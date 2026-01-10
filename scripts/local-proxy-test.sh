#!/bin/bash
#
# Local Proxy Mode Testing Script
#
# This script starts both the renderer and proxy locally in proxy mode,
# allowing you to test custom domain rendering (e.g., codersociety.com).
#
# Usage:
#   ./scripts/local-proxy-test.sh
#
# Then in another terminal:
#   curl -H "Host: codersociety.com" http://localhost:8080/
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load environment variables from .env.local
if [ -f "$PROJECT_DIR/.env.local" ]; then
  echo "[Setup] Loading .env.local..."
  set -a
  source "$PROJECT_DIR/.env.local"
  set +a
else
  echo "[Error] .env.local not found. Please create it with OAuth credentials."
  echo "See .claude/incidents/2025-01-03-custom-domain-projectid-missing.md for details."
  exit 1
fi

# Cleanup function
cleanup() {
  echo ""
  echo "[Cleanup] Stopping processes..."
  kill $RENDERER_PID 2>/dev/null || true
  kill $PROXY_PID 2>/dev/null || true
  echo "[Cleanup] Done."
}

trap cleanup EXIT INT TERM

# Start renderer in proxy mode (background)
echo "[Renderer] Starting on port ${RENDERER_PORT:-3001}..."
cd "$PROJECT_DIR"

# Create a temporary veryfront.config.ts for proxy mode
cat > /tmp/veryfront.config.ts << 'EOF'
import type { VeryfrontConfig } from "./src/core/config/types.ts";

const config: VeryfrontConfig = {
  fs: {
    type: "veryfront-api",
    veryfront: {
      proxyMode: true,
      apiBaseUrl: Deno.env.get("VERYFRONT_API_BASE_URL") || "https://api.veryfront.com",
      apiToken: "",  // Token provided per-request via x-token header
    },
  },
};

export default config;
EOF

PORT=${RENDERER_PORT:-3001} deno run --allow-all --no-lock --unstable-net --unstable-worker-options \
  --config "$PROJECT_DIR/deno.json" \
  "$PROJECT_DIR/src/server/production-server.ts" &
RENDERER_PID=$!
echo "[Renderer] Started with PID $RENDERER_PID"

# Wait for renderer to be ready
echo "[Renderer] Waiting for renderer to be ready..."
for i in {1..30}; do
  if curl -s http://localhost:${RENDERER_PORT:-3001}/_veryfront/health > /dev/null 2>&1; then
    echo "[Renderer] Ready!"
    break
  fi
  sleep 1
done

# Start proxy (foreground)
echo "[Proxy] Starting on port ${PORT:-8080}..."
PORT=${PORT:-8080} RENDERER_URL=http://localhost:${RENDERER_PORT:-3001} \
  deno run --allow-all --no-lock "$PROJECT_DIR/proxy/main.ts"
