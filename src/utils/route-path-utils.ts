/**
 * Route Path Utilities
 *
 * Consolidated utilities for route path handling, dynamic segment detection,
 * and route parameter extraction. Used across page rendering, routing, and build.
 */

/** Supported page file extensions */
export const PAGE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js", ".mdx", ".md"] as const;

/** Supported component file extensions (subset of page extensions) */
export const COMPONENT_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"] as const;

/** Regex for matching and removing file extensions */
export const EXTENSION_REGEX = /\.(tsx|jsx|ts|js|mdx|md)$/;

/** Patterns for dynamic segment detection */
const DYNAMIC_SEGMENT_PATTERNS = {
  standard: /^\[[\w]+\]$/, // [id]
  catchAll: /^\[\.\.\.[\w]+\]$/, // [...slug]
  optionalCatchAll: /^\[\[\.\.\.[\w]+\]\]$/, // [[...slug]]
  withExtension: /^\[\.{0,3}\w+\]\.\w+$/, // [id].tsx or [...slug].ts
} as const;

/**
 * Check if a segment name is a dynamic route segment.
 * Handles both directory names like "[id]" and file names like "[id].tsx"
 */
export function isDynamicSegment(name: string): boolean {
  if (!name.startsWith("[")) return false;

  // Check for directory-style dynamic segments
  if (name.endsWith("]")) {
    return (
      DYNAMIC_SEGMENT_PATTERNS.standard.test(name) ||
      DYNAMIC_SEGMENT_PATTERNS.catchAll.test(name) ||
      DYNAMIC_SEGMENT_PATTERNS.optionalCatchAll.test(name)
    );
  }

  // Check for file-style dynamic segments like "[id].tsx"
  return DYNAMIC_SEGMENT_PATTERNS.withExtension.test(name);
}

/**
 * Check if a route pattern contains any dynamic segments
 */
export function isDynamicRoute(pattern: string): boolean {
  return /\[[\w.]+\]/.test(pattern);
}

/**
 * Check if a segment is a catch-all segment ([...slug] or [[...slug]])
 */
export function isCatchAllSegment(name: string): boolean {
  return name.startsWith("[...") || name.startsWith("[[...");
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
  return segment.replace(/\[\.\.\.|\[\[\.\.\.|\[|\]\]|\]/g, "");
}

/**
 * Router type detection result
 */
export interface RouterBasePath {
  type: "app" | "pages" | null;
  relativePath: string | null;
}

/**
 * Extract the router base path from a page entity ID.
 * Detects whether it's an App Router (/app/) or Pages Router (/pages/) path.
 */
export function extractRouterBasePath(pageEntityId: string): RouterBasePath {
  const appIndex = pageEntityId.indexOf("/app/");
  const pagesIndex = pageEntityId.indexOf("/pages/");

  if (appIndex !== -1) {
    return {
      type: "app",
      relativePath: pageEntityId.substring(appIndex + 5), // Skip "/app/"
    };
  }

  if (pagesIndex !== -1) {
    return {
      type: "pages",
      relativePath: pageEntityId.substring(pagesIndex + 7), // Skip "/pages/"
    };
  }

  return { type: null, relativePath: null };
}

/**
 * Result of route parameter extraction
 */
export interface ExtractedRouteParams {
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
): ExtractedRouteParams {
  const params: Record<string, string | string[]> = {};

  const { relativePath } = extractRouterBasePath(pageEntityId);
  if (!relativePath) {
    return { params, matched: false };
  }

  // Extract path segments, removing file extensions and App Router special file names
  const pathSegments = relativePath
    .split("/")
    .map(removeFileExtension)
    .filter((s) => s !== "page" && s !== "route" && s.length > 0);

  const slugSegments = slug.split("/").filter(Boolean);

  // Match dynamic segments with slug values
  for (let i = 0; i < pathSegments.length && i < slugSegments.length; i++) {
    const pathSeg = pathSegments[i];
    const slugSeg = slugSegments[i];

    if (pathSeg && isDynamicSegment(pathSeg)) {
      const paramName = extractParamName(pathSeg);

      if (isCatchAllSegment(pathSeg)) {
        params[paramName] = slugSegments.slice(i);
        break;
      } else if (slugSeg !== undefined) {
        params[paramName] = slugSeg;
      }
    }
  }

  return {
    params,
    matched: Object.keys(params).length > 0,
  };
}

/**
 * Extract relative path from an absolute path by removing the project directory prefix.
 *
 * @param absolutePath - The absolute file path
 * @param projectDir - The project root directory
 * @returns The relative path within the project
 */
export function extractRelativePath(absolutePath: string, projectDir: string): string {
  if (absolutePath.startsWith(projectDir)) {
    return absolutePath.slice(projectDir.length).replace(/^\//, "");
  }
  return absolutePath.replace(/^\//, "");
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

  // Check for spread params
  let hasSpreadParam = false;
  for (const part of patternParts) {
    if (isCatchAllSegment(part)) {
      hasSpreadParam = true;
      break;
    }
  }

  // If no spread param, lengths must match
  if (!hasSpreadParam && patternParts.length !== slugParts.length) {
    return null;
  }

  let slugIndex = 0;

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    if (!patternPart) continue;

    // Handle catch-all segments
    if (isCatchAllSegment(patternPart)) {
      const paramName = extractParamName(patternPart);
      const remainingParts = slugParts.slice(slugIndex);
      params[paramName] = remainingParts;
      return params;
    }

    // Handle regular dynamic segments
    if (isDynamicSegment(patternPart)) {
      if (slugIndex >= slugParts.length) {
        return null;
      }
      const paramName = extractParamName(patternPart);
      const slugPart = slugParts[slugIndex];
      if (slugPart !== undefined) {
        params[paramName] = slugPart;
      }
      slugIndex++;
      continue;
    }

    // Handle static segments - must match exactly
    if (slugIndex >= slugParts.length || slugParts[slugIndex] !== patternPart) {
      return null;
    }
    slugIndex++;
  }

  // If we haven't consumed all slug parts, no match
  if (slugIndex < slugParts.length) {
    return null;
  }

  return params;
}

/**
 * Check if a pattern matches a slug
 */
export function matchesPattern(pattern: string, slug: string): boolean {
  return extractParamsFromPattern(pattern, slug) !== null;
}
