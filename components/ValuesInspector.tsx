"use client";

import { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, Search } from "lucide-react";
import clsx from "clsx";
import type { ValuesTree, ValuesEntry } from "@/types/helm";

interface ValuesInspectorProps {
  valuesTree: ValuesTree | null;
  onHighlightKey?: (keys: string[]) => void;
}

const TYPE_BADGES: Record<string, string> = {
  string:  "bg-green-800 text-green-200",
  number:  "bg-blue-800 text-blue-200",
  boolean: "bg-purple-800 text-purple-200",
  array:   "bg-orange-800 text-orange-200",
  object:  "bg-teal-800 text-teal-200",
  null:    "bg-zinc-700 text-zinc-300",
};

export function ValuesInspector({ valuesTree, onHighlightKey }: ValuesInspectorProps) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const topLevelKeys = useMemo(() => {
    if (!valuesTree) return [];
    const keys = new Set<string>();
    for (const e of valuesTree.entries) {
      keys.add(e.key.split(".")[0]);
    }
    return Array.from(keys).sort();
  }, [valuesTree]);

  const filteredEntries = useMemo(() => {
    if (!valuesTree) return [];
    const q = search.toLowerCase();
    if (!q) return valuesTree.entries;
    return valuesTree.entries.filter(
      (e) =>
        e.key.toLowerCase().includes(q) ||
        String(e.value).toLowerCase().includes(q)
    );
  }, [valuesTree, search]);

  if (!valuesTree) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        No values loaded
      </div>
    );
  }

  function toggleGroup(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function handleSelectKey(key: string) {
    const next = selectedKey === key ? null : key;
    setSelectedKey(next);
    onHighlightKey?.(next ? [next] : []);
  }

  // Group entries by first segment when searching is off
  const displayMode = search.trim().length > 0 ? "flat" : "grouped";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700 shrink-0">
        <Search className="text-zinc-500 w-3.5 h-3.5 shrink-0" />
        <input
          type="text"
          placeholder="Search values..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent text-sm text-white placeholder-zinc-500 outline-none"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="text-zinc-500 hover:text-white text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-y-auto text-xs font-mono">
        {displayMode === "flat" ? (
          <FlatList
            entries={filteredEntries}
            selectedKey={selectedKey}
            onSelect={handleSelectKey}
          />
        ) : (
          topLevelKeys.map((group) => {
            const children = valuesTree.entries.filter((e) =>
              e.key === group || e.key.startsWith(`${group}.`)
            );
            const isOpen = expanded.has(group);
            return (
              <GroupRow
                key={group}
                group={group}
                children={children}
                isOpen={isOpen}
                selectedKey={selectedKey}
                onToggle={toggleGroup}
                onSelect={handleSelectKey}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

interface GroupRowProps {
  group: string;
  children: ValuesEntry[];
  isOpen: boolean;
  selectedKey: string | null;
  onToggle: (key: string) => void;
  onSelect: (key: string) => void;
}

function GroupRow({ group, children, isOpen, selectedKey, onToggle, onSelect }: GroupRowProps) {
  return (
    <div>
      <button
        className="w-full flex items-center gap-1.5 px-3 py-1.5 hover:bg-zinc-800 text-zinc-300 text-left"
        onClick={() => onToggle(group)}
      >
        {isOpen ? (
          <ChevronDown className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0" />
        )}
        <span className="font-bold text-zinc-100">{group}</span>
        <span className="ml-auto text-zinc-600">{children.length}</span>
      </button>

      {isOpen && (
        <div>
          <FlatList
            entries={children}
            indent
            selectedKey={selectedKey}
            onSelect={onSelect}
          />
        </div>
      )}
    </div>
  );
}

interface FlatListProps {
  entries: ValuesEntry[];
  indent?: boolean;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

function FlatList({ entries, indent = false, selectedKey, onSelect }: FlatListProps) {
  return (
    <>
      {entries.map((entry) => (
        <EntryRow
          key={entry.key}
          entry={entry}
          indent={indent}
          selected={selectedKey === entry.key}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

interface EntryRowProps {
  entry: ValuesEntry;
  indent?: boolean;
  selected: boolean;
  onSelect: (key: string) => void;
}

function EntryRow({ entry, indent = false, selected, onSelect }: EntryRowProps) {
  const displayKey = indent
    ? entry.key.split(".").slice(1).join(".")
    : entry.key;

  const displayValue = formatValue(entry.value);

  return (
    <button
      className={clsx(
        "w-full flex items-start gap-2 py-1 text-left hover:bg-zinc-800 transition-colors",
        indent ? "pl-7 pr-3" : "px-3",
        selected && "bg-zinc-700"
      )}
      onClick={() => onSelect(entry.key)}
    >
      <div className="flex-1 min-w-0">
        <span className="text-zinc-400 truncate block">{displayKey}</span>
        <span className="text-zinc-200 truncate block max-w-[200px]" title={String(entry.value)}>
          {displayValue}
        </span>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className={clsx("rounded px-1 text-[9px]", TYPE_BADGES[entry.type] ?? TYPE_BADGES.null)}>
          {entry.type}
        </span>
        {entry.usedInTemplates.length > 0 && (
          <span className="text-[9px] bg-amber-900 text-amber-300 rounded px-1">
            {entry.usedInTemplates.length}t
          </span>
        )}
      </div>
    </button>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") return "{...}";
  return String(value);
}
