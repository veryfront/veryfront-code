#!/usr/bin/env bash
set -euo pipefail

binary="${1:?usage: smoke-proxy-binary.sh <binary> [base_port]}"
base_port="${2:-18080}"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/veryfront-proxy-smoke.XXXXXX")"
proxy_pid=""
max_binary_bytes="${PROXY_BINARY_MAX_BYTES:-188743680}"

cleanup() {
  if [ -n "$proxy_pid" ]; then
    kill "$proxy_pid" 2>/dev/null || true
    wait "$proxy_pid" 2>/dev/null || true
  fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

actual_binary_bytes="$(wc -c < "$binary" | tr -d '[:space:]')"
if [ "$actual_binary_bytes" -gt "$max_binary_bytes" ]; then
  echo "proxy binary size ${actual_binary_bytes} exceeds ${max_binary_bytes} bytes" >&2
  exit 1
fi

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
    if curl --connect-timeout 1 --max-time 2 -fsS "http://127.0.0.1:${port}/_proxy/health" 2>/dev/null \
      | grep -Fq '"status":"ok"'; then
      if [ -n "$expected_log" ]; then
        if ! grep -Fq "$expected_log" "$log_file"; then
          sleep 1
          continue
        fi
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
run_smoke ambient-redis "$((base_port + 2))" "[ext-redis] RedisRuntimeProvider registered" \
  CACHE_TYPE=memory REDIS_URL=redis://127.0.0.1:1
run_smoke otel "$((base_port + 3))" "[otel] Initialized" \
  CACHE_TYPE=memory \
  OTEL_TRACES_ENABLED=true \
  OTEL_TRACES_EXPORTER=otlp \
  OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
run_smoke sentry "$((base_port + 4))" "" \
  CACHE_TYPE=memory \
  VERYFRONT_ERROR_REPORTER=sentry \
  SENTRY_ENABLED=true \
  SENTRY_DSN=https://public@example.com/1
