import { NextResponse } from "next/server";
import { mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { ChartRenderResult, EnvRenderResult, HelmChartMeta } from "@/types/helm";
import { runHelmTemplate, runHelmPull } from "@/lib/helmRunner";
import { parseMultiDocYaml, extractValuesEntries } from "@/lib/yamlParser";
import { buildGraph } from "@/lib/graphBuilder";
import { resolveArtifactHubUrl, downloadTgz } from "@/lib/artifactHub";
import { extract } from "tar";
import { readFile, readdir } from "fs/promises";
import yaml from "js-yaml";

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
      const resolved = await resolveArtifactHubUrl(body.url);
      const dest = path.join(tmpDir, "chart.tgz");
      await downloadTgz(resolved.contentUrl, dest);
      tgzPath = dest;
    } else if (body.repoUrl && body.chartName) {
      // Use helm pull directly
      tgzPath = await runHelmPull(body.repoUrl, body.chartName, tmpDir, body.version);
    } else if (body.url) {
      // Treat URL as a direct .tgz download link
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

async function renderChart(chartDir: string): Promise<NextResponse> {
  if (!existsSync(path.join(chartDir, "Chart.yaml"))) {
    return NextResponse.json(
      { error: "No Chart.yaml found in the archive. Is this a valid Helm chart?" },
      { status: 422 }
    );
  }

  const chartYamlStr = await readFile(path.join(chartDir, "Chart.yaml"), "utf-8");
  const chartMeta = yaml.load(chartYamlStr) as HelmChartMeta;

  const allFiles = await readdir(chartDir);
  const valuesFiles = allFiles
    .filter((f) => f.startsWith("values") && f.endsWith(".yaml"))
    .map((f) => path.join(chartDir, f));

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

  const renderTargets = valuesFiles.length > 0
    ? valuesFiles.map((vf) => ({ vf, env: extractEnvName(vf) }))
    : [{ vf: undefined as string | undefined, env: "default" }];

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

  return NextResponse.json({
    chartMeta,
    environments,
    activeEnv: environments[0]?.env ?? "default",
  } as ChartRenderResult);
}

function extractEnvName(valuesFilePath: string): string {
  const base = path.basename(valuesFilePath, ".yaml");
  const parts = base.split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "default";
}
