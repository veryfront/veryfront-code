#!/bin/bash
# Quick debug script for production issues
# Usage: ./scripts/debug-production.sh <project-slug>

set -e

PROJECT_SLUG="${1:-}"
PORT="${2:-8080}"

if [ -z "$PROJECT_SLUG" ]; then
  echo "Usage: ./scripts/debug-production.sh <project-slug> [port]"
  echo ""
  echo "Examples:"
  echo "  ./scripts/debug-production.sh codersociety"
  echo "  ./scripts/debug-production.sh myproject 3000"
  exit 1
fi

echo "🔍 Debug mode for: $PROJECT_SLUG"
echo ""

# Check if deno is available
if ! command -v deno &> /dev/null; then
  echo "❌ deno not found. Install from https://deno.land"
  exit 1
fi

echo "1️⃣  Starting renderer with production cache..."
echo "   This reproduces cross-environment cache issues."
echo ""

# Export for subprocess
export VERYFRONT_API_BASE_URL="https://api.veryfront.com"
export PROXY_MODE=1
export DEBUG="vf:*"

echo "   Environment:"
echo "   - VERYFRONT_API_BASE_URL=$VERYFRONT_API_BASE_URL"
echo "   - PROXY_MODE=$PROXY_MODE"
echo "   - DEBUG=$DEBUG"
echo ""

echo "2️⃣  Server will start on port $PORT"
echo "   Open: http://$PROJECT_SLUG.veryfront.me:$PORT/"
echo ""

echo "3️⃣  Debug endpoints available:"
echo "   - http://localhost:$PORT/_vf_debug/context"
echo "   - http://localhost:$PORT/_vf_debug/cache"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Press Ctrl+C to stop"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Start the server
exec deno task start -p "$PORT"
