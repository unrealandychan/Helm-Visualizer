import { NextResponse } from "next/server";
import { writeFile, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { runHelmTemplate } from "@/lib/helmRunner";

const CHART_DIR = path.join(process.cwd(), "helm");

/**
 * POST /api/render-manifest
 *
 * Re-render the workspace chart with optional custom values override.
 * Body: { customValues?: string }   — raw YAML to merge on top of the existing values
 *
 * Returns: { renderedManifest: string } | { error: string }
 */
export async function POST(request: Request) {
  if (!existsSync(CHART_DIR)) {
    return NextResponse.json(
      { error: "No helm/ directory found in the workspace." },
      { status: 404 }
    );
  }

  const tmpDir = path.join("/tmp", `helm-rerender-${randomUUID()}`);

  try {
    const body = (await request.json()) as { customValues?: string };
    const customValuesYaml = typeof body.customValues === "string" ? body.customValues.trim() : "";

    let valuesFiles: string[] = [];

    if (customValuesYaml) {
      // Write the custom values to a temp file so helm / the JS renderer can consume them
      await mkdir(tmpDir, { recursive: true });
      const overridePath = path.join(tmpDir, "override-values.yaml");
      await writeFile(overridePath, customValuesYaml, "utf-8");
      valuesFiles = [overridePath];
    }

    const renderedManifest = await runHelmTemplate(CHART_DIR, "release", valuesFiles);
    return NextResponse.json({ renderedManifest });
  } catch (err) {
    console.error("[render-manifest] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
