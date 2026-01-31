#!/bin/bash
# Start split mode for manual debugging - keeps running until interrupted.
# Usage: deno task start-split [--deno]
#   --deno  Use deno task instead of compiled binary
#
# Prerequisites:
#   - 1Password CLI (op) installed
#   - OP_SERVICE_ACCOUNT_TOKEN env var set (for non-interactive auth)
#   - Get token from: https://start.1password.com/open/i?a=TEAMSACCOUNT&v=VERYFRONT_CI&i=OP_SERVICE_ACCOUNT_TOKEN
#
#   Example:
#     export OP_SERVICE_ACCOUNT_TOKEN="ops_..."
#     deno task start-split
#
# Architecture:
# ┌─────────────────────────────────────────────────────────────────────┐
# │  deno task start-split                                              │
# │  ┌─────────────────┐                                                │
# │  │ 1. Compile      │  deno task build (if ./bin/veryfront missing) │
# │  └────────┬────────┘                                                │
# │           ▼                                                         │
# │  ┌─────────────────┐      ┌──────────────────────────────────────┐ │
# │  │ 2. Load secrets │ ───► │ 1Password (op read)                  │ │
# │  └────────┬────────┘      │ - OAuth credentials                  │ │
# │           │               │ - Redis URL                          │ │
# │           ▼               └──────────────────────────────────────┘ │
# │  ┌─────────────────┐      ┌──────────────────────────────────────┐ │
# │  │ 3. Set env vars │ ───► │ VERYFRONT_CONFIG=split-mode/config   │ │
# │  └────────┬────────┘      │ PROXY_MODE=1, PRODUCTION_MODE=1      │ │
# │           │               └──────────────────────────────────────┘ │
# │           ▼                                                         │
# │  ┌─────────────────────────────────────────────────────────────┐   │
# │  │ 4. Start servers                                            │   │
# │  │                                                             │   │
# │  │   ./bin/veryfront serve --mode=renderer --port=3000         │   │
# │  │   ./bin/veryfront serve --mode=proxy --port=8080            │   │
# │  │                                                             │   │
# │  │   ┌───────┐          ┌─────────────────────┐                │   │
# │  │   │ Redis │◄─cache──►│        API          │                │   │
# │  │   │(token)│          │  (OAuth + Files)    │                │   │
# │  │   └───▲───┘          └──────▲────▲─────────┘                │   │
# │  │       │                     │    │                          │   │
# │  │       │               token │    │ files                    │   │
# │  │       │                     │    │                          │   │
# │  │   ┌───┴─────┐    ┌──────────┴────┴─────────┐                │   │
# │  │   │ proxy   │───►│       renderer          │                │   │
# │  │   │  :8080  │    │         :3000           │                │   │
# │  │   └────▲────┘    └─────────────────────────┘                │   │
# │  │        │                                                    │   │
# │  │   ┌────┴────┐                                               │   │
# │  │   │ Browser │                                               │   │
# │  │   └─────────┘                                               │   │
# │  └─────────────────────────────────────────────────────────────┘   │
# └─────────────────────────────────────────────────────────────────────┘
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
# Filter by: service.name="veryfront-proxy-local" AND host.name="your-hostname"
export OTEL_TRACES_ENABLED=true
export OTEL_SERVICE_NAME="veryfront-proxy-local"
export OTEL_RESOURCE_ATTRIBUTES="host.name=$(hostname)"
export OTEL_EXPORTER_OTLP_ENDPOINT=$(op read "op://VERYFRONT_CI/GRAFANA/tempo_url")
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(op read "op://VERYFRONT_CI/GRAFANA/otlp_auth")"

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
