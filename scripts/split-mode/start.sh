#!/bin/bash
# Start split mode for manual debugging - keeps running until interrupted.
# Usage: deno task start-split [--deno]
#   --deno  Use deno task instead of compiled binary
set -e
cd "$(dirname "$0")/../.."

# Check for --deno flag
if [[ "$1" == "--deno" ]]; then
  VERYFRONT="deno run --allow-all src/cli/main.ts"
else
  VERYFRONT="./bin/veryfront"
fi

# Load secrets from 1Password
export API_CLIENT_ID_VERYFRONT_RENDERER_PROXY=$(op read "op://VERYFRONT_CI/Veryfront Renderer Proxy OAuth/API_CLIENT_ID_VERYFRONT_RENDERER_PROXY")
export API_CLIENT_SECRET_VERYFRONT_RENDERER_PROXY=$(op read "op://VERYFRONT_CI/Veryfront Renderer Proxy OAuth/API_CLIENT_SECRET_VERYFRONT_RENDERER_PROXY")
export REDIS_URL=$(op read "op://VERYFRONT_CI/UPSTASH_REDIS_VERYFRONT_RENDERER_PROXY_STAGING/REDIS_URL")

# Match production env vars exactly
export VERYFRONT_API_BASE_URL="https://api.veryfront.com"
export RENDERER_URL="http://localhost:3000"
export CACHE_TYPE="redis"
export REDIS_PREFIX="vf:token:"
export RENDERER_REQUEST_TIMEOUT_MS=90000
export NODE_ENV=production
export PROXY_MODE=1
export PRODUCTION_MODE=1
export SSR_REDIS_CACHE_ENABLED=true
export PROJECT_MAX_CONCURRENT=1000
export PROJECT_CIRCUIT_THRESHOLD=20
export PROJECT_CIRCUIT_RESET_MS=15000

# Use split-mode config
export VERYFRONT_CONFIG="scripts/split-mode/veryfront.config.mjs"

cleanup() { kill $RENDERER_PID 2>/dev/null; }
trap cleanup EXIT

# Start renderer, then proxy
$VERYFRONT serve --mode=renderer --port=3000 &
RENDERER_PID=$!
sleep 3
$VERYFRONT serve --mode=proxy --port=8080
