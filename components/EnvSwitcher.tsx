"use client";

import type { EnvRenderResult } from "@/types/helm";
import { GitCompare, BarChart2 } from "lucide-react";

interface EnvSwitcherProps {
  environments: EnvRenderResult[];
  activeEnv: string;
  diffEnv: string | null;
  onEnvChange: (env: string) => void;
  onDiffEnvChange: (env: string | null) => void;
  onViewDiff?: () => void;
}

// Environments with well-known colors
const ENV_COLORS: Record<string, string> = {
  dev:     "bg-emerald-800 text-emerald-100",
  sit:     "bg-sky-800     text-sky-100",
  uat:     "bg-amber-800   text-amber-100",
  prd:     "bg-red-800     text-red-100",
  prod:    "bg-red-800     text-red-100",
  staging: "bg-amber-800   text-amber-100",
  default: "bg-zinc-700    text-zinc-200",
};

function envColor(env: string): string {
  return ENV_COLORS[env.toLowerCase()] ?? ENV_COLORS.default;
}

function envTabClass(env: string, activeEnv: string, hasError: boolean): string {
  const base = "px-3 py-1 rounded text-xs font-semibold transition-all";
  if (hasError) {
    return activeEnv === env
      ? `${base} bg-red-900 text-red-300 ring-1 ring-red-600`
      : `${base} bg-zinc-800 text-red-400 hover:text-red-300`;
  }
  return activeEnv === env
    ? `${base} ${envColor(env)}`
    : `${base} bg-zinc-800 text-zinc-400 hover:text-zinc-200`;
}

export function EnvSwitcher({
  environments,
  activeEnv,
  diffEnv,
  onEnvChange,
  onDiffEnvChange,
  onViewDiff,
}: EnvSwitcherProps) {
  const activeResult = environments.find((e) => e.env === activeEnv);

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-zinc-900 border-b border-zinc-700">
      {/* Env tabs */}
      <div className="flex gap-1">
        {environments.map((env) => (
          <button
            key={env.env}
            onClick={() => onEnvChange(env.env)}
            className={envTabClass(env.env, activeEnv, !!env.renderError)}
            title={env.renderError ? `Render error: ${env.renderError}` : undefined}
          >
            {env.env}
            {env.renderError && " ⚠"}
          </button>
        ))}
      </div>

      {/* Resource count */}
      {activeResult && !activeResult.renderError && (
        <span className="text-zinc-500 text-xs">
          {activeResult.resources.length} resources
        </span>
      )}

      {/* Diff selector */}
      {environments.length > 1 && (
        <div className="ml-auto flex items-center gap-2">
          <GitCompare className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-zinc-500 text-xs">Diff:</span>
          <select
            value={diffEnv ?? ""}
            onChange={(e) => onDiffEnvChange(e.target.value || null)}
            className="bg-zinc-800 border border-zinc-600 rounded text-xs text-zinc-300 px-2 py-0.5 outline-none focus:border-zinc-500"
          >
            <option value="">None</option>
            {environments
              .filter((e) => e.env !== activeEnv)
              .map((e) => (
                <option key={e.env} value={e.env}>
                  {e.env}
                </option>
              ))}
          </select>
          {diffEnv && onViewDiff && (
            <button
              onClick={onViewDiff}
              className="flex items-center gap-1.5 text-xs bg-amber-700 hover:bg-amber-600 text-white px-3 py-1 rounded transition-colors font-medium"
              title={`View detailed diff: ${activeEnv} vs ${diffEnv}`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              View Diff
            </button>
          )}
        </div>
      )}
    </div>
  );
}
