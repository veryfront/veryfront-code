const MAX_HYDRATION_PATH_LENGTH = 2_048;
const HYDRATION_MODULE_EXTENSION_PATTERN = /\.(?:tsx?|jsx?|mdx?|mjs)$/;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:\//;
const URL_DOT_SEGMENT_PATTERN = /^(?:\.|%2e){1,2}$/i;

function slashPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function hasAbsolutePrefix(value: string): boolean {
  return value.startsWith("/") || WINDOWS_ABSOLUTE_PATH_PATTERN.test(value);
}

function pathSegmentsAreCanonical(value: string): boolean {
  return value.split("/").every((part) =>
    part.length > 0 &&
    !URL_DOT_SEGMENT_PATTERN.test(part)
  );
}

export function isCanonicalHydrationPath(value: string): boolean {
  return value.length > 0 &&
    value.length <= MAX_HYDRATION_PATH_LENGTH &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.includes("\\") &&
    !value.includes("?") &&
    !value.includes("#") &&
    pathSegmentsAreCanonical(value);
}

export function isCanonicalHydrationModulePath(value: string): boolean {
  return isCanonicalHydrationPath(value) &&
    HYDRATION_MODULE_EXTENSION_PATTERN.test(value);
}

function normalizeProjectRoot(projectDir: string): string | undefined {
  const slashRoot = slashPath(projectDir);
  const normalized = slashRoot === "/" ? "/" : slashRoot.replace(/\/+$/, "");
  const isWindowsDriveRoot = /^[A-Za-z]:$/.test(normalized);
  if (
    !normalized ||
    (!hasAbsolutePrefix(normalized) && !isWindowsDriveRoot)
  ) {
    return undefined;
  }
  const rootSegments = normalized === "/" || isWindowsDriveRoot ? "" : normalized
    .replace(WINDOWS_ABSOLUTE_PATH_PATTERN, "")
    .replace(/^\/+/, "");
  if (
    normalized.includes("?") ||
    normalized.includes("#") ||
    (rootSegments.length > 0 && !pathSegmentsAreCanonical(rootSegments))
  ) {
    return undefined;
  }
  return normalized;
}

/**
 * Resolves an authored path to one canonical project-relative identity.
 *
 * Absolute paths are accepted only when a project root proves containment.
 * Relative paths remain supported for existing callers, but all dot segments
 * (including encoded forms) and non-canonical separators fail closed.
 */
export function resolveCanonicalProjectRelativePath(
  filePath: string,
  projectDir?: string,
  options: { module?: boolean } = {},
): string | undefined {
  if (typeof filePath !== "string" || filePath.length === 0) return undefined;

  const normalizedPath = slashPath(filePath);
  if (
    normalizedPath.includes("?") ||
    normalizedPath.includes("#") ||
    normalizedPath.includes("//")
  ) {
    return undefined;
  }

  const isAbsolute = hasAbsolutePrefix(normalizedPath);
  let relativePath: string;
  if (projectDir) {
    const projectRoot = normalizeProjectRoot(projectDir);
    if (!projectRoot) return undefined;

    if (isAbsolute) {
      const projectPrefix = projectRoot.endsWith("/") ? projectRoot : `${projectRoot}/`;
      if (!normalizedPath.startsWith(projectPrefix)) return undefined;
      relativePath = normalizedPath.slice(projectPrefix.length);
    } else {
      relativePath = normalizedPath;
    }
  } else {
    if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(normalizedPath)) return undefined;
    relativePath = normalizedPath.replace(/^\/+/, "");
  }

  const isCanonical = options.module
    ? isCanonicalHydrationModulePath(relativePath)
    : isCanonicalHydrationPath(relativePath);
  return isCanonical ? relativePath : undefined;
}
