import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { assertSafeHostname } from "@/lib/ssrf";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com";

/**
 * Parsed components of a GitHub tree URL.
 */
export interface GitHubUrlInfo {
  owner: string;
  repo: string;
  /** Branch name, tag, or "HEAD" */
  ref: string;
  /** Path within the repo to the chart root (empty string = repo root) */
  subpath: string;
}

// Allow alphanumeric, hyphens, underscores, and dots (covers semver tags, owner/repo names)
const SAFE_SEGMENT_RE = /^[a-zA-Z0-9_.\-]+$/;

/**
 * Parse a GitHub URL into owner/repo/ref/subpath components.
 *
 * Supported formats:
 *   https://github.com/user/repo
 *   https://github.com/user/repo/tree/main
 *   https://github.com/user/repo/tree/v1.2.3/charts/myapp
 */
export function parseGitHubUrl(rawUrl: string): GitHubUrlInfo {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL.");
  }

  if (parsed.hostname !== "github.com") {
    throw new Error("Only github.com URLs are supported for Git import.");
  }

  // Decode each path segment individually to handle percent-encoding
  const parts = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });

  // Reject any path traversal in any segment
  if (parts.some((p) => p === "." || p === "..")) {
    throw new Error("Path traversal not allowed.");
  }

  if (parts.length < 2) {
    throw new Error(
      "Invalid GitHub URL. Expected: https://github.com/owner/repo or https://github.com/owner/repo/tree/branch"
    );
  }

  const owner = parts[0];
  const repo = parts[1];

  if (!SAFE_SEGMENT_RE.test(owner) || !SAFE_SEGMENT_RE.test(repo)) {
    throw new Error("Invalid GitHub owner or repository name.");
  }

  // /tree/{ref}[/{subpath...}]
  if (parts[2] !== undefined && parts[2] !== "tree") {
    throw new Error(
      "Unsupported GitHub URL format. Use: https://github.com/owner/repo/tree/branch[/path]"
    );
  }

  let ref = "HEAD";
  let subpath = "";

  if (parts[2] === "tree") {
    if (!parts[3]) {
      throw new Error("Invalid GitHub URL: missing branch or tag after /tree/.");
    }
    ref = parts[3];
    subpath = parts.slice(4).join("/");
  }

  if (!SAFE_SEGMENT_RE.test(ref)) {
    throw new Error(
      "Invalid branch or tag name. Branch names with slashes are not supported in URL form."
    );
  }

  return { owner, repo, ref, subpath };
}

// ─── GitHub API helpers ───────────────────────────────────────────────────────

interface GitHubContentItem {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  download_url: string | null;
}

function buildApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "Helm-Visualizer/1.0",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

function buildRawHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "Helm-Visualizer/1.0",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

/**
 * Encode a repo-relative file path for use in a GitHub URL.
 * Each segment is percent-encoded individually so slashes remain as path separators.
 */
function encodeRepoPath(repoPath: string): string {
  return repoPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

/**
 * List the contents of a directory in a GitHub repository.
 * Returns an empty array when the path does not exist (404).
 */
async function listContents(
  owner: string,
  repo: string,
  dirPath: string,
  ref: string
): Promise<GitHubContentItem[]> {
  const encodedPath = dirPath ? encodeRepoPath(dirPath) : "";
  const url =
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}` +
    `?ref=${encodeURIComponent(ref)}`;

  const res = await fetch(url, {
    headers: buildApiHeaders(),
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 404) {
    return [];
  }

  if (res.status === 403 || res.status === 401) {
    const body = await res.json().catch(() => null) as { message?: string } | null;
    const msg = body?.message ?? "";
    if (msg.toLowerCase().includes("rate limit")) {
      throw new Error("GitHub API rate limit exceeded. Please try again later.");
    }
    throw new Error(
      "Access denied. This may be a private repository or your GitHub token lacks access."
    );
  }

  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${res.statusText}`);
  }

  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    // Single file returned instead of a directory listing
    return [];
  }

  return data as GitHubContentItem[];
}

/**
 * Fetch a raw file from GitHub.
 * Returns null when the file does not exist (404).
 * Throws on private-repo / auth errors.
 */
