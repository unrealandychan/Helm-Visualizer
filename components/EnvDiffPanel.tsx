"use client";

import { useState, useMemo } from "react";
import {
  X,
  Download,
  Search,
  FileJson,
  FileText,
  GitCompare,
} from "lucide-react";
import clsx from "clsx";
import type { ValuesDiffResult, ValuesDiffEntry } from "@/types/helm";
import { exportDiffAsMarkdown, exportDiffAsJson } from "@/lib/valueDiff";

interface EnvDiffPanelProps {
  diffResult: ValuesDiffResult;
  baseEnv: string;
  compareEnv: string;
  onClose: () => void;
}

const STATUS_CONFIG = {
  added: {
    bg: "bg-emerald-950/60",
    border: "border-emerald-700/50",
    badge: "bg-emerald-800 text-emerald-200",
    label: "added",
    dot: "bg-emerald-400",
  },
  removed: {
    bg: "bg-red-950/60",
    border: "border-red-700/50",
    badge: "bg-red-800 text-red-200",
    label: "removed",
    dot: "bg-red-400",
  },
  changed: {
    bg: "bg-amber-950/60",
    border: "border-amber-700/50",
    badge: "bg-amber-800 text-amber-200",
    label: "changed",
    dot: "bg-amber-400",
  },
  unchanged: {
    bg: "",
    border: "",
    badge: "bg-zinc-700 text-zinc-400",
    label: "unchanged",
    dot: "bg-zinc-600",
  },
} as const;

