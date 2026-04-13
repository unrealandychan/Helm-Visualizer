import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { ChartRenderResult, EnvRenderResult, HelmChartMeta } from "@/types/helm";
import { runHelmTemplate } from "@/lib/helmRunner";
import { parseMultiDocYaml, extractValuesEntries } from "@/lib/yamlParser";
import { buildGraph } from "@/lib/graphBuilder";
import yaml from "js-yaml";

export function extractEnvName(valuesFilePath: string): string {
  const base = path.basename(valuesFilePath, ".yaml");
  const parts = base.split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "default";
}

export async function renderChart(chartDir: string): Promise<NextResponse> {
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

  const renderTargets =
    valuesFiles.length > 0
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
          renderedManifest: rendered,
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
