import { NextResponse } from "next/server";
import { mkdir, rm } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { parseGitHubUrl, fetchGitHubChart } from "@/lib/githubImport";
import { renderChart } from "@/lib/chartRenderer";

// ── 24-hour in-memory result cache ───────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  data: unknown;
  status: number;
  expiresAt: number;
}

// Module-level cache shared across requests for the lifetime of the server process.
const chartCache = new Map<string, CacheEntry>();

function cacheKey(url: string): string {
  // Preserve case of owner/repo (GitHub redirects case variants, but owner/repo
  // names are canonical). Only trim whitespace and drop a trailing slash.
  return url.trim().replace(/\/$/, "");
}

function getCache(key: string): CacheEntry | null {
  const entry = chartCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    chartCache.delete(key);
    return null;
  }
  return entry;
}

function setCache(key: string, data: unknown, status: number): void {
  chartCache.set(key, { data, status, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const tmpDir = path.join("/tmp", `helm-git-${randomUUID()}`);

  try {
    const body = (await request.json()) as { url?: string };

    if (!body.url?.trim()) {
      return NextResponse.json(
        {
          error:
            "Provide a GitHub URL, e.g. https://github.com/user/repo/tree/main",
        },
        { status: 400 }
      );
    }

    const url = body.url.trim();
    const key = cacheKey(url);

    // Serve from cache when available
    const cached = getCache(key);
    if (cached) {
      return NextResponse.json(cached.data, { status: cached.status });
    }

    // Parse + validate the URL (throws on invalid input)
    const info = parseGitHubUrl(url);

    // Fetch chart files from GitHub into a temp directory
    await mkdir(tmpDir, { recursive: true });
    await fetchGitHubChart(info, tmpDir);

    // Render the chart using the same pipeline as the other import routes
    const renderResponse = await renderChart(tmpDir);
    const data: unknown = await renderResponse.json();
    const status = renderResponse.status;

    // Cache successful renders (200) to avoid repeated GitHub API calls
    if (status === 200) {
      setCache(key, data, status);
    }

    return NextResponse.json(data, { status });
  } catch (err) {
    console.error("[import-git] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
