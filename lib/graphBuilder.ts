import dagre from "@dagrejs/dagre";
import type {
  K8sResource,
  K8sKind,
  ResourceGraphNode,
  ResourceGraphEdge,
  GraphData,
  ResourceNodeData,
} from "@/types/helm";
import { extractTemplateValueRefs } from "./yamlParser";

// ──────────────────────────────────────────────
// Kind classification
// ──────────────────────────────────────────────

const KNOWN_KINDS: Set<string> = new Set([
  "Deployment",
  "Service",
  "Ingress",
  "HorizontalPodAutoscaler",
  "CronJob",
  "ServiceAccount",
  "ConfigMap",
  "Secret",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "PersistentVolumeClaim",
]);

function classifyKind(kind: string): K8sKind {
  return KNOWN_KINDS.has(kind) ? (kind as K8sKind) : "Unknown";
}

// ──────────────────────────────────────────────
// Relationship inference
// ──────────────────────────────────────────────

interface Edge {
  source: string;
  target: string;
  label: string;
}

function inferEdges(resources: K8sResource[]): Edge[] {
  const edges: Edge[] = [];
  const nodeId = (r: K8sResource) => resourceId(r);

  // Build lookup maps
  const deployments = resources.filter(
    (r) => r.kind === "Deployment" || r.kind === "StatefulSet" || r.kind === "DaemonSet"
  );
  const services = resources.filter((r) => r.kind === "Service");
  const hpas = resources.filter((r) => r.kind === "HorizontalPodAutoscaler");
  const ingresses = resources.filter((r) => r.kind === "Ingress");
  const serviceAccounts = resources.filter((r) => r.kind === "ServiceAccount");
  const cronJobs = resources.filter((r) => r.kind === "CronJob");
  const configMaps = resources.filter((r) => r.kind === "ConfigMap");
  const secrets = resources.filter((r) => r.kind === "Secret");

  // Helper: extract pod spec from any workload kind
  function getPodSpec(r: K8sResource): Record<string, unknown> | undefined {
    if (r.kind === "CronJob") {
      const s = r.spec as Record<string, unknown> | undefined;
      const jt = s?.jobTemplate as Record<string, unknown> | undefined;
      const js = jt?.spec as Record<string, unknown> | undefined;
      const tmpl = js?.template as Record<string, unknown> | undefined;
      return (tmpl as Record<string, unknown> | undefined)?.spec as Record<string, unknown> | undefined;
    }
    const s = r.spec as Record<string, unknown> | undefined;
    const tmpl = s?.template as Record<string, unknown> | undefined;
    return (tmpl as Record<string, unknown> | undefined)?.spec as Record<string, unknown> | undefined;
  }

  const allWorkloads: K8sResource[] = [...deployments, ...cronJobs];

  // HPA → Deployment via scaleTargetRef.name
  for (const hpa of hpas) {
    const scaleRef = (hpa.spec as Record<string, unknown> | undefined)?.scaleTargetRef as
      | Record<string, unknown>
      | undefined;
    if (!scaleRef) continue;
    const targetName = scaleRef.name as string | undefined;
    const targetKind = scaleRef.kind as string | undefined;

    const target = resources.find(
      (r) =>
        r.metadata.name === targetName &&
        (!targetKind || r.kind === targetKind)
    );
    if (target) {
      edges.push({ source: nodeId(hpa), target: nodeId(target), label: "scales" });
    }
  }

  // Service → Deployment via selector matching
  for (const svc of services) {
    const spec = svc.spec as Record<string, unknown> | undefined;
    const selector = spec?.selector as Record<string, string> | undefined;
    if (!selector || Object.keys(selector).length === 0) continue;

    for (const dep of deployments) {
      const depSpec = dep.spec as Record<string, unknown> | undefined;
      const template = depSpec?.template as Record<string, unknown> | undefined;
      const podMeta = template?.metadata as Record<string, unknown> | undefined;
      const podLabels = podMeta?.labels as Record<string, string> | undefined;
      if (!podLabels) continue;

      const matches = Object.entries(selector).every(
        ([k, v]) => podLabels[k] === v
      );
      if (matches) {
        edges.push({ source: nodeId(svc), target: nodeId(dep), label: "routes to" });
      }
    }
  }

  // Ingress → Service via backend
  for (const ing of ingresses) {
    const spec = ing.spec as Record<string, unknown> | undefined;
    const rules = spec?.rules as Array<Record<string, unknown>> | undefined;
    if (!rules) continue;

    for (const rule of rules) {
      const http = rule.http as Record<string, unknown> | undefined;
      const paths = http?.paths as Array<Record<string, unknown>> | undefined;
      if (!paths) continue;

      for (const path of paths) {
        const backend = path.backend as Record<string, unknown> | undefined;
        const svcBackend = backend?.service as Record<string, unknown> | undefined;
        const targetName = svcBackend?.name as string | undefined;
        if (!targetName) continue;

        const target = services.find((s) => s.metadata.name === targetName);
        if (target) {
          edges.push({ source: nodeId(ing), target: nodeId(target), label: "exposes" });
        }
      }
    }
  }

  // ServiceAccount → workloads via serviceAccountName
  if (serviceAccounts.length > 0) {
    for (const workload of allWorkloads) {
      const podSpec = getPodSpec(workload);
      const saName = podSpec?.serviceAccountName as string | undefined;
      if (!saName) continue;
      const sa = serviceAccounts.find((s) => s.metadata.name === saName);
      if (sa) {
        edges.push({ source: nodeId(sa), target: nodeId(workload), label: "bound to" });
      }
    }
  }

  // ConfigMap / Secret → workloads via envFrom and volumes
  if (configMaps.length > 0 || secrets.length > 0) {    for (const workload of allWorkloads) {
      const podSpec = getPodSpec(workload);
      if (!podSpec) continue;

      // envFrom references
      const envFrom = podSpec.envFrom as Array<Record<string, unknown>> | undefined;
      if (envFrom) {
        for (const ef of envFrom) {
          const cmRef = ef.configMapRef as Record<string, unknown> | undefined;
          const cmName = cmRef?.name as string | undefined;
          if (cmName) {
            const cm = configMaps.find((c) => c.metadata.name === cmName);
            if (cm) edges.push({ source: nodeId(cm), target: nodeId(workload), label: "mounted by" });
          }
          const secRef = ef.secretRef as Record<string, unknown> | undefined;
          const secName = secRef?.name as string | undefined;
          if (secName) {
            const sec = secrets.find((s) => s.metadata.name === secName);
            if (sec) edges.push({ source: nodeId(sec), target: nodeId(workload), label: "mounted by" });
          }
        }
      }

      // volumes references
      const volumes = podSpec.volumes as Array<Record<string, unknown>> | undefined;
      if (volumes) {
        for (const vol of volumes) {
          const cmVol = vol.configMap as Record<string, unknown> | undefined;
          const cmName = cmVol?.name as string | undefined;
          if (cmName) {
            const cm = configMaps.find((c) => c.metadata.name === cmName);
            if (cm) edges.push({ source: nodeId(cm), target: nodeId(workload), label: "mounted by" });
          }
          const secVol = vol.secret as Record<string, unknown> | undefined;
          const secName = secVol?.secretName as string | undefined;
          if (secName) {
            const sec = secrets.find((s) => s.metadata.name === secName);
            if (sec) edges.push({ source: nodeId(sec), target: nodeId(workload), label: "mounted by" });
          }
        }
      }
    }
  }

  // Service → ConfigMap via data values (e.g. DATABASE_HOST points to a service name)
  for (const svc of services) {
    const svcName = svc.metadata.name;
    for (const cm of configMaps) {
      const data = cm.data as Record<string, string> | undefined;
      if (!data) continue;
      const referenced = Object.values(data).some((v) => String(v) === svcName);
      if (referenced) {
        edges.push({ source: nodeId(svc), target: nodeId(cm), label: "referenced by" });
      }
    }
  }

  // Secret → StatefulSet via env.valueFrom.secretKeyRef (e.g., postgres POSTGRES_PASSWORD)
  for (const sec of secrets) {
    const secName = sec.metadata.name;
    for (const workload of allWorkloads) {
      const podSpec = getPodSpec(workload);
      if (!podSpec) continue;
      const containers = podSpec.containers as Array<Record<string, unknown>> | undefined;
      if (!containers) continue;
      for (const container of containers) {
        const env = container.env as Array<Record<string, unknown>> | undefined;
        if (!env) continue;
        for (const envVar of env) {
          const valueFrom = envVar.valueFrom as Record<string, unknown> | undefined;
          const secretKeyRef = valueFrom?.secretKeyRef as Record<string, unknown> | undefined;
          if (secretKeyRef?.name === secName) {
            edges.push({ source: nodeId(sec), target: nodeId(workload), label: "mounted by" });
          }
        }
      }
    }
  }

  return edges;
}

