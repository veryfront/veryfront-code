#!/usr/bin/env bash
set -euo pipefail

binary="${1:?usage: smoke-proxy-binary.sh <binary> [port]}"
base_port="${2:-18080}"
tmp_dir="$(mktemp -d)"
proxy_pid=""

cleanup() {
  if [ -n "$proxy_pid" ]; then
    kill "$proxy_pid" 2>/dev/null || true
    wait "$proxy_pid" 2>/dev/null || true
  fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

run_smoke() {
  local name="$1"
  local port="$2"
  local expected_log="$3"
  shift 3
  local log_file="${tmp_dir}/${name}.log"

  env PORT="$port" HOST=127.0.0.1 NODE_ENV=development "$@" \
    "$binary" >"$log_file" 2>&1 &
  proxy_pid=$!

  for _ in {1..30}; do
    if curl -fsS "http://127.0.0.1:${port}/_proxy/health" 2>/dev/null \
      | grep -Fq '"status":"ok"'; then
      if [ -n "$expected_log" ]; then
        grep -Fq "$expected_log" "$log_file"
      fi
      kill "$proxy_pid" 2>/dev/null || true
      wait "$proxy_pid" 2>/dev/null || true
      proxy_pid=""
      return 0
    fi
    sleep 1
  done

  cat "$log_file"
  return 1
}

run_smoke memory "$base_port" "" CACHE_TYPE=memory
run_smoke redis "$((base_port + 1))" "TokenCacheStore registered" \
  CACHE_TYPE=redis REDIS_URL=redis://127.0.0.1:1
run_smoke observability "$((base_port + 2))" "[otel] Initialized" \
  CACHE_TYPE=memory \
  OTEL_TRACES_ENABLED=true \
  OTEL_TRACES_EXPORTER=otlp \
  OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
  SENTRY_ENABLED=true \
  SENTRY_DSN=https://public@example.com/1
