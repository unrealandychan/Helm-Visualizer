import { NextResponse } from "next/server";
import { mkdir, rm } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { runHelmPull } from "@/lib/helmRunner";
import { resolveArtifactHubUrl, downloadTgz } from "@/lib/artifactHub";
import { assertSafeUrl } from "@/lib/ssrf";
import { extract } from "tar";
import { renderChart } from "@/lib/chartRenderer";

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
      await assertSafeUrl(body.url);
      const resolved = await resolveArtifactHubUrl(body.url);
      await assertSafeUrl(resolved.contentUrl);
      const dest = path.join(tmpDir, "chart.tgz");
      await downloadTgz(resolved.contentUrl, dest);
      tgzPath = dest;
    } else if (body.repoUrl && body.chartName) {
      // Use helm pull directly
      assertSafeUrl(body.repoUrl);
      if (!/^[a-zA-Z0-9_-]+$/.test(body.chartName)) {
        return NextResponse.json(
          { error: "Invalid chart name. Chart names must only contain letters, digits, hyphens, and underscores." },
          { status: 400 }
        );
      }
      if (body.version !== undefined && !/^[a-zA-Z0-9._+:-]+$/.test(body.version)) {
        return NextResponse.json(
          { error: "Invalid version format. Versions must only contain letters, digits, dots, hyphens, underscores, plus signs, and colons." },
          { status: 400 }
        );
      }
      tgzPath = await runHelmPull(body.repoUrl, body.chartName, tmpDir, body.version);
    } else if (body.url) {
      // Treat URL as a direct .tgz download link — must be https or oci
      await assertSafeUrl(body.url);
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

