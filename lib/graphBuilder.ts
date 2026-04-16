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
  "ClusterRole",
  "ClusterRoleBinding",
  "Role",
  "RoleBinding",
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
  const roleBindings = resources.filter(
    (r) => r.kind === "RoleBinding" || r.kind === "ClusterRoleBinding"
  );

  // O(1) name-based lookup maps — avoids O(n) Array.find() inside loops
  const servicesByName = new Map(services.map((s) => [s.metadata.name, s]));
  const configMapsByName = new Map(configMaps.map((c) => [c.metadata.name, c]));
  const secretsByName = new Map(secrets.map((s) => [s.metadata.name, s]));
  const serviceAccountsByName = new Map(serviceAccounts.map((sa) => [sa.metadata.name, sa]));
  // For HPA scaleTargetRef we need lookup by "kind/name"
  const resourcesByKindAndName = new Map(
    resources.map((r) => [`${r.kind}/${r.metadata.name}`, r])
  );

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

  // Collect raw edges then deduplicate before returning
  const edgeSet = new Set<string>();
  const edges: Edge[] = [];

  function addEdge(source: string, target: string, label: string) {
    const key = `${source}|${target}|${label}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push({ source, target, label });
    }
  }

  // HPA → Deployment via scaleTargetRef.name
  for (const hpa of hpas) {
    const scaleRef = (hpa.spec as Record<string, unknown> | undefined)?.scaleTargetRef as
      | Record<string, unknown>
      | undefined;
    if (!scaleRef) continue;
    const targetName = scaleRef.name as string | undefined;
    const targetKind = scaleRef.kind as string | undefined;
    if (!targetName) continue;

    // Prefer exact kind/name lookup; fall back to name-only search among all resources
    const target = targetKind
      ? resourcesByKindAndName.get(`${targetKind}/${targetName}`)
      : resources.find((r) => r.metadata.name === targetName);
    if (target) {
      addEdge(nodeId(hpa), nodeId(target), "scales");
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
        addEdge(nodeId(svc), nodeId(dep), "routes to");
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

        const target = servicesByName.get(targetName);
        if (target) {
          addEdge(nodeId(ing), nodeId(target), "exposes");
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
      const sa = serviceAccountsByName.get(saName);
      if (sa) {
        addEdge(nodeId(sa), nodeId(workload), "bound to");
      }
    }
  }

  // RoleBinding / ClusterRoleBinding → Role / ClusterRole (via roleRef)
  // RoleBinding / ClusterRoleBinding → ServiceAccount (via subjects[])
  const resolveRoleRefTarget = (
    rb: K8sResource,
    refKind: string,
    refName: string,
  ): K8sResource | undefined => {
    if (refKind === "Role") {
      const rbNamespace = rb.metadata?.namespace;
      return Array.from(resourcesByKindAndName.values()).find((resource) => {
        return (
          resource.kind === "Role" &&
          resource.metadata?.name === refName &&
          resource.metadata?.namespace === rbNamespace
        );
      });
    }

    return resourcesByKindAndName.get(`${refKind}/${refName}`);
  };

  for (const rb of roleBindings) {
    const roleRef = (rb as Record<string, unknown>).roleRef as Record<string, unknown> | undefined;
    if (roleRef) {
      const refKind = roleRef.kind as string | undefined;
      const refName = roleRef.name as string | undefined;
      if (refKind && refName) {
        const role = resolveRoleRefTarget(rb, refKind, refName);
        if (role) {
          addEdge(nodeId(rb), nodeId(role), "binds");
        }
      }
    }

    const subjects = (rb as Record<string, unknown>).subjects as
      | Array<Record<string, unknown>>
      | undefined;
    if (subjects) {
      for (const subject of subjects) {
        if (subject.kind === "ServiceAccount") {
          const saName = subject.name as string | undefined;
          if (saName) {
            const sa = serviceAccountsByName.get(saName);
            if (sa) {
              addEdge(nodeId(rb), nodeId(sa), "grants");
            }
          }
        }
      }
    }
  }

  // ConfigMap / Secret → workloads via envFrom and volumes
  if (configMaps.length > 0 || secrets.length > 0) {
    for (const workload of allWorkloads) {
      const podSpec = getPodSpec(workload);
      if (!podSpec) continue;

      // envFrom references
      const envFrom = podSpec.envFrom as Array<Record<string, unknown>> | undefined;
      if (envFrom) {
        for (const ef of envFrom) {
          const cmRef = ef.configMapRef as Record<string, unknown> | undefined;
          const cmName = cmRef?.name as string | undefined;
          if (cmName) {
            const cm = configMapsByName.get(cmName);
            if (cm) addEdge(nodeId(cm), nodeId(workload), "mounted by");
          }
          const secRef = ef.secretRef as Record<string, unknown> | undefined;
          const secName = secRef?.name as string | undefined;
          if (secName) {
            const sec = secretsByName.get(secName);
            if (sec) addEdge(nodeId(sec), nodeId(workload), "mounted by");
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
            const cm = configMapsByName.get(cmName);
            if (cm) addEdge(nodeId(cm), nodeId(workload), "mounted by");
          }
          const secVol = vol.secret as Record<string, unknown> | undefined;
          const secName = secVol?.secretName as string | undefined;
          if (secName) {
            const sec = secretsByName.get(secName);
            if (sec) addEdge(nodeId(sec), nodeId(workload), "mounted by");
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
        addEdge(nodeId(svc), nodeId(cm), "referenced by");
      }
    }
  }

  // Secret → workloads via env.valueFrom.secretKeyRef
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
        const secName = secretKeyRef?.name as string | undefined;
        if (!secName) continue;
        const sec = secretsByName.get(secName);
        if (sec) addEdge(nodeId(sec), nodeId(workload), "mounted by");
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
