/**
 * OpenAPI Path Utilities
 *
 * Converts file-based routing patterns to OpenAPI path format.
 *
 * @module routing/api/openapi/path-utils
 */

import {
  compileRoutePattern,
  parseRouteParameterSegment,
} from "#veryfront/utils/route-path-utils.ts";

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

export interface OpenAPIPathDescription {
  path: string;
  params: PathParam[];
}

export interface OpenAPIPathAnalysis {
  description: OpenAPIPathDescription | null;
  reason: string | null;
}

/**
 * Convert the canonical runtime grammar into the subset OpenAPI 3.1 can
 * represent. Optional catch-alls fail closed because OpenAPI path parameters
 * are always required.
 */
export function analyzeOpenAPIPath(pattern: string): OpenAPIPathAnalysis {
  const compiled = compileRoutePattern(pattern);
  if (!compiled.valid) {
    return {
      description: null,
      reason:
        "the route grammar is invalid or contains more than one catch-all parameter; correct malformed segments and keep at most one catch-all",
    };
  }
  if (compiled.parameters.some((param) => param.kind === "optional-catch-all")) {
    return {
      description: null,
      reason:
        "OpenAPI 3.1 requires every path parameter; split the optional catch-all into explicit routes",
    };
  }

  const params: PathParam[] = [];
  const seen = new Set<string>();
  const convertedSegments: string[] = [];

  for (const segment of pattern.split("/")) {
    const parameter = parseRouteParameterSegment(segment);
    if (!parameter) {
      if (segment.includes("{") || segment.includes("}")) {
        return {
          description: null,
          reason: "literal braces conflict with OpenAPI path-template syntax",
        };
      }
      convertedSegments.push(segment);
      continue;
    }

    convertedSegments.push(`{${parameter.name}}${parameter.suffix}`);
    if (seen.has(parameter.name)) continue;
    seen.add(parameter.name);
    params.push({
      name: parameter.name,
      required: true,
      catchAll: parameter.kind === "catch-all",
    });
  }

  return {
    description: { path: convertedSegments.join("/"), params },
    reason: null,
  };
}

export function describeOpenAPIPath(pattern: string): OpenAPIPathDescription | null {
  return analyzeOpenAPIPath(pattern).description;
}

/**
 * Convert file-system route pattern to OpenAPI path format.
 *
 * Transforms Next.js-style dynamic segments to OpenAPI path parameters:
 * - `[id]` → `{id}` (required parameter)
 * - `[...slug]` → `{slug}` (required catch-all)
 * - `[[...slug]]` is not representable and returns `null`
 *
 * @param pattern - Route pattern (e.g., "/api/users/[id]")
 * @returns OpenAPI path, or `null` when the runtime pattern is not representable
 *
 * @example
 * ```typescript
 * toOpenAPIPath("/api/users/[id]") // → "/api/users/{id}"
 * toOpenAPIPath("/api/docs/[...slug]") // → "/api/docs/{slug}"
 * toOpenAPIPath("/api/[[...path]]") // → null
 * ```
 */
export function toOpenAPIPath(pattern: string): string | null {
  return describeOpenAPIPath(pattern)?.path ?? null;
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
 * // → null
 * ```
 */
export function extractPathParams(pattern: string): PathParam[] | null {
  return describeOpenAPIPath(pattern)?.params ?? null;
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
