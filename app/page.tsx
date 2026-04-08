"use client";

import { useState, useEffect, useCallback } from "react";
import { ChartLoader } from "@/components/ChartLoader";
import dynamic from "next/dynamic";
import { ValuesInspector } from "@/components/ValuesInspector";
import { ResourceDetail } from "@/components/ResourceDetail";
import { EnvSwitcher } from "@/components/EnvSwitcher";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { LayoutGrid, GitBranch, ChevronDown, ChevronUp, Download } from "lucide-react";
import yaml from "js-yaml";
import type {
  ChartRenderResult,
  EnvRenderResult,
  ResourceNodeData,
  ResourceGraphNode,
  K8sKind,
} from "@/types/helm";
import type { GraphData } from "@/types/helm";

const HISTORY_KEY = "helm-viz-history";
const MAX_HISTORY = 8;

export interface HistoryEntry {
  id: string;
  name: string;
  version: string;
  source: "workspace" | "upload" | "artifacthub";
  url?: string;
  loadedAt: string;
  result: ChartRenderResult;
}

const ResourceGraph = dynamic(
  () => import("@/components/ResourceGraph").then((m) => m.ResourceGraph),
  { ssr: false, loading: () => <GraphPlaceholder text="Loading graph…" /> }
);

function getEnvGraph(result: ChartRenderResult | null, env: string): GraphData | null {
  if (!result) return null;
  const envResult = result.environments.find((e) => e.env === env);
  if (!envResult) return null;
  return (envResult as EnvRenderResult & { graph?: GraphData }).graph ?? null;
}

