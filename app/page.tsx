"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ChartLoader } from "@/components/ChartLoader";
import dynamic from "next/dynamic";
import { ValuesInspector } from "@/components/ValuesInspector";
import { ResourceDetail } from "@/components/ResourceDetail";
import { ManifestPreview } from "@/components/ManifestPreview";
import { EnvSwitcher } from "@/components/EnvSwitcher";
import { EnvDiffPanel } from "@/components/EnvDiffPanel";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { ChatBot } from "@/components/ChatBot";
import { LayoutGrid, GitBranch, ChevronDown, ChevronUp, Download, AlertTriangle, Layers, FileImage, FileJson, FileText, Image as ImageIcon } from "lucide-react";
import yaml from "js-yaml";
import type {
  ChartRenderResult,
  EnvRenderResult,
  ResourceNodeData,
  ResourceGraphNode,
  K8sKind,
} from "@/types/helm";
import type { GraphData } from "@/types/helm";
import { computeValuesDiff } from "@/lib/valueDiff";
import { exportGraphAsJson, exportGraphAsMarkdown, triggerDownload } from "@/lib/graphExport";
import type { ResourceGraphHandle } from "@/components/ResourceGraph";

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
  const [showDiffPanel, setShowDiffPanel] = useState(false);
  const [showManifest, setShowManifest] = useState(false);
  const [selectedValueKey, setSelectedValueKey] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportingType, setExportingType] = useState<string | null>(null);
  const graphRef = useRef<ResourceGraphHandle>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close export menu when clicking outside
  useEffect(() => {
    if (!showExportMenu) return;
    function handleClick(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showExportMenu]);

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

  async function handleGraphExport(type: "png" | "svg" | "json" | "markdown") {
    if (!chartResult) return;
    setExportingType(type);
    setShowExportMenu(false);
    try {
      const visibleNodes = diffNodes.length > 0 ? diffNodes : (currentGraph?.nodes ?? []);
      const visibleEdges = currentGraph?.edges ?? [];
      const basename = `${chartResult.chartMeta.name}-${activeEnv}-graph`;

      if (type === "png") {
        await graphRef.current?.exportPng();
      } else if (type === "svg") {
        await graphRef.current?.exportSvg();
      } else if (type === "json") {
        const content = exportGraphAsJson(visibleNodes, visibleEdges, chartResult.chartMeta, activeEnv);
        triggerDownload(content, `${basename}.json`, "application/json");
      } else if (type === "markdown") {
        const content = exportGraphAsMarkdown(
          visibleNodes,
          visibleEdges,
          chartResult.chartMeta,
          activeEnv,
          highlightedKeys
        );
        triggerDownload(content, `${basename}.md`, "text/markdown");
      }
    } finally {
      setExportingType(null);
    }
  }

  const currentGraph = getEnvGraph(chartResult, activeEnv);
  const currentEnvResult = getEnvResult(chartResult, activeEnv);
  const diffGraph = getEnvGraph(chartResult, diffEnv ?? "");
  const diffEnvResult = getEnvResult(chartResult, diffEnv ?? "");

  const diffResult = useMemo(() => {
    if (!currentEnvResult || !diffEnvResult) return null;
    return computeValuesDiff(currentEnvResult.valuesTree, diffEnvResult.valuesTree);
  }, [currentEnvResult, diffEnvResult]);

  const diffNodes = useMemo(
    () => computeDiffNodes(currentGraph?.nodes ?? [], diffGraph?.nodes ?? [], diffResult?.changedKeys ?? []),
    [currentGraph?.nodes, diffGraph?.nodes, diffResult?.changedKeys]
  );
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
            <>
              <button
                onClick={exportYaml}
                className="flex items-center gap-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
                title={`Export ${activeEnv} YAML`}
              >
                <Download className="w-3.5 h-3.5" />
                Export YAML
              </button>
              {/* Graph export dropdown */}
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={() => setShowExportMenu((v) => !v)}
                  className="flex items-center gap-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
                  title="Export graph view"
                  disabled={!!exportingType}
                >
                  <FileImage className="w-3.5 h-3.5" />
                  {exportingType ? "Exporting…" : "Export Graph"}
                  <ChevronDown className="w-3 h-3 ml-0.5" />
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 top-full mt-1 w-44 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
                    <button
                      onClick={() => handleGraphExport("png")}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                    >
                      <ImageIcon className="w-3.5 h-3.5 text-blue-400" />
                      PNG image
                    </button>
                    <button
                      onClick={() => handleGraphExport("svg")}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                    >
                      <FileImage className="w-3.5 h-3.5 text-green-400" />
                      SVG image
                    </button>
                    <div className="border-t border-zinc-700" />
                    <button
                      onClick={() => handleGraphExport("json")}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                    >
                      <FileJson className="w-3.5 h-3.5 text-yellow-400" />
                      JSON data
                    </button>
                    <button
                      onClick={() => handleGraphExport("markdown")}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5 text-purple-400" />
                      Markdown
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={() => setShowManifest((v) => !v)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors ${
                  showManifest
                    ? "bg-blue-700 text-white"
                    : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                }`}
                title="Toggle rendered manifest preview"
              >
                <Layers className="w-3.5 h-3.5" />
                Manifest
              </button>
            </>
          )}
          <button
            onClick={() => setShowLoader((v) => !v)}
            className="flex items-center gap-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            {chartResult ? "Change Chart" : "Load Chart"}
          </button>
          <a
            href="https://github.com/unrealandychan/Helm-Visualizer"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
            title="View on GitHub"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844a9.59 9.59 0 012.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            GitHub
          </a>
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
          onDiffEnvChange={(env) => { setDiffEnv(env); setShowDiffPanel(false); }}
          onViewDiff={diffResult ? () => setShowDiffPanel(true) : undefined}
        />
      )}

      {showDiffPanel && diffResult && diffEnv && (
        <EnvDiffPanel
          diffResult={diffResult}
          baseEnv={activeEnv}
          compareEnv={diffEnv}
          onClose={() => setShowDiffPanel(false)}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative overflow-hidden">
          {!chartResult && !showLoader && (
            <WelcomeScreen onLoadChart={() => setShowLoader(true)} />
          )}
          {currentEnvResult?.renderError ? (
            <RenderErrorPanel
              error={currentEnvResult.renderError}
              env={currentEnvResult.env}
              onLoadChart={() => setShowLoader(true)}
            />
          ) : (
            currentGraph && (
              <ResourceGraph
                ref={graphRef}
                nodes={diffNodes.length > 0 ? diffNodes : currentGraph.nodes}
                edges={currentGraph.edges}
                highlightedKeys={highlightedKeys}
                onNodeSelect={setSelectedResource}
                exportFilename={chartResult ? `${chartResult.chartMeta.name}-${activeEnv}-graph` : "helm-graph"}
              />
            )
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

        {showManifest && !selectedResource && (
          <div className="w-[420px] shrink-0 overflow-hidden flex flex-col">
            <ManifestPreview
              renderedManifest={currentEnvResult?.renderedManifest ?? null}
              renderError={currentEnvResult?.renderError}
              selectedValueKey={selectedValueKey}
              isWorkspace={!!chartResult?.environments.some((e) => e.valuesFile?.startsWith("values"))}
              onClose={() => setShowManifest(false)}
            />
          </div>
        )}
      </div>

      <ChatBot chartContext={chartResult} activeEnv={activeEnv} />

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
                onHighlightKey={(keys) => {
                  setHighlightedKeys(keys);
                  setSelectedValueKey(keys.length > 0 ? keys[0] : null);
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function computeDiffNodes(
  baseNodes: ResourceGraphNode[],
  compareNodes: ResourceGraphNode[],
  changedValueKeys: string[] = []
): ResourceGraphNode[] {
  if (compareNodes.length === 0 && changedValueKeys.length === 0) return [];
  const compareMap = new Map(compareNodes.map((n) => [n.id, n]));
  const changedKeySet = new Set(changedValueKeys);
  return baseNodes.map((node) => {
    const other = compareMap.get(node.id);
    // Highlight if resource structure differs or any of its used values keys changed
    const resourceChanged = compareNodes.length > 0 &&
      (!other || JSON.stringify(node.data.resource) !== JSON.stringify(other.data.resource));
    const valuesChanged = node.data.valuesUsed.some((k) => changedKeySet.has(k));
    const changed = resourceChanged || valuesChanged;
    return changed ? { ...node, data: { ...node.data, highlighted: true } } : node;
  });
}

function RenderErrorPanel({
  error,
  env,
  onLoadChart,
}: {
  error: string;
  env: string;
  onLoadChart: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-12 gap-5">
      <div className="w-14 h-14 rounded-2xl bg-red-950/60 border border-red-700/50 flex items-center justify-center shrink-0">
        <AlertTriangle className="w-7 h-7 text-red-400" />
      </div>
      <div className="text-center max-w-lg">
        <h2 className="text-white font-semibold text-base mb-1">
          Render failed for <span className="text-red-400">{env}</span>
        </h2>
        <p className="text-zinc-400 text-xs mb-4">
          <code className="bg-zinc-800 px-1 py-0.5 rounded">helm template</code> returned an error.
          Check your templates and values file for issues.
        </p>
        <pre className="text-left text-red-300 text-[11px] bg-red-950/40 border border-red-800/60 rounded-lg p-4 overflow-x-auto overflow-y-auto max-h-52 whitespace-pre-wrap font-mono leading-relaxed">
          {error}
        </pre>
      </div>
      <button
        onClick={onLoadChart}
        className="flex items-center gap-2 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-lg transition-colors"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        Load a different chart
      </button>
    </div>
  );
}

function GraphPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-3">
      <GitBranch className="w-10 h-10" />
      <p className="text-sm max-w-sm text-center">{text}</p>
    </div>
  );
}
