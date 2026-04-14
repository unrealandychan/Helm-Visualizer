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
}

const nodeTypes = {
  resourceNode: ResourceNode,
};

const IMAGE_WIDTH = 1920;
const IMAGE_HEIGHT = 1080;

function ResourceGraphInner(
  {
    nodes: initialNodes,
    edges: initialEdges,
    highlightedKeys = [],
    onNodeSelect,
    exportFilename = "helm-graph",
  }: ResourceGraphProps,
  ref: React.Ref<ResourceGraphHandle>
) {
  const { getNodes } = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);

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

  function getExportViewport() {
    const allNodes = getNodes();
    const bounds = getNodesBounds(allNodes);
    return getViewportForBounds(bounds, IMAGE_WIDTH, IMAGE_HEIGHT, 0.05, 2, 0.1);
  }

  useImperativeHandle(ref, () => ({
    async exportPng() {
      const el = containerRef.current?.querySelector<HTMLElement>(".react-flow__viewport");
      if (!el) return;
      const { x, y, zoom } = getExportViewport();
      const dataUrl = await toPng(el, {
        backgroundColor: "#09090b",
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
      const el = containerRef.current?.querySelector<HTMLElement>(".react-flow__viewport");
      if (!el) return;
      const { x, y, zoom } = getExportViewport();
      const dataUrl = await toSvg(el, {
        backgroundColor: "#09090b",
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
        colorMode="dark"
        defaultEdgeOptions={{
          style: { stroke: "#6b7280" },
          labelStyle: { fill: "#9ca3af", fontSize: 10 },
          labelBgStyle: { fill: "transparent" },
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#27272a"
        />
        <Controls className="!bg-zinc-800 !border-zinc-700" />
        <MiniMap
          nodeColor={(n) => kindToMiniMapColor((n.data as ResourceNodeData)?.kind ?? "Unknown")}
          className="!bg-zinc-900 !border-zinc-700"
          maskColor="rgba(0,0,0,0.5)"
        />
      </ReactFlow>
    </div>
  );
}

export const ResourceGraph = forwardRef<ResourceGraphHandle, ResourceGraphProps>(ResourceGraphInner);

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
