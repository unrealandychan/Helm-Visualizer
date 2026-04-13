"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import {
  X,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Layers,
  AlignLeft,
  SlidersHorizontal,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import clsx from "clsx";

interface ManifestPreviewProps {
  /** Raw multi-doc YAML output from helm template */
  renderedManifest: string | null;
  /** Non-null means the template render failed */
  renderError?: string;
  /** Dot-notation values key that is currently selected in the ValuesInspector */
  selectedValueKey?: string | null;
  /** Whether the chart is a workspace chart (supports re-render) */
  isWorkspace?: boolean;
  onClose: () => void;
}

type ViewMode = "raw" | "grouped";

interface KindGroup {
  kind: string;
  apiVersion: string;
  documents: Array<{ name: string; yaml: string }>;
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Split a multi-doc YAML string into individual document strings.
 * Preserves the "---" separator at the start of each section.
 */
function splitDocs(yaml: string): string[] {
  return yaml
    .split(/^---[ \t]*$/m)
    .map((d) => d.trim())
    .filter(Boolean);
}

/** Naively extract a top-level scalar field from a YAML document string */
function extractField(doc: string, field: string): string {
  const re = new RegExp(`^${field}:\\s*(.+)$`, "m");
  const m = doc.match(re);
  return m ? m[1].trim() : "";
}

/**
 * Group document strings by their `kind` field.
 */
function groupByKind(docs: string[]): KindGroup[] {
  const map = new Map<string, KindGroup>();
  for (const doc of docs) {
    const kind = extractField(doc, "kind") || "Unknown";
    const apiVersion = extractField(doc, "apiVersion") || "";
    const name = extractField(doc, "  name") || extractField(doc, "name") || "(unnamed)";
    if (!map.has(kind)) {
      map.set(kind, { kind, apiVersion, documents: [] });
    }
    map.get(kind)!.documents.push({ name, yaml: doc });
  }
  return Array.from(map.values()).sort((a, b) => a.kind.localeCompare(b.kind));
}

const KIND_COLORS: Record<string, string> = {
  Deployment: "text-blue-300",
  Service: "text-green-300",
  Ingress: "text-yellow-300",
  ConfigMap: "text-teal-300",
  Secret: "text-red-300",
  ServiceAccount: "text-gray-300",
  StatefulSet: "text-indigo-300",
  DaemonSet: "text-violet-300",
  HorizontalPodAutoscaler: "text-purple-300",
  CronJob: "text-orange-300",
  Job: "text-amber-300",
  PersistentVolumeClaim: "text-cyan-300",
};

// ─── main component ─────────────────────────────────────────────────────────

export function ManifestPreview({
  renderedManifest,
  renderError,
  selectedValueKey,
  isWorkspace = false,
  onClose,
}: ManifestPreviewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("raw");
  const [copied, setCopied] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [customValues, setCustomValues] = useState("");
  const [rerenderManifest, setRerenderManifest] = useState<string | null>(null);
  const [rerenderError, setRerenderError] = useState<string | null>(null);
  const [rerendering, setRerendering] = useState(false);
  const highlightRef = useRef<HTMLElement | null>(null);

  const activeManifest = rerenderManifest ?? renderedManifest ?? "";
  const activeError = rerenderError ?? renderError;

  const docs = useMemo(() => splitDocs(activeManifest), [activeManifest]);
  const kindGroups = useMemo(() => groupByKind(docs), [docs]);

  // Scroll to first highlighted line when the selected key changes
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedValueKey]);

  function handleCopy() {
    if (!activeManifest) return;
    navigator.clipboard.writeText(activeManifest).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function handleRerender() {
    setRerendering(true);
    setRerenderError(null);
    try {
      const res = await fetch("/api/render-manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customValues }),
      });
      const data = (await res.json()) as { renderedManifest?: string; error?: string };
      if (!res.ok || data.error) {
        setRerenderError(data.error ?? "Unknown render error");
        setRerenderManifest(null);
      } else {
        setRerenderManifest(data.renderedManifest ?? "");
        setRerenderError(null);
      }
    } catch (err) {
      setRerenderError(err instanceof Error ? err.message : String(err));
    } finally {
      setRerendering(false);
    }
  }

  function resetOverride() {
    setCustomValues("");
    setRerenderManifest(null);
    setRerenderError(null);
  }

  return (
    <div className="flex flex-col h-full bg-zinc-900 border-l border-zinc-700 overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Layers className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="text-white text-sm font-semibold truncate">Rendered Manifest</span>
          {docs.length > 0 && (
            <span className="text-[10px] text-zinc-500 bg-zinc-800 rounded px-1.5 py-0.5">
              {docs.length} resource{docs.length !== 1 ? "s" : ""}
            </span>
          )}
          {rerenderManifest && (
            <span className="text-[10px] text-amber-400 bg-amber-900/30 border border-amber-700/40 rounded px-1.5 py-0.5">
              custom values
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {activeManifest && (
            <button
              onClick={handleCopy}
              title="Copy to clipboard"
              className="p-1.5 rounded text-zinc-500 hover:text-white hover:bg-zinc-700 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
          {isWorkspace && (
            <button
              onClick={() => setShowOverride((v) => !v)}
              title="Custom values override"
              className={clsx(
                "p-1.5 rounded transition-colors",
                showOverride
                  ? "text-amber-400 bg-amber-900/30"
                  : "text-zinc-500 hover:text-white hover:bg-zinc-700"
              )}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded text-zinc-500 hover:text-white hover:bg-zinc-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Custom values override panel ── */}
      {showOverride && isWorkspace && (
        <div className="shrink-0 border-b border-zinc-700 bg-zinc-950/60 p-3 flex flex-col gap-2">
          <div className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wide">
            Custom values override (YAML)
          </div>
          <textarea
            value={customValues}
            onChange={(e) => setCustomValues(e.target.value)}
            placeholder="replicaCount: 3&#10;image:&#10;  tag: v2.0.0"
            rows={5}
            className="w-full bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-200 font-mono p-2 resize-none outline-none focus:border-blue-500 placeholder-zinc-600"
          />
          <div className="flex gap-2">
            <button
              onClick={handleRerender}
              disabled={rerendering}
              className="flex items-center gap-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded transition-colors"
            >
              <RefreshCw className={clsx("w-3 h-3", rerendering && "animate-spin")} />
              {rerendering ? "Rendering…" : "Re-render"}
            </button>
            {rerenderManifest && (
              <button
                onClick={resetOverride}
                className="text-xs text-zinc-400 hover:text-white px-2 py-1.5 rounded hover:bg-zinc-700 transition-colors"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── View mode toggle ── */}
      {!activeError && activeManifest && (
        <div className="flex items-center gap-1 px-3 py-2 border-b border-zinc-700 shrink-0">
          <button
            onClick={() => setViewMode("raw")}
            className={clsx(
              "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded transition-colors",
              viewMode === "raw"
                ? "bg-zinc-700 text-white"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            )}
          >
            <AlignLeft className="w-3 h-3" />
            Raw YAML
          </button>
          <button
            onClick={() => setViewMode("grouped")}
            className={clsx(
              "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded transition-colors",
              viewMode === "grouped"
                ? "bg-zinc-700 text-white"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            )}
          >
            <Layers className="w-3 h-3" />
            By Kind
          </button>
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        {activeError ? (
          <ErrorView error={activeError} />
        ) : !activeManifest ? (
          <EmptyView />
        ) : viewMode === "raw" ? (
          <RawView
            manifest={activeManifest}
            selectedValueKey={selectedValueKey ?? null}
            highlightRef={highlightRef}
          />
        ) : (
          <GroupedView
            kindGroups={kindGroups}
            selectedValueKey={selectedValueKey ?? null}
            highlightRef={highlightRef}
          />
        )}
      </div>
    </div>
  );
}

// ─── sub-views ───────────────────────────────────────────────────────────────

function EmptyView() {
  return (
    <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
      No manifest rendered yet
    </div>
  );
}

function ErrorView({ error }: { error: string }) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2 text-red-400">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="text-sm font-medium">Template render failed</span>
      </div>
      <pre className="text-[11px] text-red-300 bg-red-950/40 border border-red-800/50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
        {error}
      </pre>
    </div>
  );
}

interface RawViewProps {
  manifest: string;
  selectedValueKey: string | null;
  highlightRef: React.RefObject<HTMLElement | null>;
}

function RawView({ manifest, selectedValueKey, highlightRef }: RawViewProps) {
  const lines = manifest.split("\n");
  // Build a lookup string from the key, e.g. "image.repository" → look for occurrences of "repository"
  // More specifically, we look for the leaf segment of the dot path.
  const searchTerm = selectedValueKey
    ? selectedValueKey.split(".").pop()?.toLowerCase() ?? ""
    : null;

  // Pre-compute which line is the first match so we don't mutate inside render
  const firstHighlightIdx = searchTerm !== null
    ? lines.findIndex(
        (l) => l.toLowerCase().includes(searchTerm) && !l.trimStart().startsWith("#")
      )
    : -1;

  return (
    <div className="p-3">
      <pre className="text-[11px] font-mono leading-relaxed text-zinc-200 whitespace-pre-wrap">
        {lines.map((line, i) => {
          const isHighlighted =
            searchTerm !== null &&
            line.toLowerCase().includes(searchTerm) &&
            !line.trimStart().startsWith("#");
          const isFirstHighlight = i === firstHighlightIdx;
          return (
            <span
              key={i}
              ref={isFirstHighlight ? highlightRef : undefined}
              className={clsx(
                "block",
                isHighlighted && "bg-amber-900/40 border-l-2 border-amber-500 pl-1 -ml-1"
              )}
            >
              {line || " "}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

interface GroupedViewProps {
  kindGroups: KindGroup[];
  selectedValueKey: string | null;
  highlightRef: React.RefObject<HTMLElement | null>;
}

function GroupedView({ kindGroups, selectedValueKey, highlightRef }: GroupedViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(kindGroups.map((g) => g.kind)));

  function toggle(kind: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  }

  if (kindGroups.length === 0) {
    return <EmptyView />;
  }

  return (
    <div className="divide-y divide-zinc-800">
      {kindGroups.map((group) => {
        const isOpen = expanded.has(group.kind);
        const colorClass = KIND_COLORS[group.kind] ?? "text-zinc-300";
        return (
          <div key={group.kind}>
            <button
              onClick={() => toggle(group.kind)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 transition-colors text-left"
            >
              {isOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              )}
              <span className={clsx("text-xs font-semibold", colorClass)}>{group.kind}</span>
              <span className="text-[10px] text-zinc-600 ml-auto">
                {group.documents.length} resource{group.documents.length !== 1 ? "s" : ""}
              </span>
            </button>

            {isOpen && (
              <div className="bg-zinc-950/40">
                {group.documents.map((doc, idx) => (
                  <ResourceDocView
                    key={idx}
                    name={doc.name}
                    yaml={doc.yaml}
                    selectedValueKey={selectedValueKey}
                    highlightRef={highlightRef}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface ResourceDocViewProps {
  name: string;
  yaml: string;
  selectedValueKey: string | null;
  highlightRef: React.RefObject<HTMLElement | null>;
}

function ResourceDocView({ name, yaml, selectedValueKey, highlightRef }: ResourceDocViewProps) {
  const [open, setOpen] = useState(true);
  const lines = yaml.split("\n");
  const searchTerm = selectedValueKey
    ? selectedValueKey.split(".").pop()?.toLowerCase() ?? ""
    : null;

  // Pre-compute first highlight index to avoid mutating variables inside render
  const firstHighlightIdx = searchTerm !== null
    ? lines.findIndex(
        (l) => l.toLowerCase().includes(searchTerm) && !l.trimStart().startsWith("#")
      )
    : -1;

  return (
    <div className="border-t border-zinc-800/60">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-5 py-1.5 hover:bg-zinc-800/60 text-left transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-zinc-600 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" />
        )}
        <span className="text-[11px] text-zinc-300 font-mono">{name}</span>
      </button>

      {open && (
        <div className="px-5 pb-3">
          <pre className="text-[10px] font-mono leading-relaxed text-zinc-300 whitespace-pre-wrap bg-zinc-900 rounded p-2 border border-zinc-800">
            {lines.map((line, i) => {
              const isHighlighted =
                searchTerm !== null &&
                line.toLowerCase().includes(searchTerm) &&
                !line.trimStart().startsWith("#");
              const isFirstHighlight = i === firstHighlightIdx;
              return (
                <span
                  key={i}
                  ref={isFirstHighlight ? highlightRef : undefined}
                  className={clsx(
                    "block",
                    isHighlighted && "bg-amber-900/40 border-l-2 border-amber-500 pl-1 -ml-1"
                  )}
                >
                  {line || " "}
                </span>
              );
            })}
          </pre>
        </div>
      )}
    </div>
  );
}
