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
export declare function toOpenAPIPath(pattern: string): string;
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
export declare function extractPathParams(pattern: string): PathParam[];
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
export declare function filePathToPattern(filePath: string, routePrefix?: string): string;
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
export declare function generateOperationId(method: string, path: string): string;
//# sourceMappingURL=path-utils.d.ts.map