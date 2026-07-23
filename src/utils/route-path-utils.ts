/**************************
 * Route Path Utilities
 *
 * Consolidated utilities for route path handling, dynamic segment detection,
 * and route parameter extraction. Used across page rendering, routing, and build.
 **************************/

/** Supported page file extensions */
export const PAGE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js", ".mdx", ".md"] as const;

/** Supported component file extensions (subset of page extensions) */
export const COMPONENT_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"] as const;

/** Regex for matching and removing file extensions */
const EXTENSION_REGEX = /\.(tsx|jsx|ts|js|mdx|md)$/;

/** Patterns for dynamic segment detection */
const DYNAMIC_SEGMENT_PATTERNS = {
  standard: /^\[[A-Za-z0-9_-]+\]$/, // [id]
  catchAll: /^\[\.\.\.[A-Za-z0-9_-]+\]$/, // [...slug]
  optionalCatchAll: /^\[\[\.\.\.[A-Za-z0-9_-]+\]\]$/, // [[...slug]]
} as const;

/**
 * Check if a segment name is a dynamic route segment.
 * Handles both directory names like "[id]" and file names like "[id].tsx"
 */
export function isDynamicSegment(name: string): boolean {
  if (!name.startsWith("[")) return false;
  const segment = removeFileExtension(name);
  return DYNAMIC_SEGMENT_PATTERNS.standard.test(segment) ||
    DYNAMIC_SEGMENT_PATTERNS.catchAll.test(segment) ||
    DYNAMIC_SEGMENT_PATTERNS.optionalCatchAll.test(segment);
}

/**
 * Check if a route pattern contains any dynamic segments
 */
export function isDynamicRoute(pattern: string): boolean {
  return pattern.split("/").some((segment) => isDynamicSegment(segment));
}

/**
 * Check if a segment is a catch-all segment ([...slug] or [[...slug]])
 */
export function isCatchAllSegment(name: string): boolean {
  const segment = removeFileExtension(name);
  return DYNAMIC_SEGMENT_PATTERNS.catchAll.test(segment) ||
    DYNAMIC_SEGMENT_PATTERNS.optionalCatchAll.test(segment);
}

function isOptionalCatchAllSegment(name: string): boolean {
  return DYNAMIC_SEGMENT_PATTERNS.optionalCatchAll.test(removeFileExtension(name));
}

/**
 * Remove file extension from a path
 */
export function removeFileExtension(path: string): string {
  return path.replace(EXTENSION_REGEX, "");
}

/**
 * Extract parameter name from a dynamic segment.
 * "[id]" -> "id"
 * "[...slug]" -> "slug"
 * "[[...params]]" -> "params"
 */
export function extractParamName(segment: string): string {
  return removeFileExtension(segment).replace(/\[\[\.\.\.|\[\.\.\.|\[|\]\]|\]/g, "");
}

/**
 * Router type detection result
 */
interface RouterBasePath {
  type: "app" | "pages" | null;
  relativePath: string | null;
}

export interface RouterDirectories {
  app?: string;
  pages?: string;
}

function extractPathBelowRoot(pageEntityId: string, root: string): string | null {
  const isWindowsPath = /^[A-Za-z]:[\\/]/.test(pageEntityId) ||
    /^(?:\\\\|\/\/)/.test(pageEntityId);
  const normalizedPath = `/${pageEntityId.replaceAll("\\", "/").replace(/^\/+/, "")}`;
  const normalizedRoot = root.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!normalizedRoot) return null;

  const marker = `/${normalizedRoot}/`;
  const rootIndex = isWindowsPath
    ? normalizedPath.toLowerCase().lastIndexOf(marker.toLowerCase())
    : normalizedPath.lastIndexOf(marker);
  return rootIndex === -1 ? null : normalizedPath.substring(rootIndex + marker.length);
}

/**
 * Extract the router base path from a page entity ID.
 * Detects whether it's an App Router (/app/) or Pages Router (/pages/) path.
 */
export function extractRouterBasePath(
  pageEntityId: string,
  directories: RouterDirectories = {},
): RouterBasePath {
  const appRelativePath = extractPathBelowRoot(pageEntityId, directories.app ?? "app");
  if (appRelativePath !== null) {
    return { type: "app", relativePath: appRelativePath };
  }

  const pagesRelativePath = extractPathBelowRoot(pageEntityId, directories.pages ?? "pages");
  if (pagesRelativePath !== null) {
    return { type: "pages", relativePath: pagesRelativePath };
  }

  return { type: null, relativePath: null };
}

/**
 * Result of route parameter extraction
 */
interface ExtractedRouteParams {
  params: Record<string, string | string[]>;
  matched: boolean;
}

