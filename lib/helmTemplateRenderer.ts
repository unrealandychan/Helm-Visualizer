/**
 * Pure-JS Helm template renderer.
 * Handles enough Go template syntax to render real-world Helm charts
 * without requiring the `helm` CLI binary.
 *
 * Supported:
 *   - {{ .Values.x.y }}, {{ .Release.Name }}, {{ .Chart.Name }}
 *   - {{- trimming
 *   - {{ if / else if / else / end }}
 *   - {{ range $k, $v := .Values.x }} / {{ range .Values.list }}
 *   - {{ with .Values.x }}
 *   - {{ define "name" }} / {{ include "name" . }} / {{ template "name" . }}
 *   - {{ $var := expr }}  variable assignment
 *   - Pipe chains: expr | quote | default "x" | toYaml | nindent 4 …
 *   - Common sprig/helm builtins
 */

import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import yaml from "js-yaml";

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export interface HelmRenderContext {
  Values: Record<string, unknown>;
  Release: {
    Name: string;
    Namespace: string;
    Service: string;
    IsInstall: boolean;
    IsUpgrade: boolean;
  };
  Chart: {
    Name: string;
    Version: string;
    AppVersion: string;
    Description: string;
  };
}

/**
 * Render all templates in chartDir, merging the provided values files.
 * Returns a multi-document YAML string (same format as `helm template` output).
 */
export async function renderHelmChartJS(
  chartDir: string,
  releaseName: string,
  valuesFiles: string[]
): Promise<string> {
  // 1. Load Chart.yaml
  const chartYaml = yaml.load(
    await readFile(path.join(chartDir, "Chart.yaml"), "utf-8")
  ) as Record<string, unknown>;

  // 2. Load + deep-merge values: chart defaults first, then each -f file in order
  let mergedValues: Record<string, unknown> = {};
  const defaultValuesPath = path.join(chartDir, "values.yaml");
  if (existsSync(defaultValuesPath)) {
    mergedValues = deepMerge(
      mergedValues,
      (yaml.load(await readFile(defaultValuesPath, "utf-8")) as Record<string, unknown>) ?? {}
    );
  }
  for (const vf of valuesFiles) {
    if (existsSync(vf)) {
      const extra = yaml.load(await readFile(vf, "utf-8")) as Record<string, unknown>;
      if (extra) mergedValues = deepMerge(mergedValues, extra);
    }
  }

  // 3. Build render context
  const ctx: HelmRenderContext = {
    Values: mergedValues,
    Release: {
      Name: releaseName,
      Namespace: "default",
      Service: "Helm",
      IsInstall: true,
      IsUpgrade: false,
    },
    Chart: {
      Name: String(chartYaml.name ?? ""),
      Version: String(chartYaml.version ?? ""),
      AppVersion: String(chartYaml.appVersion ?? ""),
      Description: String(chartYaml.description ?? ""),
    },
  };

  // 4. Load all templates, collect {{ define }} blocks first
  const templatesDir = path.join(chartDir, "templates");
  if (!existsSync(templatesDir)) return "";

  // Recursively collect all template files under a directory
  async function collectTemplateFiles(
    dir: string,
    relBase: string
  ): Promise<Array<{ name: string; relPath: string; src: string }>> {
    const result: Array<{ name: string; relPath: string; src: string }> = [];
    if (!existsSync(dir)) return result;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        result.push(...await collectTemplateFiles(fullPath, relPath));
      } else if (
        entry.name.endsWith(".yaml") ||
        entry.name.endsWith(".tpl") ||
        entry.name.endsWith(".yml")
      ) {
        const src = await readFile(fullPath, "utf-8");
        result.push({ name: entry.name, relPath, src });
      }
    }
    return result;
  }

  // Load templates from main chart + all subcharts (charts/ directory)
  const namedTemplates = new Map<string, ASTNode[]>();
  const templateSources: Array<{ name: string; relPath: string; src: string }> = [];

  // Main chart templates
  templateSources.push(...await collectTemplateFiles(templatesDir, ""));

  // Subchart templates (charts/*/templates/**) — needed for library charts like bitnami/common
  const chartsDir = path.join(chartDir, "charts");
  if (existsSync(chartsDir)) {
    const subcharts = await readdir(chartsDir, { withFileTypes: true });
    for (const sc of subcharts.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!sc.isDirectory()) continue;
      const scTemplatesDir = path.join(chartsDir, sc.name, "templates");
      const scFiles = await collectTemplateFiles(scTemplatesDir, "");
      for (const f of scFiles) {
        templateSources.push({ ...f, relPath: `charts/${sc.name}/templates/${f.relPath}` });
      }
    }
  }

  // First pass: extract {{ define }} blocks from ALL files (including subcharts)
  for (const { src } of templateSources) {
    try {
      const tokens = tokenize(src);
      const ast = parse(tokens);
      collectDefines(ast, namedTemplates);
    } catch {
      // ignore parse failures in define collection
    }
  }

  // Second pass: render main-chart .yaml files only (skip subcharts and .tpl helpers)
  const parts: string[] = [];
  for (const { name, relPath, src } of templateSources) {
    // Only render top-level chart templates (not from subcharts/charts/)
    if (relPath.startsWith("charts/")) continue;
    if (name.endsWith(".tpl")) continue; // helpers-only files
    if (name === "NOTES.txt") continue;  // informational only
    try {
      const tokens = tokenize(src);
      const ast = parse(tokens);
      // Seed $ with root context so $.Values.x works inside range/with
      const initialScope: EvalScope = new Map([["$", ctx]]);
      const rendered = evaluate(ast, ctx, namedTemplates, initialScope).trim();
      if (rendered) {
        // A single template file can produce multiple K8s resources.
        // Split them into separate --- documents.
        const docs = splitRenderedDocs(rendered, name);
        parts.push(...docs);
      }
    } catch {
      // Skip files that fail to render (e.g. unsupported syntax)
    }
  }

  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Tokenizer
