"use client";

import { useState, useRef } from "react";
import { Upload, Globe, FolderOpen, Search, ChevronRight, AlertCircle, Clock, Zap, GitCompare } from "lucide-react";
import clsx from "clsx";
import yaml from "js-yaml";
import type { ChartRenderResult, ArtifactHubPackage } from "@/types/helm";
import type { HistoryEntry } from "@/app/page";
import { extractValuesEntries } from "@/lib/yamlParser";
import { computeValuesDiff } from "@/lib/valueDiff";
import { EnvDiffPanel } from "@/components/EnvDiffPanel";
import type { ValuesDiffResult } from "@/types/helm";

type Tab = "workspace" | "upload" | "artifacthub" | "history" | "compare";

const POPULAR_CHARTS = [
  { name: "nginx",      repo: "bitnami",      desc: "NGINX web server"            },
  { name: "grafana",    repo: "grafana",       desc: "Observability platform"      },
  { name: "postgresql", repo: "bitnami",       desc: "PostgreSQL database"         },
  { name: "redis",      repo: "bitnami",       desc: "In-memory data store"        },
  { name: "ingress-nginx", repo: "ingress-nginx", desc: "Nginx Ingress controller" },
  { name: "cert-manager", repo: "cert-manager",  desc: "TLS certificate management" },
  { name: "prometheus", repo: "prometheus-community", desc: "Metrics & alerting"  },
  { name: "argo-cd",    repo: "argo",          desc: "GitOps CD for Kubernetes"    },
];

interface ChartLoaderProps {
  onLoad: (result: ChartRenderResult, source: "workspace" | "upload" | "artifacthub", url?: string) => void;
  history?: HistoryEntry[];
}

