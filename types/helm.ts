// ──────────────────────────────────────────────
// Core Helm / Kubernetes domain types
// ──────────────────────────────────────────────

export interface HelmChartMeta {
  name: string;
  description: string;
  version: string;
  appVersion: string;
  apiVersion: string;
}

/** A single rendered Kubernetes resource from `helm template` output */
export interface K8sResource {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A single value entry extracted from a values.yaml file */
export interface ValuesEntry {
  key: string; // dot-notation path, e.g. "flavour.replicas.min"
  value: unknown;
  type: "string" | "number" | "boolean" | "object" | "array" | "null";
  usedInTemplates: string[]; // template file names where this key appears
}

/** The full extracted values tree for one environment */
export interface ValuesTree {
  env: string;
  raw: Record<string, unknown>;
  entries: ValuesEntry[];
}

/** Data returned by any of the three API routes */
export interface ChartRenderResult {
  chartMeta: HelmChartMeta;
  environments: EnvRenderResult[];
  activeEnv: string;
}

export interface EnvRenderResult {
  env: string;
  valuesFile: string;
  resources: K8sResource[];
  valuesTree: ValuesTree;
  renderedManifest?: string;
  renderError?: string;
}

// ──────────────────────────────────────────────
// React Flow graph types
// ──────────────────────────────────────────────

export type K8sKind =
  | "Deployment"
  | "Service"
  | "Ingress"
  | "HorizontalPodAutoscaler"
  | "CronJob"
  | "ServiceAccount"
  | "ConfigMap"
  | "Secret"
  | "StatefulSet"
  | "DaemonSet"
  | "Job"
  | "PersistentVolumeClaim"
  | "Unknown";

export interface ResourceNodeData extends Record<string, unknown> {
  resource: K8sResource;
  kind: K8sKind;
  label: string;
  namespace?: string;
  valuesUsed: string[];
  highlighted?: boolean;
}

export interface ResourceGraphNode {
  id: string;
  type: "resourceNode";
  position: { x: number; y: number };
  data: ResourceNodeData;
}

export interface ResourceGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
}

export interface GraphData {
  nodes: ResourceGraphNode[];
  edges: ResourceGraphEdge[];
}

// ──────────────────────────────────────────────
// Values diff types
// ──────────────────────────────────────────────

export type DiffStatus = "added" | "removed" | "changed" | "unchanged";

export interface ValuesDiffEntry {
  key: string;
  status: DiffStatus;
  baseValue?: unknown;
  compareValue?: unknown;
  baseType?: ValuesEntry["type"];
  compareType?: ValuesEntry["type"];
}

export interface ValuesDiffSummary {
  total: number;
  added: number;
  removed: number;
  changed: number;
  /** Removed keys + keys whose type changed */
  breaking: number;
}

export interface ValuesDiffResult {
  entries: ValuesDiffEntry[];
  summary: ValuesDiffSummary;
  /** All keys that differ (for graph node highlighting) */
  changedKeys: string[];
}

// ──────────────────────────────────────────────
// Artifact Hub API types
// ──────────────────────────────────────────────

export interface ArtifactHubPackage {
  package_id: string;
  name: string;
  display_name?: string;
  description?: string;
  version: string;
  app_version?: string;
  content_url?: string;
  repository: {
    name: string;
    url: string;
  };
}

export interface ArtifactHubSearchResult {
  packages: ArtifactHubPackage[];
  facets?: unknown[];
}
