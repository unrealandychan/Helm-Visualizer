import type { K8sResource, SecurityViolation } from "@/types/helm";

/** Helper to extract PodSpec from K8s Workloads */
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

/** Helper to extract all containers from a Workload */
function getContainers(podSpec: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  if (!podSpec) return [];
  const containers = (podSpec.containers as Array<Record<string, unknown>>) || [];
  const initContainers = (podSpec.initContainers as Array<Record<string, unknown>>) || [];
  return [...containers, ...initContainers];
}

/** Scan a single K8s resource and return its violations */
export function scanResource(r: K8sResource): SecurityViolation[] {
  const violations: SecurityViolation[] = [];
  if (!r || !r.kind) return violations;

  const kind = r.kind;
  const spec = r.spec as Record<string, unknown> | undefined;

  // 1. WORKLOAD SCANNING (Deployment, StatefulSet, DaemonSet, Job, CronJob)
  const isWorkload = ["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob"].includes(kind);
  if (isWorkload) {
    const podSpec = getPodSpec(r);
    const containers = getContainers(podSpec);

    // Rule 1.1: Run as non-root (Security)
    const podSc = podSpec?.securityContext as Record<string, unknown> | undefined;
    const podRunAsNonRoot = podSc?.runAsNonRoot === true;

    for (const container of containers) {
      const cName = (container.name as string) || "container";
      const cSc = container.securityContext as Record<string, unknown> | undefined;
      const runAsNonRoot = cSc?.runAsNonRoot === true || (cSc?.runAsNonRoot !== false && podRunAsNonRoot);

      if (!runAsNonRoot) {
        violations.push({
          id: "run-as-non-root",
          ruleName: "Run as Non-Root",
          category: "Security",
          severity: "high",
          message: `Container '${cName}' does not enforce runAsNonRoot: true. Running as root poses significant security risks.`,
          fixSuggestion: "Set 'securityContext.runAsNonRoot: true' at the Pod or Container level.",
        });
      }

      // Rule 1.2: Privileged container (Security)
      if (cSc?.privileged === true) {
        violations.push({
          id: "privileged-container",
          ruleName: "Privileged Container",
          category: "Security",
          severity: "high",
          message: `Container '${cName}' is running in privileged mode. Privileged containers can access host devices and escape container bounds.`,
          fixSuggestion: "Remove 'securityContext.privileged: true' or set it to false.",
        });
      }

      // Rule 1.3: Read-only root filesystem (Security)
      if (cSc?.readOnlyRootFilesystem !== true) {
        violations.push({
          id: "read-only-root-fs",
          ruleName: "Read-Only Root Filesystem",
          category: "Security",
          severity: "medium",
          message: `Container '${cName}' does not use a read-only root filesystem. A read-only root FS prevents malicious writes to the container's disk.`,
          fixSuggestion: "Set 'securityContext.readOnlyRootFilesystem: true' in the container context.",
        });
      }

      // Rule 1.4: CPU/Memory Resource Limits (Performance)
      const resources = container.resources as Record<string, unknown> | undefined;
      const limits = resources?.limits as Record<string, unknown> | undefined;
      const requests = resources?.requests as Record<string, unknown> | undefined;

      if (!limits || !limits.cpu || !limits.memory) {
        violations.push({
          id: "resource-limits",
          ruleName: "Missing Resource Limits",
          category: "Performance",
          severity: "medium",
          message: `Container '${cName}' is missing CPU and/or Memory resource limits. This can lead to resource exhaustion/starvation on the node (OOM).`,
          fixSuggestion: "Add 'resources.limits.cpu' and 'resources.limits.memory' configuration.",
        });
      }

      // Rule 1.5: CPU/Memory Resource Requests (Performance)
      if (!requests || !requests.cpu || !requests.memory) {
        violations.push({
          id: "resource-requests",
          ruleName: "Missing Resource Requests",
          category: "Performance",
          severity: "medium",
          message: `Container '${cName}' is missing CPU and/or Memory resource requests. Proper requests ensure the scheduler allocates pods to nodes with sufficient capacity.`,
          fixSuggestion: "Add 'resources.requests.cpu' and 'resources.requests.memory' configuration.",
        });
      }

      // Rule 1.6: Image Tag Pinning (Best Practice)
      const image = (container.image as string) || "";
      if (image && (image.endsWith(":latest") || !image.includes(":"))) {
        violations.push({
          id: "image-tag-latest",
          ruleName: "Using ':latest' Image Tag",
          category: "Best Practice",
          severity: "high",
          message: `Container '${cName}' uses the ':latest' image tag. This makes deployments unpredictable and hard to rollback.`,
          fixSuggestion: "Pin your container images to a specific version or a digest/SHA (e.g. 'v1.2.3').",
        });
      }
    }

    // Rule 1.7: HostPath Volumes (Security)
    const volumes = (podSpec?.volumes as Array<Record<string, unknown>>) || [];
    const hasHostPath = volumes.some((v) => v.hostPath !== undefined);
    if (hasHostPath) {
      violations.push({
        id: "hostpath-volume",
        ruleName: "HostPath Volume Mount",
        category: "Security",
        severity: "high",
        message: "Workload mounts a hostPath volume. Direct host filesystem access can compromise the entire node.",
        fixSuggestion: "Use persistent volume claims (PVC) or emptyDir instead of hostPath.",
      });
    }

    // Rule 1.8: Missing Probes (Reliability - Deployments/StatefulSets/DaemonSets)
    if (["Deployment", "StatefulSet", "DaemonSet"].includes(kind)) {
      for (const container of containers) {
        const cName = (container.name as string) || "container";
        const hasLiveness = container.livenessProbe !== undefined;
        const hasReadiness = container.readinessProbe !== undefined;

        if (!hasLiveness || !hasReadiness) {
          const missing = !hasLiveness && !hasReadiness ? "Liveness & Readiness" : !hasLiveness ? "Liveness" : "Readiness";
          violations.push({
            id: "missing-probes",
            ruleName: "Missing Probes",
            category: "Reliability",
            severity: "medium",
            message: `Container '${cName}' is missing ${missing} probe(s). Probes are essential for self-healing and zero-downtime rolling upgrades.`,
            fixSuggestion: "Configure 'livenessProbe' and 'readinessProbe' with HTTP, TCP, or Exec checks.",
          });
        }
      }
    }
  }

  // 2. SERVICE SCANNING
  if (kind === "Service") {
    const selector = spec?.selector as Record<string, string> | undefined;
    const sType = (spec?.type as string) || "ClusterIP";

    // Rule 2.1: Missing Selector for Standard Services
    if (sType !== "ExternalName" && (!selector || Object.keys(selector).length === 0)) {
      violations.push({
        id: "service-selector",
        ruleName: "Missing Service Selector",
        category: "Reliability",
        severity: "high",
        message: "Service is missing selector labels. It will not route traffic to any Pods.",
        fixSuggestion: "Add a 'spec.selector' mapping that matches your Workload's Pod labels.",
      });
    }
  }

  // 3. SECRETS SCANNING
  if (kind === "Secret") {
    const data = r.data as Record<string, string> | undefined;
    if (data && Object.keys(data).length === 0) {
      violations.push({
        id: "empty-secret",
        ruleName: "Empty Secret",
        category: "Best Practice",
        severity: "low",
        message: "Secret contains no keys in 'data' or 'stringData'. Ensure keys are not accidentally omitted.",
        fixSuggestion: "Populate the 'data' or 'stringData' map with base64 encoded strings or plain text.",
      });
    }
  }

  return violations;
}

/** Scan a full list of K8s resources and map their resourceId to their violations */
export function scanEnvironment(resources: K8sResource[]): Map<string, SecurityViolation[]> {
  const map = new Map<string, SecurityViolation[]>();
  for (const r of resources) {
    if (!r.kind || !r.metadata?.name) continue;
    const baseId = `${r.kind}/${r.metadata.name}`;
    const violations = scanResource(r);
    if (violations.length > 0) {
      map.set(baseId, violations);
    }
  }
  return map;
}
