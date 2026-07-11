#!/usr/bin/env bash
set -euo pipefail

EVENT_NAME="${1:-}"
CURRENT_VERSION="${2:-}"
BEFORE="${3:-}"

if [[ -z "$EVENT_NAME" || -z "$CURRENT_VERSION" ]]; then
  echo "usage: stable-release-requested.sh <event-name> <current-version> [before-revision]" >&2
  exit 2
fi

STABLE_RELEASE_REQUESTED=false
if [[ "$EVENT_NAME" == "workflow_dispatch" ]]; then
  STABLE_RELEASE_REQUESTED=true
elif [[ "$EVENT_NAME" == "push" ]]; then
  if [[ -n "$BEFORE" ]] && git cat-file -e "${BEFORE}:deno.json" 2>/dev/null; then
    PREVIOUS_VERSION=$(git show "${BEFORE}:deno.json" | jq -r '.version')
    if [[ "$CURRENT_VERSION" != "$PREVIOUS_VERSION" ]]; then
      STABLE_RELEASE_REQUESTED=true
    fi
  else
    echo "::warning::Could not read deno.json at ${BEFORE}; preserving the collision-checked release path" >&2
    STABLE_RELEASE_REQUESTED=true
  fi
fi

printf '%s\n' "$STABLE_RELEASE_REQUESTED"
