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
      flex: 1;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      text-align: center;
      background: #1e1e1e;
    }
    #error-banner .error-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.6;
    }
    #error-banner h2 {
      color: #f48771;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    #error-banner p {
      color: #aaa;
      margin: 6px 0;
      line-height: 1.6;
      max-width: 520px;
    }
    #error-banner .setup-box {
      margin: 18px auto;
      padding: 14px 20px;
      background: #252526;
      border: 1px solid #3c3c3c;
      border-radius: 6px;
      text-align: left;
      max-width: 520px;
      width: 100%;
    }
    #error-banner .setup-box .step-label {
      color: #9cdcfe;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 8px;
      font-weight: 600;
    }
    #error-banner code {
      display: block;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 8px 12px;
      margin: 6px 0;
      color: #ce9178;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      word-break: break-all;
    }
    #error-banner .url-display {
      color: #9cdcfe;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }
    #error-banner a { color: #9cdcfe; cursor: pointer; text-decoration: underline; }
    #error-banner .actions {
      display: flex;
      gap: 10px;
      justify-content: center;
      margin-top: 20px;
      flex-wrap: wrap;
    }
    #error-banner .btn {
      background: #0e639c;
      color: #fff;
      border: none;
      border-radius: 3px;
      padding: 6px 16px;
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
    }
    #error-banner .btn:hover { background: #1177bb; }
    #error-banner .btn-secondary {
      background: #3c3c3c;
      color: #ccc;
    }
    #error-banner .btn-secondary:hover { background: #505050; }
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
    <div class="error-icon">⚠️</div>
    <h2>Helm Visualizer server is not running</h2>
    <p>
      The panel could not connect to <span class="url-display">${escapeHtml(appUrl)}</span>.
    </p>
    <div class="setup-box">
      <div class="step-label">How to start the server</div>
      <p style="margin:4px 0 6px;color:#bbb;font-size:12px;">
        Helm Visualizer server is not running. Start it with:
      </p>
      <code>cd &lt;project-dir&gt; &amp;&amp; npm run dev</code>
      <p style="margin:8px 0 4px;color:#888;font-size:11px;">
        then reload this panel.
      </p>
    </div>
    <div class="setup-box">
      <div class="step-label">Step-by-step</div>
      <p style="margin:4px 0;color:#bbb;font-size:12px;">1. Open a terminal in the Helm-Visualizer project directory</p>
      <code>cd Helm-Visualizer &amp;&amp; npm install &amp;&amp; npm run dev</code>
      <p style="margin:8px 0 4px;color:#bbb;font-size:12px;">2. Wait for <em>ready on http://localhost:3000</em>, then click <strong>Reload</strong> above.</p>
      <p style="margin:4px 0;color:#888;font-size:11px;">
        Using a different port? Update <code style="display:inline;border:none;background:none;padding:0;color:#ce9178;">helmVisualizer.appUrl</code> in VS Code Settings.
      </p>
    </div>
    <div class="actions">
      <button class="btn" id="error-reload-btn">↺ Retry</button>
      <button class="btn btn-secondary" id="error-browser-btn">Open in Browser ↗</button>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById('app-frame');
    const banner = document.getElementById('error-banner');
    const baseUrl = ${safeJsonUrl};

    function showError() {
      frame.style.display = 'none';
      banner.style.display = 'flex';
    }

    function hideError() {
      banner.style.display = 'none';
      frame.style.display = '';
    }

    // Reload using a cache-busting query parameter so the iframe always
    // re-fetches the page, regardless of same-origin restrictions.
    function reloadFrame() {
      const sep = baseUrl.includes('?') ? '&' : '?';
      frame.src = baseUrl + sep + '_t=' + Date.now();
      hideError();
      startLoadTimer();
    }

    document.getElementById('reload-btn').addEventListener('click', reloadFrame);
    document.getElementById('error-reload-btn').addEventListener('click', reloadFrame);

    document.getElementById('browser-btn').addEventListener('click', () => {
      vscode.postMessage({ command: 'openInBrowser' });
    });
    document.getElementById('error-browser-btn').addEventListener('click', () => {
      vscode.postMessage({ command: 'openInBrowser' });
    });

    // The iframe 'error' event does not fire for network / HTTP failures; use a
    // timed load check instead.  If the frame fires 'load' but its content is
    // inaccessible (cross-origin or blank), we show a helpful error banner.
    let loadTimer;

    function startLoadTimer() {
      clearTimeout(loadTimer);
      loadTimer = setTimeout(() => {
        // No 'load' event within 8 s — server likely not running.
        // Show the full error panel with server URL and startup instructions.
        showError();
        console.warn(
          '[Helm Visualizer] Could not reach ' + baseUrl + ' within 8 s. ' +
          'Make sure the server is running: cd <project-dir> && npm run dev'
        );
      }, 8000);
    }

    startLoadTimer();

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
        showError();
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
