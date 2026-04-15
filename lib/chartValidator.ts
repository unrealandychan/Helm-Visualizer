import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import yaml from "js-yaml";
import type { ValidationIssue, ValidationResult } from "@/types/helm";

/** Minimal shape we care about from Chart.yaml */
interface ChartYamlShape {
  name?: unknown;
  version?: unknown;
  apiVersion?: unknown;
  dependencies?: Array<{ name?: string; version?: string; repository?: string }>;
}

/**
 * Matches a YAML mapping key line: optional leading whitespace followed by
 * a key (no colons, brackets, braces, block indicators, quotes, anchors, or
 * leading whitespace), then a colon delimiter (with optional trailing
 * whitespace or end-of-line for bare "parent:" keys).
 * Groups: (1) leading indent, (2) key text.
 */
const YAML_KEY_RE = /^(\s*)([^:#\[\]{},|>'"&*\s][^:#\[\]{},]*?):(?:\s|$)/;

/**
 * Scan raw YAML text for duplicate mapping keys within the same scope.
 *
 * Uses an indentation stack so that identical key names in *different* nested
 * scopes (e.g. `resources.limits.cpu` vs `resources.requests.cpu`) are NOT
 * flagged as duplicates. List-item markers ("- ") reset the child scope so
 * that identical keys across separate list entries are also not flagged.
 *
 * Returns every duplicate occurrence with a 1-based line number.
 */
export function findDuplicateKeys(content: string): Array<{ key: string; line: number }> {
  const duplicates: Array<{ key: string; line: number }> = [];

  /**
   * Stack of mapping scopes. Each frame holds the indent depth of the
   * mapping's keys and the keys already seen in that scope.
   */
  const stack: Array<{ indent: number; seen: Map<string, number> }> = [
    { indent: -1, seen: new Map() }, // synthetic root frame
  ];

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimStart();

    // Skip blank lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = raw.length - trimmed.length;

    // A list-item marker ("- ") starts a fresh mapping scope for its children.
    // Pop any child frames from previous list entries so their keys don't
    // pollute the next entry's scope.
    if (trimmed.startsWith("- ") || trimmed === "-") {
      while (stack.length > 1 && stack[stack.length - 1].indent > indent) {
        stack.pop();
      }
      continue;
    }

    const match = raw.match(YAML_KEY_RE);
    if (!match) continue;

    const key = match[2].trim();

    // Return to the appropriate parent scope when indentation decreases.
    while (stack.length > 1 && stack[stack.length - 1].indent > indent) {
      stack.pop();
    }

    if (stack[stack.length - 1].indent === indent) {
      // Same mapping scope as the top frame — check and record the key.
      const frame = stack[stack.length - 1];
      if (frame.seen.has(key)) {
        duplicates.push({ key, line: i + 1 });
      } else {
        frame.seen.set(key, i + 1);
      }
    } else {
      // Deeper than the current top — push a new child scope for this level.
      stack.push({ indent, seen: new Map([[key, i + 1]]) });
    }
  }

  return duplicates;
}

/**
 * Validate the structure of an extracted Helm chart directory.
 *
 * Checks performed:
 *  1. Chart.yaml exists and is valid YAML
 *  2. templates/ directory exists
 *  3. Declared dependencies are present in charts/
 *  4. Each values*.yaml file is valid YAML with no duplicate keys
 */
export async function validateChart(chartDir: string): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  // ── 1. Chart.yaml ──────────────────────────────────────────────────────────
  const chartYamlPath = path.join(chartDir, "Chart.yaml");
  if (!existsSync(chartYamlPath)) {
    issues.push({
      level: "error",
      message:
        "Chart.yaml not found. This archive does not appear to be a valid Helm chart.",
    });
    return { valid: false, issues };
  }

  let chartMeta: ChartYamlShape = {};
  try {
    const chartYamlStr = await readFile(chartYamlPath, "utf-8");
    const parsed = yaml.load(chartYamlStr);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      issues.push({
        level: "error",
        message: "Chart.yaml is empty or not a valid YAML mapping.",
        file: "Chart.yaml",
      });
      return { valid: false, issues };
    }
    chartMeta = parsed as ChartYamlShape;
  } catch (err) {
    const yamlErr = err as { mark?: { line?: number }; reason?: string; message?: string };
    const line =
      yamlErr.mark?.line != null ? yamlErr.mark.line + 1 : undefined;
    const detail = yamlErr.reason ?? yamlErr.message ?? String(err);
    issues.push({
      level: "error",
      message: `Chart.yaml is not valid YAML${line != null ? `: fix line ${line}` : ""}: ${detail}`,
      file: "Chart.yaml",
      line,
    });
    return { valid: false, issues };
  }

  // ── 2. templates/ directory ────────────────────────────────────────────────
  const templatesDir = path.join(chartDir, "templates");
  if (!existsSync(templatesDir)) {
    issues.push({
      level: "warning",
      message:
        "templates/ folder is missing. This chart will render no Kubernetes resources.",
    });
  }

  // ── 3. Missing dependencies ────────────────────────────────────────────────
  const deps = chartMeta.dependencies;
  if (Array.isArray(deps) && deps.length > 0) {
    const chartsDir = path.join(chartDir, "charts");
    let chartsDirEntries: string[] = [];
    if (existsSync(chartsDir)) {
      chartsDirEntries = await readdir(chartsDir);
    }

    for (const dep of deps) {
      const depName = dep?.name;
      if (!depName) continue;
      const found = chartsDirEntries.some(
        (entry) => entry === depName || entry.startsWith(`${depName}-`)
      );
      if (!found) {
        issues.push({
          level: "warning",
          message: `Dependency "${depName}" is declared in Chart.yaml but not found in charts/. Run 'helm dependency update'.`,
          file: "Chart.yaml",
        });
      }
    }
  }

  // ── 4. Validate values files ───────────────────────────────────────────────
  let allFiles: string[] = [];
  try {
    allFiles = await readdir(chartDir);
  } catch {
    // If we can't read the dir, skip values checks
  }

  const valuesFiles = allFiles.filter(
    (f) => f.startsWith("values") && f.endsWith(".yaml")
  );

  for (const vf of valuesFiles) {
    const vfPath = path.join(chartDir, vf);
    let content: string;
    try {
      content = await readFile(vfPath, "utf-8");
    } catch {
      continue;
    }

    // Check for valid YAML
    try {
      yaml.load(content);
    } catch (err) {
      const yamlErr = err as { mark?: { line?: number }; reason?: string; message?: string };
      const line =
        yamlErr.mark?.line != null ? yamlErr.mark.line + 1 : undefined;
      const detail = yamlErr.reason ?? yamlErr.message ?? String(err);
      issues.push({
        level: "error",
        message: `${vf} is not valid YAML${line != null ? `: fix line ${line}` : ""}: ${detail}`,
        file: vf,
        line,
      });
      continue; // skip duplicate-key check for unparseable files
    }

    // Check for duplicate keys
    const dups = findDuplicateKeys(content);
    for (const { key, line } of dups) {
      issues.push({
        level: "warning",
        message: `Duplicate key "${key}" in ${vf} — fix line ${line}.`,
        file: vf,
        line,
      });
    }
  }

  const valid = !issues.some((i) => i.level === "error");
  return { valid, issues };
}