export function EnvDiffPanel({
  diffResult,
  baseEnv,
  compareEnv,
  onClose,
}: EnvDiffPanelProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<
    "all" | "added" | "removed" | "changed"
  >("all");
  const [showUnchanged, setShowUnchanged] = useState(false);

  const filtered = useMemo(() => {
    let items = diffResult.entries;
    if (!showUnchanged) {
      items = items.filter((e) => e.status !== "unchanged");
    }
    if (filter !== "all") {
      items = items.filter((e) => e.status === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (e) =>
          e.key.toLowerCase().includes(q) ||
          String(e.baseValue ?? "").toLowerCase().includes(q) ||
          String(e.compareValue ?? "").toLowerCase().includes(q)
      );
    }
    return items;
  }, [diffResult.entries, search, filter, showUnchanged]);

  function downloadMarkdown() {
    const text = exportDiffAsMarkdown(diffResult, baseEnv, compareEnv);
    triggerDownload(
      text,
      `diff-${baseEnv}-vs-${compareEnv}.md`,
      "text/markdown"
    );
  }

  function downloadJson() {
    const text = exportDiffAsJson(diffResult, baseEnv, compareEnv);
    triggerDownload(
      text,
      `diff-${baseEnv}-vs-${compareEnv}.json`,
      "application/json"
    );
  }

  const { summary } = diffResult;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/90 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-700 shrink-0">
          <div className="flex items-center gap-3">
            <GitCompare className="w-5 h-5 text-blue-400" />
            <span className="text-white font-semibold text-base">
              Values Diff
            </span>
            <div className="flex items-center gap-1.5 text-sm">
              <span className="px-2 py-0.5 rounded bg-zinc-700 text-zinc-200 font-mono text-xs">
                {baseEnv}
              </span>
              <span className="text-zinc-500">→</span>
              <span className="px-2 py-0.5 rounded bg-zinc-700 text-zinc-200 font-mono text-xs">
                {compareEnv}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadMarkdown}
              className="flex items-center gap-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
              title="Export as Markdown"
            >
              <FileText className="w-3.5 h-3.5" />
              Markdown
            </button>
            <button
              onClick={downloadJson}
              className="flex items-center gap-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
              title="Export as JSON"
            >
              <FileJson className="w-3.5 h-3.5" />
              JSON
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Summary bar */}
        <div className="flex items-center gap-4 px-5 py-3 bg-zinc-800/50 border-b border-zinc-700 shrink-0 flex-wrap">
          <SummaryBadge
            color="text-white"
            bg="bg-zinc-700"
            count={summary.total}
            label="total changes"
          />
          <SummaryBadge
            color="text-emerald-300"
            bg="bg-emerald-900"
            count={summary.added}
            label="added"
          />
          <SummaryBadge
            color="text-red-300"
            bg="bg-red-900"
            count={summary.removed}
            label="removed"
          />
          <SummaryBadge
            color="text-amber-300"
            bg="bg-amber-900"
            count={summary.changed}
            label="changed"
          />
          {summary.breaking > 0 && (
            <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-red-300 bg-red-950 border border-red-700 rounded-full px-3 py-1">
              ⚠ {summary.breaking} breaking
            </span>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 px-5 py-2.5 border-b border-zinc-700 shrink-0">
          <div className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-600 rounded-lg px-2.5 py-1.5 flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <input
              type="text"
              placeholder="Search keys or values…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-xs text-white placeholder-zinc-500 outline-none flex-1"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="text-zinc-500 hover:text-white text-xs"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex gap-1">
            {(["all", "removed", "changed", "added"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={clsx(
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors capitalize",
                  filter === f
                    ? "bg-zinc-600 text-white"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {f === "all"
                  ? `All (${showUnchanged ? diffResult.entries.length : summary.total})`
                  : f}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowUnchanged((v) => !v)}
            className={clsx(
              "ml-auto text-xs px-2.5 py-1 rounded transition-colors",
              showUnchanged
                ? "bg-zinc-700 text-zinc-200"
                : "text-zinc-600 hover:text-zinc-400"
            )}
          >
            {showUnchanged ? "Hide unchanged" : "Show unchanged"}
          </button>
        </div>

        {/* Diff table */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_1fr_1fr] gap-0 border-b border-zinc-700 shrink-0">
            <div className="px-4 py-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Key
            </div>
            <div className="px-4 py-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider border-l border-zinc-700">
              {baseEnv}
            </div>
            <div className="px-4 py-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider border-l border-zinc-700">
              {compareEnv}
            </div>
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-zinc-500 text-sm gap-2">
                <GitCompare className="w-6 h-6" />
                <p>
                  {summary.total === 0
                    ? "No differences found — environments are identical"
                    : "No results match your filter"}
                </p>
              </div>
            ) : (
              filtered.map((entry) => (
                <DiffRow
                  key={entry.key}
                  entry={entry}
                />
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-zinc-700 shrink-0 text-xs text-zinc-500 flex items-center justify-between">
          <span>
            Showing {filtered.length} of{" "}
            {showUnchanged
              ? diffResult.entries.length
              : diffResult.entries.length -
                diffResult.entries.filter((e) => e.status === "unchanged")
                  .length}{" "}
            entries
          </span>
          <button
            onClick={downloadJson}
            className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Download JSON"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryBadge({
  count,
  label,
  color,
  bg,
}: {
  count: number;
  label: string;
  color: string;
  bg: string;
}) {
  return (
    <div className={clsx("flex items-center gap-1.5 rounded-full px-3 py-1", bg)}>
      <span className={clsx("text-sm font-bold", color)}>{count}</span>
      <span className="text-xs text-zinc-400">{label}</span>
    </div>
  );
}

function DiffRow({
  entry,
}: {
  entry: ValuesDiffEntry;
}) {
  const cfg = STATUS_CONFIG[entry.status];
  const isBreaking =
    entry.status === "removed" ||
    (entry.status === "changed" && entry.baseType !== entry.compareType);

  return (
    <div
      className={clsx(
        "grid grid-cols-[1fr_1fr_1fr] gap-0 border-b border-zinc-800 text-xs font-mono",
        entry.status !== "unchanged" && cfg.bg
      )}
    >
      {/* Key cell */}
      <div className="px-4 py-2 flex items-start gap-2 min-w-0">
        <span
          className={clsx("w-2 h-2 rounded-full shrink-0 mt-0.5", cfg.dot)}
        />
        <div className="min-w-0 flex-1">
          <span
            className="text-zinc-200 truncate block"
            title={entry.key}
          >
            {entry.key}
          </span>
          <div className="flex items-center gap-1 mt-0.5">
            <span
              className={clsx(
                "rounded px-1 text-[9px]",
                cfg.badge
              )}
            >
              {cfg.label}
            </span>
            {isBreaking && (
              <span className="rounded px-1 text-[9px] bg-red-900 text-red-300">
                breaking
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Base value cell */}
      <div
        className={clsx(
          "px-4 py-2 border-l border-zinc-800 min-w-0",
          entry.status === "removed" && "bg-red-950/30"
        )}
      >
        {entry.baseValue !== undefined ? (
          <ValueDisplay
            value={entry.baseValue}
            type={entry.baseType}
            highlight={entry.status === "removed"}
          />
        ) : (
          <span className="text-zinc-600 italic">—</span>
        )}
      </div>

      {/* Compare value cell */}
      <div
        className={clsx(
          "px-4 py-2 border-l border-zinc-800 min-w-0",
          entry.status === "added" && "bg-emerald-950/30"
        )}
      >
        {entry.compareValue !== undefined ? (
          <ValueDisplay
            value={entry.compareValue}
            type={entry.compareType}
            highlight={entry.status === "added"}
          />
        ) : (
          <span className="text-zinc-600 italic">—</span>
        )}
      </div>
    </div>
  );
}

function ValueDisplay({
  value,
  type,
  highlight,
}: {
  value: unknown;
  type?: string;
  highlight?: boolean;
}) {
  const text = formatValue(value);
  return (
    <div className="flex items-start gap-1.5 min-w-0">
      <span
        className={clsx(
          "truncate block flex-1",
          highlight ? "text-white" : "text-zinc-300"
        )}
        title={typeof value === "object" ? JSON.stringify(value) : String(value)}
      >
        {text}
      </span>
      {type && (
        <span
          className={clsx(
            "shrink-0 rounded px-1 text-[9px]",
            TYPE_BADGE[type] ?? "bg-zinc-700 text-zinc-400"
          )}
        >
          {type}
        </span>
      )}
    </div>
  );
}

const TYPE_BADGE: Record<string, string> = {
  string: "bg-green-900 text-green-300",
  number: "bg-blue-900 text-blue-300",
  boolean: "bg-purple-900 text-purple-300",
  array: "bg-orange-900 text-orange-300",
  object: "bg-teal-900 text-teal-300",
  null: "bg-zinc-700 text-zinc-400",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[…${value.length} items]`;
  if (typeof value === "object") return "{…}";
  return String(value);
}

function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
