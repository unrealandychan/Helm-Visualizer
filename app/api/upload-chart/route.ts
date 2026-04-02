import { NextResponse } from "next/server";
import { writeFile, mkdir, readFile, readdir, rm } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { ChartRenderResult, EnvRenderResult, HelmChartMeta } from "@/types/helm";
import { runHelmTemplate } from "@/lib/helmRunner";
import { parseMultiDocYaml, extractValuesEntries } from "@/lib/yamlParser";
import { buildGraph } from "@/lib/graphBuilder";
import yaml from "js-yaml";
import { extract } from "tar";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

export async function POST(request: Request) {
  const tmpDir = path.join("/tmp", `helm-upload-${randomUUID()}`);

  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Request must be multipart/form-data" },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.endsWith(".tgz") && !file.name.endsWith(".tar.gz")) {
      return NextResponse.json(
        { error: "Only .tgz / .tar.gz Helm chart archives are accepted." },
        { status: 400 }
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File too large. Max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` },
        { status: 413 }
      );
    }

    // Write to temp dir
    await mkdir(tmpDir, { recursive: true });
    const tgzPath = path.join(tmpDir, "chart.tgz");
    const extractDir = path.join(tmpDir, "extracted");
    await mkdir(extractDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(tgzPath, buffer);

    // Extract (strip top-level chart dir)
    await extract({ file: tgzPath, cwd: extractDir, strip: 1 });

    return await renderChart(extractDir, tmpDir);
  } catch (err) {
    console.error("[upload-chart] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  } finally {
    // Always clean up temp files
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function renderChart(chartDir: string, tmpDir: string): Promise<NextResponse> {
  if (!existsSync(path.join(chartDir, "Chart.yaml"))) {
    return NextResponse.json(
      { error: "No Chart.yaml found in the archive. Is this a valid Helm chart?" },
      { status: 422 }
    );
  }

  const chartYamlStr = await readFile(path.join(chartDir, "Chart.yaml"), "utf-8");
  const chartMeta = yaml.load(chartYamlStr) as HelmChartMeta;

  // Discover values files
  const allFiles = await readdir(chartDir);
  const valuesFiles = allFiles
    .filter((f) => f.startsWith("values") && f.endsWith(".yaml"))
    .map((f) => path.join(chartDir, f));

  // Fall back to single values.yaml if no env-specific files found
  const effectiveValuesFiles = valuesFiles.length > 0
    ? valuesFiles
    : [];

  // Read template files
  const templatesDir = path.join(chartDir, "templates");
  const templateFiles: Record<string, string> = {};
  if (existsSync(templatesDir)) {
    const names = await readdir(templatesDir);
    await Promise.all(
      names.map(async (name) => {
        if (name.endsWith(".yaml") || name.endsWith(".tpl")) {
          templateFiles[name] = await readFile(path.join(templatesDir, name), "utf-8");
        }
      })
    );
  }

  // Render each values file (or a single default render if none)
  const renderTargets = effectiveValuesFiles.length > 0
    ? effectiveValuesFiles.map((vf) => ({ vf, env: extractEnvName(vf) }))
    : [{ vf: undefined, env: "default" }];

  const environments: EnvRenderResult[] = await Promise.all(
    renderTargets.map(async ({ vf, env }) => {
      try {
        const vfArr = vf ? [vf] : [];
        const rendered = await runHelmTemplate(chartDir, "release", vfArr);
        const resources = parseMultiDocYaml(rendered);
        const valuesYaml = vf ? await readFile(vf, "utf-8") : "";
        const valuesTree = extractValuesEntries(valuesYaml, env, templateFiles);
        const graph = buildGraph(resources, rendered);

        return {
          env,
          valuesFile: vf ? path.basename(vf) : "values.yaml",
          resources,
          valuesTree,
          graph,
        } as EnvRenderResult & { graph: ReturnType<typeof buildGraph> };
      } catch (err) {
        return {
          env,
          valuesFile: vf ? path.basename(vf) : "values.yaml",
          resources: [],
          valuesTree: { env, raw: {}, entries: [] },
          renderError: err instanceof Error ? err.message : String(err),
        } as EnvRenderResult;
      }
    })
  );

  const result: ChartRenderResult = {
    chartMeta,
    environments,
    activeEnv: environments[0]?.env ?? "default",
  };

  return NextResponse.json(result);
}

function extractEnvName(valuesFilePath: string): string {
  const base = path.basename(valuesFilePath, ".yaml");
  const parts = base.split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "default";
}