/**
 * Extract route parameters from a page entity ID and URL slug.
 * Handles both App Router and Pages Router patterns.
 *
 * @param pageEntityId - The page entity ID (file path)
 * @param slug - The URL slug to match against
 * @returns Extracted parameters and whether at least one dynamic parameter was extracted
 */
export function extractRouteParams(
  pageEntityId: string,
  slug: string,
  directories: RouterDirectories = {},
): ExtractedRouteParams {
  const params: Record<string, string | string[]> = {};

  const { relativePath, type } = extractRouterBasePath(pageEntityId, directories);
  if (!relativePath || !type) return { params, matched: false };

  const pathSegments = relativePath.split("/").filter(Boolean);
  const lastIndex = pathSegments.length - 1;
  if (lastIndex >= 0) pathSegments[lastIndex] = removeFileExtension(pathSegments[lastIndex]!);

  if (
    (type === "app" && ["page", "route"].includes(pathSegments.at(-1) ?? "")) ||
    (type === "pages" && pathSegments.at(-1) === "index")
  ) {
    pathSegments.pop();
  }

  const routeSegments = type === "app"
    ? pathSegments.filter((segment) =>
      !(segment.startsWith("(") && segment.endsWith(")")) && !segment.startsWith("@")
    )
    : pathSegments;
  const extracted = extractParamsFromPattern(routeSegments.join("/"), slug);

  if (extracted === null || Object.keys(extracted).length === 0) {
    return { params, matched: false };
  }
  return { params: extracted, matched: true };
}

/**
 * Extract relative path from an absolute path by removing the project directory prefix.
 *
 * @param absolutePath - The absolute file path
 * @param projectDir - The project root directory
 * @returns The relative path within the project
 */
export function extractRelativePath(absolutePath: string, projectDir: string): string {
  const normalizedPath = absolutePath.replaceAll("\\", "/");
  const normalizedProjectDir = projectDir.replaceAll("\\", "/").replace(/\/+$/, "");
  const isWindowsPath = (
    /^[A-Za-z]:(?:\/|$)/.test(normalizedPath) &&
    /^[A-Za-z]:(?:\/|$)/.test(normalizedProjectDir)
  ) || (normalizedPath.startsWith("//") && normalizedProjectDir.startsWith("//"));
  const comparablePath = isWindowsPath ? normalizedPath.toLowerCase() : normalizedPath;
  const comparableProjectDir = isWindowsPath
    ? normalizedProjectDir.toLowerCase()
    : normalizedProjectDir;
  const path = comparablePath === comparableProjectDir
    ? ""
    : comparablePath.startsWith(`${comparableProjectDir}/`)
    ? normalizedPath.slice(normalizedProjectDir.length + 1)
    : normalizedPath;

  return path.replace(/^\//, "");
}

function setRouteParam(
  params: Record<string, string | string[]>,
  name: string,
  value: string | string[],
): void {
  Object.defineProperty(params, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/**
 * Extract route params using pattern matching (for slug-mapper).
 * This is a more flexible version that works with route patterns directly.
 *
 * @param pattern - The route pattern (e.g., "[id]/posts/[...slug]")
 * @param slug - The URL slug to match
 * @returns Extracted params or null if no match
 */
export function extractParamsFromPattern(
  pattern: string,
  slug: string,
): Record<string, string | string[]> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const slugParts = slug.split("/").filter(Boolean);

  const params: Record<string, string | string[]> = {};

  const catchAllIndex = patternParts.findIndex(isCatchAllSegment);
  const hasCatchAll = catchAllIndex !== -1;
  if (hasCatchAll && catchAllIndex !== patternParts.length - 1) return null;
  if (!hasCatchAll && patternParts.length !== slugParts.length) return null;

  let slugIndex = 0;

  for (const patternPart of patternParts) {
    if (isCatchAllSegment(patternPart)) {
      const remaining = slugParts.slice(slugIndex);
      if (remaining.length === 0 && !isOptionalCatchAllSegment(patternPart)) return null;
      setRouteParam(params, extractParamName(patternPart), remaining);
      return params;
    }

    if (isDynamicSegment(patternPart)) {
      if (slugIndex >= slugParts.length) return null;
      setRouteParam(params, extractParamName(patternPart), slugParts[slugIndex]!);
      slugIndex++;
      continue;
    }

    if (slugParts[slugIndex] !== patternPart) return null;
    slugIndex++;
  }

  if (slugIndex < slugParts.length) return null;

  return params;
}

/**
 * Check if a pattern matches a slug
 */
export function matchesPattern(pattern: string, slug: string): boolean {
  return extractParamsFromPattern(pattern, slug) !== null;
}
