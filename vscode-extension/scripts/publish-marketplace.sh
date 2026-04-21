#!/usr/bin/env bash
# publish-marketplace.sh
# Build the VSIX and publish it to the Visual Studio Marketplace.
#
# Usage:
#   cd vscode-extension
#   VSCE_PAT=<your-token> ./scripts/publish-marketplace.sh
#
# The Personal Access Token must be created in Azure DevOps with the
# "Marketplace (Publish)" scope for the "unrealandychan" publisher.
# See: https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$EXT_DIR"

# ── Validate PAT ────────────────────────────────────────────────────────────
if [[ -z "${VSCE_PAT:-}" ]]; then
  echo ""
  echo "ERROR: VSCE_PAT environment variable is not set."
  echo ""
  echo "  Create a Personal Access Token at https://dev.azure.com with the"
  echo "  'Marketplace (Publish)' scope, then run:"
  echo ""
  echo "    VSCE_PAT=<token> ./scripts/publish-marketplace.sh"
  echo ""
  exit 1
fi

echo "==> Installing dependencies..."
npm install

echo "==> Compiling TypeScript..."
npm run compile

echo "==> Packaging extension..."
npx @vscode/vsce package --no-yarn

VSIX_FILE=$(ls helm-visualizer-*.vsix 2>/dev/null | sort -V | tail -1)
echo "==> Packaged: $VSIX_FILE"

echo "==> Publishing to VS Marketplace..."
npx @vscode/vsce publish --pat "$VSCE_PAT" --no-yarn

echo ""
echo "✅ Published successfully."
echo "   View on the marketplace:"
echo "   https://marketplace.visualstudio.com/items?itemName=unrealandychan.helm-visualizer"
