"use client";

import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  getNodesBounds,
  getViewportForBounds,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  useEffect,
  useMemo,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react";
import { toPng, toSvg } from "html-to-image";
import { ResourceNode } from "./ResourceNode";
import clsx from "clsx";
import type { ResourceGraphNode, ResourceGraphEdge, ResourceNodeData } from "@/types/helm";

export interface ResourceGraphHandle {
  exportPng: () => Promise<void>;
  exportSvg: () => Promise<void>;
}

interface ResourceGraphProps {
  nodes: ResourceGraphNode[];
  edges: ResourceGraphEdge[];
  highlightedKeys?: string[];
  onNodeSelect?: (data: ResourceNodeData | null) => void;
  exportFilename?: string;
  theme?: "dark" | "light" | "high-contrast";
}

const nodeTypes = {
  resourceNode: ResourceNode,
};

const IMAGE_WIDTH = 1920;
const IMAGE_HEIGHT = 1080;
const VIEWPORT_SELECTOR = ".react-flow__viewport";

// ──────────────────────────────────────────────
// ExportController — rendered INSIDE <ReactFlow> so it has access to the RF context
// ──────────────────────────────────────────────

interface ExportControllerProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  exportFilename: string;
  exportBackground: string;
}

const ExportController = forwardRef<ResourceGraphHandle, ExportControllerProps>(
  ({ containerRef, exportFilename, exportBackground }, ref) => {
    const { getNodes } = useReactFlow();

    function getExportViewport() {
      const allNodes = getNodes();
      const bounds = getNodesBounds(allNodes);
      return getViewportForBounds(bounds, IMAGE_WIDTH, IMAGE_HEIGHT, 0.05, 2, 0.1);
    }

    useImperativeHandle(ref, () => ({
      async exportPng() {
        const el = containerRef.current?.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
        if (!el) return;
        const { x, y, zoom } = getExportViewport();
        const dataUrl = await toPng(el, {
          backgroundColor: exportBackground,
          width: IMAGE_WIDTH,
          height: IMAGE_HEIGHT,
          style: {
            width: `${IMAGE_WIDTH}px`,
            height: `${IMAGE_HEIGHT}px`,
            transform: `translate(${x}px, ${y}px) scale(${zoom})`,
          },
        });
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `${exportFilename}.png`;
        a.click();
      },

      async exportSvg() {
        const el = containerRef.current?.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
        if (!el) return;
        const { x, y, zoom } = getExportViewport();
        const dataUrl = await toSvg(el, {
          backgroundColor: exportBackground,
          width: IMAGE_WIDTH,
          height: IMAGE_HEIGHT,
          style: {
            width: `${IMAGE_WIDTH}px`,
            height: `${IMAGE_HEIGHT}px`,
            transform: `translate(${x}px, ${y}px) scale(${zoom})`,
          },
        });
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `${exportFilename}.svg`;
        a.click();
      },
    }));

    return null;
  }
);
ExportController.displayName = "ExportController";

// ──────────────────────────────────────────────
// ResourceGraph — the public component
// ──────────────────────────────────────────────

function ResourceGraphInner(
  {
    nodes: initialNodes,
    edges: initialEdges,
    highlightedKeys = [],
    onNodeSelect,
    exportFilename = "helm-graph",
    theme = "dark",
  }: ResourceGraphProps,
  ref: React.Ref<ResourceGraphHandle>
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const themeVisuals = useMemo(() => {
    if (theme === "light") {
      return {
        colorMode: "light" as const,
        edgeStroke: "#64748b",
        edgeLabel: "#475569",
        background: "#e2e8f0",
        exportBackground: "#f8fafc",
        controlsClass: "!bg-white !border-slate-300",
        minimapClass: "!bg-slate-100 !border-slate-300",
        minimapMask: "rgba(148,163,184,0.35)",
      };
    }
    if (theme === "high-contrast") {
      return {
        colorMode: "dark" as const,
        edgeStroke: "#a3a3a3",
        edgeLabel: "#f5f5f5",
        background: "#525252",
        exportBackground: "#000000",
        controlsClass: "!bg-black !border-white",
        minimapClass: "!bg-black !border-white",
        minimapMask: "rgba(0,0,0,0.65)",
      };
    }
    return {
      colorMode: "dark" as const,
      edgeStroke: "#6b7280",
      edgeLabel: "#9ca3af",
      background: "#27272a",
      exportBackground: "#09090b",
      controlsClass: "!bg-zinc-800 !border-zinc-700",
      minimapClass: "!bg-zinc-900 !border-zinc-700",
      minimapMask: "rgba(0,0,0,0.5)",
    };
  }, [theme]);

  // Apply highlight state to nodes
  const annotatedNodes = useMemo(() => {
    if (highlightedKeys.length === 0) return initialNodes;
    return initialNodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        highlighted: n.data.valuesUsed.some((k) =>
          highlightedKeys.some((hk) => k.startsWith(hk) || hk.startsWith(k))
        ),
      },
    }));
  }, [initialNodes, highlightedKeys]);

  const [nodes, setNodes, onNodesChange] = useNodesState(annotatedNodes as ResourceGraphNode[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges as ResourceGraphEdge[]);

  // Sync when data changes
  useEffect(() => {
    setNodes(annotatedNodes as ResourceGraphNode[]);
  }, [annotatedNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges as ResourceGraphEdge[]);
  }, [initialEdges, setEdges]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      onNodeSelect?.((node.data as ResourceNodeData) ?? null);
    },
    [onNodeSelect]
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect?.(null);
  }, [onNodeSelect]);

  return (
    <div className="w-full h-full" ref={containerRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        colorMode={themeVisuals.colorMode}
        defaultEdgeOptions={{
          style: { stroke: themeVisuals.edgeStroke },
          labelStyle: { fill: themeVisuals.edgeLabel, fontSize: 10 },
          labelBgStyle: { fill: "transparent" },
        }}
      >
        {/* ExportController is a child of ReactFlow so it can use useReactFlow() */}
        <ExportController
          ref={ref}
          containerRef={containerRef}
          exportFilename={exportFilename}
          exportBackground={themeVisuals.exportBackground}
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color={themeVisuals.background}
        />
        <Controls className={clsx(themeVisuals.controlsClass)} />
        <MiniMap
          nodeColor={(n) => kindToMiniMapColor((n.data as ResourceNodeData)?.kind ?? "Unknown")}
          className={clsx(themeVisuals.minimapClass)}
          maskColor={themeVisuals.minimapMask}
        />
      </ReactFlow>
    </div>
  );
}

export const ResourceGraph = forwardRef<ResourceGraphHandle, ResourceGraphProps>(ResourceGraphInner);
ResourceGraph.displayName = "ResourceGraph";

function kindToMiniMapColor(kind: string): string {
  const map: Record<string, string> = {
    Deployment: "#3b82f6",
    StatefulSet: "#60a5fa",
    DaemonSet: "#93c5fd",
    Service: "#22c55e",
    Ingress: "#eab308",
    HorizontalPodAutoscaler: "#a855f7",
    CronJob: "#f97316",
    Job: "#fb923c",
    ServiceAccount: "#6b7280",
    ConfigMap: "#14b8a6",
    Secret: "#ef4444",
    PersistentVolumeClaim: "#6366f1",
  };
  return map[kind] ?? "#71717a";
}
