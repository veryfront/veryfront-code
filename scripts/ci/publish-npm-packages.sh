#!/usr/bin/env bash
# Publish the veryfront npm packages (root `veryfront` plus every
# @veryfront/ext-* extension package) from CI.
#
# Usage:
#   scripts/ci/publish-npm-packages.sh <mode>
#
# Modes:
#   rc-publish       Version-bump the `deno task build:npm` output to $VERSION
#                    and publish every package with `--tag rc`, skipping
#                    packages already published at $VERSION.
#                    Requires: VERSION.
#   preflight        Runs BEFORE the build: enumerate package names from the
#                    deno.json workspace and fail if any name@$VERSION already
#                    exists on npm for a different commit than $GITHUB_SHA.
#                    Requires: VERSION, GITHUB_SHA.
#   release-publish  Version-bump the `deno task build:npm` output to $VERSION,
#                    publish every package to the latest tag with provenance
#                    (skipping packages already published for this commit), and
#                    verify each published package's gitHead matches
#                    $GITHUB_SHA. Requires: VERSION, GITHUB_SHA.
set -euo pipefail

usage() {
  echo "Usage: $0 <rc-publish|preflight|release-publish>" >&2
  exit 2
}

require_env() {
  for NAME in "$@"; do
    if [ -z "${!NAME:-}" ]; then
      echo "::error::${NAME} must be set for this mode." >&2
      exit 1
    fi
  done
}

# Package directories in dependency order for publish modes. The root package
# pins auto-loaded extensions to the same version, so publish it last.
package_dirs() {
  find npm/extensions -mindepth 1 -maxdepth 1 -type d | sort | while read -r PACKAGE_DIR; do
    if [ "$(jq -r '.veryfront.npm.publish == false' "${PACKAGE_DIR}/package.json")" = "true" ]; then
      PACKAGE_NAME="$(jq -r '.name' "${PACKAGE_DIR}/package.json")"
      echo "::notice::${PACKAGE_NAME} is marked veryfront.npm.publish=false; skipping npm publish" >&2
      continue
    fi
    printf '%s\n' "${PACKAGE_DIR}"
  done
  printf '%s\n' npm
}

# Package names derived from the deno.json workspace (preflight runs before
# the build, so the npm output does not exist yet).
package_names_from_workspace() {
  printf '%s\n' veryfront
  jq -r '.workspace[] | select(startswith("./extensions/")) | .[2:] + "/deno.json"' deno.json \
    | while read -r MANIFEST_PATH; do
      if [ "$(jq -r '.veryfront.npm.publish == false' "${MANIFEST_PATH}")" = "true" ]; then
        continue
      fi
      jq -r '.name' "${MANIFEST_PATH}"
    done \
    | sort
}

update_package_version() {
  PACKAGE_DIR="$1"
  jq --arg v "$VERSION" '
    def update_first_party_extension_deps:
      if .dependencies then
        .dependencies |= with_entries(
          if (.key | startswith("@veryfront/ext-")) then .value = $v else . end
        )
      else . end;

    .version = $v
    | if .peerDependencies?.veryfront then .peerDependencies.veryfront = "^" + $v else . end
    | if .dependencies?.veryfront then .dependencies.veryfront = "^" + $v else . end
    | update_first_party_extension_deps
  ' "${PACKAGE_DIR}/package.json" > "${PACKAGE_DIR}/package.json.tmp"
  mv "${PACKAGE_DIR}/package.json.tmp" "${PACKAGE_DIR}/package.json"
}

# Poll the npm registry until PACKAGE_NAME@VERSION reports a gitHead. Succeeds
# only when that gitHead matches GITHUB_SHA. Leaves the last observed value in
# the global PUBLISHED_GIT_HEAD for callers' error messages.
wait_for_npm_git_head() {
  PACKAGE_NAME="$1"
  for attempt in $(seq 1 24); do
    PUBLISHED_GIT_HEAD="$(npm view "${PACKAGE_NAME}@${VERSION}" gitHead 2>/dev/null || true)"
    if [ "${PUBLISHED_GIT_HEAD}" = "${GITHUB_SHA}" ]; then
      return 0
    fi
    if [ -n "${PUBLISHED_GIT_HEAD}" ]; then
      return 1
    fi
    echo "Waiting for npm registry metadata for ${PACKAGE_NAME}@${VERSION} (attempt ${attempt}/24)."
    sleep 5
  done

  PUBLISHED_GIT_HEAD="$(npm view "${PACKAGE_NAME}@${VERSION}" gitHead 2>/dev/null || true)"
  [ "${PUBLISHED_GIT_HEAD}" = "${GITHUB_SHA}" ]
}