// ─────────────────────────────────────────────────────────────

interface Token {
  type: "text" | "action";
  content: string;
  trimLeft: boolean;
  trimRight: boolean;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const re = /\{\{(-?)([\s\S]*?)(-?)\}\}/g;
  let last = 0;

  for (const m of src.matchAll(re)) {
    const start = m.index!;
    if (start > last) {
      tokens.push({ type: "text", content: src.slice(last, start), trimLeft: false, trimRight: false });
    }
    const trimLeft = m[1] === "-";
    const trimRight = m[3] === "-";
    const inner = m[2].trim();
    tokens.push({ type: "action", content: inner, trimLeft, trimRight });
    last = start + m[0].length;
  }

  if (last < src.length) {
    tokens.push({ type: "text", content: src.slice(last), trimLeft: false, trimRight: false });
  }

  // Apply whitespace trimming caused by {{- and -}}
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== "action") continue;
    if (tok.trimLeft && i > 0 && tokens[i - 1].type === "text") {
      tokens[i - 1].content = tokens[i - 1].content.replace(/[ \t]*\n?[ \t]*$/, "");
    }
    if (tok.trimRight && i < tokens.length - 1 && tokens[i + 1].type === "text") {
      tokens[i + 1].content = tokens[i + 1].content.replace(/^[ \t]*\n?/, "");
    }
  }

  return tokens;
}

// ─────────────────────────────────────────────────────────────
// AST types
// ─────────────────────────────────────────────────────────────

type ASTNode =
  | { k: "text"; v: string }
  | { k: "expr"; v: string }
  | { k: "comment" }
  | { k: "assign"; name: string; expr: string }
  | { k: "include"; tname: string; ctxExpr: string }
  | {
      k: "if";
      cond: string;
      then: ASTNode[];
      elseIfs: Array<{ cond: string; body: ASTNode[] }>;
      otherwise: ASTNode[];
    }
  | { k: "range"; keyVar?: string; valVar?: string; target: string; body: ASTNode[]; otherwise: ASTNode[] }
  | { k: "with"; target: string; body: ASTNode[]; otherwise: ASTNode[] }
  | { k: "define"; name: string; body: ASTNode[] };

// ─────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────

interface ParseState {
  tokens: Token[];
  pos: number;
}

function parse(tokens: Token[]): ASTNode[] {
  const state: ParseState = { tokens, pos: 0 };
  return parseBlock(state);
}

