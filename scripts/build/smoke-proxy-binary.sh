#!/usr/bin/env bash
set -euo pipefail

binary="${1:?usage: smoke-proxy-binary.sh <binary> [port]}"
port="${2:-18080}"
log_file="proxy-smoke.log"
proxy_pid=""

cleanup() {
  if [ -n "$proxy_pid" ]; then
    kill "$proxy_pid" 2>/dev/null || true
    wait "$proxy_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

PORT="$port" HOST=127.0.0.1 NODE_ENV=development CACHE_TYPE=memory \
  "$binary" >"$log_file" 2>&1 &
proxy_pid=$!

for _ in {1..30}; do
  if curl -fsS "http://127.0.0.1:${port}/_proxy/health" 2>/dev/null \
    | grep -Fq '"status":"ok"'; then
    exit 0
  fi
  sleep 1
done

cat "$log_file"
exit 1
