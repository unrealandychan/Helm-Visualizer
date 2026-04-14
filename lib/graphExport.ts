import type {
  ResourceGraphNode,
  ResourceGraphEdge,
  HelmChartMeta,
} from "@/types/helm";

// ──────────────────────────────────────────────
// JSON export
// ──────────────────────────────────────────────

/**
 * Serialize the current graph state (nodes + edges + metadata) to a JSON string.
 */
export function exportGraphAsJson(
  nodes: ResourceGraphNode[],
  edges: ResourceGraphEdge[],
  chartMeta: HelmChartMeta,
  env: string
): string {
  const payload = {
    chart: {
      name: chartMeta.name,
      version: chartMeta.version,
      appVersion: chartMeta.appVersion,
    },
    env,
    exportedAt: new Date().toISOString(),
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      name: n.data.label,
      namespace: n.data.namespace,
      valuesUsed: n.data.valuesUsed,
    })),
    edges: edges.map((e) => ({
      source: e.source,
      target: e.target,
      relationship: e.label ?? "",
    })),
  };
  return JSON.stringify(payload, null, 2);
}

// ──────────────────────────────────────────────
// Markdown export
// ──────────────────────────────────────────────

/**
 * Build a Markdown document that describes the graph:
 *  – resource list with kinds and values they consume
 *  – relationship table  *  – per-value-key: which resources use it
 */
export function exportGraphAsMarkdown(
  nodes: ResourceGraphNode[],
  edges: ResourceGraphEdge[],
  chartMeta: HelmChartMeta,
  env: string,
  highlightedKeys: string[] = []
): string {
  const lines: string[] = [
    `# Helm Chart Graph: \`${chartMeta.name}\` (${env})`,
    "",
    `**Version:** ${chartMeta.version}  `,
    `**App Version:** ${chartMeta.appVersion}  `,
    `**Environment:** \`${env}\`  `,
    `**Exported:** ${new Date().toUTCString()}`,
    "",
  ];

  // Resources section
  lines.push("## Resources", "");
  lines.push(`| Kind | Name | Namespace | Values Used |`);
  lines.push(`|------|------|-----------|-------------|`);
  for (const n of nodes) {
    const vals =
      n.data.valuesUsed.length > 0
        ? n.data.valuesUsed.map((v) => `\`${v}\``).join(", ")
        : "—";
    const ns = n.data.namespace ?? "—";
    lines.push(
      `| ${n.data.kind} | \`${n.data.label}\` | ${ns} | ${vals} |`
    );
  }
  lines.push("");

  // Relationships section
  if (edges.length > 0) {
    lines.push("## Relationships", "");
    lines.push("| Source | Relationship | Target |");
    lines.push("|--------|--------------|--------|");
    for (const e of edges) {
      lines.push(`| \`${e.source}\` | ${e.label ?? "→"} | \`${e.target}\` |`);
    }
    lines.push("");
  }

  // Value paths section — for each unique value key, list consuming resources
  const valueMap = new Map<string, string[]>();
  for (const n of nodes) {
    for (const key of n.data.valuesUsed) {
      const arr = valueMap.get(key) ?? [];
      arr.push(n.data.label);
      valueMap.set(key, arr);
    }
  }

  if (valueMap.size > 0) {
    lines.push("## Value Paths", "");

    // If highlighted keys are provided, list those first
    const sortedKeys = [...valueMap.keys()].sort((a, b) => {
      const aHL = highlightedKeys.includes(a) ? 0 : 1;
      const bHL = highlightedKeys.includes(b) ? 0 : 1;
      return aHL - bHL || a.localeCompare(b);
    });

    for (const key of sortedKeys) {
      const consumers = valueMap.get(key)!;
      const highlight = highlightedKeys.includes(key) ? " ⭐" : "";
      lines.push(
        `- Value \`${key}\`${highlight} flows into: ${consumers.map((c) => `**${c}**`).join(", ")}`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ──────────────────────────────────────────────
// Download helper (browser only)
// ──────────────────────────────────────────────

export function triggerDownload(
  content: string,
  filename: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
