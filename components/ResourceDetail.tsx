"use client";

import { useState } from "react";
import { X, FileText, Variable } from "lucide-react";
import clsx from "clsx";
import type { ResourceNodeData } from "@/types/helm";

interface ResourceDetailProps {
  data: ResourceNodeData | null;
  onClose: () => void;
}

type ActiveTab = "yaml" | "values";

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
