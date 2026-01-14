/**
 * OpenAPI Path Utilities
 *
 * Converts file-based routing patterns to OpenAPI path format.
 *
 * @module routing/api/openapi/path-utils
 */

/**
 * Path parameter extracted from route pattern.
 */
export interface PathParam {
  /** Parameter name (e.g., "id", "slug") */
  name: string;
  /** Whether the parameter is required */
  required: boolean;
  /** Whether this is a catch-all parameter ([...slug] or [[...slug]]) */
  catchAll: boolean;
}

/**
 * Convert file-system route pattern to OpenAPI path format.
 *
 * Transforms Next.js-style dynamic segments to OpenAPI path parameters:
 * - `[id]` → `{id}` (required parameter)
 * - `[...slug]` → `{slug}` (required catch-all)
 * - `[[...slug]]` → `{slug}` (optional catch-all)
 *
 * @param pattern - Route pattern (e.g., "/api/users/[id]")
 * @returns OpenAPI path (e.g., "/api/users/{id}")
 *
 * @example
 * ```typescript
 * toOpenAPIPath("/api/users/[id]") // → "/api/users/{id}"
 * toOpenAPIPath("/api/docs/[...slug]") // → "/api/docs/{slug}"
 * toOpenAPIPath("/api/[[...path]]") // → "/api/{path}"
 * ```
 */
export function toOpenAPIPath(pattern: string): string {
  return (
    pattern
      // Optional catch-all [[...param]] → {param}
      .replace(/\[\[\.\.\.([^\]]+)\]\]/g, "{$1}")
      // Required catch-all [...param] → {param}
      .replace(/\[\.\.\.([^\]]+)\]/g, "{$1}")
      // Single param [param] → {param}
      .replace(/\[([^\]]+)\]/g, "{$1}")
  );
}

/**
 * Extract path parameters from route pattern.
 *
 * Parses Next.js-style dynamic segments and returns parameter info.
 *
 * @param pattern - Route pattern (e.g., "/api/users/[id]/posts/[postId]")
 * @returns Array of path parameters with metadata
 *
 * @example
 * ```typescript
 * extractPathParams("/api/users/[id]")
 * // → [{ name: "id", required: true, catchAll: false }]
 *
 * extractPathParams("/api/docs/[...slug]")
 * // → [{ name: "slug", required: true, catchAll: true }]
 *
 * extractPathParams("/api/[[...path]]")
 * // → [{ name: "path", required: false, catchAll: true }]
 * ```
 */
export function extractPathParams(pattern: string): PathParam[] {
  const params: PathParam[] = [];
  const seen = new Set<string>();

  // Optional catch-all [[...param]] - not required
  for (const match of pattern.matchAll(/\[\[\.\.\.([^\]]+)\]\]/g)) {
    const name = match[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      params.push({ name, required: false, catchAll: true });
    }
  }

  // Required catch-all [...param]
  for (const match of pattern.matchAll(/\[\.\.\.([^\]]+)\]/g)) {
    const name = match[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      params.push({ name, required: true, catchAll: true });
    }
  }

  // Single param [param] - must not start with ... or contain [
  for (const match of pattern.matchAll(/\[([^\[\]]+)\]/g)) {
    const name = match[1];
    if (name && !name.startsWith("...") && !seen.has(name)) {
      seen.add(name);
      params.push({ name, required: true, catchAll: false });
    }
  }

  return params;
}

/**
 * Convert file path to route pattern.
 *
 * Transforms a file system path to an API route pattern.
 *
 * @param filePath - File path relative to pages/api or app directory
 * @param routePrefix - Prefix to add (e.g., "/api")
 * @returns Route pattern
 *
 * @example
 * ```typescript
 * filePathToPattern("users/[id]/route.ts", "/api")
 * // → "/api/users/[id]"
 *
 * filePathToPattern("users/[id].ts", "/api")
 * // → "/api/users/[id]"
 * ```
 */
export function filePathToPattern(filePath: string, routePrefix: string = ""): string {
  // Remove file extension
  let pattern = filePath.replace(/\.(ts|tsx|js|jsx)$/, "");

  // Remove "route" suffix for App Router style
  pattern = pattern.replace(/\/route$/, "");

  // Remove index suffix
  pattern = pattern.replace(/\/index$/, "");

  // Ensure leading slash
  if (!pattern.startsWith("/")) {
    pattern = "/" + pattern;
  }

  // Add prefix
  if (routePrefix && !pattern.startsWith(routePrefix)) {
    pattern = routePrefix + pattern;
  }

  // Clean up double slashes
  pattern = pattern.replace(/\/+/g, "/");

  // Remove trailing slash unless it's just "/"
  if (pattern.length > 1 && pattern.endsWith("/")) {
    pattern = pattern.slice(0, -1);
  }

  return pattern;
}

/**
 * Generate a unique operation ID from method and path.
 *
 * @param method - HTTP method (GET, POST, etc.)
 * @param path - API path
 * @returns camelCase operation ID
 *
 * @example
 * ```typescript
 * generateOperationId("GET", "/api/users/{id}")
 * // → "getUsersById"
 *
 * generateOperationId("POST", "/api/users")
 * // → "postUsers"
 * ```
 */
export function generateOperationId(method: string, path: string): string {
  // Remove /api prefix if present
  let cleanPath = path.replace(/^\/api/, "");

  // Replace path parameters with "By{Param}"
  cleanPath = cleanPath.replace(/\{([^}]+)\}/g, (_, param) => {
    return "By" + capitalize(param);
  });

  // Split path into segments and capitalize
  const segments = cleanPath
    .split("/")
    .filter(Boolean)
    .map((s, i) => (i === 0 ? s : capitalize(s)))
    .join("");

  return method.toLowerCase() + capitalize(segments || "root");
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
