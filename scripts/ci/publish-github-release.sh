#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 --repo <owner/repo> --tag <tag> --title <title> --notes <notes> [--prerelease] [--latest] -- <asset>..." >&2
}

require_value() {
  local option="$1"
  local value="${2:-}"
  if [[ -z "$value" ]]; then
    echo "::error::${option} requires a value." >&2
    usage
    exit 2
  fi
}

repo=""
tag=""
title=""
notes=""
prerelease=false
latest=false

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --repo)
      require_value "$1" "${2:-}"
      repo="$2"
      shift 2
      ;;
    --tag)
      require_value "$1" "${2:-}"
      tag="$2"
      shift 2
      ;;
    --title)
      require_value "$1" "${2:-}"
      title="$2"
      shift 2
      ;;
    --notes)
      require_value "$1" "${2:-}"
      notes="$2"
      shift 2
      ;;
    --prerelease)
      prerelease=true
      shift
      ;;
    --latest)
      latest=true
      shift
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "::error::Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

require_value "--repo" "$repo"
require_value "--tag" "$tag"
require_value "--title" "$title"
require_value "--notes" "$notes"

if [[ "$prerelease" == true && "$latest" == true ]]; then
  echo "::error::A release cannot be both a prerelease and the latest release." >&2
  exit 2
fi

assets=("$@")
if [[ "${#assets[@]}" -eq 0 ]]; then
  echo "::error::At least one release asset is required." >&2
  exit 2
fi
for asset in "${assets[@]}"; do
  if [[ ! -f "$asset" ]]; then
    echo "::error::Release asset does not exist: $asset" >&2
    exit 2
  fi
done

retry_attempts="${GH_RELEASE_RETRY_ATTEMPTS:-3}"
retry_delay_seconds="${GH_RELEASE_RETRY_DELAY_SECONDS:-10}"
retry_fatal_status=64
if ! [[ "$retry_attempts" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::GH_RELEASE_RETRY_ATTEMPTS must be a positive integer." >&2
  exit 2
fi
if ! [[ "$retry_delay_seconds" =~ ^[0-9]+$ ]]; then
  echo "::error::GH_RELEASE_RETRY_DELAY_SECONDS must be a non-negative integer." >&2
  exit 2
fi

run_with_retry() {
  local description="$1"
  shift
  local fatal_status=""
  if [[ "${1:-}" == "--fatal-status" ]]; then
    fatal_status="$2"
    shift 2
  fi
  local attempt=1
  local status

  while true; do
    if "$@"; then
      return 0
    else
      status="$?"
    fi
    if [[ -n "$fatal_status" && "$status" -eq "$fatal_status" ]]; then
      return 1
    fi
    if [[ "$attempt" -ge "$retry_attempts" ]]; then
      echo "::error::${description} failed after ${retry_attempts} attempts." >&2
      return 1
    fi

    echo "::warning::${description} failed on attempt ${attempt}/${retry_attempts}. Retrying." >&2
    if [[ "$retry_delay_seconds" -gt 0 ]]; then
      sleep "$((retry_delay_seconds * attempt))"
    fi
    attempt=$((attempt + 1))
  done
}

delete_release() {
  gh release delete "$tag" --repo "$repo" --yes --cleanup-tag >/dev/null 2>&1 || true
}

create_draft_release() {
  local existing_is_draft
  if existing_is_draft="$(
    gh release view "$tag" --repo "$repo" --json isDraft --jq '.isDraft' 2>/dev/null
  )"; then
    if [[ "$existing_is_draft" == true ]]; then
      echo "::warning::Reusing existing GitHub release draft ${tag}." >&2
      return 0
    fi

    echo "::error::GitHub release ${tag} already exists and is not a draft." >&2
    return "$retry_fatal_status"
  fi

  local create_args=(
    release create "$tag"
    --repo "$repo"
    --title "$title"
    --draft
    --notes "$notes"
  )
  if [[ "$prerelease" == true ]]; then
    create_args+=(--prerelease)
  fi

  gh "${create_args[@]}"
}

incomplete_draft_created=false
cleanup_failed_release() {
  local status="$?"
  trap - EXIT
  if [[ "$status" -ne 0 && "$incomplete_draft_created" == true ]]; then
    echo "::warning::Removing incomplete GitHub release ${tag}." >&2
    delete_release
  fi
  exit "$status"
}
trap cleanup_failed_release EXIT

run_with_retry \
  "GitHub release draft creation" \
  --fatal-status "$retry_fatal_status" \
  create_draft_release
incomplete_draft_created=true

for asset in "${assets[@]}"; do
  run_with_retry \
    "GitHub release asset $(basename "$asset") upload" \
    gh release upload "$tag" "$asset" --repo "$repo" --clobber
done
incomplete_draft_created=false

publish_args=(release edit "$tag" --repo "$repo" --draft=false)
if [[ "$prerelease" == true ]]; then
  publish_args+=(--prerelease --latest=false)
elif [[ "$latest" == true ]]; then
  publish_args+=(--prerelease=false --latest)
fi
run_with_retry "GitHub release publication" gh "${publish_args[@]}"

trap - EXIT
