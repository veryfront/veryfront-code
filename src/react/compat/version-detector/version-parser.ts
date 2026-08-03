import type { ParsedVersion } from "./types.ts";
import { CONFIG_INVALID } from "#veryfront/errors";

const MAX_REACT_VERSION_LENGTH = 256;
const NUMERIC_IDENTIFIER = String.raw`(?:0|[1-9]\d*)`;
const PRERELEASE_IDENTIFIER = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER_SOURCE =
  String.raw`${NUMERIC_IDENTIFIER}\.${NUMERIC_IDENTIFIER}\.${NUMERIC_IDENTIFIER}` +
  String.raw`(?:-${PRERELEASE_IDENTIFIER}(?:\.${PRERELEASE_IDENTIFIER})*)?` +
  String.raw`(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const SEMVER_PATTERN = new RegExp(`^${SEMVER_SOURCE}$`);
const SUPPORTED_DEPENDENCY_SPECIFIER_PATTERN = new RegExp(
  `^(?:\\^|~|>=|=)?\\s*(${SEMVER_SOURCE})(?:\\s+<=?\\s*${SEMVER_SOURCE})?$`,
);

function invalidReactVersion(detail: string): Error {
  return CONFIG_INVALID.create({ detail });
}

export function parseVersion(versionString: string): ParsedVersion {
  if (
    versionString.length > MAX_REACT_VERSION_LENGTH ||
    !SEMVER_PATTERN.test(versionString)
  ) {
    throw invalidReactVersion("React version must be a valid semantic version");
  }

  const [core] = versionString.split(/[-+]/, 1);
  const parts = core?.split(".").map(Number);
  if (
    !parts ||
    parts.length !== 3 ||
    parts.some((part) => !Number.isSafeInteger(part))
  ) {
    throw invalidReactVersion("React version contains an unsafe numeric component");
  }

  return { major: parts[0]!, minor: parts[1]!, patch: parts[2]! };
}

/**
 * Resolve the lowest version guaranteed by one supported npm-style specifier.
 *
 * The detector deliberately rejects tags, protocols, disjunctions, and
 * upper-bound-only ranges because none of them identifies a safe capability
 * baseline without a package-manager resolver.
 */
export function resolveReactDependencyVersion(specifier: string): string {
  const normalized = specifier.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_REACT_VERSION_LENGTH
  ) {
    throw invalidReactVersion(
      "React dependency must contain one bounded semantic-version specifier",
    );
  }

  const match = SUPPORTED_DEPENDENCY_SPECIFIER_PATTERN.exec(normalized);
  const version = match?.[1];
  if (!version) {
    throw invalidReactVersion(
      "React dependency must use an exact, caret, tilde, or inclusive lower-bounded semantic version",
    );
  }

  parseVersion(version);
  return version;
}

export function isReact17(major: number): boolean {
  return major === 17;
}

export function isReact18(major: number): boolean {
  return major === 18;
}

export function isReact19(major: number, _version: string): boolean {
  return major === 19;
}
