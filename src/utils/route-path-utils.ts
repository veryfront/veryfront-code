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
const ROUTE_PARAMETER_FILE_SUFFIX_REGEX = /^\.(tsx|jsx|ts|js|mdx|md)$/i;

/** Reject control characters before paths reach runtime filesystem adapters. */
export function containsPathControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

export type RouteParameterKind =
  | "dynamic"
  | "catch-all"
  | "optional-catch-all";

export interface ParsedRouteParameter {
  name: string;
  kind: RouteParameterKind;
  /** Literal suffix after the route parameter, such as `.tsx`. */
  suffix: string;
}

function isValidParameterName(name: string): boolean {
  return /^[\w-]+(?:\.[\w-]+)*$/.test(name);
}

/** Parse a complete dynamic route segment using the public route grammar. */
export function parseRouteParameterSegment(
  segment: string,
): ParsedRouteParameter | null {
  if (!segment.startsWith("[") || containsPathControlCharacters(segment)) {
    return null;
  }

  let marker: string;
  let kind: RouteParameterKind;
  let closing: string;
  if (segment.startsWith("[[...")) {
    marker = "[[...";
    kind = "optional-catch-all";
    closing = "]]";
  } else if (segment.startsWith("[...")) {
    marker = "[...";
    kind = "catch-all";
    closing = "]";
  } else {
    marker = "[";
    kind = "dynamic";
    closing = "]";
  }

  const closingIndex = segment.indexOf(closing, marker.length);
  if (closingIndex === -1) return null;

  const name = segment.slice(marker.length, closingIndex);
  const suffix = segment.slice(closingIndex + closing.length);
  if (!isValidParameterName(name)) return null;
  if (suffix !== "" && !ROUTE_PARAMETER_FILE_SUFFIX_REGEX.test(suffix)) {
    return null;
  }
  return { name, kind, suffix };
}

/**
 * Check if a segment name is a dynamic route segment.
 * Handles both directory names like "[id]" and file names like "[id].tsx"
 */
export function isDynamicSegment(name: string): boolean {
  return parseRouteParameterSegment(name) !== null;
}

/**
 * Check if a route pattern contains any dynamic segments
 */
export function isDynamicRoute(pattern: string): boolean {
  return pattern.split(/[\\/]/).some(isDynamicSegment);
}

/**
 * Check if a segment is a catch-all segment ([...slug] or [[...slug]])
 */
export function isCatchAllSegment(name: string): boolean {
  const parameter = parseRouteParameterSegment(name);
  return parameter?.kind === "catch-all" || parameter?.kind === "optional-catch-all";
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
  return parseRouteParameterSegment(segment)?.name ?? segment;
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
  const normalizedPath = `/${pageEntityId.replaceAll("\\", "/").replace(/^\/+/, "")}`;
  const normalizedRoot = root.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!normalizedRoot) return null;

  const marker = `/${normalizedRoot}/`;
  const rootIndex = normalizedPath.lastIndexOf(marker);
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
 * @returns Extracted parameters and whether matching succeeded
 */
export function extractRouteParams(
  pageEntityId: string,
  slug: string,
  directories: RouterDirectories = {},
): ExtractedRouteParams {
  const params: Record<string, string | string[]> = Object.create(null);

  const { relativePath } = extractRouterBasePath(pageEntityId, directories);
  if (!relativePath) return { params, matched: false };

  const pathSegments = relativePath
    .split("/")
    .map(removeFileExtension)
    .filter((segment) => segment.length > 0 && segment !== "page" && segment !== "route");

  const slugSegments = slug.split("/").filter(Boolean);

  for (let i = 0; i < pathSegments.length && i < slugSegments.length; i++) {
    const pathSegment = pathSegments[i];
    if (!pathSegment || !isDynamicSegment(pathSegment)) continue;

    const paramName = extractParamName(pathSegment);

    if (isCatchAllSegment(pathSegment)) {
      params[paramName] = slugSegments.slice(i);
      break;
    }

    params[paramName] = slugSegments[i]!;
  }

  const nextPathSegment = pathSegments[slugSegments.length];
  const nextParameter = nextPathSegment ? parseRouteParameterSegment(nextPathSegment) : null;
  if (nextParameter?.kind === "optional-catch-all") {
    const staticPrefixMatches = pathSegments
      .slice(0, slugSegments.length)
      .every((segment, index) => isDynamicSegment(segment) || segment === slugSegments[index]);
    if (staticPrefixMatches) {
      params[nextParameter.name] = [];
    }
  }

  return { params, matched: Object.keys(params).length > 0 };
}

/**
 * Extract relative path from an absolute path by removing the project directory prefix.
 *
 * @param absolutePath - The absolute file path
 * @param projectDir - The project root directory
 * @returns The relative path within the project
 */
export function extractRelativePath(absolutePath: string, projectDir: string): string {
  const path = absolutePath.startsWith(projectDir)
    ? absolutePath.slice(projectDir.length)
    : absolutePath;

  return path.replace(/^\//, "");
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

  const params: Record<string, string | string[]> = Object.create(null);

  const hasCatchAll = patternParts.some(isCatchAllSegment);
  if (!hasCatchAll && patternParts.length !== slugParts.length) return null;

  let slugIndex = 0;

  for (const patternPart of patternParts) {
    if (isCatchAllSegment(patternPart)) {
      params[extractParamName(patternPart)] = slugParts.slice(slugIndex);
      return params;
    }

    if (isDynamicSegment(patternPart)) {
      if (slugIndex >= slugParts.length) return null;
      params[extractParamName(patternPart)] = slugParts[slugIndex]!;
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
