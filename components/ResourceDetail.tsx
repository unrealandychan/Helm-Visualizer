"use client";

import { useState } from "react";
import { X, FileText, Variable, Shield, ShieldCheck, GitCompare } from "lucide-react";
import clsx from "clsx";
import type { ResourceNodeData } from "@/types/helm";

interface ResourceDetailProps {
  data: ResourceNodeData | null;
  onClose: () => void;
}

type ActiveTab = "yaml" | "values" | "security" | "live-diff";

export function ResourceDetail({ data, onClose }: ResourceDetailProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("yaml");

  if (!data) return null;

  const yamlStr = toYaml(data.resource);

  return (
    <div className="flex flex-col h-full bg-zinc-900 border-l border-zinc-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 shrink-0">
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-zinc-500 font-semibold tracking-wider">
            {data.resource.kind}
          </div>
          <div className="text-white text-sm font-semibold truncate">
            {data.label}
          </div>
          {data.namespace && (
            <div className="text-zinc-400 text-[10px]">ns: {data.namespace}</div>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-white p-1 rounded hover:bg-zinc-700 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex border-b border-zinc-700 px-4 gap-4 shrink-0">
          <TabLabel
            icon={<FileText className="w-3 h-3" />}
            label="YAML"
            active={activeTab === "yaml"}
            onClick={() => setActiveTab("yaml")}
          />
          {data.valuesUsed.length > 0 && (
            <TabLabel
              icon={<Variable className="w-3 h-3" />}
              label={`Values (${data.valuesUsed.length})`}
              active={activeTab === "values"}
              onClick={() => setActiveTab("values")}
            />
          )}
          <TabLabel
            icon={<Shield className="w-3 h-3" />}
            label={data.violations && data.violations.length > 0 ? `Security (${data.violations.length})` : "Security"}
            active={activeTab === "security"}
            onClick={() => setActiveTab("security")}
          />
          {data.syncStatus && (
            <TabLabel
              icon={<GitCompare className="w-3 h-3" />}
              label="Live Diff"
              active={activeTab === "live-diff"}
              onClick={() => setActiveTab("live-diff")}
            />
          )}
        </div>

        {activeTab === "yaml" && (
          <div className="flex-1 overflow-y-auto p-3">
            {/* API version + Kind badge */}
            <div className="flex flex-wrap gap-1 mb-3">
              <Badge label={data.resource.apiVersion} variant="blue" />
              <Badge label={data.resource.kind} variant="purple" />
              {data.resource.metadata?.namespace && (
                <Badge label={`ns: ${data.resource.metadata.namespace}`} variant="gray" />
              )}
            </div>

            {/* Rendered YAML */}
            <div className="text-[10px] text-zinc-500 font-semibold uppercase mb-1">
              Rendered YAML
            </div>
            <pre className="text-[11px] text-zinc-200 bg-zinc-950 rounded p-3 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
              {yamlStr}
            </pre>
          </div>
        )}

        {activeTab === "values" && (
          <div className="flex-1 overflow-y-auto p-3">
            <div className="text-[10px] uppercase text-zinc-500 font-semibold mb-2">
              Values Referenced
            </div>
            {data.valuesUsed.length === 0 ? (
              <p className="text-zinc-500 text-xs">No values keys referenced.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {data.valuesUsed.map((v) => (
                  <div
                    key={v}
                    className="text-[11px] bg-amber-900/20 border border-amber-800/40 text-amber-300 rounded px-2 py-1 font-mono"
                  >
                    .Values.{v}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "security" && (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            <div className="text-[10px] uppercase text-zinc-500 font-semibold tracking-wider shrink-0">
              Security & Best Practices
            </div>

            {!data.violations || data.violations.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-6 bg-emerald-950/20 border border-emerald-800/30 rounded-lg text-center gap-2 my-4">
                <ShieldCheck className="w-8 h-8 text-emerald-400" />
                <div>
                  <h4 className="text-emerald-300 text-xs font-semibold">No Violations Found</h4>
                  <p className="text-zinc-400 text-[10px] mt-1 max-w-[200px] mx-auto leading-relaxed">
                    This resource complies with all built-in security and reliability best practices.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {data.violations.map((v, i) => (
                  <div
                    key={`${v.id}-${i}`}
                    className={clsx(
                      "p-3 rounded-lg border flex flex-col gap-1.5",
                      v.severity === "high"
                        ? "bg-red-950/10 border-red-900/40"
                        : v.severity === "medium"
                        ? "bg-yellow-950/10 border-yellow-900/40"
                        : "bg-blue-950/10 border-blue-900/40"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={clsx(
                          "text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider font-mono",
                          v.severity === "high"
                            ? "bg-red-900 text-red-200"
                            : v.severity === "medium"
                            ? "bg-yellow-900 text-yellow-200"
                            : "bg-blue-900 text-blue-200"
                        )}
                      >
                        {v.severity}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-semibold uppercase">{v.category}</span>
                    </div>

                    <h4 className="text-zinc-100 text-xs font-bold leading-snug">{v.ruleName}</h4>
                    <p className="text-zinc-300 text-[11px] leading-relaxed">{v.message}</p>

                    <div className="mt-1 pt-1.5 border-t border-zinc-800/50">
                      <div className="text-[9px] text-zinc-500 uppercase font-semibold">Suggested Fix</div>
                      <p className="text-amber-400/90 text-[10px] leading-relaxed font-mono mt-0.5 bg-zinc-950/40 p-1.5 rounded border border-zinc-800/30">
                        {v.fixSuggestion}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "live-diff" && data.syncStatus && (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            <div className="text-[10px] uppercase text-zinc-500 font-semibold tracking-wider shrink-0">
              Live Cluster Diff
            </div>

            {data.syncStatus === "local-only" && (
              <div className="flex flex-col items-center justify-center p-6 bg-zinc-950/40 border border-zinc-800 rounded-lg text-center gap-2">
                <span className="text-2xl">○</span>
                <div>
                  <h4 className="text-zinc-300 text-xs font-semibold">Local Only</h4>
                  <p className="text-zinc-500 text-[10px] mt-1 max-w-[200px] mx-auto leading-relaxed">
                    This resource only exists in your local Helm render and has not yet been deployed to the live Kubernetes cluster.
                  </p>
                </div>
              </div>
            )}

            {data.syncStatus === "in-sync" && (
              <div className="flex flex-col items-center justify-center p-6 bg-emerald-950/20 border border-emerald-800/30 rounded-lg text-center gap-2">
                <span className="text-2xl text-emerald-400">🟢</span>
                <div>
                  <h4 className="text-emerald-300 text-xs font-semibold">In Sync</h4>
                  <p className="text-zinc-400 text-[10px] mt-1 max-w-[200px] mx-auto leading-relaxed">
                    This resource is perfectly in sync with the manifest currently running in the active cluster context.
                  </p>
                </div>
              </div>
            )}

            {data.syncStatus === "out-of-sync" && data.liveYaml && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-amber-300 text-xs font-semibold">▲ Diff Detected</h4>
                  <span className="text-[9px] bg-amber-950 text-amber-300 px-1.5 py-0.5 rounded font-bold border border-amber-800/40">
                    Out of Sync
                  </span>
                </div>
                
                <div className="text-[9px] text-zinc-500 uppercase font-semibold">Line-by-line Diff (- local, + live)</div>
                <pre className="text-[10px] bg-zinc-950 rounded p-3 overflow-x-auto font-mono leading-relaxed max-h-[400px] overflow-y-auto flex flex-col gap-0.5 border border-zinc-800">
                  {computeLineDiff(yamlStr, data.liveYaml).map((line, idx) => (
                    <div
                      key={idx}
                      className={clsx(
                        "whitespace-pre-wrap pl-1.5 py-0.5 rounded",
                        line.type === "local"
                          ? "bg-red-950/40 text-red-300 border-l-2 border-red-600 font-medium"
                          : line.type === "live"
                          ? "bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-600 font-medium"
                          : "text-zinc-400"
                      )}
                    >
                      {line.text}
                    </div>
                  ))}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Badge({ label, variant }: { label: string; variant: "blue" | "purple" | "gray" }) {
  const cls = {
    blue: "bg-blue-900/60 text-blue-300",
    purple: "bg-purple-900/60 text-purple-300",
    gray: "bg-zinc-700 text-zinc-300",
  }[variant];

  return (
    <span className={clsx("text-[9px] rounded px-1.5 py-0.5 font-mono", cls)}>{label}</span>
  );
}

function TabLabel({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center gap-1.5 text-xs py-2 border-b-2 transition-colors",
        active
          ? "border-blue-500 text-white"
          : "border-transparent text-zinc-500 hover:text-zinc-300"
      )}
    >
      {icon}
      {label}
    </button>
  );
}


// ── Simple YAML serialiser ── avoids a full yaml library import on client ──
function toYaml(obj: unknown, indent = 0): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string") {
    // Quote multiline or special strings
    if (obj.includes("\n") || obj.includes(":")) return `"${obj.replace(/"/g, '\\"')}"`;
    return obj;
  }
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);

  const pad = "  ".repeat(indent);
  const childPad = "  ".repeat(indent + 1);

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj
      .map((item) => `${pad}- ${toYaml(item, indent + 1).trimStart()}`)
      .join("\n");
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => {
        const val = toYaml(v, indent + 1);
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          return `${pad}${k}:\n${childPad}${val.trimStart()}`;
        }
        if (Array.isArray(v) && v.length > 0) {
          return `${pad}${k}:\n${val}`;
        }
        return `${pad}${k}: ${val}`;
      })
      .join("\n");
  }

  return String(obj);
}

// ── Simple line-by-line diff helper ──
function computeLineDiff(local: string, live: string) {
  const localLines = local.split("\n");
  const liveLines = live.split("\n");
  const max = Math.max(localLines.length, liveLines.length);
  const result: Array<{ type: "same" | "local" | "live"; text: string }> = [];

  for (let i = 0; i < max; i++) {
    const loc = localLines[i];
    const liv = liveLines[i];
    if (loc === liv) {
      if (loc !== undefined) result.push({ type: "same", text: loc });
    } else {
      if (loc !== undefined) result.push({ type: "local", text: `- ${loc}` });
      if (liv !== undefined) result.push({ type: "live", text: `+ ${liv}` });
    }
  }
  return result;
}
