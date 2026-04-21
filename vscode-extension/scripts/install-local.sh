#!/usr/bin/env bash
# install-local.sh
# Build the extension VSIX and install it into the local VS Code instance.
#
# Usage:
#   cd vscode-extension
#   ./scripts/install-local.sh
#
# Requirements:
#   - Node.js + npm (to compile and package the extension)
#   - VS Code CLI (`code`) available on PATH

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$EXT_DIR"

echo "==> Installing dependencies..."
npm install

echo "==> Compiling TypeScript..."
npm run compile

echo "==> Packaging extension..."
VSIX_FILE=$(npx @vscode/vsce package --no-yarn 2>&1 \
  | grep -oE '[^ ]+\.vsix' | tail -1)

if [[ -z "$VSIX_FILE" ]]; then
  echo "ERROR: Could not find generated .vsix file." >&2
  exit 1
fi

echo "==> Installing $VSIX_FILE into VS Code..."
if ! command -v code &>/dev/null; then
  echo ""
  echo "ERROR: 'code' CLI not found on PATH."
  echo "Install it from VS Code: Shift+Cmd+P / Shift+Ctrl+P → 'Shell Command: Install code in PATH'"
  echo ""
  echo "Alternatively install manually:"
  echo "  code --install-extension $EXT_DIR/$VSIX_FILE"
  exit 1
fi

code --install-extension "$EXT_DIR/$VSIX_FILE"

echo ""
echo "✅ Helm Visualizer extension installed successfully."
echo "   Reload VS Code (Ctrl+Shift+P → 'Developer: Reload Window') to activate."
