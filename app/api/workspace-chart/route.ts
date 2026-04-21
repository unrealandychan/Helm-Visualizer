import { NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { ChartRenderResult, EnvRenderResult, HelmChartMeta } from "@/types/helm";
import { runHelmTemplate } from "@/lib/helmRunner";
import { parseMultiDocYaml, extractValuesEntries } from "@/lib/yamlParser";
import { buildGraph } from "@/lib/graphBuilder";
import yaml from "js-yaml";
import { extractEnvName } from "@/lib/chartRenderer";

// The workspace helm chart directory.
// When the server is launched by `helm viz`, HELM_CHART_DIR is set to the
// chart directory supplied on the command line; otherwise fall back to the
// conventional helm/ directory inside the repository root.
const CHART_DIR = process.env.HELM_CHART_DIR
  ? path.resolve(process.env.HELM_CHART_DIR)
  : path.join(process.cwd(), "helm");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedEnv = searchParams.get("env"); // optional filter

  try {
    if (!existsSync(CHART_DIR)) {
      return NextResponse.json(
        { error: "No helm/ directory found in the workspace." },
        { status: 404 }
      );
    }

    // Read Chart.yaml
    const chartYamlPath = path.join(CHART_DIR, "Chart.yaml");
    const chartYamlStr = await readFile(chartYamlPath, "utf-8");
    const chartMeta = yaml.load(chartYamlStr) as HelmChartMeta;

    // Discover values.*.yaml files
    const allFiles = await readdir(CHART_DIR);
    let valuesFiles = allFiles
      .filter((f) => f.startsWith("values") && f.endsWith(".yaml"))
      .map((f) => path.join(CHART_DIR, f));

    if (requestedEnv) {
      valuesFiles = valuesFiles.filter((f) => f.includes(requestedEnv));
      if (valuesFiles.length === 0) {
        valuesFiles = [path.join(CHART_DIR, `values.${requestedEnv}.yaml`)].filter(existsSync);
      }
    }

    // Read all template files for value-reference scanning
    const templatesDir = path.join(CHART_DIR, "templates");
    const templateFiles: Record<string, string> = {};
    if (existsSync(templatesDir)) {
      const templateNames = await readdir(templatesDir);
      await Promise.all(
        templateNames.map(async (name) => {
          if (name.endsWith(".yaml") || name.endsWith(".tpl")) {
            templateFiles[name] = await readFile(
              path.join(templatesDir, name),
              "utf-8"
            );
          }
        })
      );
    }

    // Render each environment
    const environments: EnvRenderResult[] = await Promise.all(
      valuesFiles.map(async (vf) => {
        const envName = extractEnvName(vf);
        try {
          const rendered = await runHelmTemplate(CHART_DIR, "release", [vf]);
          const resources = parseMultiDocYaml(rendered);
          const valuesYaml = await readFile(vf, "utf-8");
          const valuesTree = extractValuesEntries(valuesYaml, envName, templateFiles);
          const graph = buildGraph(resources, rendered);

          return {
            env: envName,
            valuesFile: path.basename(vf),
            resources,
            renderedManifest: rendered,
            valuesTree,
            graph,
          } as EnvRenderResult & { graph: ReturnType<typeof buildGraph> };
        } catch (err) {
          const valuesYaml = await readFile(vf, "utf-8").catch(() => "");
          const valuesTree = extractValuesEntries(valuesYaml, envName, templateFiles);
          return {
            env: envName,
            valuesFile: path.basename(vf),
            resources: [],
            valuesTree,
            renderError: err instanceof Error ? err.message : String(err),
          } as EnvRenderResult;
        }
      })
    );

    const result: ChartRenderResult = {
      chartMeta,
      environments,
      activeEnv: requestedEnv ?? (environments[0]?.env ?? ""),
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[workspace-chart] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

