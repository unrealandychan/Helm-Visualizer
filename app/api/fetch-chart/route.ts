import { NextResponse } from "next/server";
import { mkdir, rm } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { runHelmPull } from "@/lib/helmRunner";
import { resolveArtifactHubUrl, downloadTgz } from "@/lib/artifactHub";
import { extract } from "tar";
import { renderChart } from "@/lib/chartRenderer";

// Private / loopback address patterns that must never be fetched (SSRF guard).
const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|fd[0-9a-f]{2}:)/i;

/**
 * Validate that a URL is safe to fetch:
 * - Must use https://' or oci://
 * - Host must not resolve to an internal/private address
 */
function assertSafeUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "oci:") {
    throw new Error("Only https:// and oci:// URLs are allowed.");
  }

  const host = parsed.hostname.toLowerCase();
  if (PRIVATE_HOST_RE.test(host)) {
    throw new Error("Requests to private or loopback addresses are not allowed.");
  }
}

export async function POST(request: Request) {
  const tmpDir = path.join("/tmp", `helm-fetch-${randomUUID()}`);

  try {
    const body = (await request.json()) as { url?: string; repoUrl?: string; chartName?: string; version?: string };

    if (!body.url && !body.repoUrl) {
      return NextResponse.json(
        { error: "Provide either a `url` (Artifact Hub package URL) or `repoUrl` + `chartName`." },
        { status: 400 }
      );
    }

    await mkdir(tmpDir, { recursive: true });
    const extractDir = path.join(tmpDir, "extracted");
    await mkdir(extractDir, { recursive: true });

    let tgzPath: string;

    if (body.url && body.url.includes("artifacthub.io")) {
      // Resolve via Artifact Hub API
      assertSafeUrl(body.url);
      const resolved = await resolveArtifactHubUrl(body.url);
      assertSafeUrl(resolved.contentUrl);
      const dest = path.join(tmpDir, "chart.tgz");
      await downloadTgz(resolved.contentUrl, dest);
      tgzPath = dest;
    } else if (body.repoUrl && body.chartName) {
      // Use helm pull directly
      assertSafeUrl(body.repoUrl);
      tgzPath = await runHelmPull(body.repoUrl, body.chartName, tmpDir, body.version);
    } else if (body.url) {
      // Treat URL as a direct .tgz download link — must be https or oci
      assertSafeUrl(body.url);
      const dest = path.join(tmpDir, "chart.tgz");
      await downloadTgz(body.url, dest);
      tgzPath = dest;
    } else {
      return NextResponse.json({ error: "Invalid request parameters." }, { status: 400 });
    }

    // Extract
    await extract({ file: tgzPath, cwd: extractDir, strip: 1 });

    return await renderChart(extractDir);
  } catch (err) {
    console.error("[fetch-chart] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