async function fetchRawFile(
  owner: string,
  repo: string,
  filePath: string,
  ref: string
): Promise<Buffer | null> {
  const encodedPath = encodeRepoPath(filePath);
  const url = `${GITHUB_RAW_BASE}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${encodedPath}`;

  const res = await fetch(url, {
    headers: buildRawHeaders(),
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 404) {
    return null;
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "Private repo or missing Chart.yaml. Ensure the repository is public and the URL points to a Helm chart directory."
    );
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch ${filePath}: ${res.status} ${res.statusText}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Fetch all chart files from a GitHub repository into `destDir`.
 *
 * Files fetched:
 *   Chart.yaml        (required — throws when absent)
 *   values.yaml       (optional)
 *   values-*.yaml     (optional, any additional values overlays)
 *   templates/*.yaml  (optional)
 *   templates/*.tpl   (optional)
 *   charts/*.tgz      (optional packaged dependencies)
 */
export async function fetchGitHubChart(
  info: GitHubUrlInfo,
  destDir: string
): Promise<void> {
  const { owner, repo, ref, subpath } = info;

  // SSRF guard — verify GitHub endpoints resolve to public IPs
  await assertSafeHostname("api.github.com");
  await assertSafeHostname("raw.githubusercontent.com");

  const chartRoot = subpath || "";

  /** Build the full in-repo path from a chart-relative path. */
  const repoPath = (relPath: string): string =>
    chartRoot ? `${chartRoot}/${relPath}` : relPath;

  /** Write content to destDir, creating intermediate directories.
   *  Guards against path traversal by verifying the resolved path
   *  stays within destDir. */
  async function saveFile(relPath: string, content: Buffer): Promise<void> {
    const destPath = path.resolve(destDir, relPath);
    // Ensure the resolved path is within destDir (prevents path traversal)
    if (!destPath.startsWith(destDir + path.sep) && destPath !== destDir) {
      throw new Error(`Path traversal detected in chart file path: ${relPath}`);
    }
    await mkdir(path.dirname(destPath), { recursive: true });
    await writeFile(destPath, content);
  }

  // ── 1. Chart.yaml (required) ──────────────────────────────────────────────
  const chartYamlContent = await fetchRawFile(owner, repo, repoPath("Chart.yaml"), ref);
  if (!chartYamlContent) {
    throw new Error(
      "Private repo or missing Chart.yaml. Ensure the repository is public and the URL points to a Helm chart directory."
    );
  }
  await saveFile("Chart.yaml", chartYamlContent);

  // ── 2. List the chart root directory ─────────────────────────────────────
  const rootItems = await listContents(owner, repo, chartRoot, ref);

  // ── 3. values.yaml + extra values-*.yaml overlays ────────────────────────
  const valueFiles = rootItems.filter(
    (item) =>
      item.type === "file" &&
      (item.name === "values.yaml" ||
        (item.name.startsWith("values") && item.name.endsWith(".yaml")))
  );

  await Promise.all(
    valueFiles.map(async (item) => {
      const content = await fetchRawFile(owner, repo, repoPath(item.name), ref);
      if (content) {
        await saveFile(item.name, content);
      }
    })
  );

  // ── 4. templates/ ─────────────────────────────────────────────────────────
  const templateItems = await listContents(owner, repo, repoPath("templates"), ref);
  const templateFiles = templateItems.filter(
    (item) =>
      item.type === "file" &&
      (item.name.endsWith(".yaml") ||
        item.name.endsWith(".yml") ||
        item.name.endsWith(".tpl") ||
        item.name.endsWith(".txt"))
  );

  await Promise.all(
    templateFiles.map(async (item) => {
      const content = await fetchRawFile(
        owner,
        repo,
        repoPath(`templates/${item.name}`),
        ref
      );
      if (content) {
        await saveFile(`templates/${item.name}`, content);
      }
    })
  );

  // ── 5. charts/ (packaged dependencies — .tgz only) ───────────────────────
  const chartsItems = await listContents(owner, repo, repoPath("charts"), ref);
  const chartsTgz = chartsItems.filter(
    (item) => item.type === "file" && item.name.endsWith(".tgz")
  );

  if (chartsTgz.length > 0) {
    await mkdir(path.join(destDir, "charts"), { recursive: true });
    await Promise.all(
      chartsTgz.map(async (item) => {
        const content = await fetchRawFile(
          owner,
          repo,
          repoPath(`charts/${item.name}`),
          ref
        );
        if (content) {
          await saveFile(`charts/${item.name}`, content);
        }
      })
    );
  }
}
