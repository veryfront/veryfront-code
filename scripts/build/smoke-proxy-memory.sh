#!/usr/bin/env bash
set -euo pipefail

binary="${1:?usage: smoke-proxy-memory.sh <binary> [base-port]}"
base_port="${2:-18180}"
memory_limit="${PROXY_MEMORY_LIMIT:-1536m}"
attempts="${PROXY_MEMORY_ATTEMPTS:-3}"
container_image="${PROXY_MEMORY_IMAGE:-debian:trixie-slim}"
container_platform="${PROXY_MEMORY_PLATFORM:-}"
health_path="/_proxy/health"
container=""
platform_args=()

if [ -n "$container_platform" ]; then
  platform_args=(--platform "$container_platform")
fi

if [ ! -f "$binary" ]; then
  echo "proxy binary not found: $binary" >&2
  exit 1
fi

if ! [[ "$attempts" =~ ^[1-9][0-9]*$ ]]; then
  echo "PROXY_MEMORY_ATTEMPTS must be a positive integer" >&2
  exit 1
fi

binary_dir="$(cd "$(dirname "$binary")" && pwd)"
binary_name="$(basename "$binary")"

cleanup() {
  if [ -n "$container" ]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for ((attempt = 1; attempt <= attempts; attempt++)); do
  port=$((base_port + attempt - 1))
  container="veryfront-proxy-memory-${RANDOM}-$$-${attempt}"

  docker run --detach \
    "${platform_args[@]}" \
    --name "$container" \
    --memory "$memory_limit" \
    --publish "127.0.0.1:${port}:${port}" \
    --volume "${binary_dir}/${binary_name}:/usr/local/bin/veryfront-proxy:ro" \
    --env CACHE_TYPE=memory \
    --env HOME=/tmp \
    --env HOST=0.0.0.0 \
    --env NODE_ENV=development \
    --env PORT="$port" \
    --entrypoint /usr/local/bin/veryfront-proxy \
    "$container_image" >/dev/null

  ready=false
  for ((probe = 1; probe <= 60; probe++)); do
    if curl --connect-timeout 1 --max-time 2 -fsS \
      "http://127.0.0.1:${port}${health_path}" 2>/dev/null \
      | grep -Fq '"status":"ok"'; then
      ready=true
      break
    fi

    if [ "$(docker inspect --format '{{.State.Running}}' "$container")" != "true" ]; then
      break
    fi
    sleep 1
  done

  read -r oom_killed exit_code < <(
    docker inspect --format '{{.State.OOMKilled}} {{.State.ExitCode}}' "$container"
  )

  if [ "$ready" != "true" ]; then
    docker logs "$container" >&2 || true
    echo "proxy memory smoke attempt ${attempt} failed before health; OOMKilled=${oom_killed}, exit=${exit_code}" >&2
    exit 1
  fi

  if [ "$oom_killed" != "false" ]; then
    docker logs "$container" >&2 || true
    echo "proxy memory smoke attempt ${attempt} was OOM killed" >&2
    exit 1
  fi

  docker stop --time 5 "$container" >/dev/null
  read -r oom_killed exit_code < <(
    docker inspect --format '{{.State.OOMKilled}} {{.State.ExitCode}}' "$container"
  )
  if [ "$oom_killed" != "false" ] || [ "$exit_code" != "0" ]; then
    docker logs "$container" >&2 || true
    echo "proxy memory smoke attempt ${attempt} did not stop cleanly; OOMKilled=${oom_killed}, exit=${exit_code}" >&2
    exit 1
  fi

  docker rm "$container" >/dev/null
  container=""
  echo "proxy memory smoke attempt ${attempt}/${attempts} passed (${memory_limit}, OOMKilled=false)"
done
