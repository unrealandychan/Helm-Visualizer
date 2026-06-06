import type { K8sResource } from "@/types/helm";

export interface ClusterDiffResult {
  baseId: string;
  syncStatus: "in-sync" | "out-of-sync" | "local-only" | "orphaned";
  localYaml: string;
  liveYaml: string | null;
  diffText?: string; // summary of changes
}

/** Sanitize runtime-only fields from a live Kubernetes resource to prevent false-positive diffs */
export function sanitizeLiveResource(live: Record<string, unknown>): Record<string, unknown> {
  const clean = JSON.parse(JSON.stringify(live));

  if (clean.metadata) {
    delete clean.metadata.uid;
    delete clean.metadata.resourceVersion;
    delete clean.metadata.generation;
    delete clean.metadata.creationTimestamp;
    delete clean.metadata.managedFields;
    delete clean.metadata.selfLink;
    
    if (clean.metadata.annotations) {
      delete clean.metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"];
      delete clean.metadata.annotations["deployment.kubernetes.io/revision"];
    }
  }
  
  delete clean.status;
  return clean;
}

/** Compute a structural comparison between local and live resources */
export function diffResources(local: K8sResource, liveRaw: Record<string, unknown> | null): ClusterDiffResult {
  const baseId = `${local.kind}/${local.metadata.name}`;
  const localYaml = toYaml(local);

  if (!liveRaw) {
    return {
      baseId,
      syncStatus: "local-only",
      localYaml,
      liveYaml: null,
    };
  }

  const liveClean = sanitizeLiveResource(liveRaw);
  const liveYaml = toYaml(liveClean);

  // Compare structural equivalence
  const localNormalized = JSON.parse(JSON.stringify(local));
  // Normalize both by removing status and standard annotations from local as well if present
  if (localNormalized.metadata?.annotations) {
    delete localNormalized.metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"];
  }
  delete localNormalized.status;

  const isEquivalent = JSON.stringify(localNormalized) === JSON.stringify(liveClean);

  return {
    baseId,
    syncStatus: isEquivalent ? "in-sync" : "out-of-sync",
    localYaml,
    liveYaml,
  };
}

// ── Simple YAML serialiser ──
function toYaml(obj: unknown, indent = 0): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string") {
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
