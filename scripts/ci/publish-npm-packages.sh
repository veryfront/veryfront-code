#!/usr/bin/env bash
# Publish the veryfront npm packages (root `veryfront` plus every
# @veryfront/ext-* extension package) from CI.
#
# Usage:
#   scripts/ci/publish-npm-packages.sh <mode>
#
# Modes:
#   rc-publish       Publish every verified tarball from $NPM_PACK_DIR with
#                    `--tag rc`, skipping packages already published at
#                    $VERSION. Requires: VERSION, GITHUB_SHA, NPM_PACK_DIR.
#   preflight        Runs BEFORE the build: enumerate package names from the
#                    deno.json workspace and fail if any name@$VERSION already
#                    exists on npm. Requires: VERSION.
#   release-publish  Publish every verified tarball from $NPM_PACK_DIR to the
#                    latest tag with provenance and verify each published
#                    package's gitHead matches $GITHUB_SHA. Conflict retries
#                    fail closed: a name@version that already exists on npm is
#                    never accepted as this workflow's publish. Requires:
#                    VERSION, GITHUB_SHA, NPM_PACK_DIR.
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
      jq -r '.veryfront.npm.runtimePackages[]?.name' "${MANIFEST_PATH}"
    done \
    | sort
}

update_package_version() {
  PACKAGE_DIR="$1"
  # CLI-only extensions ship as optional peers of the root package, so the
  # first-party pin has to cover peerDependencies too. Missing it would publish
  # an RC root pointing at a version that was never published, leaving the
  # optional peer permanently uninstallable.
  jq --arg v "$VERSION" '
    def update_first_party_extension_deps(section):
      if .[section] then
        .[section] |= with_entries(
          if (.key | startswith("@veryfront/ext-")) then .value = $v else . end
        )
      else . end;

    .version = $v
    | if .peerDependencies?.veryfront then .peerDependencies.veryfront = "^" + $v else . end
    | if .dependencies?.veryfront then .dependencies.veryfront = "^" + $v else . end
    | update_first_party_extension_deps("dependencies")
    | update_first_party_extension_deps("optionalDependencies")
    | update_first_party_extension_deps("peerDependencies")
  ' "${PACKAGE_DIR}/package.json" > "${PACKAGE_DIR}/package.json.tmp"
  mv "${PACKAGE_DIR}/package.json.tmp" "${PACKAGE_DIR}/package.json"
}

