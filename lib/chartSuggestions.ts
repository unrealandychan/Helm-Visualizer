import type { ChartRenderResult, ChartSuggestion, EnvRenderResult } from "@/types/helm";

const PROD_ENV_RE = /^(prod|prd|production)$/i;
const BEST_PRACTICE_REF = "References: [2], [5], [6].";
const DEFAULT_IMAGE_TAG_RECOMMENDATION = "stable";
const MIN_REPLICA_COUNT = 1;
const DEFAULT_REPLICA_RECOMMENDATION = 2;
const DEFAULT_PROD_REPLICA_RECOMMENDATION = 3;

export function analyzeChartSuggestions(result: ChartRenderResult | null): ChartSuggestion[] {
  if (!result) return [];
  const defaultEnv = result.environments.find((e) => e.env === "default") ?? result.environments[0];
  if (!defaultEnv) return [];

  const suggestions: ChartSuggestion[] = [];
  const tagKeys = defaultEnv.valuesTree.entries
    .map((e) => e.key)
    .filter((k) => /(^|\.)(imageTag|image\.tag)$/i.test(k));
  const replicaKeys = defaultEnv.valuesTree.entries
    .map((e) => e.key)
    .filter((k) => /(^|\.)replicaCount$/i.test(k));

  if (tagKeys.length === 0) {
    suggestions.push({
      id: "default:image.tag:missing",
      env: defaultEnv.env,
      level: "high",
      title: "No explicit image tag key detected",
      keyPath: "image.tag",
      recommendation: result.chartMeta.appVersion || result.chartMeta.version || DEFAULT_IMAGE_TAG_RECOMMENDATION,
      rationale: `Pin image tags in values to avoid drifting deployments caused by mutable tags. ${BEST_PRACTICE_REF}`,
    });
  }

  for (const keyPath of tagKeys) {
    const value = getByPath(defaultEnv.valuesTree.raw, keyPath);
    if (typeof value !== "string" || !value.trim() || value.trim().toLowerCase() === "latest") {
      suggestions.push({
        id: `default:${keyPath}:unbounded`,
        env: defaultEnv.env,
        level: "high",
        title: "Image tag is not pinned",
        keyPath,
        recommendation: result.chartMeta.appVersion || result.chartMeta.version || DEFAULT_IMAGE_TAG_RECOMMENDATION,
        rationale: `Set a deterministic image tag for reproducible rollouts and safer rollbacks. ${BEST_PRACTICE_REF}`,
      });
    }

    for (const env of result.environments) {
      if (env.env === defaultEnv.env) continue;
      if (PROD_ENV_RE.test(env.env) && !hasPath(env.valuesTree.raw, keyPath)) {
        const fallbackRecommendation =
          typeof value === "string" && value.trim()
            ? value
            : (result.chartMeta.appVersion || result.chartMeta.version || DEFAULT_IMAGE_TAG_RECOMMENDATION);
        suggestions.push({
          id: `${env.env}:${keyPath}:override-missing`,
          env: env.env,
          level: "high",
          title: "Production override missing for image tag",
          keyPath,
          recommendation: fallbackRecommendation,
          rationale: `Set image tag explicitly in production overrides to keep releases auditable. ${BEST_PRACTICE_REF}`,
        });
      }
    }
  }

  for (const keyPath of replicaKeys) {
    const value = getByPath(defaultEnv.valuesTree.raw, keyPath);
    if (typeof value !== "number" || Number.isNaN(value) || value < MIN_REPLICA_COUNT) {
      suggestions.push({
        id: `default:${keyPath}:missing`,
        env: defaultEnv.env,
        level: "high",
        title: "replicaCount is missing or invalid",
        keyPath,
        recommendation: DEFAULT_REPLICA_RECOMMENDATION,
        rationale: `Define replica counts explicitly to avoid implicit single-replica defaults in workloads. ${BEST_PRACTICE_REF}`,
      });
    }

    const root = keyPath.replace(/\.replicaCount$/i, "");
    for (const env of result.environments) {
      if (!PROD_ENV_RE.test(env.env) || env.env === defaultEnv.env) continue;
      if (!hasPath(env.valuesTree.raw, keyPath)) {
        suggestions.push({
          id: `${env.env}:${keyPath}:prod-override`,
          env: env.env,
          level: "medium",
          title: "Production replicaCount override missing",
          keyPath,
          recommendation: typeof value === "number" && value >= MIN_REPLICA_COUNT ? value : DEFAULT_PROD_REPLICA_RECOMMENDATION,
          rationale: `Production overrides should set replica counts intentionally for predictable scaling behavior. ${BEST_PRACTICE_REF}`,
        });
      }
      const resourcesBase = `${root}.resources`;
      if (!hasPath(env.valuesTree.raw, resourcesBase)) {
        suggestions.push({
          id: `${env.env}:${resourcesBase}:missing`,
          env: env.env,
          level: "high",
          title: "Production resources override missing",
          keyPath: resourcesBase,
          recommendation: {
            requests: { cpu: "250m", memory: "256Mi" },
            limits: { cpu: "1", memory: "1Gi" },
          },
          rationale: `Set CPU/memory requests and limits to avoid noisy-neighbor risk and scheduling instability. ${BEST_PRACTICE_REF}`,
        });
      }
    }
  }

  return dedupeSuggestions(suggestions).slice(0, 8);
}

export function applySuggestionToEnv(env: EnvRenderResult, suggestion: ChartSuggestion): EnvRenderResult {
  if (!suggestion.recommendation || env.env !== suggestion.env) return env;
  const entries = upsertEntry(env.valuesTree.entries, suggestion.keyPath, suggestion.recommendation);
  return {
    ...env,
    valuesTree: {
      ...env.valuesTree,
      entries,
    },
  };
}

function dedupeSuggestions(suggestions: ChartSuggestion[]): ChartSuggestion[] {
  const out: ChartSuggestion[] = [];
  const seen = new Set<string>();
  for (const s of suggestions) {
    const key = `${s.env}:${s.keyPath}:${s.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function upsertEntry(
  entries: EnvRenderResult["valuesTree"]["entries"],
  key: string,
  value: unknown
): EnvRenderResult["valuesTree"]["entries"] {
  const next = [...entries];
  const idx = next.findIndex((e) => e.key === key);
  const type = inferType(value);
  if (idx >= 0) {
    next[idx] = { ...next[idx], value, type };
  } else {
    next.push({ key, value, type, usedInTemplates: [] });
    next.sort((a, b) => a.key.localeCompare(b.key));
  }
  return next;
}

function inferType(value: unknown): "string" | "number" | "boolean" | "object" | "array" | "null" {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    case "object": return "object";
    default: return "string";
  }
}

function hasPath(obj: Record<string, unknown>, path: string): boolean {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const segment of parts) {
    if (!cur || typeof cur !== "object" || !(segment in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return true;
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const segment of parts) {
    if (!cur || typeof cur !== "object" || !(segment in (cur as Record<string, unknown>))) return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}