export function ChartLoader({ onLoad, history = [] }: ChartLoaderProps) {
  const [activeTab, setActiveTab] = useState<Tab>(history.length > 0 ? "history" : "workspace");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Upload state
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Artifact Hub state
  const [ahUrl, setAhUrl] = useState("");
  const [ahSearch, setAhSearch] = useState("");
  const [ahResults, setAhResults] = useState<ArtifactHubPackage[]>([]);
  const [ahSearching, setAhSearching] = useState(false);

  // Compare tab state
  const [compareFileA, setCompareFileA] = useState<{ name: string; content: string } | null>(null);
  const [compareFileB, setCompareFileB] = useState<{ name: string; content: string } | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareDiff, setCompareDiff] = useState<ValuesDiffResult | null>(null);
  const [compareLabelA, setCompareLabelA] = useState("");
  const [compareLabelB, setCompareLabelB] = useState("");
  const compareFileRefA = useRef<HTMLInputElement>(null);
  const compareFileRefB = useRef<HTMLInputElement>(null);

  async function loadWorkspaceChart() {
    await fetchWithLoading(() => fetch("/api/workspace-chart"), "workspace");
  }

  async function handleFile(file: File) {
    const form = new FormData();
    form.append("file", file);
    await fetchWithLoading(
      () => fetch("/api/upload-chart", { method: "POST", body: form }),
      "upload"
    );
  }

  async function loadFromArtifactHub() {
    if (!ahUrl.trim()) {
      setError("Please enter an Artifact Hub package URL.");
      return;
    }
    await fetchWithLoading(
      () =>
        fetch("/api/fetch-chart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: ahUrl.trim() }),
        }),
      "artifacthub",
      ahUrl.trim()
    );
  }

  async function searchArtifactHub() {
    if (ahSearch.trim().length < 2) return;
    setAhSearching(true);
    try {
      const res = await fetch(`/api/search-charts?q=${encodeURIComponent(ahSearch.trim())}`);
      const data = await res.json();
      setAhResults(data.packages ?? []);
    } catch {
      setError("Artifact Hub search failed.");
    } finally {
      setAhSearching(false);
    }
  }

  async function loadFromPackage(pkg: ArtifactHubPackage) {
    const url = `https://artifacthub.io/packages/helm/${pkg.repository.name}/${pkg.name}`;
    setAhUrl(url);
    await fetchWithLoading(
      () =>
        fetch("/api/fetch-chart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        }),
      "artifacthub",
      url
    );
  }

  async function loadPopularChart(name: string, repo: string) {
    const url = `https://artifacthub.io/packages/helm/${repo}/${name}`;
    setActiveTab("artifacthub");
    setAhUrl(url);
    await fetchWithLoading(
      () =>
        fetch("/api/fetch-chart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        }),
      "artifacthub",
      url
    );
  }

  async function fetchWithLoading(fn: () => Promise<Response>, source: "workspace" | "upload" | "artifacthub", url?: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fn();
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      onLoad(data as ChartRenderResult, source, url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  function readYamlFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string ?? "");
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  }

  async function handleCompareFileA(file: File) {
    setCompareError(null);
    setCompareDiff(null);
    try {
      const content = await readYamlFile(file);
      yaml.load(content); // validate YAML (js-yaml v4 is safe by default)
      setCompareFileA({ name: file.name, content });
      setCompareLabelA(file.name.replace(/\.(yaml|yml)$/, ""));
    } catch {
      setCompareError(`File A is not valid YAML: ${file.name}`);
    }
  }

  async function handleCompareFileB(file: File) {
    setCompareError(null);
    setCompareDiff(null);
    try {
      const content = await readYamlFile(file);
      yaml.load(content); // validate YAML (js-yaml v4 is safe by default)
      setCompareFileB({ name: file.name, content });
      setCompareLabelB(file.name.replace(/\.(yaml|yml)$/, ""));
    } catch {
      setCompareError(`File B is not valid YAML: ${file.name}`);
    }
  }

  function runCompare() {
    if (!compareFileA || !compareFileB) return;
    setCompareError(null);
    try {
      const labelA = compareLabelA.trim() || compareFileA.name;
      const labelB = compareLabelB.trim() || compareFileB.name;
      const treeA = extractValuesEntries(compareFileA.content, labelA);
      const treeB = extractValuesEntries(compareFileB.content, labelB);
      setCompareDiff(computeValuesDiff(treeA, treeB));
      setCompareLabelA(labelA);
      setCompareLabelB(labelB);
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : "Failed to compare files");
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-2xl mx-auto p-5">
      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-zinc-800 rounded-lg p-1">
        {(["history", "workspace", "upload", "artifacthub", "compare"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setError(null); }}
            className={clsx(
              "flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors",
              activeTab === tab
                ? "bg-zinc-700 text-white"
                : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            {tab === "history"     && <Clock className="w-3 h-3" />}
            {tab === "workspace"   && <FolderOpen className="w-3 h-3" />}
            {tab === "upload"      && <Upload className="w-3 h-3" />}
            {tab === "artifacthub" && <Globe className="w-3 h-3" />}
            {tab === "compare"     && <GitCompare className="w-3 h-3" />}
            {tab === "history"     ? "Recent" :
             tab === "workspace"   ? "Workspace" :
             tab === "upload"      ? "Upload" :
             tab === "compare"     ? "Compare" : "Artifact Hub"}
            {tab === "history" && history.length > 0 && (
              <span className="bg-blue-600 text-white text-[9px] rounded-full px-1 leading-none py-0.5">
                {history.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "history" && (
        <div>
          {history.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
              <p className="text-zinc-400 text-sm">No charts loaded yet</p>
              <p className="text-zinc-600 text-xs mt-1">Charts you load will appear here for quick re-access</p>
            </div>
          ) : (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {history.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => onLoad(entry.result, entry.source, entry.url)}
                  className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-zinc-800 transition-colors group"
                >
                  {entry.source === "workspace" && <FolderOpen className="w-4 h-4 text-blue-400 shrink-0" />}
                  {entry.source === "upload"    && <Upload className="w-4 h-4 text-green-400 shrink-0" />}
                  {entry.source === "artifacthub" && <Globe className="w-4 h-4 text-yellow-400 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-white text-sm font-medium truncate">{entry.name}</div>
                    <div className="text-zinc-500 text-xs">
                      v{entry.version} · {new Date(entry.loadedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {activeTab === "workspace" && (
        <div className="text-center py-6">
          <FolderOpen className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
          <p className="text-zinc-300 text-sm mb-1">Load the Helm chart from this workspace</p>
          <p className="text-zinc-500 text-xs mb-5">
            Reads <code className="bg-zinc-800 px-1 rounded">helm/</code> and renders all environments
          </p>
          <button
            onClick={loadWorkspaceChart}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-5 py-2 rounded-lg font-medium transition-colors"
          >
            {loading ? "Loading…" : "Load Workspace Chart"}
          </button>
        </div>
      )}

      {activeTab === "upload" && (
        <div>
          <div
            className={clsx(
              "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
              dragOver ? "border-blue-500 bg-blue-950/30" : "border-zinc-600 hover:border-zinc-500"
            )}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="w-8 h-8 text-zinc-500 mx-auto mb-2" />
            <p className="text-zinc-300 text-sm">Drop a <code>.tgz</code> Helm chart here</p>
            <p className="text-zinc-500 text-xs mt-1">or click to browse (max 50 MB)</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".tgz,.tar.gz"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      )}

      {activeTab === "artifacthub" && (
        <div className="space-y-4">
          {/* URL input */}
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Artifact Hub Package URL</label>
            <div className="flex gap-2">
              <input
                type="url"
                placeholder="https://artifacthub.io/packages/helm/bitnami/nginx"
                value={ahUrl}
                onChange={(e) => setAhUrl(e.target.value)}
                className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg text-sm text-white px-3 py-2 outline-none focus:border-blue-500 placeholder-zinc-500"
                onKeyDown={(e) => e.key === "Enter" && loadFromArtifactHub()}
              />
              <button
                onClick={loadFromArtifactHub}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-1"
              >
                {loading ? "…" : <><ChevronRight className="w-4 h-4" /></>}
              </button>
            </div>
          </div>

          {/* Search */}
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Search Artifact Hub</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. nginx, prometheus, grafana"
                value={ahSearch}
                onChange={(e) => setAhSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchArtifactHub()}
                className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg text-sm text-white px-3 py-2 outline-none focus:border-blue-500 placeholder-zinc-500"
              />
              <button
                onClick={searchArtifactHub}
                disabled={ahSearching}
                className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm px-3 py-2 rounded-lg transition-colors"
              >
                <Search className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search results */}
          {ahResults.length > 0 ? (
            <div className="max-h-48 overflow-y-auto border border-zinc-700 rounded-lg divide-y divide-zinc-800">
              {ahResults.map((pkg) => (
                <button
                  key={pkg.package_id}
                  onClick={() => loadFromPackage(pkg)}
                  className="w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-white text-sm font-medium">
                        {pkg.display_name ?? pkg.name}
                      </span>
                      <span className="ml-2 text-zinc-500 text-xs">{pkg.version}</span>
                      <p className="text-zinc-400 text-xs truncate mt-0.5">
                        {pkg.description}
                      </p>
                    </div>
                    <span className="text-zinc-500 text-xs shrink-0">{pkg.repository.name}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            /* Popular charts */
            <div>
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
                <Zap className="w-3 h-3" />
                Popular charts — click to load
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {POPULAR_CHARTS.map((c) => (
                  <button
                    key={`${c.repo}/${c.name}`}
                    onClick={() => loadPopularChart(c.name, c.repo)}
                    disabled={loading}
                    className="text-left flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                  >
                    <Globe className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-white text-xs font-medium truncate">{c.name}</div>
                      <div className="text-zinc-500 text-[10px] truncate">{c.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "compare" && (
        <div className="space-y-4">
          <p className="text-xs text-zinc-400">
            Upload two YAML values files to compare them side-by-side.
          </p>

          {/* Two file upload zones */}
          <div className="grid grid-cols-2 gap-3">
            {/* File A */}
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Base (e.g. dev.yaml)</label>
              <div
                className={clsx(
                  "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors",
                  compareFileA
                    ? "border-emerald-600 bg-emerald-950/20"
                    : "border-zinc-600 hover:border-zinc-500"
                )}
                onClick={() => compareFileRefA.current?.click()}
              >
                {compareFileA ? (
                  <div>
                    <p className="text-emerald-300 text-xs font-medium truncate">{compareFileA.name}</p>
                    <p className="text-zinc-500 text-[10px] mt-0.5">click to change</p>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-5 h-5 text-zinc-500 mx-auto mb-1" />
                    <p className="text-zinc-400 text-xs">Drop or click</p>
                  </div>
                )}
              </div>
              <input
                ref={compareFileRefA}
                type="file"
                accept=".yaml,.yml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleCompareFileA(file);
                  e.target.value = "";
                }}
              />
              {compareFileA && (
                <input
                  type="text"
                  value={compareLabelA}
                  onChange={(e) => setCompareLabelA(e.target.value)}
                  placeholder="Label (e.g. dev)"
                  className="mt-1 w-full bg-zinc-800 border border-zinc-600 rounded text-xs text-white px-2 py-1 outline-none focus:border-blue-500 placeholder-zinc-500"
                />
              )}
            </div>

            {/* File B */}
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Compare (e.g. prod.yaml)</label>
              <div
                className={clsx(
                  "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors",
                  compareFileB
                    ? "border-blue-600 bg-blue-950/20"
                    : "border-zinc-600 hover:border-zinc-500"
                )}
                onClick={() => compareFileRefB.current?.click()}
              >
                {compareFileB ? (
                  <div>
                    <p className="text-blue-300 text-xs font-medium truncate">{compareFileB.name}</p>
                    <p className="text-zinc-500 text-[10px] mt-0.5">click to change</p>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-5 h-5 text-zinc-500 mx-auto mb-1" />
                    <p className="text-zinc-400 text-xs">Drop or click</p>
                  </div>
                )}
              </div>
              <input
                ref={compareFileRefB}
                type="file"
                accept=".yaml,.yml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleCompareFileB(file);
                  e.target.value = "";
                }}
              />
              {compareFileB && (
                <input
                  type="text"
                  value={compareLabelB}
                  onChange={(e) => setCompareLabelB(e.target.value)}
                  placeholder="Label (e.g. prod)"
                  className="mt-1 w-full bg-zinc-800 border border-zinc-600 rounded text-xs text-white px-2 py-1 outline-none focus:border-blue-500 placeholder-zinc-500"
                />
              )}
            </div>
          </div>

          <button
            onClick={runCompare}
            disabled={!compareFileA || !compareFileB}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
          >
            <GitCompare className="w-4 h-4" />
            Compare Values
          </button>

          {compareError && (
            <div className="flex items-start gap-2 bg-red-950/50 border border-red-800 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-red-300 text-xs">{compareError}</p>
            </div>
          )}
        </div>
      )}

      {/* Compare diff panel (opens over modal) */}
      {compareDiff && compareFileA && compareFileB && (
        <EnvDiffPanel
          diffResult={compareDiff}
          baseEnv={compareLabelA || compareFileA.name}
          compareEnv={compareLabelB || compareFileB.name}
          onClose={() => setCompareDiff(null)}
        />
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 flex items-start gap-2 bg-red-950/50 border border-red-800 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            {error.includes("\n") ? (
              <pre className="text-red-300 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-40 overflow-y-auto">
                {error}
              </pre>
            ) : (
              <p className="text-red-300 text-xs">{error}</p>
            )}
          </div>
        </div>
      )}

      {/* Loading spinner overlay hint */}
      {loading && (
        <div className="mt-3 text-center text-zinc-400 text-xs animate-pulse">
          Running helm template…
        </div>
      )}
    </div>
  );
}