rc_publish_package_dir() {
  PACKAGE_DIR="$1"
  PACKAGE_NAME="$(jq -r '.name' "${PACKAGE_DIR}/package.json")"
  if npm view "${PACKAGE_NAME}@${VERSION}" version 2>/dev/null; then
    echo "::notice::${PACKAGE_NAME}@${VERSION} already published to npm; skipping publish"
    return 0
  fi

  echo "Publishing ${PACKAGE_NAME}@${VERSION} with rc tag"
  (cd "${PACKAGE_DIR}" && npm publish --provenance --access public --tag rc)
}

release_publish_package_dir() {
  PACKAGE_DIR="$1"
  PACKAGE_NAME="$(jq -r '.name' "${PACKAGE_DIR}/package.json")"
  PUBLISHED_GIT_HEAD="$(npm view "${PACKAGE_NAME}@${VERSION}" gitHead 2>/dev/null || true)"
  if [ "${PUBLISHED_GIT_HEAD}" = "${GITHUB_SHA}" ]; then
    echo "${PACKAGE_NAME}@${VERSION} is already published for this commit; skipping npm publish."
  else
    echo "Publishing ${PACKAGE_NAME}@${VERSION}"
    set +e
    PUBLISH_OUTPUT="$(cd "${PACKAGE_DIR}" && npm publish --provenance --access public 2>&1)"
    PUBLISH_STATUS=$?
    set -e
    printf '%s\n' "${PUBLISH_OUTPUT}"

    if [ "${PUBLISH_STATUS}" -ne 0 ]; then
      if printf '%s\n' "${PUBLISH_OUTPUT}" | grep -Fq "previously published versions: ${VERSION}" \
        && wait_for_npm_git_head "${PACKAGE_NAME}"; then
        echo "npm reports ${PACKAGE_NAME}@${VERSION} already exists, and gitHead matches this commit; continuing."
      else
        exit "${PUBLISH_STATUS}"
      fi
    fi
  fi

  if ! wait_for_npm_git_head "${PACKAGE_NAME}"; then
    echo "::error::Published ${PACKAGE_NAME}@${VERSION} gitHead is ${PUBLISHED_GIT_HEAD}, expected ${GITHUB_SHA}."
    exit 1
  fi
}

run_rc_publish() {
  require_env VERSION

  for PACKAGE_DIR in $(package_dirs); do
    update_package_version "${PACKAGE_DIR}"
  done

  for PACKAGE_DIR in $(package_dirs); do
    rc_publish_package_dir "${PACKAGE_DIR}"
  done
}

run_preflight() {
  require_env VERSION GITHUB_SHA

  for PACKAGE_NAME in $(package_names_from_workspace); do
    if npm view "${PACKAGE_NAME}@${VERSION}" version 2>/dev/null; then
      if ! wait_for_npm_git_head "${PACKAGE_NAME}"; then
        echo "::error::${PACKAGE_NAME}@${VERSION} already exists on npm for ${PUBLISHED_GIT_HEAD}. Bump deno.json before releasing."
        exit 1
      fi
      echo "${PACKAGE_NAME}@${VERSION} already exists on npm for this commit; continuing release metadata."
    fi
  done
}

run_release_publish() {
  require_env VERSION GITHUB_SHA

  for PACKAGE_DIR in $(package_dirs); do
    update_package_version "${PACKAGE_DIR}"
  done

  for PACKAGE_DIR in $(package_dirs); do
    release_publish_package_dir "${PACKAGE_DIR}"
  done
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  MODE="${1:-}"
  case "${MODE}" in
    rc-publish) run_rc_publish ;;
    preflight) run_preflight ;;
    release-publish) run_release_publish ;;
    *) usage ;;
  esac
fi
