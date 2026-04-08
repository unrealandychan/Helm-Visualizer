"use client";

import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo } from "react";
import { ResourceNode } from "./ResourceNode";
import type { ResourceGraphNode, ResourceGraphEdge, ResourceNodeData } from "@/types/helm";

interface ResourceGraphProps {
  nodes: ResourceGraphNode[];
  edges: ResourceGraphEdge[];
  highlightedKeys?: string[];
  onNodeSelect?: (data: ResourceNodeData | null) => void;
}

const nodeTypes = {
  resourceNode: ResourceNode,
};

export function ResourceGraph({
  nodes: initialNodes,
  edges: initialEdges,
  highlightedKeys = [],
  onNodeSelect,
}: ResourceGraphProps) {
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

  const handleNodeClick: NodeMouseHandler = (_, node) => {
    onNodeSelect?.((node.data as ResourceNodeData) ?? null);
  };

  const handlePaneClick = () => {
    onNodeSelect?.(null);
  };

  return (
    <div className="w-full h-full">
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
