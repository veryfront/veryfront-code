import { isAbsolute, relative, resolve } from "#veryfront/compat/path/resolution.ts";
import { MAX_PATH_LENGTH_CHARS } from "./constants/limits.ts";

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Assert that a configured project path has one portable, unambiguous spelling.
 *
 * Configuration paths use forward slashes and are always relative to the
 * project root. Rejecting normalization aliases keeps cache identities stable
 * and prevents local and virtual filesystem adapters from resolving the same
 * configuration differently.
 */
export function assertCanonicalProjectRelativePath(
  value: unknown,
  label = "Project path",
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    containsControlCharacter(value)
  ) {
    throw new TypeError(
      `${label} must be a non-empty project-relative path of at most ${MAX_PATH_LENGTH_CHARS} characters without control characters`,
    );
  }

  if (
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    /^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(value) ||
    value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new TypeError(
      `${label} must use canonical forward-slash segments and stay within the project`,
    );
  }

  return value;
}

/** Return whether a value is a canonical, portable project-relative path. */
export function isCanonicalProjectRelativePath(value: unknown): value is string {
  try {
    assertCanonicalProjectRelativePath(value);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a validated project-relative path and re-check lexical containment. */
export function resolveCanonicalProjectRelativePath(
  projectDir: string,
  value: unknown,
  label = "Project path",
): string {
  const relativePath = assertCanonicalProjectRelativePath(value, label);
  if (typeof projectDir !== "string" || !isAbsolute(projectDir)) {
    throw new TypeError(`${label} project directory must be absolute`);
  }

  const projectRoot = resolve(projectDir);
  const absolutePath = resolve(projectRoot, relativePath);
  const pathFromRoot = relative(projectRoot, absolutePath);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith("../") ||
    isAbsolute(pathFromRoot)
  ) {
    throw new TypeError(`${label} must resolve within the project directory`);
  }

  return absolutePath;
}
