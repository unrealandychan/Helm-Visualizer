#!/usr/bin/env bash
# =============================================================================
# helm viz — Helm CLI plugin
# Launches the Helm Chart Visualizer web UI for a given chart directory.
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve script / plugin directories (handles symlinks from helm plugin install)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Resolve symlink so we can find the app relative to the real source location
if command -v realpath &>/dev/null; then
  REAL_PLUGIN_DIR="$(realpath "$PLUGIN_DIR")"
elif command -v readlink &>/dev/null && readlink -f "$PLUGIN_DIR" &>/dev/null 2>&1; then
  REAL_PLUGIN_DIR="$(readlink -f "$PLUGIN_DIR")"
else
  REAL_PLUGIN_DIR="$PLUGIN_DIR"
fi

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
PORT="${HELM_VIZ_PORT:-3000}"
APP_URL=""          # set by --url; if empty, we manage the server
CHART_DIR=""        # chart directory (resolved below)
EXTRA_VALUES=""     # --values flag
NO_OPEN=false
APP_DIR=""          # Helm Visualizer Next.js app root

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
Launch the Helm Chart Visualizer web UI for a given chart directory.

Usage:
  helm viz [CHART_DIR] [flags]

Arguments:
  CHART_DIR   Path to the Helm chart directory (default: current directory)

Flags:
  -f, --values FILE   Additional values YAML file to merge
  -p, --port  PORT    Port for the local web server (default: 3000)
      --url   URL     Connect to an already-running Visualizer instead of
                      starting one (e.g. http://localhost:3000)
      --no-open       Do not open the browser automatically
  -h, --help          Show this help message

Environment variables:
  HELM_VISUALIZER_DIR   Absolute path to the Helm Visualizer app directory
                        (only needed when the plugin is not installed from
                        inside the cloned repository)
  HELM_VIZ_PORT         Port override (same as --port, default: 3000)

Examples:
  helm viz ./my-chart
  helm viz ./my-chart -f ./my-chart/values.prod.yaml
  helm viz --port 8080 ./my-chart
  helm viz --url http://localhost:3000 ./my-chart
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -p|--port)
      PORT="$2"
      shift 2
      ;;
    -f|--values)
      EXTRA_VALUES="$2"
      shift 2
      ;;
    --url)
      APP_URL="$2"
      shift 2
      ;;
    --no-open)
      NO_OPEN=true
      shift
      ;;
    -*)
      echo "Error: Unknown flag: $1" >&2
      echo "Run 'helm viz --help' for usage." >&2
      exit 1
      ;;
    *)
      if [[ -n "$CHART_DIR" ]]; then
        echo "Error: unexpected argument '$1' (chart directory already set to '$CHART_DIR')" >&2
        exit 1
      fi
      CHART_DIR="$1"
      shift
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Resolve chart directory
# ---------------------------------------------------------------------------
if [[ -z "$CHART_DIR" ]]; then
  CHART_DIR="$(pwd)"
fi

if [[ ! -d "$CHART_DIR" ]]; then
  echo "Error: chart directory not found: $CHART_DIR" >&2
  exit 1
fi

CHART_DIR="$(cd "$CHART_DIR" && pwd)"

if [[ ! -f "$CHART_DIR/Chart.yaml" ]]; then
  echo "Error: '$CHART_DIR' does not appear to be a Helm chart (missing Chart.yaml)." >&2
  exit 1
fi

# Resolve extra values file to absolute path if provided
if [[ -n "$EXTRA_VALUES" ]]; then
  if [[ ! -f "$EXTRA_VALUES" ]]; then
    echo "Error: values file not found: $EXTRA_VALUES" >&2
    exit 1
  fi
  EXTRA_VALUES="$(cd "$(dirname "$EXTRA_VALUES")" && pwd)/$(basename "$EXTRA_VALUES")"
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
is_server_running() {
  local url="${1:-http://localhost:${PORT}}"
  if ! command -v curl &>/dev/null; then
    echo "Warning: 'curl' is not installed — cannot verify server status." >&2
    return 1
  fi
  curl -sf "${url}/api/workspace-chart" --max-time 2 > /dev/null 2>&1
}

open_browser() {
  local target_url="$1"
  if [[ "$NO_OPEN" == "true" ]]; then
    return 0
  fi
  echo "==> Opening $target_url in your default browser..."
  if command -v xdg-open &>/dev/null; then
    xdg-open "$target_url" &
  elif command -v open &>/dev/null; then
    open "$target_url"
  else
    echo "    (Could not detect a browser opener — please visit the URL above manually.)"
  fi
}

