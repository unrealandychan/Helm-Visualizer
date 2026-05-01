# Helm Visualizer — Architecture

This document is intended for developers who want to understand how the project is structured, how data flows through the system, and where to find the key pieces of logic.

---

## High-Level Rendering Pipeline

```
User supplies a Helm chart
        │
        ▼
┌───────────────────┐
│   helmRunner.ts   │  Try Helm CLI (helm template)
│                   │──────────────────────────────▶  Helm CLI available?
└───────────────────┘                                       │
        │  CLI not found / error                           YES
        │                                                   │
        ▼                                                   ▼
┌──────────────────────────┐               ┌─────────────────────────┐
│ helmTemplateRenderer.ts  │               │  helm template <chart>  │
│  (pure-JS Go-template    │               │  (subprocess)           │
│   engine fallback)       │               └─────────────────────────┘
└──────────────────────────┘                           │
        │                                              │
        └──────────────────┬───────────────────────────┘
                           │  Rendered YAML (multi-document)
                           ▼
              ┌─────────────────────┐
              │  chartRenderer.ts   │  Orchestrates multiple
              │  (concurrency       │  value-env renders in parallel
              │   limiter = 3)      │  (RENDER_CONCURRENCY=3)
              └─────────────────────┘
                           │
                           ▼
              ┌─────────────────────┐
              │   graphBuilder.ts   │  Parses YAML → Kubernetes
              │                     │  resource objects → ReactFlow
              │                     │  nodes + edges (edge inference)
              └─────────────────────┘
                           │
                           ▼
              ┌─────────────────────┐
              │  ResourceGraph.tsx  │  Renders the interactive
              │  (ReactFlow)        │  node/edge graph in the browser
              └─────────────────────┘
```

---

## Directory Structure