canonical_tarball_for_package_dir() {
  PACKAGE_DIR="$1"
  PACKAGE_NAME="$(jq -r '.name' "${PACKAGE_DIR}/package.json")"
  PACKAGE_FILE="$(
    jq -er --arg name "${PACKAGE_NAME}" --arg version "${VERSION}" '
      [.packages[] | select(.name == $name and .version == $version) | .file]
      | if length == 1 then .[0] else error("canonical package entry must be unique") end
    ' "${NPM_PACK_DIR}/manifest.json" 2>/dev/null
  )"
  case "${PACKAGE_FILE}" in
    ""|*/*|*\\*)
      echo "::error::Canonical artifact file for ${PACKAGE_NAME} is invalid." >&2
      return 1
      ;;
    *)
      ;;
  esac
  printf '%s/%s\n' "${NPM_PACK_DIR}" "${PACKAGE_FILE}"
}

verify_npm_compatibility_artifact() {
  if ! VERIFY_OUTPUT="$(deno run --config=scripts/test.deno.json --no-lock --allow-read --allow-run=tar \
    scripts/ci/npm-compatibility-artifact.ts verify "${NPM_PACK_DIR}" "${GITHUB_SHA}" \
    2>&1)"; then
    if [[ -n "${VERIFY_OUTPUT}" ]]; then
      printf '%s\n' "${VERIFY_OUTPUT}" >&2
    fi
    echo "::error::Canonical npm compatibility artifact verification failed." >&2
    return 1
  fi
}

# npm answers a burst of publishes with `409 Conflict - Failed to save
# packument`; the conflicting write sometimes still lands. The GitHub Actions
# OIDC endpoint that `--provenance` calls for each publish separately fails a
# single request under the same back-to-back loop (IDENTITY_TOKEN_READ_ERROR)
# without ever reaching the registry, so retrying it through this same loop is
# safe: the registry recheck below just reports the version still absent, and
# the publish is retried as if it were a fresh attempt.
NPM_PUBLISH_CONFLICT_ATTEMPTS="${NPM_PUBLISH_CONFLICT_ATTEMPTS:-5}"
NPM_PUBLISH_CONFLICT_DELAY_SECONDS="${NPM_PUBLISH_CONFLICT_DELAY_SECONDS:-15}"

is_transient_publish_failure() {
  CONFLICT_OUTPUT_CANDIDATE="$1"
  printf '%s\n' "${CONFLICT_OUTPUT_CANDIDATE}" \
    | grep -Eq 'npm error code E409|409 Conflict|Failed to save packument|IDENTITY_TOKEN_READ_ERROR'
}

is_identity_token_read_failure() {
  IDENTITY_OUTPUT_CANDIDATE="$1"
  printf '%s\n' "${IDENTITY_OUTPUT_CANDIDATE}" | grep -Fq 'IDENTITY_TOKEN_READ_ERROR'
}

# npm rejects a reused name/version with "You cannot publish over the
# previously published versions". That answer comes from the registry's write
# side, so it is authoritative that the version exists even while the read
# replica still reports it absent.
is_npm_version_already_published() {
  ALREADY_PUBLISHED_OUTPUT_CANDIDATE="$1"
  printf '%s\n' "${ALREADY_PUBLISHED_OUTPUT_CANDIDATE}" \
    | grep -Fq "previously published versions: ${VERSION}"
}

note_conflict_publish_landed() {
  echo "::notice::$1@${VERSION} landed despite an npm registry conflict; continuing."
}

# 0: landed for GITHUB_SHA. 1: exists but cannot match. 2: still absent.
inspect_publish_conflict_result() {
  CONFLICT_PACKAGE_NAME="$1"
  PUBLISHED_GIT_HEAD="$(npm view "${CONFLICT_PACKAGE_NAME}@${VERSION}" gitHead 2>/dev/null || true)"
  if [[ "${PUBLISHED_GIT_HEAD}" == "${GITHUB_SHA}" ]]; then
    note_conflict_publish_landed "${CONFLICT_PACKAGE_NAME}"
    return 0
  fi
  if [[ -n "${PUBLISHED_GIT_HEAD}" ]]; then
    echo "::error::${CONFLICT_PACKAGE_NAME}@${VERSION} exists with a different commit after a registry conflict." >&2
    return 1
  fi

  # npm can expose the immutable name@version before its gitHead metadata. A
  # visible version is pending, not absent: wait for its identity instead of
  # issuing a publish that npm must reject.
  if npm view "${CONFLICT_PACKAGE_NAME}@${VERSION}" version >/dev/null 2>&1; then
    if wait_for_npm_git_head "${CONFLICT_PACKAGE_NAME}"; then
      note_conflict_publish_landed "${CONFLICT_PACKAGE_NAME}"
      return 0
    fi
    if [[ -n "${PUBLISHED_GIT_HEAD}" ]]; then
      echo "::error::${CONFLICT_PACKAGE_NAME}@${VERSION} exists with a different commit after a registry conflict." >&2
    else
      echo "::error::${CONFLICT_PACKAGE_NAME}@${VERSION} exists after a registry conflict, but its gitHead metadata did not converge." >&2
    fi
    return 1
  fi
  return 2
}

# Fail-closed conflict inspection for stable releases. Registry metadata such
# as gitHead is attacker-controllable, so it can never prove that this
# workflow's write is what landed. Any evidence that name@VERSION exists after
# a conflict therefore fails the release instead of being recovered.
# 1: exists — fail closed. 2: still absent, retrying the publish is safe.
fail_closed_publish_conflict_result() {
  CONFLICT_PACKAGE_NAME="$1"
  if npm view "${CONFLICT_PACKAGE_NAME}@${VERSION}" version >/dev/null 2>&1; then
    echo "::error::${CONFLICT_PACKAGE_NAME}@${VERSION} exists on npm after a registry conflict. Stable releases fail closed: registry metadata cannot prove this workflow published it. Bump deno.json before releasing." >&2
    return 1
  fi
  return 2
}

# Dispatch conflict inspection for the retry loop by publish mode.
# 0: landed for GITHUB_SHA (recover mode only). 1: fail. 2: still absent.
resolve_publish_conflict() {
  case "${PUBLISH_RETRY_MODE}" in
    recover) inspect_publish_conflict_result "$1" ;;
    fail-closed) fail_closed_publish_conflict_result "$1" ;;
    *)
      echo "::error::Unknown npm publish retry mode \"${PUBLISH_RETRY_MODE}\"." >&2
      return 1
      ;;
  esac
}

# A conflicting write can land between the pre-retry registry check and the
# retry publish, which npm then rejects as an ordinary already-published error
# rather than a conflict. Only the registry can say whether the earlier
# conflict published this commit; the read replica can also lag behind the
# write, so an authoritative already-exists answer falls back to the bounded
# gitHead poll instead of trusting one absent lookup.
# 0: recovered for GITHUB_SHA. 1: not recovered.
recover_publish_rejection_after_conflict() {
  REJECTED_PACKAGE_NAME="$1"
  REJECTED_PUBLISH_OUTPUT="$2"
  if inspect_publish_conflict_result "${REJECTED_PACKAGE_NAME}"; then
    return 0
  fi
  if ! is_npm_version_already_published "${REJECTED_PUBLISH_OUTPUT}"; then
    return 1
  fi
  if wait_for_npm_git_head "${REJECTED_PACKAGE_NAME}"; then
    note_conflict_publish_landed "${REJECTED_PACKAGE_NAME}"
    return 0
  fi
  echo "::error::${REJECTED_PACKAGE_NAME}@${VERSION} already exists after a registry conflict, but its gitHead is \"${PUBLISHED_GIT_HEAD}\" instead of ${GITHUB_SHA}." >&2
  return 1
}

# Never toggles errexit: `set -e` is process-global, so flipping it here would
# clobber a caller that disabled it to capture this helper's status.
#
# The first argument selects the retry mode: "recover" (RC builds) may accept
# a conflicted publish once the registry attributes name@VERSION to
# GITHUB_SHA, while "fail-closed" (stable releases) never treats registry
# metadata as proof that this workflow published the package.
publish_npm_package_with_retry() {
  PUBLISH_RETRY_MODE="$1"
  PUBLISH_PACKAGE_NAME="$2"
  PUBLISH_SPEC="$3"
  shift 3
  PUBLISH_SAW_REGISTRY_CONFLICT=0
  for PUBLISH_ATTEMPT in $(seq 1 "${NPM_PUBLISH_CONFLICT_ATTEMPTS}"); do
    if [[ "${PUBLISH_ATTEMPT}" -gt 1 ]]; then
      # npm refuses to reuse a published name/version, so a write that landed
      # during the delay must be caught before republishing.
      resolve_publish_conflict "${PUBLISH_PACKAGE_NAME}" \
        && PUBLISH_CONFLICT_STATE=0 || PUBLISH_CONFLICT_STATE=$?
      if [[ "${PUBLISH_CONFLICT_STATE}" -ne 2 ]]; then
        return "${PUBLISH_CONFLICT_STATE}"
      fi
    fi

    PUBLISH_OUTPUT="$(npm publish "${PUBLISH_SPEC}" "$@" 2>&1)" \
      && PUBLISH_STATUS=0 || PUBLISH_STATUS=$?
    SANITIZED_PUBLISH_OUTPUT="$(sanitize_npm_lookup_output "${PUBLISH_OUTPUT}")"
    if [[ -n "${SANITIZED_PUBLISH_OUTPUT}" ]]; then
      printf '%s\n' "${SANITIZED_PUBLISH_OUTPUT}"
    fi
    if [[ "${PUBLISH_STATUS}" -eq 0 ]]; then
      return 0
    fi
    if ! is_transient_publish_failure "${PUBLISH_OUTPUT}"; then
      # Only the recover mode may reinterpret an already-published rejection
      # that races an earlier conflict; the fail-closed mode reports npm's
      # rejection as-is so an existing version always fails the release.
      if [[ "${PUBLISH_SAW_REGISTRY_CONFLICT}" -eq 1 && "${PUBLISH_RETRY_MODE}" == "recover" ]] \
        && recover_publish_rejection_after_conflict "${PUBLISH_PACKAGE_NAME}" "${PUBLISH_OUTPUT}"; then
        return 0
      fi
      return "${PUBLISH_STATUS}"
    fi
    if ! is_identity_token_read_failure "${PUBLISH_OUTPUT}"; then
      PUBLISH_SAW_REGISTRY_CONFLICT=1
    fi

    resolve_publish_conflict "${PUBLISH_PACKAGE_NAME}" \
      && PUBLISH_CONFLICT_STATE=0 || PUBLISH_CONFLICT_STATE=$?
    if [[ "${PUBLISH_CONFLICT_STATE}" -ne 2 ]]; then
      return "${PUBLISH_CONFLICT_STATE}"
    fi
    if [[ "${PUBLISH_ATTEMPT}" -lt "${NPM_PUBLISH_CONFLICT_ATTEMPTS}" ]]; then
      echo "Transient npm publish failure for ${PUBLISH_PACKAGE_NAME}@${VERSION}; retrying in ${NPM_PUBLISH_CONFLICT_DELAY_SECONDS}s (attempt ${PUBLISH_ATTEMPT}/${NPM_PUBLISH_CONFLICT_ATTEMPTS})."
      sleep "${NPM_PUBLISH_CONFLICT_DELAY_SECONDS}"
    elif [[ "${PUBLISH_RETRY_MODE}" == "recover" && "${PUBLISH_SAW_REGISTRY_CONFLICT}" -eq 1 ]] \
      && wait_for_npm_git_head "${PUBLISH_PACKAGE_NAME}"; then
      echo "::notice::${PUBLISH_PACKAGE_NAME}@${VERSION} landed after the final transient publish failure; continuing."
      return 0
    elif [[ "${PUBLISH_RETRY_MODE}" == "recover" && -n "${PUBLISHED_GIT_HEAD}" ]]; then
      echo "::error::${PUBLISH_PACKAGE_NAME}@${VERSION} exists with a different commit after the final registry conflict." >&2
      return 1
    fi
  done
  echo "::error::npm registry conflict persisted for ${PUBLISH_PACKAGE_NAME}@${VERSION} after ${NPM_PUBLISH_CONFLICT_ATTEMPTS} attempts." >&2
  return 1
}

# Poll the npm registry until PACKAGE_NAME@VERSION reports a gitHead. Succeeds
# only when that gitHead matches GITHUB_SHA. Leaves the last observed value in
# the global PUBLISHED_GIT_HEAD for callers' error messages.
wait_for_npm_git_head() {
  PACKAGE_NAME="$1"
  # npm can expose a published version before its gitHead metadata converges.
  # Allow up to five minutes of empty reads while preserving hash mismatches as
  # immediate failures.
  for attempt in $(seq 1 60); do
    PUBLISHED_GIT_HEAD="$(npm view "${PACKAGE_NAME}@${VERSION}" gitHead 2>/dev/null || true)"
    if [ "${PUBLISHED_GIT_HEAD}" = "${GITHUB_SHA}" ]; then
      return 0
    fi
    if [ -n "${PUBLISHED_GIT_HEAD}" ]; then
      return 1
    fi
    echo "Waiting for npm registry metadata for ${PACKAGE_NAME}@${VERSION} (attempt ${attempt}/60)."
    sleep 5
  done

  PUBLISHED_GIT_HEAD="$(npm view "${PACKAGE_NAME}@${VERSION}" gitHead 2>/dev/null || true)"
  [ "${PUBLISHED_GIT_HEAD}" = "${GITHUB_SHA}" ]
}

rc_publish_package_dir() {
  PACKAGE_DIR="$1"
  PUBLISH_SPEC="${2:-${PACKAGE_DIR}}"
  PACKAGE_NAME="$(jq -r '.name' "${PACKAGE_DIR}/package.json")"
  if npm view "${PACKAGE_NAME}@${VERSION}" version 2>/dev/null; then
    set +e
    PUBLISHED_GIT_HEAD="$(npm view "${PACKAGE_NAME}@${VERSION}" gitHead 2>&1)"
    PUBLISHED_GIT_HEAD_STATUS=$?
    set -e
    if [[ "${PUBLISHED_GIT_HEAD_STATUS}" -ne 0 ]]; then
      echo "::error::npm registry gitHead lookup failed for ${PACKAGE_NAME}@${VERSION} (status ${PUBLISHED_GIT_HEAD_STATUS})." >&2
      SANITIZED_NPM_LOOKUP_OUTPUT="$(sanitize_npm_lookup_output "${PUBLISHED_GIT_HEAD}")"
      if [[ -n "${SANITIZED_NPM_LOOKUP_OUTPUT}" ]]; then
        printf '%s\n' "${SANITIZED_NPM_LOOKUP_OUTPUT}" >&2
      fi
      return "${PUBLISHED_GIT_HEAD_STATUS}"
    fi
    if [[ -z "${PUBLISHED_GIT_HEAD}" ]] && ! wait_for_npm_git_head "${PACKAGE_NAME}"; then
      if [[ -n "${PUBLISHED_GIT_HEAD}" ]]; then
        echo "::error::${PACKAGE_NAME}@${VERSION} already exists, but its gitHead does not match this commit." >&2
      else
        echo "::error::${PACKAGE_NAME}@${VERSION} already exists, but its gitHead metadata did not converge." >&2
      fi
      return 1
    fi
    if [[ "${PUBLISHED_GIT_HEAD}" == "${GITHUB_SHA}" ]]; then
      echo "::notice::${PACKAGE_NAME}@${VERSION} already published for this commit; skipping npm publish"
      return 0
    fi
    echo "::error::${PACKAGE_NAME}@${VERSION} already exists, but its gitHead does not match this commit." >&2
    return 1
  fi

  echo "Publishing ${PACKAGE_NAME}@${VERSION} with rc tag"
  publish_npm_package_with_retry recover "${PACKAGE_NAME}" "${PUBLISH_SPEC}" \
    --provenance --access public --tag rc
}

release_publish_package_dir() {
  PACKAGE_DIR="$1"
  PUBLISH_SPEC="${2:-${PACKAGE_DIR}}"
  PACKAGE_NAME="$(jq -r '.name' "${PACKAGE_DIR}/package.json")"
  echo "Publishing ${PACKAGE_NAME}@${VERSION}"
  # Stable releases fail closed: a name@version that already exists on npm can
  # never be attributed to this workflow, so conflict retries must not accept
  # it via registry metadata such as gitHead.
  publish_npm_package_with_retry fail-closed "${PACKAGE_NAME}" "${PUBLISH_SPEC}" \
    --provenance --access public \
    && PUBLISH_STATUS=0 || PUBLISH_STATUS=$?

  if [ "${PUBLISH_STATUS}" -ne 0 ]; then
    exit "${PUBLISH_STATUS}"
  fi

  if ! wait_for_npm_git_head "${PACKAGE_NAME}"; then
    echo "::error::Published ${PACKAGE_NAME}@${VERSION} gitHead is ${PUBLISHED_GIT_HEAD}, expected ${GITHUB_SHA}."
    exit 1
  fi
}

run_rc_publish() {
  require_env VERSION GITHUB_SHA NPM_PACK_DIR
  verify_npm_compatibility_artifact

  for PACKAGE_DIR in $(package_dirs); do
    PUBLISH_SPEC="$(canonical_tarball_for_package_dir "${PACKAGE_DIR}")" || PUBLISH_SPEC=""
    if [[ -z "${PUBLISH_SPEC}" ]]; then
      PACKAGE_NAME="$(jq -r '.name' "${PACKAGE_DIR}/package.json")"
      echo "::error::Canonical npm publish spec for ${PACKAGE_NAME} is empty. Ensure manifest.json contains exactly one matching package entry." >&2
      return 1
    fi
    rc_publish_package_dir "${PACKAGE_DIR}" "${PUBLISH_SPEC}"
  done
}

is_npm_package_not_found() {
  printf '%s\n' "$1" | grep -Eq '(^|[[:space:]])(E404|404 Not Found)([[:space:]]|$)'
}

sanitize_npm_lookup_output() {
  printf '%s\n' "$1" \
    | sed -E \
      -e '/^npm error A complete log of this run can be found in:/d' \
      -e "s#Bearer [^][[:space:]\"'),]+#Bearer <REDACTED>#g" \
      -e "s#([?&]token=)[^][[:space:]\"'),&]+#\1<REDACTED>#g" \
      -e "s#(_authToken=)[^][[:space:]\"'),]+#\1<REDACTED>#g" \
      -e 's#"(file://)/[^"]*"#"\1<path>"#g' \
      -e "s#'(file://)/[^']*'#'\1<path>'#g" \
      -e 's#\[(file://)/[^]]*\]#[\1<path>]#g' \
      -e 's#(file://)/[^][[:space:]"),]+#\1<path>#g' \
      -e 's#(^|[[:space:]=(])"((/|[A-Za-z]:[\\/]|\\\\)[^"]*)"#\1"<path>"#g' \
      -e "s#(^|[[:space:]=(])'((/|[A-Za-z]:[\\\\/]|\\\\\\\\)[^']*)'#\1'<path>'#g" \
      -e 's#\[(/|[A-Za-z]:[\\/]|\\\\)[^]]*\]#[<path>]#g' \
      -e 's#(^|[[:space:]"=(])/[^][[:space:]"),]+#\1<path>#g' \
      -e 's#(^|[[:space:]"=(])[A-Za-z]:[\\/][^][[:space:]"),]+#\1<path>#g' \
      -e 's#(^|[[:space:]"=(])\\\\[^][[:space:]"),]+#\1<path>#g'
}

ensure_package_names_registered() {
  MISSING_PACKAGE_NAMES=0
  PACKAGE_NAME_LOOKUP_FAILURES=0

  for PACKAGE_NAME in $(package_names_from_workspace); do
    set +e
    NPM_LOOKUP_OUTPUT="$(npm view "${PACKAGE_NAME}@*" name 2>&1)"
    NPM_LOOKUP_STATUS=$?
    set -e

    if [ "${NPM_LOOKUP_STATUS}" -eq 0 ]; then
      continue
    fi

    if is_npm_package_not_found "${NPM_LOOKUP_OUTPUT}"; then
      echo "::error::${PACKAGE_NAME} is not registered on npm." >&2
      MISSING_PACKAGE_NAMES=1
      continue
    fi

    echo "::error::npm registry lookup failed for ${PACKAGE_NAME} (status ${NPM_LOOKUP_STATUS})." >&2
    SANITIZED_NPM_LOOKUP_OUTPUT="$(sanitize_npm_lookup_output "${NPM_LOOKUP_OUTPUT}")"
    if [ -n "${SANITIZED_NPM_LOOKUP_OUTPUT}" ]; then
      printf '%s\n' "${SANITIZED_NPM_LOOKUP_OUTPUT}" >&2
    fi
    PACKAGE_NAME_LOOKUP_FAILURES=1
  done

  if [ "${PACKAGE_NAME_LOOKUP_FAILURES}" -ne 0 ]; then
    echo "::error::Resolve the npm registry lookup failures above, then rerun the stable release preflight." >&2
    return 1
  fi

  if [ "${MISSING_PACKAGE_NAMES}" -ne 0 ]; then
    echo "::error::The unregistered package names are listed above. Publish each package once with a prerelease version and a non-latest dist-tag, then configure trusted publishing. Do not publish ${VERSION} manually; keep that stable version available for this CI provenance release." >&2
    return 1
  fi
}

run_preflight() {
  require_env VERSION
  ensure_package_names_registered

  for PACKAGE_NAME in $(package_names_from_workspace); do
    if npm view "${PACKAGE_NAME}@${VERSION}" version 2>/dev/null; then
      echo "::error::${PACKAGE_NAME}@${VERSION} already exists on npm. Bump deno.json before releasing."
      exit 1
    fi
  done
}

run_release_publish() {
  require_env VERSION GITHUB_SHA NPM_PACK_DIR
  verify_npm_compatibility_artifact

  for PACKAGE_DIR in $(package_dirs); do
    PUBLISH_SPEC="$(canonical_tarball_for_package_dir "${PACKAGE_DIR}")" || PUBLISH_SPEC=""
    if [[ -z "${PUBLISH_SPEC}" ]]; then
      PACKAGE_NAME="$(jq -r '.name' "${PACKAGE_DIR}/package.json")"
      echo "::error::Canonical npm publish spec for ${PACKAGE_NAME} is empty. Ensure manifest.json contains exactly one matching package entry." >&2
      return 1
    fi
    release_publish_package_dir "${PACKAGE_DIR}" "${PUBLISH_SPEC}"
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