function getEnvResult(result: ChartRenderResult | null, env: string): EnvRenderResult | null {
  if (!result) return null;
  return result.environments.find((e) => e.env === env) ?? null;
}

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveHistory(entry: HistoryEntry) {
  const prev = loadHistory().filter((h) => h.name !== entry.name || h.source !== entry.source);
  const next = [entry, ...prev].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

/** Count resources grouped by kind from the active environment */
function getKindCounts(result: ChartRenderResult | null, env: string): Record<string, number> {
  const envResult = getEnvResult(result, env);
  if (!envResult) return {};
  return envResult.resources.reduce<Record<string, number>>((acc, r) => {
    acc[r.kind] = (acc[r.kind] ?? 0) + 1;
    return acc;
  }, {});
}

const KIND_BADGE_COLOR: Partial<Record<K8sKind, string>> = {
  Deployment: "bg-blue-900 text-blue-300 border-blue-700",
  Service: "bg-green-900 text-green-300 border-green-700",
  Ingress: "bg-yellow-900 text-yellow-300 border-yellow-700",
  HorizontalPodAutoscaler: "bg-purple-900 text-purple-300 border-purple-700",
  CronJob: "bg-orange-900 text-orange-300 border-orange-700",
  ConfigMap: "bg-teal-900 text-teal-300 border-teal-700",
  ServiceAccount: "bg-gray-700 text-gray-300 border-gray-600",
  Secret: "bg-red-900 text-red-300 border-red-700",
};

const KIND_LABEL: Partial<Record<K8sKind, string>> = {
  Deployment: "Deploy",
  HorizontalPodAutoscaler: "HPA",
  PersistentVolumeClaim: "PVC",
  ServiceAccount: "SA",
};

export default function Home() {
  const [chartResult, setChartResult] = useState<ChartRenderResult | null>(null);
  const [activeEnv, setActiveEnv] = useState<string>("");
  const [diffEnv, setDiffEnv] = useState<string | null>(null);
  const [selectedResource, setSelectedResource] = useState<ResourceNodeData | null>(null);
  const [highlightedKeys, setHighlightedKeys] = useState<string[]>([]);
  const [showLoader, setShowLoader] = useState(true);
  const [valuesOpen, setValuesOpen] = useState(true);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    setHistory(loadHistory());
    fetch("/api/workspace-chart")
      .then((r) => r.json())
      .then((data: ChartRenderResult) => {
        if (data && data.chartMeta) {
          handleChartLoad(data, "workspace");
          setShowLoader(false);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChartLoad = useCallback((result: ChartRenderResult, source: "workspace" | "upload" | "artifacthub" = "workspace", url?: string) => {
    setChartResult(result);
    setActiveEnv(result.activeEnv);
    setDiffEnv(null);
    setSelectedResource(null);
    setShowLoader(false);

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      name: result.chartMeta.name,
      version: result.chartMeta.version,
      source,
      url,
      loadedAt: new Date().toISOString(),
      result,
    };
    saveHistory(entry);
    setHistory(loadHistory());
  }, []);

  function exportYaml() {
    if (!chartResult) return;
    const envResult = getEnvResult(chartResult, activeEnv);
    if (!envResult) return;
    const yamlText = envResult.resources
      .map((r) => "---\n" + yaml.dump(r, { lineWidth: -1 }))
      .join("");
    const blob = new Blob([yamlText], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${chartResult.chartMeta.name}-${activeEnv}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const currentGraph = getEnvGraph(chartResult, activeEnv);
  const currentEnvResult = getEnvResult(chartResult, activeEnv);
  const diffGraph = getEnvGraph(chartResult, diffEnv ?? "");
  const diffNodes = useDiffNodes(currentGraph?.nodes ?? [], diffGraph?.nodes ?? []);
  const kindCounts = getKindCounts(chartResult, activeEnv);

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white overflow-hidden">
      <header className="flex items-center justify-between px-5 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0 z-10">
        <div className="flex items-center gap-3 min-w-0 overflow-hidden">
          <GitBranch className="w-5 h-5 text-blue-400 shrink-0" />
          <span className="font-bold text-white text-base shrink-0">Helm Chart Visualizer</span>
          {chartResult && (
            <>
              <span className="text-zinc-400 text-sm shrink-0">
                — <span className="text-zinc-200">{chartResult.chartMeta.name}</span>{" "}
                <span className="text-zinc-500 text-xs">v{chartResult.chartMeta.version}</span>
              </span>
              {/* Kind count badges */}
              <div className="hidden lg:flex items-center gap-1 ml-2 overflow-hidden">
                {Object.entries(kindCounts).map(([kind, count]) => {
                  const colorClass = KIND_BADGE_COLOR[kind as K8sKind] ?? "bg-zinc-800 text-zinc-300 border-zinc-600";
                  const label = KIND_LABEL[kind as K8sKind] ?? kind;
                  return (
                    <span
                      key={kind}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${colorClass}`}
                      title={kind}
                    >
                      {label}
                      <span className="opacity-70">{count}</span>
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {chartResult && (
            <button
              onClick={exportYaml}
              className="flex items-center gap-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
              title={`Export ${activeEnv} YAML`}
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
          )}
          <button
            onClick={() => setShowLoader((v) => !v)}
            className="flex items-center gap-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            {chartResult ? "Change Chart" : "Load Chart"}
          </button>
        </div>
      </header>

      {showLoader && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-zinc-950/90 backdrop-blur-sm p-6">
          <div className="w-full max-w-2xl">
            <ChartLoader onLoad={handleChartLoad} history={history} />
            {chartResult && (
              <button
                onClick={() => setShowLoader(false)}
                className="w-full mt-3 text-zinc-500 hover:text-zinc-300 text-sm text-center"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {chartResult && (
        <EnvSwitcher
          environments={chartResult.environments}
          activeEnv={activeEnv}
          diffEnv={diffEnv}
          onEnvChange={(env) => { setActiveEnv(env); setSelectedResource(null); }}
          onDiffEnvChange={setDiffEnv}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative overflow-hidden">
          {!chartResult && !showLoader && (
            <WelcomeScreen onLoadChart={() => setShowLoader(true)} />
          )}
          {currentEnvResult?.renderError && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-red-950 border border-red-700 text-red-300 text-xs rounded-lg px-4 py-2 max-w-lg">
              ⚠ Render error: {currentEnvResult.renderError}
            </div>
          )}
          {currentGraph && (
            <ResourceGraph
              nodes={diffNodes.length > 0 ? diffNodes : currentGraph.nodes}
              edges={currentGraph.edges}
              highlightedKeys={highlightedKeys}
              onNodeSelect={setSelectedResource}
            />
          )}
        </div>

        {selectedResource && (
          <div className="w-[380px] shrink-0 overflow-hidden flex flex-col">
            <ResourceDetail
              data={selectedResource}
              onClose={() => setSelectedResource(null)}
            />
          </div>
        )}
      </div>

      {chartResult && (
        <div
          className="shrink-0 bg-zinc-900 border-t border-zinc-700"
          style={{ height: valuesOpen ? 240 : 36 }}
        >
          <button
            onClick={() => setValuesOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-2 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            {valuesOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span className="font-semibold">Values Inspector</span>
            {currentEnvResult && (
              <span className="text-zinc-600 ml-1">
                — {currentEnvResult.valuesTree.entries.length} keys
              </span>
            )}
          </button>
          {valuesOpen && (
            <div className="overflow-hidden" style={{ height: 204 }}>
              <ValuesInspector
                valuesTree={currentEnvResult?.valuesTree ?? null}
                onHighlightKey={setHighlightedKeys}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function useDiffNodes(
  baseNodes: ResourceGraphNode[],
  compareNodes: ResourceGraphNode[]
): ResourceGraphNode[] {
  if (compareNodes.length === 0) return [];
  const compareMap = new Map(compareNodes.map((n) => [n.id, n]));
  return baseNodes.map((node) => {
    const other = compareMap.get(node.id);
    const changed = !other || JSON.stringify(node.data.resource) !== JSON.stringify(other.data.resource);
    return changed ? { ...node, data: { ...node.data, highlighted: true } } : node;
  });
}

function GraphPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-3">
      <GitBranch className="w-10 h-10" />
      <p className="text-sm max-w-sm text-center">{text}</p>
    </div>
  );
}
