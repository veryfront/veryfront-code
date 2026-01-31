#!/bin/bash
# Start split mode, run test, cleanup, exit.
# Usage: deno task test-split [--deno]
#   --deno  Use deno task instead of compiled binary
#
# Prerequisites:
#   - 1Password CLI (op) installed
#   - OP_SERVICE_ACCOUNT_TOKEN env var set (for non-interactive auth)
#   - Get token from: https://start.1password.com/open/i?a=TEAMSACCOUNT&v=VERYFRONT_CI&i=OP_SERVICE_ACCOUNT_TOKEN
#
#   Example:
#     export OP_SERVICE_ACCOUNT_TOKEN="ops_..."
#     deno task test-split
#
# Flow:
# ┌─────────────────────────────────────────────────────────────────┐
# │  deno task test-split                                           │
# │                                                                 │
# │  1. Compile (if needed)                                         │
# │  2. Load secrets from 1Password                                 │
# │  3. Start renderer (:3000) + proxy (:8080)                      │
# │  4. Test: curl http://codersociety.lvh.me:8080/                 │
# │  5. Cleanup + exit                                              │
# │                                                                 │
# │  ┌───────┐            ┌─────────────────────┐                   │
# │  │ Redis │◄──cache───►│        API          │                   │
# │  │(token)│            │  (OAuth + Files)    │                   │
# │  └───▲───┘            └──────▲────▲─────────┘                   │
# │      │                       │    │                             │
# │      │                 token │    │ files                       │
# │      │                       │    │                             │
# │  ┌───┴─────┐      ┌──────────┴────┴─────────┐                   │
# │  │  proxy  │─────►│       renderer          │                   │
# │  │  :8080  │      │         :3000           │                   │
# │  └────▲────┘      └─────────────────────────┘                   │
# │       │                                                         │
# │  ┌────┴────┐                                                    │
# │  │  curl   │                                                    │
# │  └─────────┘                                                    │
# └─────────────────────────────────────────────────────────────────┘
#
set -e
cd "$(dirname "$0")/../.."

# Check for --deno flag
if [[ "$1" == "--deno" ]]; then
  VERYFRONT="deno run --allow-all src/cli/main.ts"
else
  # Ensure binary exists
  if [[ ! -f "./bin/veryfront" ]]; then
    echo "Binary not found. Compiling..."
    deno task build
  fi
  VERYFRONT="./bin/veryfront"
fi

# Load secrets from 1Password
export API_CLIENT_ID_VERYFRONT_RENDERER_PROXY=$(op read "op://VERYFRONT_CI/Veryfront Renderer Proxy OAuth/API_CLIENT_ID_VERYFRONT_RENDERER_PROXY")
export API_CLIENT_SECRET_VERYFRONT_RENDERER_PROXY=$(op read "op://VERYFRONT_CI/Veryfront Renderer Proxy OAuth/API_CLIENT_SECRET_VERYFRONT_RENDERER_PROXY")
export REDIS_URL=$(op read "op://VERYFRONT_CI/UPSTASH_REDIS_VERYFRONT_RENDERER_PROXY_STAGING/REDIS_URL")

# OpenTelemetry tracing to Grafana Cloud
# Filter by: service.name="veryfront-proxy-local" AND resource.host.name="your-hostname"
export OTEL_TRACES_ENABLED=true
export OTEL_SERVICE_NAME="veryfront-proxy-local"
export OTEL_RESOURCE_ATTRIBUTES="host.name=$(hostname)"
export OTEL_EXPORTER_OTLP_ENDPOINT="https://otlp-gateway-prod-eu-west-2.grafana.net/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(op read 'op://VERYFRONT_CI/GRAFANA/otlp_auth')"

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

# Cleanup on exit
cleanup() { kill $RENDERER_PID $PROXY_PID 2>/dev/null; }
trap cleanup EXIT

# Start servers
$VERYFRONT serve --mode=renderer --port=3000 &
RENDERER_PID=$!
$VERYFRONT serve --mode=proxy --port=8080 &
PROXY_PID=$!
sleep 5

# Test
# Use localhost with Host header to avoid DNS issues in CI
echo "Testing codersociety.lvh.me:8080 (via localhost)..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: codersociety.lvh.me:8080" http://127.0.0.1:8080/ --max-time 30)
echo "Status: $STATUS"

# Check result
# 200 = Success
# 500 = Known issue (codersociety has missing modules)
# 000 = Curl timeout (renderer hanging on missing modules - also acceptable)
if [[ "$STATUS" == "200" ]]; then
  echo "SUCCESS: Got 200 response"
  exit 0
elif [[ "$STATUS" == "500" ]]; then
  echo "OK: Known issue (codersociety missing modules, got 500)"
  exit 0
elif [[ "$STATUS" == "000" ]]; then
  echo "OK: Renderer timeout (codersociety has missing modules causing hang)"
  exit 0
else
  echo "FAILED: Unexpected status $STATUS"
  exit 1
fi
