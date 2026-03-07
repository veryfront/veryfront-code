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
interface PathParam {
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
  return pattern.replace(
    /\[\[\.\.\.([^\]]+)\]\]|\[\.\.\.([^\]]+)\]|\[([^\]]+)\]/g,
    (
      _match,
      optionalCatchAll: string | undefined,
      catchAll: string | undefined,
      segment: string | undefined,
    ) => {
      return `{${optionalCatchAll ?? catchAll ?? segment ?? ""}}`;
    },
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

  function addParam(name: string | undefined, required: boolean, catchAll: boolean): void {
    if (!name || seen.has(name)) return;
    seen.add(name);
    params.push({ name, required, catchAll });
  }

  for (const match of pattern.matchAll(/\[\[\.\.\.([^\]]+)\]\]/g)) {
    addParam(match[1], false, true);
  }

  for (const match of pattern.matchAll(/\[\.\.\.([^\]]+)\]/g)) {
    addParam(match[1], true, true);
  }

  for (const match of pattern.matchAll(/\[([^\[\]]+)\]/g)) {
    const name = match[1];
    if (!name || name.startsWith("...")) continue;
    addParam(name, true, false);
  }

  return params;
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
  const cleanPath = path
    .replace(/^\/api/, "")
    .replace(/\{([^}]+)\}/g, (_, param: string) => `By${capitalize(param)}`);

  const segments = cleanPath
    .split("/")
    .filter(Boolean)
    .map((segment, index) => (index === 0 ? segment : capitalize(segment)))
    .join("");

  return method.toLowerCase() + capitalize(segments || "root");
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
