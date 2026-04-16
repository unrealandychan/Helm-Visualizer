"use client";

import { useMemo } from "react";
import clsx from "clsx";
import { Sparkles, CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import type { ChartSuggestion } from "@/types/helm";

interface SuggestionsPanelProps {
  suggestions: ChartSuggestion[];
  ignoredIds: Set<string>;
  explainingId: string | null;
  llmExplanations: Record<string, string>;
  onApply: (suggestion: ChartSuggestion) => void;
  onIgnore: (suggestion: ChartSuggestion) => void;
  onExplain: (suggestion: ChartSuggestion) => void;
}

export function SuggestionsPanel({
  suggestions,
  ignoredIds,
  explainingId,
  llmExplanations,
  onApply,
  onIgnore,
  onExplain,
}: SuggestionsPanelProps) {
  const visibleSuggestions = useMemo(
    () => suggestions.filter((s) => !ignoredIds.has(s.id)),
    [suggestions, ignoredIds]
  );

  return (
    <div className="w-[360px] shrink-0 overflow-hidden flex flex-col border-l border-zinc-800 bg-zinc-900/60">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-violet-300" />
        <p className="text-sm font-semibold text-zinc-100">AI Suggestions</p>
        <span className="ml-auto text-[10px] text-zinc-500">
          {visibleSuggestions.length} active
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {visibleSuggestions.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-500">
            No high-impact suggestions found.
          </div>
        ) : (
          visibleSuggestions.map((s) => {
            const ai = llmExplanations[s.id];
            return (
              <div key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <CircleDashed
                    className={clsx(
                      "w-4 h-4 mt-0.5 shrink-0",
                      s.level === "high" ? "text-rose-400" : "text-amber-400"
                    )}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-zinc-100">{s.title}</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      {s.env} · <code>{s.keyPath}</code>
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-300 leading-relaxed">{s.rationale}</p>
                {ai && (
                  <div className="text-[11px] text-violet-200 bg-violet-950/30 border border-violet-800/40 rounded p-2 whitespace-pre-wrap">
                    {ai}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => onApply(s)}
                    className="text-[11px] px-2 py-1 rounded bg-emerald-700/80 hover:bg-emerald-600 text-white"
                  >
                    Apply
                  </button>
                  <button
                    onClick={() => onIgnore(s)}
                    className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                  >
                    Ignore
                  </button>
                  <button
                    onClick={() => onExplain(s)}
                    disabled={explainingId === s.id}
                    className="text-[11px] px-2 py-1 rounded bg-violet-800/70 hover:bg-violet-700 text-violet-100 disabled:opacity-50"
                    aria-label={explainingId === s.id ? "Generating AI explanation" : "Explain with AI"}
                  >
                    {explainingId === s.id ? (
                      <span className="inline-flex items-center gap-1" aria-live="polite">
                        <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                        Explaining
                      </span>
                    ) : "Explain"}
                  </button>
                  {s.recommendation !== undefined && (
                    <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-300">
                      <CheckCircle2 className="w-3 h-3" />
                      {formatRecommendation(s.recommendation)}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function formatRecommendation(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (value && typeof value === "object") return "object";
  return "set";
}
