# Helm Visualizer — VS Code Extension

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/unrealandychan.helm-visualizer)](https://marketplace.visualstudio.com/items?itemName=unrealandychan.helm-visualizer)
[![GitHub](https://img.shields.io/badge/GitHub-unrealandychan%2FHelm--Visualizer-blue?logo=github)](https://github.com/unrealandychan/Helm-Visualizer)

Brings the **Helm Chart Visualizer** web application into a VS Code panel — visualize Helm charts, diff environments, and explore Kubernetes resources without leaving your editor.

---

## Features

| Feature | Description |
|---|---|
| **Extension pane** | Embedded web app inside a VS Code WebviewPanel |
| **Open in browser** | One-click fallback to open the app in your default browser |
| **Configurable URL** | Point the extension at any running instance (local dev or deployed) |
| **Reload button** | Refresh the embedded app without reopening the panel |

All core web app features are available inside the panel:

- Multi-environment rendering and diff view
- Kubernetes resource graph with relationship edges
- Values inspector and resource detail sidebar
- Manifest preview and export
- AI chat assistant (requires `OPENAI_API_KEY`)

---

## Requirements

The extension embeds the Helm Visualizer web app inside VS Code. You must have a running instance of the server:

**Local development (recommended):**

```bash
# In the Helm-Visualizer repository root
npm install
npm run dev
```

Then open the extension panel — it connects to `http://localhost:3000` by default.

**Deployed instance:**

Set `helmVisualizer.appUrl` in your VS Code settings to point to your deployed URL.

---

## Install

### Option A — VS Marketplace (easiest)

Search for **Helm Visualizer** in the VS Code Extensions sidebar, or run:

```bash
code --install-extension unrealandychan.helm-visualizer
```

### Option B — Local build (no marketplace needed)

Use the one-command script that builds the VSIX and installs it for you:

```bash
cd vscode-extension
npm run install-local
```

Or step by step:

```bash
cd vscode-extension
npm install                  # install build tools
npm run compile              # TypeScript → out/
npm run package              # produces helm-visualizer-<version>.vsix
code --install-extension helm-visualizer-<version>.vsix
```

> Reload VS Code after install (`Ctrl+Shift+P` → **Developer: Reload Window**).

---

## Usage

### Open the panel

- Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
- Run **Helm Visualizer: Open**

### Open in browser

- Command Palette → **Helm Visualizer: Open in Browser**

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `helmVisualizer.appUrl` | `http://localhost:3000` | URL of the Helm Visualizer server |

---

## Publish to VS Marketplace

Set your Azure DevOps Personal Access Token (Marketplace → Publish scope) and run:

```bash
cd vscode-extension
VSCE_PAT=<your-token> npm run publish-marketplace
```

Or use the script directly:

```bash
VSCE_PAT=<your-token> bash scripts/publish-marketplace.sh
```

Get a PAT: <https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token>

---

## Scripts Reference

| Script | Command | Description |
|---|---|---|
| Compile | `npm run compile` | TypeScript → `out/` |
| Watch | `npm run watch` | Recompile on file change |
| Package | `npm run package` | Build VSIX archive |
| **Install locally** | `npm run install-local` | Build VSIX and install into VS Code |
| **Publish** | `VSCE_PAT=<tok> npm run publish-marketplace` | Publish to VS Marketplace |

---

## License

Apache 2.0 — see [LICENSE](../LICENSE).

