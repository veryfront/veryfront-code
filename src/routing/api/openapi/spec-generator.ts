/**
 * OpenAPI Spec Generator
 *
 * Generates OpenAPI 3.1.0 specification from discovered routes.
 *
 * @module routing/api/openapi/spec-generator
 */

import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import type { DynamicRouter, RouteEntry } from "../api-route-matcher.ts";
import { loadHandlerModule } from "../module-loader/loader.ts";
import {
  OPENAPI_METADATA,
  type OpenAPIOperation,
  type OpenAPIParameter,
  type OpenAPIPathItem,
  type OpenAPIRouteMetadata,
  type OpenAPISpec,
  type WrappedHandler,
} from "./types.ts";
import { extractPathParams, generateOperationId, toOpenAPIPath } from "./path-utils.ts";
import { logger } from "@veryfront/utils";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

export interface GenerateSpecOptions {
  /** API title for OpenAPI info */
  title?: string;
  /** API version */
  version?: string;
  /** API description */
  description?: string;
  /** Server URLs to include */
  servers?: Array<{ url: string; description?: string }>;
}

/**
 * Generate OpenAPI 3.1.0 specification from discovered routes.
 *
 * Iterates through all registered routes, loads their handler modules,
 * extracts OpenAPI metadata from wrapped handlers, and builds the spec.
 *
 * @param router - DynamicRouter with discovered routes
 * @param projectDir - Project root directory
 * @param adapter - Runtime adapter for file operations
 * @param config - Veryfront configuration (for openapi settings)
 * @param options - Additional generation options
 * @returns OpenAPI 3.1.0 specification
 */
export async function generateOpenAPISpec(
  router: DynamicRouter,
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
  options?: GenerateSpecOptions,
): Promise<OpenAPISpec> {
  const spec: OpenAPISpec = {
    openapi: "3.1.0",
    info: {
      title: options?.title || config?.openapi?.title || "API Documentation",
      version: options?.version || config?.openapi?.version || "1.0.0",
      description: options?.description || config?.openapi?.description,
    },
    paths: {},
    tags: [],
  };

  // Add servers if provided
  if (options?.servers && options.servers.length > 0) {
    spec.servers = options.servers;
  }

  const tagSet = new Set<string>();
  const routes = router.routes;

  for (const [pattern, entry] of routes) {
    // Skip non-API routes (only document /api/* routes)
    if (!pattern.startsWith("/api") && !entry.route.page.includes("/api/")) {
      continue;
    }

    try {
      const pathItem = await processRoute(pattern, entry, projectDir, adapter, config, tagSet);

      if (pathItem && Object.keys(pathItem).length > 0) {
        const openApiPath = toOpenAPIPath(pattern);
        spec.paths[openApiPath] = pathItem;
      }
    } catch (error) {
      // Log but continue - one broken route shouldn't break the whole spec
      logger.warn(`[OpenAPI] Failed to process route ${pattern}:`, { error: String(error) });
    }
  }

  // Convert tag set to array
  spec.tags = Array.from(tagSet)
    .sort()
    .map((name) => ({ name }));

  return spec;
}

/**
 * Process a single route and extract OpenAPI path item.
 */
async function processRoute(
  pattern: string,
  entry: RouteEntry,
  projectDir: string,
  adapter: RuntimeAdapter,
  config: VeryfrontConfig | undefined,
  tagSet: Set<string>,
): Promise<OpenAPIPathItem | null> {
  const module = await loadHandlerModule({
    projectDir,
    modulePath: entry.route.page,
    adapter,
    config,
  });

  if (!module) {
    return null;
  }

  const pathParams = extractPathParams(pattern);
  const pathItem: OpenAPIPathItem = {};

  // Process each HTTP method
  for (const method of HTTP_METHODS) {
    const handler = module[method] as WrappedHandler | undefined;

    if (handler && typeof handler === "function") {
      const metadata = handler[OPENAPI_METADATA] as OpenAPIRouteMetadata | undefined;
      const operation = buildOperation(method, pattern, metadata, pathParams, entry);

      // Collect tags
      if (metadata?.tags) {
        for (const tag of metadata.tags) {
          tagSet.add(tag);
        }
      }

      pathItem[method.toLowerCase() as Lowercase<HttpMethod>] = operation;
    }
  }

  // Handle default export (responds to all methods not explicitly defined)
  if (module.default && typeof module.default === "function") {
    const handler = module.default as WrappedHandler;
    const metadata = handler[OPENAPI_METADATA] as OpenAPIRouteMetadata | undefined;

    for (const method of HTTP_METHODS) {
      const methodKey = method.toLowerCase() as Lowercase<HttpMethod>;
      if (!pathItem[methodKey]) {
        const operation = buildOperation(method, pattern, metadata, pathParams, entry);
        pathItem[methodKey] = operation;
      }
    }
  }

  return pathItem;
}

