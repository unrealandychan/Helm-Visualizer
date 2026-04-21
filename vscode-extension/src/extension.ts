import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Panel singleton
// ---------------------------------------------------------------------------

let currentPanel: HelmVisualizerPanel | undefined;
let helmTerminal: vscode.Terminal | undefined;

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  // Register sidebar tree view
  const sidebarProvider = new HelmSidebarProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("helmVisualizerSidebar", sidebarProvider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("helmVisualizer.open", () => {
      HelmVisualizerPanel.createOrShow(context.extensionUri);
    }),
    vscode.commands.registerCommand("helmVisualizer.openInBrowser", () => {
      const url = getAppUrl();
      vscode.env.openExternal(vscode.Uri.parse(url));
    }),
    vscode.commands.registerCommand("helmVisualizer.openCli", () => {
      openHelmTerminal();
    }),
  );
}

export function deactivate(): void {
  currentPanel?.dispose();
  helmTerminal?.dispose();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAppUrl(): string {
  return (
    vscode.workspace
      .getConfiguration("helmVisualizer")
      .get<string>("appUrl") ?? "http://localhost:3000"
  );
}

function openHelmTerminal(): void {
  // Reuse existing terminal if it is still alive
  if (helmTerminal && helmTerminal.exitStatus === undefined) {
    helmTerminal.show(false);
    return;
  }
  helmTerminal = vscode.window.createTerminal({
    name: "Helm CLI",
    iconPath: new vscode.ThemeIcon("terminal"),
  });
  helmTerminal.show(false);
}

// ---------------------------------------------------------------------------
// Sidebar TreeDataProvider
// ---------------------------------------------------------------------------

class HelmSidebarItem extends vscode.TreeItem {
  constructor(
    label: string,
    command: vscode.Command,
    icon: string,
    description?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = command;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.description = description;
    this.tooltip = label;
  }
}

class HelmSidebarProvider implements vscode.TreeDataProvider<HelmSidebarItem> {
  constructor() {}

  getTreeItem(element: HelmSidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(): HelmSidebarItem[] {
    return [
      new HelmSidebarItem(
        "Open Helm Visualizer",
        { title: "Open Helm Visualizer", command: "helmVisualizer.open" },
        "graph",
        "Open in panel",
      ),
      new HelmSidebarItem(
        "Open in Browser",
        { title: "Open in Browser", command: "helmVisualizer.openInBrowser" },
        "link-external",
        getAppUrl(),
      ),
      new HelmSidebarItem(
        "Open Helm CLI Terminal",
        { title: "Open Helm CLI Terminal", command: "helmVisualizer.openCli" },
        "terminal",
        "Run helm commands",
      ),
    ];
  }
}

// ---------------------------------------------------------------------------
// WebviewPanel wrapper
// ---------------------------------------------------------------------------

class HelmVisualizerPanel {
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(extensionUri: vscode.Uri) {
    this._panel = vscode.window.createWebviewPanel(
      "helmVisualizer",
      "Helm Visualizer",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    this._panel.iconPath = vscode.Uri.joinPath(extensionUri, "icon.png");
    this._panel.webview.html = this._buildHtml(getAppUrl());

    // Handle configuration changes while the panel is open
    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
        if (e.affectsConfiguration("helmVisualizer.appUrl")) {
          this._panel.webview.html = this._buildHtml(getAppUrl());
        }
      }),
    );

    // Handle messages from the webview (e.g. "open in browser" button)
    this._panel.webview.onDidReceiveMessage(
      (message: { command: string }) => {
        if (message.command === "openInBrowser") {
          vscode.env.openExternal(vscode.Uri.parse(getAppUrl()));
        }
      },
      undefined,
      this._disposables,
    );

    this._panel.onDidDispose(() => this.dispose(), undefined, this._disposables);
  }

  static createOrShow(extensionUri: vscode.Uri): void {
    if (currentPanel) {
      currentPanel._panel.reveal(vscode.ViewColumn.One);
      return;
    }
    currentPanel = new HelmVisualizerPanel(extensionUri);
  }

  dispose(): void {
    currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }
  }

  // -------------------------------------------------------------------------
  // HTML
  // -------------------------------------------------------------------------

  private _buildHtml(appUrl: string): string {
    // Validate / normalise the URL so we can compute a safe frame-src value
    let origin = "http://localhost:3000";
    try {
      const parsed = new URL(appUrl);
      origin = parsed.origin;
    } catch {
      // keep default origin; error will surface in the iframe anyway
    }

    // Produce a JSON literal that is safe to embed inside a <script> block:
    // the raw output of JSON.stringify can contain "</script" or "<!--" which
    // would break out of the script context.  Escaping < and > to their
    // Unicode escape sequences prevents this without changing the JS value.
    const safeJsonUrl = JSON.stringify(appUrl)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e");

    return /* html */ `<!DOCTYPE html>
<html lang="en" style="height:100%;margin:0;padding:0;">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; frame-src ${origin}; script-src 'unsafe-inline'; style-src 'unsafe-inline';"
  />
  <title>Helm Visualizer</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      background: #1e1e1e;
      color: #ccc;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 13px;
    }
    #toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: #252526;
      border-bottom: 1px solid #3c3c3c;
      flex-shrink: 0;
    }
    #toolbar span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9cdcfe; }
    #toolbar button {
      background: #0e639c;
      color: #fff;
      border: none;
      border-radius: 3px;
      padding: 3px 10px;
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
    }
    #toolbar button:hover { background: #1177bb; }
    iframe {
      flex: 1;
      border: none;
      width: 100%;
    }
    #error-banner {
      display: none;
      padding: 20px;
      text-align: center;
    }
    #error-banner a { color: #9cdcfe; }
  </style>
</head>
<body>
  <div id="toolbar">
    <span title="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</span>
    <button id="reload-btn">↺ Reload</button>
    <button id="browser-btn">Open in Browser ↗</button>
  </div>
  <iframe
    id="app-frame"
    src="${escapeHtml(appUrl)}"
    allow="clipboard-read; clipboard-write"
    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
  ></iframe>
  <div id="error-banner">
    <p>
      Could not load <strong>${escapeHtml(appUrl)}</strong>.<br/>
      Make sure the Helm Visualizer server is running:<br/>
      <code>npm run dev</code><br/>
      in the repository root, then reload.
    </p>
    <p>Or <a href="#" id="browser-link">open in your default browser</a>.</p>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById('app-frame');
    const banner = document.getElementById('error-banner');
    const baseUrl = ${safeJsonUrl};

    // Reload using a cache-busting query parameter so the iframe always
    // re-fetches the page, regardless of same-origin restrictions.
    document.getElementById('reload-btn').addEventListener('click', () => {
      const sep = baseUrl.includes('?') ? '&' : '?';
      frame.src = baseUrl + sep + '_t=' + Date.now();
      banner.style.display = 'none';
      frame.style.display = '';
    });
    document.getElementById('browser-btn').addEventListener('click', () => {
      vscode.postMessage({ command: 'openInBrowser' });
    });
    document.getElementById('browser-link').addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ command: 'openInBrowser' });
    });

    // The iframe 'error' event does not fire for network / HTTP failures; use a
    // timed load check instead.  If the frame fires 'load' but its content is
    // inaccessible (cross-origin or blank), we show a helpful error banner.
    let loadTimer = setTimeout(() => {
      // No 'load' event within 8 s — server likely not running.
      frame.style.display = 'none';
      banner.style.display = 'block';
    }, 8000);

    frame.addEventListener('load', () => {
      clearTimeout(loadTimer);
      // Cross-origin iframes throw on contentDocument access; that means
      // the page loaded successfully. A null contentDocument (e.g. net::ERR_*)
      // means it failed.
      let loaded = false;
      try {
        // Will throw if cross-origin (successful load of remote origin).
        loaded = frame.contentDocument !== null;
      } catch (_) {
        loaded = true; // cross-origin = loaded fine
      }
      if (!loaded) {
        frame.style.display = 'none';
        banner.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;
  }
}

// ---------------------------------------------------------------------------
// Tiny XSS-safe helper — only used to embed trusted config values into HTML
// ---------------------------------------------------------------------------
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

