import yaml from "js-yaml";
import type { K8sResource, ValuesEntry, ValuesTree } from "@/types/helm";

/**
 * Parse a multi-document YAML string (--- separated) into an array of K8sResource objects.
 * Falls back to per-document parsing when a bulk parse fails, silently skipping
 * individual documents that cannot be parsed (e.g. templates with missing values).
 */
/**
 * Quote any unquoted YAML scalar value that ends with ':' (bare colon at EOL).
 * These arise when template variables like image tag or ECR URL are empty and
 * produce strings like `image: /name:` which YAML mis-parses as nested keys.
 */
function quoteTrailingColons(s: string): string {
  // Match: <indent><key>:_<unquoted-value-ending-with-colon>
  // Use [ \t]+ (horizontal whitespace only) after the key colon to avoid
  // crossing newline boundaries and incorrectly matching bare keys like "spec:"
  return s.replace(
    /^([ \t]*[\w.-]+:[ \t]+)([^'"\n{}\[\]][^\n]*):[ \t]*$/gm,
    '$1"$2:"'
  );
}

export function parseMultiDocYaml(yamlStr: string): K8sResource[] {
  // Fast path: try a single pass
  try {
    const resources: K8sResource[] = [];
    yaml.loadAll(yamlStr, (doc) => {
      if (doc && typeof doc === "object") {
        resources.push(doc as K8sResource);
      }
    });
    return resources;
  } catch {
    // Fall back: split on --- and parse each segment independently
  }

  const resources: K8sResource[] = [];
  const segments = yamlStr.split(/\n---(?:\s*\n|$)/);
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    // Try as-is first, then with colon-value quoting applied
    for (const attempt of [trimmed, quoteTrailingColons(trimmed)]) {
      try {
        const doc = yaml.load(attempt);
        if (doc && typeof doc === "object") {
          resources.push(doc as K8sResource);
          break;
        }
        break; // parsed but was not an object (null, scalar) — skip
      } catch {
        // try next attempt
      }
    }
  }
  return resources;
}

/**
 * Parse a values.yaml string into a flat list of ValuesEntry objects (dot-notation keys).
 */
export function extractValuesEntries(
  valuesYaml: string,
  env: string,
  templateFiles: Record<string, string> = {}
): ValuesTree {
  const raw = (yaml.load(valuesYaml) as Record<string, unknown>) ?? {};

  // Build a flat map of dot-notation key → value
  const flat: Array<{ key: string; value: unknown }> = [];
  flattenObject(raw, "", flat);

  const entries: ValuesEntry[] = flat.map(({ key, value }) => ({
    key,
    value,
    type: inferType(value),
    usedInTemplates: findKeyInTemplates(key, templateFiles),
  }));

  return { env, raw, entries };
}

/** Recursively flatten an object into dot-notation keys */
function flattenObject(
  obj: unknown,
  prefix: string,
  acc: Array<{ key: string; value: unknown }>
): void {
  if (obj === null || obj === undefined) {
    acc.push({ key: prefix, value: obj });
    return;
  }

  if (Array.isArray(obj)) {
    acc.push({ key: prefix, value: obj });
    return;
  }

  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const newKey = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        flattenObject(v, newKey, acc);
      } else {
        acc.push({ key: newKey, value: v });
      }
    }
    return;
  }

  acc.push({ key: prefix, value: obj });
}

function inferType(value: unknown): ValuesEntry["type"] {
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

/**
 * Given a dot-notation values key (e.g. "flavour.replicas.min"),
 * look for any usage of that key in Go templates using regex.
 * Returns array of template file names that reference this key.
 */
function findKeyInTemplates(
  key: string,
  templateFiles: Record<string, string>
): string[] {
  // e.g. key = "flavour.replicas.min"
  // template usage: .Values.flavour.replicas.min
  // also shorter partials — we check if the key's last segment appears in the template
  const usages: string[] = [];

  // Build a dotted path pattern: .Values.flavour.replicas.min
  const valuePath = `.Values.${key}`;
  // Also match partial final segment (last two parts) for robustness
  const keyParts = key.split(".");
  const shortPattern = keyParts.length >= 2
    ? `.Values.${keyParts.slice(-2).join(".")}`
    : valuePath;

  for (const [filename, content] of Object.entries(templateFiles)) {
    if (content.includes(valuePath) || content.includes(shortPattern)) {
      usages.push(filename);
    }
  }

  return usages;
}

/**
 * Given a template string, extract all `.Values.xxx.yyy.zzz` references.
 * Returns an array of dot-notation value paths (without the `.Values.` prefix).
 */
export function extractTemplateValueRefs(templateContent: string): string[] {
  const pattern = /\.Values\.([\w.]+)/g;
  const refs = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(templateContent)) !== null) {
    refs.add(match[1]);
  }

  return Array.from(refs);
}

/**
 * Parse a single YAML document string safely, returning null on failure.
 */
export function safeParseYaml(yamlStr: string): Record<string, unknown> | null {
  try {
    const result = yaml.load(yamlStr);
    return typeof result === "object" && result !== null
      ? (result as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