/**
 * Build OpenAPI operation for a single method.
 */
function buildOperation(
  method: HttpMethod,
  pattern: string,
  metadata: OpenAPIRouteMetadata | undefined,
  pathParams: Array<{ name: string; required: boolean; catchAll: boolean }>,
  _entry: RouteEntry,
): OpenAPIOperation {
  const openApiPath = toOpenAPIPath(pattern);

  const operation: OpenAPIOperation = {
    operationId: generateOperationId(method, openApiPath),
    summary: metadata?.summary || `${method} ${openApiPath}`,
    description: metadata?.description,
    tags: metadata?.tags,
    deprecated: metadata?.deprecated,
    parameters: [],
    responses: {},
  };

  // Add path parameters
  for (const param of pathParams) {
    const paramSchema = metadata?.params?.properties?.[param.name] || { type: "string" as const };

    const parameter: OpenAPIParameter = {
      name: param.name,
      in: "path",
      required: param.required,
      schema: paramSchema,
    };

    if (param.catchAll) {
      parameter.description = "Catch-all parameter (matches multiple path segments)";
    }

    operation.parameters!.push(parameter);
  }

  // Add query parameters from metadata
  if (metadata?.query?.properties) {
    const required = metadata.query.required || [];

    for (const [name, schema] of Object.entries(metadata.query.properties)) {
      operation.parameters!.push({
        name,
        in: "query",
        required: required.includes(name),
        schema,
      });
    }
  }

  // Add request body for methods that support it
  if (["POST", "PUT", "PATCH"].includes(method) && metadata?.body) {
    operation.requestBody = {
      required: true,
      content: {
        "application/json": { schema: metadata.body },
      },
    };
  }

  // Add responses
  if (metadata?.responses && Object.keys(metadata.responses).length > 0) {
    // Ensure all responses have a description (required by OpenAPI spec)
    operation.responses = {};
    for (const [statusCode, response] of Object.entries(metadata.responses)) {
      operation.responses[statusCode] = {
        ...response,
        description: response.description || getDefaultStatusDescription(Number(statusCode)),
      };
    }
  } else {
    // Default responses for routes without metadata
    operation.responses = {
      "200": { description: "Successful response" },
    };

    // Add common error responses
    if (["POST", "PUT", "PATCH"].includes(method)) {
      operation.responses["400"] = { description: "Bad request" };
    }
  }

  // Clean up empty parameters array
  if (operation.parameters!.length === 0) {
    delete operation.parameters;
  }

  return operation;
}

/**
 * Generate OpenAPI spec as JSON string.
 */
export async function generateOpenAPIJson(
  router: DynamicRouter,
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
  options?: GenerateSpecOptions,
): Promise<string> {
  const spec = await generateOpenAPISpec(router, projectDir, adapter, config, options);
  return JSON.stringify(spec, null, 2);
}

/**
 * Simple YAML serialization for OpenAPI spec.
 * For more complex cases, consider using a proper YAML library.
 */
export function specToYaml(spec: OpenAPISpec): string {
  return toYaml(spec, 0);
}

function toYaml(obj: unknown, indent: number): string {
  const spaces = "  ".repeat(indent);

  if (obj === null || obj === undefined) {
    return "null";
  }

  if (typeof obj === "string") {
    // Quote strings that contain special characters
    if (obj.includes(":") || obj.includes("#") || obj.includes("\n") || obj.startsWith("{")) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj;
  }

  if (typeof obj === "number" || typeof obj === "boolean") {
    return String(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj.map((item) => `\n${spaces}- ${toYaml(item, indent + 1).trimStart()}`).join("");
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj).filter(([_, v]) => v !== undefined);
    if (entries.length === 0) return "{}";

    return entries
      .map(([key, value]) => {
        const yamlValue = toYaml(value, indent + 1);
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          return `\n${spaces}${key}:${yamlValue}`;
        }
        return `\n${spaces}${key}: ${yamlValue}`;
      })
      .join("");
  }

  return String(obj);
}

/**
 * Get default description for common HTTP status codes.
 */
function getDefaultStatusDescription(statusCode: number): string {
  const descriptions: Record<number, string> = {
    200: "Successful response",
    201: "Resource created",
    204: "No content",
    400: "Bad request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not found",
    409: "Conflict",
    422: "Unprocessable entity",
    429: "Too many requests",
    500: "Internal server error",
    502: "Bad gateway",
    503: "Service unavailable",
  };

  return descriptions[statusCode] || `Response with status ${statusCode}`;
}
