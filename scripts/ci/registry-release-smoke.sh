#!/usr/bin/env bash
# Validate one immutable npm release before any downstream deployment dispatch.

recovery() {
	echo "::error::${1}" >&2
	echo "::error::npm versions are immutable. Do not unpublish ${VERSION}. Fix forward by publishing a new version from the intended commit, then rerun registry validation. Downstream deploy dispatches remain blocked." >&2
	return 0
}

registry_smoke_failure_classification() {
	case "${1:-}" in
		22) printf '%s\n' "configuration" ;;
		20) printf '%s\n' "install" ;;
		21) printf '%s\n' "behavior" ;;
		*) printf '%s\n' "install-or-behavior" ;;
	esac
	return 0
}

registry_release_smoke_main() {
	set -euo pipefail
	local root_dir version registry_url registry_authority metadata_status smoke_status classification package_name registry_packages
	local -a package_args=()
	local -a package_names=()
	root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
	cd "$root_dir"

	if [[ "${IS_STABLE:-}" == "true" ]]; then
		version="${STABLE_VERSION:-}"
	else
		version="${RC_VERSION:-}"
	fi
	VERSION="$version"

	if [[ -z "$version" || -z "${GITHUB_SHA:-}" ]]; then
		echo "REGISTRY RELEASE FAIL [configuration]: exact version and GITHUB_SHA are required." >&2
		return 1
	fi

	registry_url="${NPM_CONFIG_REGISTRY:-https://registry.npmjs.org}"
	case "$registry_url" in
		*"?"* | *"#"*)
			echo "REGISTRY RELEASE FAIL [configuration]: registry URL must not include a query or fragment." >&2
			return 1
			;;
		http://* | https://*) ;;
		*)
			echo "REGISTRY RELEASE FAIL [configuration]: registry URL must use HTTP or HTTPS." >&2
			return 1
			;;
	esac
	registry_authority="${registry_url#*://}"
	registry_authority="${registry_authority%%/*}"
	case "$registry_authority" in
		"" | *"@"* | *"?"* | *"#"*)
			echo "REGISTRY RELEASE FAIL [configuration]: registry URL authority is invalid." >&2
			return 1
			;;
	esac

	# Reuse the publish manifest enumeration so validation cannot silently omit a
	# new first-party package or a runtime package emitted from an extension.
	source "$root_dir/scripts/ci/publish-npm-packages.sh"
	while IFS= read -r package_name; do
		package_args+=(--package "$package_name")
		package_names+=("$package_name")
		if [[ "${VF_NPM_SMOKE_DRY_RUN:-}" == "1" ]]; then
			printf 'REGISTRY_PACKAGE_SPEC=%s@%s\n' "$package_name" "$version"
		fi
	done < <(package_names_from_workspace)

	if [[ "${VF_NPM_SMOKE_DRY_RUN:-}" == "1" ]]; then
		return 0
	fi
	printf -v registry_packages '%s\n' "${package_names[@]}"

	set +e
	deno run --no-config --no-lock --allow-net="$registry_authority" \
		"$root_dir/scripts/ci/registry-release-integrity.ts" \
		--version "$version" \
		--git-head "$GITHUB_SHA" \
		--registry-url "$registry_url" \
		"${package_args[@]}"
	metadata_status=$?
	set -e
	if [[ "$metadata_status" -ne 0 ]]; then
		recovery "Exact-version registry metadata validation failed."
		return 1
	fi

	set +e
	VF_NPM_REGISTRY_PACKAGES="$registry_packages" \
		VF_NPM_REGISTRY_URL="$registry_url" \
		VF_NPM_REGISTRY_VERSION="$version" \
		bash "$root_dir/scripts/test/npm-install-smoke.sh"
	smoke_status=$?
	set -e
	if [[ "$smoke_status" -ne 0 ]]; then
		classification="$(registry_smoke_failure_classification "$smoke_status")"
		recovery "Exact-version registry ${classification} smoke failed."
		return 1
	fi

	echo "Registry release smoke: ${version} passed exact-version metadata, install, API, page, and workflow checks."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	registry_release_smoke_main "$@"
fi
