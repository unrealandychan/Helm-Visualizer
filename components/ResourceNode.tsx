"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import clsx from "clsx";
import type { ResourceNodeData, K8sKind } from "@/types/helm";

// ── kind → visual config ──────────────────────────────────────────
const KIND_CONFIG: Record<
  K8sKind,
  { bg: string; border: string; text: string; iconChar: string; label: string }
> = {
  Deployment:               { bg: "bg-blue-950",   border: "border-blue-500",   text: "text-blue-300",   iconChar: "⬡", label: "Deploy" },
  StatefulSet:              { bg: "bg-blue-950",   border: "border-blue-400",   text: "text-blue-200",   iconChar: "⬡", label: "StatefulSet" },
  DaemonSet:                { bg: "bg-blue-950",   border: "border-blue-300",   text: "text-blue-100",   iconChar: "⬡", label: "DaemonSet" },
  Service:                  { bg: "bg-green-950",  border: "border-green-500",  text: "text-green-300",  iconChar: "⬟", label: "Service" },
  Ingress:                  { bg: "bg-yellow-950", border: "border-yellow-500", text: "text-yellow-300", iconChar: "⬖", label: "Ingress" },
  HorizontalPodAutoscaler:  { bg: "bg-purple-950", border: "border-purple-500", text: "text-purple-300", iconChar: "⬕", label: "HPA" },
  CronJob:                  { bg: "bg-orange-950", border: "border-orange-500", text: "text-orange-300", iconChar: "⏱", label: "CronJob" },
  Job:                      { bg: "bg-orange-900", border: "border-orange-400", text: "text-orange-200", iconChar: "⏱", label: "Job" },
  ServiceAccount:           { bg: "bg-gray-800",   border: "border-gray-500",   text: "text-gray-300",   iconChar: "👤", label: "SA" },
  ConfigMap:                { bg: "bg-teal-950",   border: "border-teal-500",   text: "text-teal-300",   iconChar: "⚙", label: "ConfigMap" },
  Secret:                   { bg: "bg-red-950",    border: "border-red-700",    text: "text-red-300",    iconChar: "🔑", label: "Secret" },
  PersistentVolumeClaim:    { bg: "bg-indigo-950", border: "border-indigo-500", text: "text-indigo-300", iconChar: "💾", label: "PVC" },
  Unknown:                  { bg: "bg-zinc-800",   border: "border-zinc-500",   text: "text-zinc-300",   iconChar: "?", label: "Resource" },
};

type ResourceNodeProps = NodeProps & {
  data: ResourceNodeData;
};

export function ResourceNode({ data, selected }: ResourceNodeProps) {
  const cfg = KIND_CONFIG[data.kind] ?? KIND_CONFIG["Unknown"];

  return (
    <div
      className={clsx(
        "relative rounded-lg border-2 px-3 py-2 shadow-lg min-w-[200px]",
        cfg.bg,
        cfg.border,
        selected && "ring-2 ring-white ring-offset-1 ring-offset-zinc-900",
        data.highlighted && "ring-2 ring-amber-400 ring-offset-1 ring-offset-zinc-900"
      )}
    >
      {/* Target handle (top) */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !bg-zinc-400 !border-zinc-600"
      />

      {/* Content */}
      <div className="flex items-start gap-2">
        <span className={clsx("text-lg leading-none mt-0.5", cfg.text)}>{cfg.iconChar}</span>
        <div className="min-w-0">
          <div className={clsx("text-[10px] font-semibold uppercase tracking-wider opacity-70", cfg.text)}>
            {cfg.label}
          </div>
          <div className="text-white text-sm font-medium truncate max-w-[160px]" title={data.label}>
            {data.label}
          </div>
          {data.namespace && (
            <div className="text-zinc-400 text-[10px] truncate">{data.namespace}</div>
          )}
        </div>
      </div>

      {/* Values used badge */}
      {data.valuesUsed.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          <span className="text-[9px] bg-zinc-700 text-zinc-300 rounded px-1 py-0.5">
            {data.valuesUsed.length} values
          </span>
        </div>
      )}

      {/* GPU badge */}
      {hasGpu(data) && (
        <span className="absolute top-1 right-1 text-[9px] bg-emerald-700 text-emerald-100 rounded px-1">
          GPU
        </span>
      )}

      {/* Source handle (bottom) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !bg-zinc-400 !border-zinc-600"
      />
    </div>
  );
}

function hasGpu(data: ResourceNodeData): boolean {
  const spec = data.resource.spec as Record<string, unknown> | undefined;
  const template = (spec?.template as Record<string, unknown> | undefined)?.spec as
    | Record<string, unknown>
    | undefined;
  const containers = (template?.containers ?? []) as Array<Record<string, unknown>>;

  return containers.some((c) => {
    const resources = c.resources as Record<string, unknown> | undefined;
    const limits = resources?.limits as Record<string, unknown> | undefined;
    return limits?.["nvidia.com/gpu"] !== undefined;
  });
}
