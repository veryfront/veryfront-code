#!/bin/sh

# Install Veryfront Git Hooks
#
# Run this script to install the pre-push hook:
#   ./scripts/hooks/install.sh

HOOKS_DIR="$(git rev-parse --git-dir)/hooks"
SCRIPT_DIR="$(dirname "$0")"

echo "Installing git hooks..."

# Install pre-push hook
cp "$SCRIPT_DIR/pre-push" "$HOOKS_DIR/pre-push"
chmod +x "$HOOKS_DIR/pre-push"

echo "Installed pre-push hook to $HOOKS_DIR/pre-push"
echo ""
echo "Git hooks installed successfully!"
echo ""
echo "The pre-push hook will run:"
echo "  1. deno task verify:quick (fmt, lint, typecheck)"
echo "  2. deno task test:e2e (E2E smoke tests)"
echo ""
echo "To skip E2E tests: SKIP_E2E=1 git push"