function parseBlock(state: ParseState): ASTNode[] {
  const nodes: ASTNode[] = [];

  while (state.pos < state.tokens.length) {
    const tok = state.tokens[state.pos];

    if (tok.type === "text") {
      if (tok.content) nodes.push({ k: "text", v: tok.content });
      state.pos++;
      continue;
    }

    // Action token
    const content = tok.content;

    // Break conditions - end/else/else if - return to caller
    if (content === "end" || content === "else" || content.startsWith("else ")) {
      break;
    }

    state.pos++;

    // Comment
    if (content.startsWith("/*") || content.startsWith("-/*")) {
      nodes.push({ k: "comment" });
      continue;
    }

    // Variable assignment: $var := expr   or  $var = expr
    const assignMatch = content.match(/^(\$\w+)\s*:?=\s*([\s\S]+)$/);
    if (assignMatch) {
      nodes.push({ k: "assign", name: assignMatch[1], expr: assignMatch[2].trim() });
      continue;
    }

    // include "name" ctx  — only create a special include node when there are NO pipes.
    // When pipes are present (e.g. include "x" . | nindent 4), fall through to expr so
    // evalExpr handles the pipe chain correctly (include is also handled in applyFunc).
    const includeMatch = content.match(/^include\s+"([^"]+)"\s+([\s\S]+)$/);
    if (includeMatch) {
      const ctxExpr = includeMatch[2].trim();
      if (hasPipe(ctxExpr)) {
        nodes.push({ k: "expr", v: content });
      } else {
        nodes.push({ k: "include", tname: includeMatch[1], ctxExpr });
      }
      continue;
    }
    // template "name" ctx
    const tmplMatch = content.match(/^template\s+"([^"]+)"\s+([\s\S]+)$/);
    if (tmplMatch) {
      const ctxExpr = tmplMatch[2].trim();
      if (hasPipe(ctxExpr)) {
        nodes.push({ k: "expr", v: content });
      } else {
        nodes.push({ k: "include", tname: tmplMatch[1], ctxExpr });
      }
      continue;
    }

    // if
    if (content.startsWith("if ")) {
      const cond = content.slice(3).trim();
      const thenBody = parseBlock(state);
      const elseIfs: Array<{ cond: string; body: ASTNode[] }> = [];
      let otherwise: ASTNode[] = [];

      // Consume else / else if chains
      while (
        state.pos < state.tokens.length &&
        (state.tokens[state.pos].content === "else" ||
          state.tokens[state.pos].content.startsWith("else if "))
      ) {
        const elseTok = state.tokens[state.pos];
        state.pos++;
        if (elseTok.content.startsWith("else if ")) {
          const elseIfCond = elseTok.content.slice(8).trim();
          const elseIfBody = parseBlock(state);
          elseIfs.push({ cond: elseIfCond, body: elseIfBody });
        } else {
          otherwise = parseBlock(state);
        }
      }

      // Consume end
      if (state.pos < state.tokens.length && state.tokens[state.pos].content === "end") {
        state.pos++;
      }

      nodes.push({ k: "if", cond, then: thenBody, elseIfs, otherwise });
      continue;
    }

    // range
    if (content.startsWith("range ")) {
      const rangeExpr = content.slice(6).trim();
      // Patterns: "$k, $v := expr"  |  "$v := expr"  |  "expr"
      let keyVar: string | undefined;
      let valVar: string | undefined;
      let target: string;

      const kvMatch = rangeExpr.match(/^(\$\w+)\s*,\s*(\$\w+)\s*:=\s*([\s\S]+)$/);
      const vMatch = rangeExpr.match(/^(\$\w+)\s*:=\s*([\s\S]+)$/);

      if (kvMatch) {
        keyVar = kvMatch[1];
        valVar = kvMatch[2];
        target = kvMatch[3].trim();
      } else if (vMatch) {
        valVar = vMatch[1];
        target = vMatch[2].trim();
      } else {
        target = rangeExpr;
      }

      const body = parseBlock(state);
      let otherwise: ASTNode[] = [];
      if (
        state.pos < state.tokens.length &&
        state.tokens[state.pos].content === "else"
      ) {
        state.pos++;
        otherwise = parseBlock(state);
      }
      if (state.pos < state.tokens.length && state.tokens[state.pos].content === "end") {
        state.pos++;
      }

      nodes.push({ k: "range", keyVar, valVar, target, body, otherwise });
      continue;
    }

    // with
    if (content.startsWith("with ")) {
      const target = content.slice(5).trim();
      const body = parseBlock(state);
      let otherwise: ASTNode[] = [];
      if (
        state.pos < state.tokens.length &&
        state.tokens[state.pos].content === "else"
      ) {
        state.pos++;
        otherwise = parseBlock(state);
      }
      if (state.pos < state.tokens.length && state.tokens[state.pos].content === "end") {
        state.pos++;
      }
      nodes.push({ k: "with", target, body, otherwise });
      continue;
    }

    // define
    if (content.startsWith("define ")) {
      const nameMatch = content.match(/^define\s+"([^"]+)"/);
      const name = nameMatch ? nameMatch[1] : "";
      const body = parseBlock(state);
      if (state.pos < state.tokens.length && state.tokens[state.pos].content === "end") {
        state.pos++;
      }
      nodes.push({ k: "define", name, body });
      continue;
    }

    // block (like define + template)
    if (content.startsWith("block ")) {
      const blockMatch = content.match(/^block\s+"([^"]+)"\s+([\s\S]+)$/);
      const body = parseBlock(state);
      if (state.pos < state.tokens.length && state.tokens[state.pos].content === "end") {
        state.pos++;
      }
      if (blockMatch) {
        nodes.push({ k: "define", name: blockMatch[1], body });
      }
      continue;
    }

    // Otherwise: expression
    nodes.push({ k: "expr", v: content });
  }

  return nodes;
}

// ─────────────────────────────────────────────────────────────
// Collect named templates from AST
// ─────────────────────────────────────────────────────────────

