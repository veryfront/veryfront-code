import { isAbsolute, relative, resolve } from "#veryfront/compat/path/resolution.ts";
import { MAX_PATH_LENGTH_CHARS } from "./constants/limits.ts";

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Admit a path string before normalization or platform path operations. */
export function assertBoundedPathString(
  value: unknown,
  label = "Path",
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    containsControlCharacter(value)
  ) {
    throw new TypeError(
      `${label} must be a non-empty path of at most ${MAX_PATH_LENGTH_CHARS} characters without control characters`,
    );
  }
  return value;
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
  const path = assertBoundedPathString(value, label);

  if (
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    /^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(path) ||
    path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new TypeError(
      `${label} must use canonical forward-slash segments and stay within the project`,
    );
  }

  return path;
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

/**
 * Convert one admitted absolute or canonical relative path to its canonical
 * project-relative identity. Absolute prefix collisions and every path outside
 * the resolved project root are rejected rather than stripped textually.
 */
export function toCanonicalProjectRelativePath(
  projectDir: string,
  value: unknown,
  label = "Project path",
): string {
  const admittedProjectDir = assertBoundedPathString(
    projectDir,
    `${label} project directory`,
  );
  if (!isAbsolute(admittedProjectDir)) {
    throw new TypeError(`${label} project directory must be absolute`);
  }
  const projectRoot = resolve(admittedProjectDir);
  const admittedPath = assertBoundedPathString(value, label);
  const absolutePath = isAbsolute(admittedPath)
    ? resolve(admittedPath)
    : resolveCanonicalProjectRelativePath(projectRoot, admittedPath, label);
  const pathFromRoot = relative(projectRoot, absolutePath).replaceAll("\\", "/");
  if (
    pathFromRoot === "" ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith("../") ||
    isAbsolute(pathFromRoot)
  ) {
    throw new TypeError(`${label} must resolve within the project directory`);
  }
  return assertCanonicalProjectRelativePath(pathFromRoot, label);
}
