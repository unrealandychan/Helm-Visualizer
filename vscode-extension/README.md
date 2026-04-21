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

## Usage

### Open the panel

- Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
- Run **Helm Visualizer: Open**

### Open in browser

- Command Palette → **Helm Visualizer: Open in Browser**

### Install from VSIX (CLI)

```bash
code --install-extension helm-visualizer-0.1.0.vsix
```

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `helmVisualizer.appUrl` | `http://localhost:3000` | URL of the Helm Visualizer server |

---

## Building and Packaging

```bash
cd vscode-extension
npm install
npm run compile        # compile TypeScript → out/
npm run package        # create helm-visualizer-<version>.vsix
```

### Publish to VS Marketplace

```bash
npm run publish        # requires VSCE_PAT environment variable
```

---

## License

Apache 2.0 — see [LICENSE](../LICENSE).
