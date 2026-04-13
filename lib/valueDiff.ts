import type {
  ValuesTree,
  ValuesDiffEntry,
  ValuesDiffResult,
  ValuesDiffSummary,
} from "@/types/helm";

/**
 * Compute a structured diff between two ValuesTree objects.
 * Returns per-key status (added / removed / changed / unchanged),
 * a summary with counts, and the list of changed keys for graph highlighting.
 */
export function computeValuesDiff(
  base: ValuesTree,
  compare: ValuesTree
): ValuesDiffResult {
  const baseMap = new Map(base.entries.map((e) => [e.key, e]));
  const compareMap = new Map(compare.entries.map((e) => [e.key, e]));

  const allKeys = new Set([...baseMap.keys(), ...compareMap.keys()]);

  const entries: ValuesDiffEntry[] = [];

  for (const key of allKeys) {
    const baseEntry = baseMap.get(key);
    const compareEntry = compareMap.get(key);

    if (!baseEntry) {
      entries.push({
        key,
        status: "added",
        compareValue: compareEntry!.value,
        compareType: compareEntry!.type,
      });
    } else if (!compareEntry) {
      entries.push({
        key,
        status: "removed",
        baseValue: baseEntry.value,
        baseType: baseEntry.type,
      });
    } else if (
      JSON.stringify(baseEntry.value) !== JSON.stringify(compareEntry.value)
    ) {
      entries.push({
        key,
        status: "changed",
        baseValue: baseEntry.value,
        compareValue: compareEntry.value,
        baseType: baseEntry.type,
        compareType: compareEntry.type,
      });
    } else {
      entries.push({
        key,
        status: "unchanged",
        baseValue: baseEntry.value,
        compareValue: compareEntry.value,
        baseType: baseEntry.type,
        compareType: compareEntry.type,
      });
    }
  }

  // Sort: removed → changed → added → unchanged, then alphabetically within each group
  const ORDER: Record<ValuesDiffEntry["status"], number> = {
    removed: 0,
    changed: 1,
    added: 2,
    unchanged: 3,
  };
  entries.sort((a, b) => {
    const diff = ORDER[a.status] - ORDER[b.status];
    return diff !== 0 ? diff : a.key.localeCompare(b.key);
  });

  const added = entries.filter((e) => e.status === "added").length;
  const removed = entries.filter((e) => e.status === "removed").length;
  const changed = entries.filter((e) => e.status === "changed").length;
  // "Breaking" = removed keys + type-changed keys
  const breaking =
    removed +
    entries.filter(
      (e) => e.status === "changed" && e.baseType !== e.compareType
    ).length;

  const summary: ValuesDiffSummary = {
    total: added + removed + changed,
    added,
    removed,
    changed,
    breaking,
  };

  const changedKeys = entries
    .filter((e) => e.status !== "unchanged")
    .map((e) => e.key);

  return { entries, summary, changedKeys };
}

/**
 * Export a diff result as a Markdown table string.
 */
export function exportDiffAsMarkdown(
  diff: ValuesDiffResult,
  baseEnv: string,
  compareEnv: string
): string {
  const lines: string[] = [
    `# Helm Values Diff: \`${baseEnv}\` → \`${compareEnv}\``,
    "",
    `## Summary`,
    "",
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Total changes | ${diff.summary.total} |`,
    `| Added | ${diff.summary.added} |`,
    `| Removed | ${diff.summary.removed} |`,
    `| Changed | ${diff.summary.changed} |`,
    `| Breaking | ${diff.summary.breaking} |`,
    "",
    `## Changed Keys`,
    "",
    `| Status | Key | ${baseEnv} | ${compareEnv} |`,
    `|--------|-----|${"-".repeat(baseEnv.length + 2)}|${"-".repeat(compareEnv.length + 2)}|`,
  ];

  for (const entry of diff.entries.filter((e) => e.status !== "unchanged")) {
    const statusIcon =
      entry.status === "added"
        ? "✅ added"
        : entry.status === "removed"
          ? "❌ removed"
          : "⚠️ changed";
    const baseVal =
      entry.baseValue !== undefined ? formatMd(entry.baseValue) : "—";
    const compareVal =
      entry.compareValue !== undefined ? formatMd(entry.compareValue) : "—";
    lines.push(
      `| ${statusIcon} | \`${entry.key}\` | ${baseVal} | ${compareVal} |`
    );
  }

  return lines.join("\n");
}

function formatMd(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === "object") return "{...}";
  return String(value);
}

/**
 * Export a diff result as a JSON string.
 */
export function exportDiffAsJson(
  diff: ValuesDiffResult,
  baseEnv: string,
  compareEnv: string
): string {
  return JSON.stringify(
    {
      base: baseEnv,
      compare: compareEnv,
      summary: diff.summary,
      changes: diff.entries
        .filter((e) => e.status !== "unchanged")
        .map((e) => ({
          key: e.key,
          status: e.status,
          ...(e.baseValue !== undefined ? { from: e.baseValue } : {}),
          ...(e.compareValue !== undefined ? { to: e.compareValue } : {}),
          ...(e.baseType !== e.compareType
            ? { typeChange: `${e.baseType} → ${e.compareType}` }
            : {}),
        })),
    },
    null,
    2
  );
}
