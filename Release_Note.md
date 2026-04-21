# Release Notes

## Helm Visualizer — v0.2.0 (April 21, 2026)

---

### 🆕 New Features

#### VS Code Extension — Beta (PR #62 · April 21, 2026)

> ⚠️ **Beta**: This is the first release of the VS Code extension. APIs and behavior may change before the stable release.

The Helm Visualizer is now available as a **VS Code extension** (`unrealandychan.helm-visualizer`) that embeds the full web app inside an editor panel via a `WebviewPanel` + iframe.

Key highlights:

- **Embedded panel** — Open the Helm Visualizer app directly inside VS Code via the Command Palette (`Helm Visualizer: Open`).
- **Open in Browser fallback** — One-click command to open the app in your default browser (`Helm Visualizer: Open in Browser`).
- **Configurable URL** — `helmVisualizer.appUrl` setting lets you point the extension at any running instance (local dev or deployed).
- **Live config reload** — The panel reloads automatically when the URL setting changes.
- **Load-failure detection** — 8-second timeout plus an iframe load check shows an actionable error banner when the server isn't reachable.
- **Install scripts** — `scripts/install-local.sh` and `scripts/publish-marketplace.sh` (plus `npm run install-local` / `npm run publish-marketplace`) make building, installing, and publishing the extension a one-command operation.

**Install (VS Marketplace):**

```bash
code --install-extension unrealandychan.helm-visualizer
```

**Install (local build — no marketplace):**

```bash
cd vscode-extension
npm run install-local
```

**Publish to VS Marketplace:**

```bash
cd vscode-extension
VSCE_PAT=<token> npm run publish-marketplace
```

---

## Helm Visualizer — v0.1.0 / Recent Updates (April 14–16, 2026)

---

### 🆕 New Features

#### RBAC Resource Graph Support (PR #55 · April 16, 2026)
- Added `ClusterRole`, `ClusterRoleBinding`, `Role`, and `RoleBinding` as first-class nodes in the resource graph.
- Graph edges now reflect RBAC relationships: bindings point **from** subjects (ServiceAccounts, Users, Groups) **to** the role they bind, making privilege flows visually clear.
- ServiceAccount resolution is namespace-aware — `subjects` entries without an explicit namespace default to the binding's own namespace.

#### Selectable Colour Themes (PR #53 · April 15, 2026)
- Three built-in themes are now selectable from the UI toolbar: **Dark**, **Light**, and **High-Contrast**.
- Theme tokens propagate into the React Flow graph canvas so node colours, edge colours, and backgrounds stay consistent across every theme.
- Improved overall layout readability with cleaner spacing and typography in `page.tsx`.

#### Helm Chart Structure Validation (PR #51 · April 15, 2026)
- A new validation step runs when a chart is loaded, checking for common structural problems before rendering.
- A **progress bar** shows validation progress; results surface as actionable **warnings and errors** inline in the UI so users can fix issues quickly.
- Detected categories include: missing required files (`Chart.yaml`, `values.yaml`), duplicate YAML keys, and malformed template syntax.

#### Export Visualization (PR #50 · April 14, 2026)
- The rendered resource graph can now be exported in four formats directly from the toolbar:
  - **PNG** — rasterised snapshot of the current viewport.
  - **SVG** — scalable vector export of the full graph.
  - **JSON** — raw React Flow node/edge data for programmatic use.
  - **Markdown** — text summary listing every resource and its relationships.

---

### 🐛 Bug Fixes

| Date | Fix |
|---|---|
| April 16, 2026 | **RBAC edges** — reversed the direction of `binds` edges so arrows correctly flow from subjects to roles. |
| April 15, 2026 | **SSRF guard** — `getOciToken` now properly `await`s `assertSafeHostname` (previously a missing `await` left the guard ineffective). |
| April 15, 2026 | **Duplicate-key detection** — rewrote `findDuplicateKeys` using an indentation stack, eliminating false-positive warnings on valid nested YAML. |
| April 14, 2026 | **Export button crash** — moved `useReactFlow()` into the `ExportController` child component so it is always called inside a React Flow provider, resolving a Zustand provider error. |

---

### 🔧 Refactors & Chores

- Named constants replace magic strings in chart-validation and export components (improves readability and reduces risk of typos).
- X (close) icon added to dismissible warning banners in the validation panel.
- Inline regex patterns now carry explanatory comments.
- Theme follow-up review items addressed: colour contrast ratios improved, token naming made consistent.

---

### Summary

These releases collectively extend Helm Visualizer with **RBAC visibility**, **multi-theme support**, **chart health validation**, and **graph export** — four major capabilities shipped across three PRs in roughly 48 hours. Two security/correctness fixes (SSRF guard and duplicate-key detection) were also bundled.