```
helm-visualizer/
├── app/                        # Next.js App Router pages & API routes
│   ├── api/
│   │   ├── chat/               # AI Chat endpoint (OpenAI)
│   │   ├── fetch-chart/        # Fetch chart from URL / Artifact Hub
│   │   ├── render-chart/       # Render a chart by path/ref
│   │   ├── upload-chart/       # Accept chart tarball upload
│   │   └── workspace-chart/    # Serve charts from the local workspace
│   ├── layout.tsx
│   └── page.tsx
│
├── components/                 # React UI components
│   ├── ChartLoader.tsx         # Unified chart loading UI (tabs + progress bar)
│   ├── ResourceGraph.tsx       # ReactFlow graph visualisation
│   └── ...
│
├── lib/                        # Pure logic — no React, no Next.js
│   ├── chartRenderer.ts        # Multi-env orchestration + concurrency limiter
│   ├── graphBuilder.ts         # YAML resources → ReactFlow nodes/edges
│   ├── helmRunner.ts           # Helm CLI wrapper with JS fallback
│   ├── helmTemplateRenderer.ts # Pure-JS Go-template engine
│   └── ...
│
├── types/                      # Shared TypeScript types / interfaces
│
├── vscode-extension/           # VS Code extension package
│   ├── src/
│   │   └── extension.ts        # Activation, WebviewPanel creation
│   └── package.json
│
├── helm-plugin/                # Helm plugin (helm vis)
│   ├── run.sh                  # Unix entry point
│   ├── run.bat                 # Windows entry point
│   └── plugin.yaml
│
├── env.example                 # Template for .env.local
├── ARCHITECTURE.md             # This file
├── CONTRIBUTING.md
└── package.json
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser / UI                            │
│                                                                 │
│   ChartLoader.tsx                                               │
│   ┌──────────┐  upload / URL / workspace path                   │
│   │  Input   │──────────────────────────────────────────────▶  │
│   └──────────┘        POST /api/upload-chart                    │
│                        GET  /api/fetch-chart                    │
│                        GET  /api/workspace-chart                │
│                        POST /api/render-chart                   │
│                                │                                │
│              ◀─────────────────┘  { nodes[], edges[], envs[] }  │
│                                                                 │
│   ResourceGraph.tsx                                             │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  ReactFlow canvas — pan, zoom, click node for details    │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│   AI Chat sidebar                                               │
│   ┌──────────┐  user message + graph context                    │
│   │  Chat    │──────────────────────────▶ POST /api/chat        │
│   │  input   │  ◀─────────────────────── streamed response      │
│   └──────────┘                                                  │
└─────────────────────────────────────────────────────────────────┘

                         Next.js API layer
┌─────────────────────────────────────────────────────────────────┐
│  /api/render-chart                                              │
│       │                                                         │
│       ▼                                                         │
│  chartRenderer.ts  ──────────────────────────────────────────▶  │
│  (per-env loop,                  helmRunner.ts                  │
│   concurrency=3)  ◀──────────── (CLI or JS fallback)           │
│       │                                                         │
│       ▼                                                         │
│  graphBuilder.ts  → { nodes, edges }                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Files

### `lib/helmTemplateRenderer.ts`

A **pure-JavaScript Go-template engine** that replicates the subset of Go templating used by Helm charts. It is invoked as a fallback when the Helm CLI is not available in the runtime environment (e.g. serverless deployments, the VS Code extension sandbox).

Responsibilities:
- Parses `Chart.yaml` and `values.yaml`.
- Walks `templates/` and `charts/` (subcharts) recursively.
- Implements: variable interpolation, `if`/`else`/`end`, `range`/`end`, `define`/`include`, pipelines, and a set of common Helm built-in functions (`default`, `quote`, `toYaml`, `sha256sum`, etc.).
- Tracks which stub functions were called (returned in `stubsUsed[]`) so callers know when output may be approximate.

**Exported API:**

```ts
renderHelmChartJS(
  chartDir: string,
  releaseName: string,
  valuesFiles: string[]
): Promise<{ yaml: string; stubsUsed: string[] }>
```

---

### `lib/helmRunner.ts`

A thin **wrapper around the `helm template` CLI command**. It attempts to locate the Helm binary using `which`/`where`, spawns the process, and captures stdout. On failure (binary not found, non-zero exit, timeout) it automatically falls back to `renderHelmChartJS`.

---

### `lib/chartRenderer.ts`

Orchestrates rendering a chart against **multiple value environments** (e.g. `values-dev.yaml`, `values-prod.yaml`) in parallel. A `p-limit` concurrency limiter caps simultaneous Helm/JS renders at `RENDER_CONCURRENCY` (default `3`) to avoid memory spikes.

Returns a map of `envName → { nodes, edges }` ready for the frontend to switch between environments.

---

### `lib/graphBuilder.ts`

Converts a multi-document YAML string of rendered Kubernetes resources into a **ReactFlow-compatible graph**. 

Steps:
1. Parse each YAML document into a typed resource object.
2. Create one ReactFlow **node** per resource (with `kind`, `name`, `namespace` metadata).
3. **Infer edges** — e.g. a `Deployment` that references a `ConfigMap` via `envFrom` gets an edge to that `ConfigMap` node; a `Service` whose selector matches a `Deployment`'s pod labels gets an edge, etc.
4. Apply a hierarchical auto-layout (dagre) and return `{ nodes, edges }`.

---

### `app/api/`

Next.js **Route Handlers** (App Router):

| Route | Method | Purpose |
|-------|--------|---------|
| `fetch-chart` | GET | Download & cache a chart tarball from a URL or Artifact Hub slug |
| `workspace-chart` | GET | Serve chart files from the server's local filesystem (dev/VS Code mode) |
| `upload-chart` | POST | Accept a `.tgz` upload, extract to a temp dir, return a chart ref |
| `render-chart` | POST | Run `chartRenderer.ts` for a given chart ref + env list; return graph data |
| `chat` | POST | Proxy to OpenAI Chat Completions with rate limiting; streams the response |

---

### `components/ResourceGraph.tsx`

The main **ReactFlow canvas** component. Features:
- Renders nodes colour-coded by Kubernetes resource `kind`.
- Supports pan, zoom, and minimap.
- Clicking a node opens a detail drawer with the full rendered YAML for that resource.
- Environment switcher (tabs) to compare dev/staging/prod graphs side by side.

---

### `components/ChartLoader.tsx`

A unified **chart-loading UI** with three input tabs:
1. **URL / Artifact Hub** — paste a chart URL or `repo/chart` slug.
2. **Upload** — drag-and-drop or file picker for a `.tgz` tarball.
3. **Workspace** — browse charts available in the server's working directory.

Includes a progress bar that polls the render status and a friendly error state.

---

## Environment Variables

All variables are read at **runtime** by Next.js API routes. Copy `env.example` to `.env.local` to configure locally.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | **Yes** (for AI Chat) | — | Secret key for the OpenAI API |
| `OPENAI_BASE_URL` | No | `https://api.openai.com/v1` | Override to use a compatible API (e.g. Azure OpenAI, local Ollama) |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Model name passed to the Chat Completions endpoint |
| `OPENAI_MAX_TOKENS` | No | `1200` | Maximum tokens in the AI Chat completion response |
| `RENDER_CONCURRENCY` | No | `3` | Max simultaneous `helm template` / JS renderer invocations |
| `CHAT_RATE_LIMIT_MAX` | No | `30` | Max chat requests allowed per window per IP |
| `CHAT_RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate-limit sliding window in milliseconds |

---

## VS Code Extension Architecture

```
VS Code process
└── extension.ts (activated on command "helmVisualizer.open")
    │
    ├── Creates a WebviewPanel
    │     └── Loads the Next.js app inside an <iframe>
    │           (URL: http://localhost:<port> — the extension starts
    │            a bundled Next.js server in a child process)
    │
    └── postMessage bridge
          ├── Extension → Webview: current workspace folder path,
          │                        active file path
          └── Webview → Extension: "open file" requests,
                                   telemetry events
```

The extension communicates the **active workspace path** to the web app so `ChartLoader` can pre-populate the workspace tab with charts found locally.

---

## Helm Plugin Architecture

```
helm vis [chart-path] [flags]
        │
        ├─ run.sh  (Linux / macOS)
        └─ run.bat (Windows)
               │
               ▼
        Checks if Next.js server is already running on PORT
               │
         NOT running?
               │
               ▼
        Starts `node server.js` (bundled Next.js standalone build)
        in background, waits for HTTP 200 on /api/health
               │
               ▼
        Opens the browser at http://localhost:<PORT>?chart=<chart-path>
               │
               ▼
        The web app reads the ?chart= query param, calls
        /api/workspace-chart to load the chart, and renders the graph
```

The plugin ships with a **pre-built Next.js standalone bundle** so it does not require a separate `npm install` step — just `helm plugin install`.
