export interface ParsedCrossProjectImport {
  projectSlug: string;
  version: string;
  path: string;
}

const CROSS_PROJECT_VERSIONED_PATTERN = /^([a-z0-9-]+)@([\d^~x][\d.x^~-]*)\/@\/(.+)$/;
const CROSS_PROJECT_LATEST_PATTERN = /^([a-z0-9-]+)\/@\/(.+)$/;

export function isCrossProjectImport(specifier: string): boolean {
  return (
    CROSS_PROJECT_VERSIONED_PATTERN.test(specifier) ||
    CROSS_PROJECT_LATEST_PATTERN.test(specifier)
  );
}

export function parseCrossProjectImport(specifier: string): ParsedCrossProjectImport | null {
  const versionedMatch = specifier.match(CROSS_PROJECT_VERSIONED_PATTERN);
  if (versionedMatch && versionedMatch[1] && versionedMatch[2] && versionedMatch[3]) {
    return { projectSlug: versionedMatch[1], version: versionedMatch[2], path: versionedMatch[3] };
  }

  const latestMatch = specifier.match(CROSS_PROJECT_LATEST_PATTERN);
  if (!latestMatch || !latestMatch[1] || !latestMatch[2]) return null;

  return { projectSlug: latestMatch[1], version: "latest", path: latestMatch[2] };
}
