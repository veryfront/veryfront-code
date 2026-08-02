import { MAX_PATH_LENGTH_CHARS } from "./constants/limits.ts";

/** Maximum number of roots accepted for one project primitive kind. */
export const MAX_PROJECT_DISCOVERY_DIRECTORIES = 100;

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Validate and normalize one project-relative discovery root.
 *
 * Discovery roots are configuration, not arbitrary filesystem paths: they must
 * remain inside the project, use a canonical segment spelling, and be portable
 * across local and virtual filesystem adapters.
 */
export function normalizeProjectRelativeDiscoveryPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    containsControlCharacter(value) ||
    /^file:\/\//i.test(value)
  ) {
    throw new TypeError(
      `Project discovery path must be a non-empty relative path of at most ${MAX_PATH_LENGTH_CHARS} characters without control characters`,
    );
  }

  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((segment) =>
      segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new TypeError(
      "Project discovery path must stay within the project and cannot contain empty, dot, or traversal segments",
    );
  }

  return normalized;
}

/** Return whether a value is a canonical project-relative discovery root. */
export function isProjectRelativeDiscoveryPath(value: unknown): value is string {
  try {
    normalizeProjectRelativeDiscoveryPath(value);
    return true;
  } catch {
    return false;
  }
}
