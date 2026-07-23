interface ParsedCrossProjectImport {
  projectSlug: string;
  version: string;
  path: string;
}

const MAX_CROSS_PROJECT_SPECIFIER_LENGTH = 1024;
const MAX_CROSS_PROJECT_PATH_LENGTH = 768;
const PROJECT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const VERSION_PATTERN = /^[\d^~x][\d.x^~-]{0,63}$/;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._~!$&'()+,;=@-]+$/;
const CROSS_PROJECT_VERSIONED_PATTERN = /^([^/@]+)@([^/]+)\/@\/(.+)$/;
const CROSS_PROJECT_LATEST_PATTERN = /^([^/@]+)\/@\/(.+)$/;

function isSafeCrossProjectPath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_CROSS_PROJECT_PATH_LENGTH) return false;

  const segments = path.split("/");
  return segments.every((segment) =>
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    PATH_SEGMENT_PATTERN.test(segment)
  );
}

function hasValidCrossProjectParts(
  projectSlug: string,
  version: string | null,
  path: string,
): boolean {
  return PROJECT_SLUG_PATTERN.test(projectSlug) &&
    (version === null || version === "latest" || VERSION_PATTERN.test(version)) &&
    isSafeCrossProjectPath(path);
}

/**
 * Reject unsafe values before constructing a cross-project module URL.
 */
export function assertValidCrossProjectImportParts(
  projectSlug: string,
  version: string | null,
  path: string,
): void {
  if (!hasValidCrossProjectParts(projectSlug, version, path)) {
    throw new TypeError("Invalid cross-project import");
  }
}

export function isCrossProjectImport(specifier: string): boolean {
  return parseCrossProjectImport(specifier) !== null;
}

export function parseCrossProjectImport(specifier: string): ParsedCrossProjectImport | null {
  if (specifier.length === 0 || specifier.length > MAX_CROSS_PROJECT_SPECIFIER_LENGTH) return null;

  const versionedMatch = specifier.match(CROSS_PROJECT_VERSIONED_PATTERN);
  if (versionedMatch && versionedMatch[1] && versionedMatch[2] && versionedMatch[3]) {
    const parsed = {
      projectSlug: versionedMatch[1],
      version: versionedMatch[2],
      path: versionedMatch[3],
    };
    return hasValidCrossProjectParts(parsed.projectSlug, parsed.version, parsed.path)
      ? parsed
      : null;
  }

  const latestMatch = specifier.match(CROSS_PROJECT_LATEST_PATTERN);
  if (!latestMatch || !latestMatch[1] || !latestMatch[2]) return null;

  const parsed = { projectSlug: latestMatch[1], version: "latest", path: latestMatch[2] };
  return hasValidCrossProjectParts(parsed.projectSlug, parsed.version, parsed.path) ? parsed : null;
}