find_app() {
  # 1. Explicit environment variable
  if [[ -n "${HELM_VISUALIZER_DIR:-}" ]]; then
    if [[ -f "$HELM_VISUALIZER_DIR/package.json" ]] \
       && grep -q '"helm-chart-visualizer"' "$HELM_VISUALIZER_DIR/package.json" 2>/dev/null; then
      APP_DIR="$HELM_VISUALIZER_DIR"
      return 0
    else
      echo "Warning: HELM_VISUALIZER_DIR is set to '$HELM_VISUALIZER_DIR' but does not" >&2
      echo "         look like a Helm Visualizer installation (missing package.json or" >&2
      echo "         wrong package name). Falling back to auto-detection." >&2
    fi
  fi

  # 2. Plugin installed from within the cloned repository.
  #    The plugin directory is helm-plugin/ and the app is one level up.
  local candidate
  candidate="$(cd "$REAL_PLUGIN_DIR/.." && pwd)"
  if [[ -f "$candidate/package.json" ]] \
     && grep -q '"helm-chart-visualizer"' "$candidate/package.json" 2>/dev/null; then
    APP_DIR="$candidate"
    return 0
  fi

  # 3. Common install locations
  for dir in \
    "$HOME/Helm-Visualizer" \
    "$HOME/helm-visualizer" \
    "$HOME/.helm-visualizer" \
    "/usr/local/helm-visualizer" \
    "/opt/helm-visualizer"; do
    if [[ -f "$dir/package.json" ]] \
       && grep -q '"helm-chart-visualizer"' "$dir/package.json" 2>/dev/null; then
      APP_DIR="$dir"
      return 0
    fi
  done

  return 1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo "==> Helm Chart Visualizer"
echo "    Chart : $CHART_DIR"
[[ -n "$EXTRA_VALUES" ]] && echo "    Values: $EXTRA_VALUES"

# If --url was provided, the user manages the server — just open the browser.
if [[ -n "$APP_URL" ]]; then
  if is_server_running "$APP_URL"; then
    echo "==> Visualizer already running at $APP_URL"
  else
    echo "Warning: could not reach $APP_URL — make sure the Helm Visualizer server is running." >&2
  fi
  open_browser "$APP_URL"
  exit 0
fi

TARGET_URL="http://localhost:${PORT}"

# If a server is already running on the configured port, reuse it.
if is_server_running "$TARGET_URL"; then
  echo "==> Visualizer already running at $TARGET_URL"
  echo "    Note: the running server may be serving a different chart."
  echo "    To start a fresh server for this chart, stop the existing one first"
  echo "    or use a different port with --port."
  open_browser "$TARGET_URL"
  exit 0
fi

# Find the Next.js app
if ! find_app; then
  cat >&2 <<EOF

Error: Could not find the Helm Visualizer application.

To fix this, either:

  A) Install the plugin from within the cloned repository:

       git clone https://github.com/unrealandychan/Helm-Visualizer
       cd Helm-Visualizer
       npm install
       helm plugin install ./helm-plugin

  B) Set HELM_VISUALIZER_DIR to the app's root directory:

       export HELM_VISUALIZER_DIR=/path/to/Helm-Visualizer
       helm viz ./my-chart

  C) If the Visualizer server is already running, use --url:

       helm viz --url http://localhost:3000 ./my-chart

EOF
  exit 1
fi

echo "==> Found Helm Visualizer at: $APP_DIR"
echo "==> Starting server on port $PORT..."

cd "$APP_DIR"

# Install dependencies if node_modules is missing
if [[ ! -d "node_modules" ]]; then
  echo "==> Installing Node.js dependencies (this may take a minute on first run)..."
  npm install
fi

# Export environment variables consumed by the Next.js server
export HELM_CHART_DIR="$CHART_DIR"
[[ -n "$EXTRA_VALUES" ]] && export HELM_VIZ_EXTRA_VALUES="$EXTRA_VALUES"
export PORT="$PORT"

# Start the dev server in the background, capturing its PID
npm run dev &
SERVER_PID=$!

# Clean up the background server and all its child processes when the script exits.
# npm run dev spawns Node.js as a child process, so we walk the process tree.
kill_tree() {
  local pid="$1"
  local children
  children="$(pgrep -P "$pid" 2>/dev/null || true)"
  for child in $children; do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    echo ""
    echo "==> Stopping Helm Visualizer server..."
    kill_tree "$SERVER_PID"
  fi
}
trap cleanup EXIT INT TERM

# Wait up to 30 seconds for the server to be ready
echo -n "==> Waiting for server"
for i in $(seq 1 30); do
  if is_server_running "$TARGET_URL"; then
    echo " ready!"
    break
  fi
  echo -n "."
  sleep 1
  if [[ $i -eq 30 ]]; then
    echo ""
    echo "Error: Timed out waiting for the Helm Visualizer server to start." >&2
    exit 1
  fi
done

open_browser "$TARGET_URL"

echo ""
echo "==> Helm Visualizer is running at $TARGET_URL"
echo "    Chart : $CHART_DIR"
[[ -n "$EXTRA_VALUES" ]] && echo "    Values: $EXTRA_VALUES"
echo ""
echo "    Press Ctrl+C to stop the server."
echo ""

# Keep the script alive so the background server continues running
wait "$SERVER_PID"
