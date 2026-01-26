/**
 * OpenAPI Path Utilities
 *
 * Converts file-based routing patterns to OpenAPI path format.
 *
 * @module routing/api/openapi/path-utils
 */
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
export function toOpenAPIPath(pattern) {
    return pattern
        .replace(/\[\[\.\.\.([^\]]+)\]\]/g, "{$1}")
        .replace(/\[\.\.\.([^\]]+)\]/g, "{$1}")
        .replace(/\[([^\]]+)\]/g, "{$1}");
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
export function extractPathParams(pattern) {
    const params = [];
    const seen = new Set();
    const addParam = (name, required, catchAll) => {
        if (!name || seen.has(name))
            return;
        seen.add(name);
        params.push({ name, required, catchAll });
    };
    for (const match of pattern.matchAll(/\[\[\.\.\.([^\]]+)\]\]/g)) {
        addParam(match[1], false, true);
    }
    for (const match of pattern.matchAll(/\[\.\.\.([^\]]+)\]/g)) {
        addParam(match[1], true, true);
    }
    for (const match of pattern.matchAll(/\[([^\[\]]+)\]/g)) {
        const name = match[1];
        if (name?.startsWith("..."))
            continue;
        addParam(name, true, false);
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
export function filePathToPattern(filePath, routePrefix = "") {
    let pattern = filePath
        .replace(/\.(ts|tsx|js|jsx)$/, "")
        .replace(/\/route$/, "")
        .replace(/\/index$/, "");
    if (!pattern.startsWith("/"))
        pattern = `/${pattern}`;
    if (routePrefix && !pattern.startsWith(routePrefix)) {
        pattern = `${routePrefix}${pattern}`;
    }
    pattern = pattern.replace(/\/+/g, "/");
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
export function generateOperationId(method, path) {
    let cleanPath = path.replace(/^\/api/, "");
    cleanPath = cleanPath.replace(/\{([^}]+)\}/g, (_, param) => `By${capitalize(param)}`);
    const segments = cleanPath
        .split("/")
        .filter(Boolean)
        .map((segment, index) => (index === 0 ? segment : capitalize(segment)))
        .join("");
    return method.toLowerCase() + capitalize(segments || "root");
}
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