function collectDefines(nodes: ASTNode[], map: Map<string, ASTNode[]>) {
  for (const node of nodes) {
    if (node.k === "define") {
      map.set(node.name, node.body);
    }
    // Recurse into blocks
    if (node.k === "if") {
      collectDefines(node.then, map);
      collectDefines(node.otherwise, map);
      for (const ei of node.elseIfs) collectDefines(ei.body, map);
    }
    if (node.k === "range" || node.k === "with") {
      collectDefines(node.body, map);
      collectDefines(node.otherwise, map);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Evaluator
// ─────────────────────────────────────────────────────────────

type EvalScope = Map<string, unknown>;

function evaluate(
  nodes: ASTNode[],
  ctx: unknown,
  namedTemplates: Map<string, ASTNode[]>,
  scope: EvalScope
): string {
  let out = "";

  for (const node of nodes) {
    switch (node.k) {
      case "text":
        out += node.v;
        break;

      case "comment":
        break;

      case "assign": {
        const val = evalExpr(node.expr, ctx, namedTemplates, scope);
        const newScope = new Map(scope);
        newScope.set(node.name, val);
        // Mutate scope so subsequent nodes in the same block see this
        scope.set(node.name, val);
        break;
      }

      case "expr": {
        const val = evalExpr(node.v, ctx, namedTemplates, scope);
        out += renderValue(val);
        break;
      }

      case "include": {
        const tBody = namedTemplates.get(node.tname);
        if (tBody) {
          const includeCtx = node.ctxExpr === "." ? ctx : evalExpr(node.ctxExpr, ctx, namedTemplates, scope);
          out += evaluate(tBody, includeCtx, namedTemplates, new Map(scope));
        }
        break;
      }

      case "if": {
        const condVal = evalExpr(node.cond, ctx, namedTemplates, scope);
        if (isTruthy(condVal)) {
          out += evaluate(node.then, ctx, namedTemplates, new Map(scope));
        } else {
          let handled = false;
          for (const ei of node.elseIfs) {
            if (isTruthy(evalExpr(ei.cond, ctx, namedTemplates, scope))) {
              out += evaluate(ei.body, ctx, namedTemplates, new Map(scope));
              handled = true;
              break;
            }
          }
          if (!handled) {
            out += evaluate(node.otherwise, ctx, namedTemplates, new Map(scope));
          }
        }
        break;
      }

      case "range": {
        const collection = evalExpr(node.target, ctx, namedTemplates, scope);
        const items = toIterable(collection);

        if (items.length === 0) {
          out += evaluate(node.otherwise, ctx, namedTemplates, new Map(scope));
          break;
        }

        for (const [key, val] of items) {
          const iterScope = new Map(scope);
          // Update $ to current root ctx
          if (node.keyVar) iterScope.set(node.keyVar, key);
          if (node.valVar) iterScope.set(node.valVar, val);
          // Set "." context
          const dotCtx = node.valVar ? val : (node.keyVar ? val : val);
          out += evaluate(node.body, dotCtx, namedTemplates, iterScope);
        }
        break;
      }

      case "with": {
        const withVal = evalExpr(node.target, ctx, namedTemplates, scope);
        if (isTruthy(withVal)) {
          out += evaluate(node.body, withVal, namedTemplates, new Map(scope));
        } else {
          out += evaluate(node.otherwise, ctx, namedTemplates, new Map(scope));
        }
        break;
      }

      case "define":
        // Defines are collected separately, skip during evaluation
        break;
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────
// Expression evaluator
// ─────────────────────────────────────────────────────────────

function evalExpr(
  expr: string,
  ctx: unknown,
  namedTemplates: Map<string, ASTNode[]>,
  scope: EvalScope
): unknown {
  expr = expr.trim();
  if (!expr) return "";

  // Handle pipe chain: split on | but not inside strings or parens
  const pipes = splitPipes(expr);
  if (pipes.length > 1) {
    let value = evalSingle(pipes[0].trim(), ctx, namedTemplates, scope);
    for (let i = 1; i < pipes.length; i++) {
      value = applyFunc(pipes[i].trim(), value, ctx, namedTemplates, scope);
    }
    return value;
  }

  return evalSingle(expr, ctx, namedTemplates, scope);
}

/**
 * Split an expression on pipe (|) characters, respecting strings and parens.
 */
/** Returns true if expr contains a pipe `|` outside of quotes/parens. */
function hasPipe(expr: string): boolean {
  let depth = 0;
  let inStr = false;
  let strChar = "";
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inStr) {
      if (ch === strChar && expr[i - 1] !== "\\") inStr = false;
    } else if (ch === '"' || ch === "'") {
      inStr = true; strChar = ch;
    } else if (ch === "(" || ch === "[") { depth++; }
    else if (ch === ")" || ch === "]") { depth--; }
    else if (ch === "|" && depth === 0) return true;
  }
  return false;
}

function splitPipes(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr = false;
  let strChar = "";
  let start = 0;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inStr) {
      if (ch === strChar && expr[i - 1] !== "\\") inStr = false;
    } else if (ch === '"' || ch === "'") {
      inStr = true;
      strChar = ch;
    } else if (ch === "(" || ch === "[") {
      depth++;
    } else if (ch === ")" || ch === "]") {
      depth--;
    } else if (ch === "|" && depth === 0) {
      parts.push(expr.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(expr.slice(start));
  return parts;
}

function evalSingle(
  expr: string,
  ctx: unknown,
  namedTemplates: Map<string, ASTNode[]>,
  scope: EvalScope
): unknown {
  expr = expr.trim();

  // Empty
  if (!expr) return "";

  // String literal
  if ((expr.startsWith('"') && expr.endsWith('"')) ||
      (expr.startsWith("'") && expr.endsWith("'"))) {
    return expr.slice(1, -1).replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
  }

  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);

  // Boolean / nil
  if (expr === "true") return true;
  if (expr === "false") return false;
  if (expr === "nil" || expr === "null") return null;

  // Variable reference ($, $.path, $var, $var.path)
  if (expr.startsWith("$")) {
    if (expr === "$") return scope.get("$") ?? ctx;
    // $.Values.x.y — navigate from root context
    if (expr.startsWith("$.")) {
      const root = scope.get("$") ?? ctx;
      return resolveDotPath(expr.slice(1), root);
    }
    // $varName.path — navigate from named variable
    const dotIdx = expr.indexOf(".");
    if (dotIdx !== -1) {
      const varName = expr.slice(0, dotIdx);
      const rest = expr.slice(dotIdx);
      const varVal = scope.get(varName);
      if (varVal == null) return "";
      return resolveDotPath(rest, varVal);
    }
    return scope.get(expr) ?? "";
  }

  // Dot (current context)
  if (expr === ".") return ctx;

  // Dot-path: .Values.x.y or .Release.Name etc.
  if (expr.startsWith(".")) {
    return resolveDotPath(expr, ctx);
  }

  // Parenthesised expression
  if (expr.startsWith("(") && expr.endsWith(")")) {
    return evalSingle(expr.slice(1, -1).trim(), ctx, namedTemplates, scope);
  }

  // Function call: funcName arg1 arg2 ...
  return applyFunc(expr, undefined, ctx, namedTemplates, scope);
}

function resolveDotPath(path: string, ctx: unknown): unknown {
  if (path === ".") return ctx;
  const parts = path.replace(/^\./, "").split(".");
  let cur: unknown = ctx;
  for (const part of parts) {
    if (!part) continue;
    if (cur === null || cur === undefined) return "";
    if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return "";
    }
  }
  return cur ?? "";
}

// ─────────────────────────────────────────────────────────────
// Built-in functions
// ─────────────────────────────────────────────────────────────

function applyFunc(
  callExpr: string,
  piped: unknown,
  ctx: unknown,
  namedTemplates: Map<string, ASTNode[]>,
  scope: EvalScope
): unknown {
  callExpr = callExpr.trim();

  // Parse: funcName [arg1] [arg2] ...
  const parts = parseCallArgs(callExpr);
  const fnName = parts[0];
  const rawArgs = parts.slice(1);

  // Evaluate each raw arg
  const args: unknown[] = rawArgs.map((a) => evalSingle(a, ctx, namedTemplates, scope));

  // If piped value exists, it becomes the LAST arg (Go template convention)
  if (piped !== undefined) args.push(piped);

  switch (fnName) {
    // ── Output formatters ─────────────────────────────────────
    case "quote":
      return `"${String(args[0] ?? "").replace(/"/g, '\\"')}"`;
    case "squote":
      return `'${String(args[0] ?? "").replace(/'/g, "\\'")}'`;
    case "upper":
      return String(args[0] ?? "").toUpperCase();
    case "lower":
      return String(args[0] ?? "").toLowerCase();
    case "title":
      return String(args[0] ?? "").replace(/\b\w/g, (c) => c.toUpperCase());
    case "trim":
      return String(args[0] ?? "").trim();
    case "trimAll": {
      const chars = String(args[0] ?? "");
      const s = String(args[1] ?? "");
      return s.replace(new RegExp(`^[${chars}]+|[${chars}]+$`, "g"), "");
    }
    case "trimPrefix":
      return String(args[1] ?? "").replace(new RegExp(`^${escapeRe(String(args[0] ?? ""))}`), "");
    case "trimSuffix":
      return String(args[1] ?? "").replace(new RegExp(`${escapeRe(String(args[0] ?? ""))}$`), "");
    case "replace":
      return String(args[2] ?? "").split(String(args[0] ?? "")).join(String(args[1] ?? ""));
    case "trunc": {
      const n = Number(args[0] ?? 0);
      const s = String(args[1] ?? "");
      // Negative n means keep at most |n| chars (truncate from front); positive = slice(0,n)
      return n < 0 ? s.slice(0, Math.abs(n)) : s.slice(0, n);
    }
    case "contains":
      return String(args[1] ?? "").includes(String(args[0] ?? ""));
    case "hasPrefix":
      return String(args[1] ?? "").startsWith(String(args[0] ?? ""));
    case "hasSuffix":
      return String(args[1] ?? "").endsWith(String(args[0] ?? ""));
    case "regexMatch":
      return new RegExp(String(args[0] ?? "")).test(String(args[1] ?? ""));
    case "b64enc":
      return Buffer.from(String(args[0] ?? "")).toString("base64");
    case "b64dec":
      return Buffer.from(String(args[0] ?? ""), "base64").toString("utf-8");
    case "sha256sum":
      return String(args[0] ?? ""); // stub — no crypto dep needed for rendering

    // ── YAML / indentation ────────────────────────────────────
    case "toYaml": {
      const v = args[0];
      if (v === null || v === undefined) return "";
      try {
        return yaml.dump(v, { indent: 2, lineWidth: -1 }).trimEnd();
      } catch {
        return "";
      }
    }
    case "fromYaml": {
      try {
        return yaml.load(String(args[0] ?? "")) ?? {};
      } catch {
        return {};
      }
    }
    case "toJson": {
      return JSON.stringify(args[0] ?? null);
    }
    case "fromJson": {
      try {
        return JSON.parse(String(args[0] ?? "null"));
      } catch {
        return {};
      }
    }
    case "indent": {
      const n = Number(args[0] ?? 0);
      const s = String(args[1] ?? "");
      const pad = " ".repeat(n);
      return s.split("\n").map((l) => (l ? pad + l : l)).join("\n");
    }
    case "nindent": {
      const n = Number(args[0] ?? 0);
      const s = String(args[1] ?? "");
      const pad = " ".repeat(n);
      return "\n" + s.split("\n").map((l) => (l ? pad + l : l)).join("\n");
    }

    // ── Default / required ────────────────────────────────────
    case "default": {
      const def = args[0];
      const val = args[1];
      return isTruthy(val) ? val : def;
    }
    case "required": {
      const val = args[1];
      if (!isTruthy(val)) return `<required:${String(args[0] ?? "")}>`;
      return val;
    }
    case "coalesce": {
      for (const a of args) {
        if (isTruthy(a)) return a;
      }
      return null;
    }

    // ── Type conversions ──────────────────────────────────────
    case "toString":
      return String(args[0] ?? "");
    case "toStrings":
      return Array.isArray(args[0]) ? args[0].map(String) : [String(args[0] ?? "")];
    case "int":
    case "int64":
    case "float64":
      return Number(args[0] ?? 0);
    case "atoi":
      return parseInt(String(args[0] ?? "0"), 10);
    case "typeOf":
      return typeof args[0];
    case "kindOf":
      return Array.isArray(args[0]) ? "slice" : args[0] === null ? "nil" : typeof args[0] === "object" ? "map" : typeof args[0];

    // ── Logic ─────────────────────────────────────────────────
    case "not":
      return !isTruthy(args[0]);
    case "and":
      return args.every(isTruthy);
    case "or":
      return args.some(isTruthy) ? args.find(isTruthy) : args[args.length - 1];
    case "eq":
      return args[0] === args[1] || String(args[0]) === String(args[1]);
    case "ne":
      return args[0] !== args[1] && String(args[0]) !== String(args[1]);
    case "lt":
      return Number(args[0]) < Number(args[1]);
    case "le":
      return Number(args[0]) <= Number(args[1]);
    case "gt":
      return Number(args[0]) > Number(args[1]);
    case "ge":
      return Number(args[0]) >= Number(args[1]);
    case "empty":
      return !isTruthy(args[0]);
    case "ternary":
      return isTruthy(args[2]) ? args[0] : args[1];

    // ── Collections ───────────────────────────────────────────
    case "list":
      return [...args];
    case "dict": {
      const d: Record<string, unknown> = {};
      for (let i = 0; i + 1 < args.length; i += 2) {
        d[String(args[i])] = args[i + 1];
      }
      return d;
    }
    case "keys":
      return Object.keys((args[0] as Record<string, unknown>) ?? {}).sort();
    case "values":
      return Object.values((args[0] as Record<string, unknown>) ?? {});
    case "len":
      return Array.isArray(args[0]) ? args[0].length
        : typeof args[0] === "string" ? args[0].length
        : typeof args[0] === "object" && args[0] !== null ? Object.keys(args[0]).length
        : 0;
    case "first":
      return Array.isArray(args[0]) ? args[0][0] : null;
    case "last":
      return Array.isArray(args[0]) ? args[0][args[0].length - 1] : null;
    case "append":
      return Array.isArray(args[1]) ? [...args[1], args[0]] : [args[0]];
    case "prepend":
      return Array.isArray(args[1]) ? [args[0], ...args[1]] : [args[0]];
    case "concat":
      return ([] as unknown[]).concat(...args.map((a) => (Array.isArray(a) ? a : [a])));
    case "uniq": {
      const arr = Array.isArray(args[0]) ? args[0] : [];
      return [...new Set(arr.map(String))].map((s) => arr.find((a) => String(a) === s));
    }
    case "without":
      return Array.isArray(args[args.length - 1])
        ? (args[args.length - 1] as unknown[]).filter((x) => !args.slice(0, -1).some((a) => String(a) === String(x)))
        : [];
    case "has":
      return Array.isArray(args[1]) ? (args[1] as unknown[]).some((x) => String(x) === String(args[0])) : false;
    case "get":
      return typeof args[1] === "object" && args[1] !== null
        ? (args[1] as Record<string, unknown>)[String(args[0])]
        : null;
    case "set": {
      const obj = (typeof args[2] === "object" && args[2] !== null ? { ...(args[2] as object) } : {}) as Record<string, unknown>;
      obj[String(args[0])] = args[1];
      return obj;
    }
    case "unset": {
      const obj = { ...(args[1] as Record<string, unknown> ?? {}) };
      delete obj[String(args[0])];
      return obj;
    }
    case "merge":
    case "mergeOverwrite": {
      let result = {} as Record<string, unknown>;
      for (const a of args) {
        result = deepMerge(result, (a as Record<string, unknown>) ?? {});
      }
      return result;
    }

    // ── String builders ───────────────────────────────────────
    case "printf": {
      // Go-style printf: printf "%s-%s" arg1 arg2 ...
      const fmt = String(args[0] ?? "");
      const fmtArgs = args.slice(1);
      let ai = 0;
      return fmt.replace(/%[sdvqf%]/g, (verb) => {
        if (verb === "%%") return "%";
        const a = fmtArgs[ai++];
        switch (verb) {
          case "%d": return String(Math.trunc(Number(a ?? 0)));
          case "%f": return String(Number(a ?? 0));
          case "%q": return JSON.stringify(String(a ?? ""));
          default:   return renderValue(a); // %s, %v
        }
      });
    }
    case "print":
      return args.map((a) => renderValue(a)).join("");
    case "println":
      return args.map((a) => renderValue(a)).join("") + "\n";
    case "join":
      return (Array.isArray(args[1]) ? args[1] : [args[1]]).join(String(args[0] ?? ","));
    case "splitList": {
      const sep = String(args[0] ?? ",");
      return String(args[1] ?? "").split(sep);
    }
    case "split": {
      const sep = String(args[0] ?? "");
      const parts = String(args[1] ?? "").split(sep);
      const result: Record<string, unknown> = {};
      parts.forEach((p, i) => { result[`_${i}`] = p; });
      return result;
    }
    case "substr":
      return String(args[2] ?? "").slice(Number(args[0] ?? 0), Number(args[1] ?? 0));
    case "repeat":
      return String(args[1] ?? "").repeat(Number(args[0] ?? 0));
    case "wrap":
    case "wrapWith":
      return String(args[args.length - 1] ?? ""); // stub
    case "cat":
      return args.map((a) => String(a ?? "")).join(" ").trim();
    case "indent_":
      return String(args[0] ?? "");

    // ── Helm-specific ─────────────────────────────────────────
    case "include":
    case "template": {
      const tname = String(args[0] ?? "");
      const tctx = args.length > 1 ? args[1] : ctx;
      const tBody = namedTemplates.get(tname);
      if (!tBody) return "";
      return evaluate(tBody, tctx, namedTemplates, new Map(scope));
    }
    case "lookup":
      return {}; // no cluster available
    case "fail":
      return ""; // swallow fail in rendering context
    case "required": {
      // required "msg" .Values.x  — return value if set, empty string if not
      const val = args[1] ?? piped;
      return val !== undefined && val !== null && val !== "" ? val : "";
    }
    case "tpl": {
      // {{ tpl .Values.someTemplate . }}
      const tplSrc = String(args[0] ?? "");
      const tplCtx = args.length > 1 ? args[1] : ctx;
      try {
        const toks = tokenize(tplSrc);
        const ast = parse(toks);
        return evaluate(ast, tplCtx, namedTemplates, new Map(scope));
      } catch {
        return tplSrc;
      }
    }
    case "semverCompare":
    case "semver":
      return false; // stub — return false so optional blocks are skipped
    case "typeOf":
    case "kindOf": {
      const v = args[0] ?? piped;
      if (v === null || v === undefined) return "nil";
      if (Array.isArray(v)) return "slice";
      return typeof v;
    }
    case "typeIsLike":
    case "typeIs":
    case "kindIs":
      return false; // stub
    case "deepCopy":
    case "mustDeepCopy":
      return args[0] ?? piped ?? {};
    case "toRawJson":
      return JSON.stringify(args[0] ?? piped ?? null);
    case "fromJson":
    case "mustFromJson": {
      try { return JSON.parse(String(args[0] ?? "")); } catch { return {}; }
    }
    case "regexFind":
      try {
        const m = new RegExp(String(args[0] ?? "")).exec(String(args[1] ?? ""));
        return m ? m[0] : "";
      } catch { return ""; }
    case "regexFindAll": {
      try {
        const re = new RegExp(String(args[0] ?? ""), "g");
        return Array.from(String(args[1] ?? "").matchAll(re), (m) => m[0]).slice(0, Number(args[2] ?? -1));
      } catch { return []; }
    }
    case "regexReplaceAll":
    case "regexReplaceAllLiteral": {
      try {
        return String(args[2] ?? "").replace(new RegExp(String(args[0] ?? ""), "g"), String(args[1] ?? ""));
      } catch { return String(args[2] ?? ""); }
    }
    case "mustRegexMatch":
    case "regexMatch":
      try { return new RegExp(String(args[0] ?? "")).test(String(args[1] ?? "")); }
      catch { return false; }
    case "nospace":
      return String(args[0] ?? "").replace(/\s+/g, "");
    case "camelcase": {
      return String(args[0] ?? "").replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase());
    }
    case "snakecase":
      return String(args[0] ?? "").replace(/([A-Z])/g, (_, c) => `_${c.toLowerCase()}`).replace(/^_/, "");
    case "kebabcase":
      return String(args[0] ?? "").replace(/([A-Z])/g, (_, c) => `-${c.toLowerCase()}`).replace(/^-/, "").replace(/[\s_]+/g, "-");
    case "initials":
      return String(args[0] ?? "").split(/\s+/).map((w) => w[0] ?? "").join("");
    case "swapcase":
      return String(args[0] ?? "").replace(/[a-zA-Z]/g, (c) => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase());
    case "randAlphaNum":
    case "randAlpha":
    case "randNumeric":
    case "randAscii":
      return "x".repeat(Math.max(1, Number(args[0] ?? 5)));
    case "uuidv4":
      return "00000000-0000-4000-8000-000000000000"; // deterministic stub
    case "now":
      return new Date().toISOString();
    case "date":
    case "dateInZone":
      return new Date().toISOString().slice(0, 10);
    case "unixEpoch":
      return String(Math.floor(Date.now() / 1000));
    case "toDecimal":
      return Number(args[0] ?? 0);
    case "int":
    case "int64":
    case "float64":
      return Number(args[args.length - 1] ?? 0);
    case "toString":
      return String(args[0] ?? "");
    case "toBool":
      return Boolean(args[0] ?? false);
    case "atoi":
      return parseInt(String(args[0] ?? ""), 10) || 0;
    case "add1":
      return Number(args[args.length - 1] ?? 0) + 1;
    case "sub":
      return Number(args[0] ?? 0) - Number(args[1] ?? 0);
    case "div":
      return Math.floor(Number(args[0] ?? 1) === 0 ? 0 : Number(args[1] ?? 0) / Number(args[0] ?? 1));
    case "mod":
      return Number(args[1] ?? 0) % (Number(args[0] ?? 1) || 1);
    case "ceil":
      return Math.ceil(Number(args[0] ?? 0));
    case "floor":
      return Math.floor(Number(args[0] ?? 0));
    case "round":
      return Math.round(Number(args[1] ?? 0));
    case "max":
      return Math.max(...args.map(Number));
    case "min":
      return Math.min(...args.map(Number));
    case "empty": {
      const v = args[0] ?? piped;
      return v === null || v === undefined || v === "" || v === 0 || v === false ||
             (Array.isArray(v) && v.length === 0) ||
             (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
    }
    case "ternary":
      return isTruthy(args[2] ?? piped) ? args[0] : args[1];
    case "compact":
      return (Array.isArray(args[0] ?? piped) ? (args[0] ?? piped) as unknown[] : []).filter(Boolean);
    case "chunk": {
      const size = Number(args[0] ?? 1);
      const arr = Array.isArray(args[1] ?? piped) ? (args[1] ?? piped) as unknown[] : [];
      const chunks: unknown[][] = [];
      for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
      return chunks;
    }
    case "uniq": {
      const arr = Array.isArray(args[0] ?? piped) ? (args[0] ?? piped) as unknown[] : [];
      return [...new Set(arr)];
    }
    case "sortAlpha": {
      const arr = Array.isArray(args[0] ?? piped) ? [...(args[0] ?? piped) as unknown[]] : [];
      return arr.sort((a, b) => String(a).localeCompare(String(b)));
    }
    case "reverse": {
      const arr = Array.isArray(args[0] ?? piped) ? [...(args[0] ?? piped) as unknown[]] : [];
      return arr.reverse();
    }
    case "first":
      return Array.isArray(args[0] ?? piped) ? ((args[0] ?? piped) as unknown[])[0] ?? "" : "";
    case "last": {
      const a = Array.isArray(args[0] ?? piped) ? (args[0] ?? piped) as unknown[] : [];
      return a[a.length - 1] ?? "";
    }
    case "rest": {
      const a = Array.isArray(args[0] ?? piped) ? (args[0] ?? piped) as unknown[] : [];
      return a.slice(1);
    }
    case "initial": {
      const a = Array.isArray(args[0] ?? piped) ? (args[0] ?? piped) as unknown[] : [];
      return a.slice(0, -1);
    }
    case "append":
      return [...(Array.isArray(args[0]) ? args[0] : []), args[1] ?? piped];
    case "prepend":
      return [args[1] ?? piped, ...(Array.isArray(args[0]) ? args[0] : [])];
    case "concat": {
      const result: unknown[] = [];
      for (const a of args) {
        if (Array.isArray(a)) result.push(...a);
        else if (a != null) result.push(a);
      }
      return result;
    }
    case "pick": {
      const obj = (args[args.length - 1] ?? piped) as Record<string, unknown>;
      const picked: Record<string, unknown> = {};
      for (const k of args.slice(0, -1)) picked[String(k)] = obj[String(k)];
      return picked;
    }
    case "omit": {
      const obj = (args[args.length - 1] ?? piped) as Record<string, unknown>;
      const result: Record<string, unknown> = { ...(obj ?? {}) };
      for (const k of args.slice(0, -1)) delete result[String(k)];
      return result;
    }
    case "set": {
      const obj = (args[2] ?? piped) as Record<string, unknown>;
      return { ...(obj ?? {}), [String(args[0])]: args[1] };
    }
    case "unset": {
      const obj = (args[1] ?? piped) as Record<string, unknown>;
      const result = { ...(obj ?? {}) };
      delete result[String(args[0])];
      return result;
    }
    case "hasKey": {
      const obj = (args[1] ?? piped) as Record<string, unknown>;
      return Object.prototype.hasOwnProperty.call(obj ?? {}, String(args[0]));
    }
    case "pluck": {
      const key = String(args[0]);
      const maps = args.slice(1);
      return maps.map((m) => (m as Record<string, unknown>)?.[key]);
    }
    case "dig": {
      let cur: unknown = args[args.length - 1] ?? piped;
      for (let i = 0; i < args.length - 1; i++) {
        if (cur == null || typeof cur !== "object") return "";
        cur = (cur as Record<string, unknown>)[String(args[i])];
      }
      return cur ?? "";
    }
    case "mustMerge":
    case "mergeOverwrite":
    case "mustMergeOverwrite": {
      let result: Record<string, unknown> = {};
      for (const a of [...args].reverse()) {
        result = deepMerge(result, (a as Record<string, unknown>) ?? {});
      }
      return result;
    }

    // ── Fallback ──────────────────────────────────────────────
    default:
      // Unknown function - return piped value unchanged or empty
      return piped !== undefined ? piped : "";
  }
}

/**
 * Parse a function call expression into [funcName, arg1, arg2, ...]
 * Respects quoted strings and nested parens.
 */
function parseCallArgs(expr: string): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let inStr = false;
  let strChar = "";

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inStr) {
      current += ch;
      if (ch === strChar && expr[i - 1] !== "\\") inStr = false;
    } else if (ch === '"' || ch === "'") {
      inStr = true;
      strChar = ch;
      current += ch;
    } else if (ch === "(" || ch === "[") {
      depth++;
      current += ch;
    } else if (ch === ")" || ch === "]") {
      depth--;
      current += ch;
    } else if (ch === " " && depth === 0) {
      if (current.trim()) args.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function isTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") {
    try {
      return yaml.dump(v, { indent: 2, lineWidth: -1 }).trimEnd();
    } catch {
      return JSON.stringify(v);
    }
  }
  return String(v);
}

function toIterable(v: unknown): Array<[unknown, unknown]> {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map((item, i) => [i, item] as [unknown, unknown]);
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, val] as [unknown, unknown]);
  }
  return [];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A rendered template file may contain multiple Kubernetes resources
 * concatenated without proper `---` separators (e.g. when `{{- end}}` trims
 * whitespace between two with-blocks). This function splits them into
 * separate documents using `---` boundaries, inserting separators where needed.
 */
function splitRenderedDocs(rendered: string, filename: string): string[] {
  // Normalise: replace any existing `---` markers with a sentinel
  const sentinel = "\x00DOCSEP\x00";
  let normalised = rendered.replace(/^---\s*/gm, sentinel);

  // Insert a sentinel before any `apiVersion:` that appears at column 0
  // but isn't already preceded by one (handles back-to-back resources)
  normalised = normalised.replace(/(^|\n)(apiVersion:)/g, (_, pre, kw) => {
    if (pre.includes(sentinel)) return pre + kw;
    return `${pre}${sentinel}${kw}`;
  });

  const docs = normalised
    .split(sentinel)
    .map((d) => d.trim())
    .filter((d) => d.length > 0 && d.includes("kind:"));

  return docs.map((doc) => `---\n# Source: templates/${filename}\n${doc}`);
}

export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (
      typeof v === "object" &&
      v !== null &&
      !Array.isArray(v) &&
      typeof result[k] === "object" &&
      result[k] !== null &&
      !Array.isArray(result[k])
    ) {
      result[k] = deepMerge(result[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}