// ──────────────────────────────────────────────
// Node ID helper
// ──────────────────────────────────────────────

function resourceId(r: K8sResource): string {
  return `${r.kind}/${r.metadata?.name ?? "unknown"}`;
}

// ──────────────────────────────────────────────
// Value reference mapping per resource
// ──────────────────────────────────────────────

function buildValueRefMap(
  renderedYaml: string
): Map<string, string[]> {
  // Map from "Kind/name" to list of .Values.xxx keys referenced in that document
  const map = new Map<string, string[]>();

  // Split multi-doc YAML into individual docs
  const docs = renderedYaml.split(/^---$/m).filter((d) => d.trim());

  for (const doc of docs) {
    // Quick extract kind + name from the doc text
    const kindMatch = /^kind:\s*(\S+)/m.exec(doc);
    const nameMatch = /^\s+name:\s*(\S+)/m.exec(doc);
    if (!kindMatch || !nameMatch) continue;

    const id = `${kindMatch[1]}/${nameMatch[1]}`;
    const refs = extractTemplateValueRefs(doc);
    map.set(id, refs);
  }

  return map;
}

// ──────────────────────────────────────────────
// Dagre auto-layout
// ──────────────────────────────────────────────

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

function applyDagreLayout(
  nodes: ResourceGraphNode[],
  edges: ResourceGraphEdge[]
): ResourceGraphNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: 80, nodesep: 50 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const { x, y } = g.node(node.id);
    return {
      ...node,
      position: {
        x: x - NODE_WIDTH / 2,
        y: y - NODE_HEIGHT / 2,
      },
    };
  });
}

