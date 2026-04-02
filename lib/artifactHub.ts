import type { ArtifactHubPackage, ArtifactHubSearchResult } from "@/types/helm";

const ARTIFACT_HUB_API = "https://artifacthub.io/api/v1";

/**
 * Search Artifact Hub for Helm charts matching a query string.
 */
export async function searchArtifactHub(query: string): Promise<ArtifactHubPackage[]> {
  const url = new URL(`${ARTIFACT_HUB_API}/packages/search`);
  url.searchParams.set("ts_query_web", query);
  url.searchParams.set("kind", "0"); // 0 = Helm chart
  url.searchParams.set("limit", "10");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Artifact Hub search failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as ArtifactHubSearchResult;
  return data.packages ?? [];
}

/**
 * Resolve an Artifact Hub package URL to a concrete .tgz download URL.
 *
 * Accepts URLs in the form:
 *   https://artifacthub.io/packages/helm/{repoName}/{chartName}
 *   https://artifacthub.io/packages/helm/{repoName}/{chartName}/{version}
 *
 * Returns: { contentUrl, repoUrl, chartName, version }
 */
export async function resolveArtifactHubUrl(packageUrl: string): Promise<{
  contentUrl: string;
  repoUrl: string;
  chartName: string;
  version: string;
}> {
  // Parse the URL path
  const parsed = new URL(packageUrl);
  const parts = parsed.pathname.replace(/^\//, "").split("/");
  // expected: ["packages", "helm", repoName, chartName] or with version appended

  if (parts[0] !== "packages" || parts[1] !== "helm" || parts.length < 4) {
    throw new Error(
      `Invalid Artifact Hub URL. Expected format: https://artifacthub.io/packages/helm/{repo}/{chart}`
    );
  }

  const repoName = parts[2];
  const chartName = parts[3];
  const specificVersion = parts[4] ?? undefined;

  const apiUrl = specificVersion
    ? `${ARTIFACT_HUB_API}/packages/helm/${repoName}/${chartName}/${specificVersion}`
    : `${ARTIFACT_HUB_API}/packages/helm/${repoName}/${chartName}`;

  const res = await fetch(apiUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(
      `Artifact Hub API error ${res.status}: could not find chart "${repoName}/${chartName}"`
    );
  }

  const pkg = (await res.json()) as ArtifactHubPackage;

  if (!pkg.content_url) {
    // Fallback: construct the URL from repo URL + chart name + version
    const repoUrl = pkg.repository.url.replace(/\/$/, "");
    const tgzUrl = `${repoUrl}/${pkg.name}-${pkg.version}.tgz`;

    return {
      contentUrl: tgzUrl,
      repoUrl: pkg.repository.url,
      chartName: pkg.name,
      version: pkg.version,
    };
  }

  return {
    contentUrl: pkg.content_url,
    repoUrl: pkg.repository.url,
    chartName: pkg.name,
    version: pkg.version,
  };
}

/**
 * Download a .tgz file from a URL to a dest file path.
 * Handles both regular HTTP(S) URLs and oci:// URLs (OCI registry).
 */
export async function downloadTgz(url: string, destPath: string): Promise<void> {
  if (url.startsWith("oci://")) {
    return downloadOciChart(url, destPath);
  }

  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Failed to download chart: ${res.status} ${res.statusText}`);
  }

  const { createWriteStream } = await import("fs");
  const { pipeline } = await import("stream/promises");
  const { Readable } = await import("stream");

  const writer = createWriteStream(destPath);
  await pipeline(Readable.fromWeb(res.body as import("stream/web").ReadableStream), writer);
}

/**
 * Pull a Helm chart packaged as an OCI artifact from a container registry.
 *
 * Supports:
 *   oci://registry-1.docker.io/bitnamicharts/nginx:22.6.10
 *   oci://ghcr.io/some-org/chart:1.2.3
 *   oci://public.ecr.aws/repo/chart:tag
 *
 * For Docker Hub the auth flow uses auth.docker.io; for all others we try
 * anonymous registry auth (many public registries allow unauthenticated pulls).
 */
async function downloadOciChart(ociUrl: string, destPath: string): Promise<void> {
  // Parse oci://[registry/]repository:tag
  const withoutScheme = ociUrl.replace(/^oci:\/\//, "");
  // Split off tag
  const atIdx = withoutScheme.lastIndexOf(":");
  const ref = atIdx !== -1 ? withoutScheme.slice(0, atIdx) : withoutScheme;
  const tag = atIdx !== -1 ? withoutScheme.slice(atIdx + 1) : "latest";

  // Split registry from repo
  const slashIdx = ref.indexOf("/");
  if (slashIdx === -1) {
    throw new Error(`Invalid OCI reference: ${ociUrl}`);
  }
  const registry = ref.slice(0, slashIdx);           // e.g. registry-1.docker.io
  const repository = ref.slice(slashIdx + 1);        // e.g. bitnamicharts/nginx

  // ── 1. Authenticate ──────────────────────────────────────────────────────
  const token = await getOciToken(registry, repository);
  const authHeader = token ? `Bearer ${token}` : undefined;

  const registryBase = `https://${registry}/v2/${repository}`;

  // ── 2. Fetch manifest ────────────────────────────────────────────────────
  const manifestAccept = [
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
  ].join(", ");

  const manifestRes = await fetch(`${registryBase}/manifests/${tag}`, {
    headers: {
      Accept: manifestAccept,
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!manifestRes.ok) {
    throw new Error(
      `OCI manifest fetch failed for ${registry}/${repository}:${tag} — ${manifestRes.status} ${manifestRes.statusText}`
    );
  }

  const manifest = (await manifestRes.json()) as {
    mediaType?: string;
    manifests?: Array<{ mediaType: string; digest: string; platform?: { os: string; architecture: string } }>;
    layers?: Array<{ mediaType: string; digest: string; size: number }>;
    config?: { mediaType: string; digest: string };
  };

  // Handle manifest list (multi-arch) — pick the first entry, or "linux/amd64"
  let layers: typeof manifest.layers;
  if (manifest.manifests?.length) {
    const pick =
      manifest.manifests.find(
        (m) => m.platform?.os === "linux" && m.platform?.architecture === "amd64"
      ) ?? manifest.manifests[0];

    const singleRes = await fetch(`${registryBase}/manifests/${pick.digest}`, {
      headers: {
        Accept: manifestAccept,
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!singleRes.ok) throw new Error(`OCI sub-manifest fetch failed: ${singleRes.status}`);
    const single = (await singleRes.json()) as typeof manifest;
    layers = single.layers;
  } else {
    layers = manifest.layers;
  }

  if (!layers?.length) {
    throw new Error(`No layers found in OCI manifest for ${ociUrl}`);
  }

  // Helm chart layer is the first layer with a helm-specific mediaType, or just [0]
  const chartLayer =
    layers.find((l) =>
      l.mediaType.includes("helm.chart.content") ||
      l.mediaType.includes("tar+gzip") ||
      l.mediaType.includes("octet-stream")
    ) ?? layers[0];

  // ── 3. Pull the blob ──────────────────────────────────────────────────────
  const blobRes = await fetch(`${registryBase}/blobs/${chartLayer.digest}`, {
    headers: {
      Accept: chartLayer.mediaType,
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    signal: AbortSignal.timeout(60_000),
  });

  if (!blobRes.ok || !blobRes.body) {
    throw new Error(`OCI blob fetch failed: ${blobRes.status} ${blobRes.statusText}`);
  }

  const { createWriteStream } = await import("fs");
  const { pipeline } = await import("stream/promises");
  const { Readable } = await import("stream");

  const writer = createWriteStream(destPath);
  await pipeline(Readable.fromWeb(blobRes.body as import("stream/web").ReadableStream), writer);
}

/**
 * Obtain an OCI registry bearer token for anonymous pulls.
 * Returns null if no auth challenge is needed.
 */
async function getOciToken(registry: string, repository: string): Promise<string | null> {
  // Probe the registry for a WWW-Authenticate challenge
  const probeRes = await fetch(`https://${registry}/v2/`, {
    signal: AbortSignal.timeout(10_000),
  });

  const wwwAuth = probeRes.headers.get("www-authenticate") ?? "";
  if (!wwwAuth.toLowerCase().startsWith("bearer ")) return null;

  // Parse realm, service, scope from header
  const realm = (wwwAuth.match(/realm="([^"]+)"/) ?? [])[1];
  const service = (wwwAuth.match(/service="([^"]+)"/) ?? [])[1];
  if (!realm) return null;

  const authUrl = new URL(realm);
  if (service) authUrl.searchParams.set("service", service);
  authUrl.searchParams.set("scope", `repository:${repository}:pull`);

  const tokenRes = await fetch(authUrl.toString(), {
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) return null;

  const tokenData = (await tokenRes.json()) as { token?: string; access_token?: string };
  return tokenData.token ?? tokenData.access_token ?? null;
}