// ──────────────────────────────────────────────
// Main builder
// ──────────────────────────────────────────────

/**
 * Build a React Flow graph from a list of K8s resources + the original rendered YAML
 * (for value reference mapping).
 */
export function buildGraph(
  resources: K8sResource[],
  renderedYaml = ""
): GraphData {
  const valueRefMap = buildValueRefMap(renderedYaml);

  // Track how many times each base id has been seen so we can suffix duplicates
  const idCounts = new Map<string, number>();

  // Build nodes — skip resources without metadata (e.g. CRDs, lists)
  const nodes: ResourceGraphNode[] = resources
    .filter((resource) => resource.metadata?.name)
    .map((resource) => {
      const baseId = resourceId(resource);
      const count = idCounts.get(baseId) ?? 0;
      idCounts.set(baseId, count + 1);
      // Append a numeric suffix for every occurrence after the first
      const id = count === 0 ? baseId : `${baseId}-${count}`;

      const kind = classifyKind(resource.kind);

      const nodeData: ResourceNodeData = {
        resource,
        kind,
        label: resource.metadata.name,
        namespace: resource.metadata.namespace,
        valuesUsed: valueRefMap.get(baseId) ?? [],
      };

      return {
        id,
        type: "resourceNode" as const,
        position: { x: 0, y: 0 },
        data: nodeData,
      };
    });

  // Build edges
  const rawEdges = inferEdges(resources);
  const edges: ResourceGraphEdge[] = rawEdges.map((e, i) => ({
    id: `edge-${i}`,
    source: e.source,
    target: e.target,
    label: e.label,
    animated: e.label === "routes to" || e.label === "exposes",
  }));

  // Apply dagre layout
  const layoutedNodes = applyDagreLayout(nodes, edges);

  return { nodes: layoutedNodes, edges };
}
