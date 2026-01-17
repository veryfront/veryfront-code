/**
 * OpenAPI Route Wrapper
 *
 * Creates route handlers with OpenAPI metadata for automatic documentation.
 *
 * @module routing/api/openapi/create-route
 *
 * @example
 * ```typescript
 * import { createRoute, z } from "veryfront/openapi";
 *
 * export const GET = createRoute({
 *   summary: "Get user by ID",
 *   params: z.object({ id: z.string().uuid() }),
 *   response: {
 *     200: z.object({ id: z.string(), name: z.string() }),
 *     404: { schema: z.object({ error: z.string() }), description: "Not found" },
 *   },
 *   handler: async (request, { params }) => {
 *     return Response.json({ id: params.id, name: "John" });
 *   },
 * });
 * ```
 */

import type { z } from "zod";
import { zodToJsonSchema } from "@veryfront/tool/schema";
import {
  OPENAPI_METADATA,
  type OpenAPIRouteConfig,
  type OpenAPIRouteMetadata,
  type WrappedHandler,
} from "./types.ts";

/**
 * Create an OpenAPI-documented route handler.
 *
 * Wraps a route handler with OpenAPI metadata for automatic documentation generation.
 * The handler signature remains unchanged - this just attaches metadata via a Symbol.
 *
 * @param config - Route configuration with schemas and handler
 * @returns The handler function with OpenAPI metadata attached
 */
export function createRoute<
  TParams extends z.ZodTypeAny = z.ZodTypeAny,
  TQuery extends z.ZodTypeAny = z.ZodTypeAny,
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
>(config: OpenAPIRouteConfig<TParams, TQuery, TBody>): WrappedHandler {
  const { handler, ...openApiConfig } = config;

  // Build OpenAPI metadata by converting Zod schemas to JSON Schema
  const metadata: OpenAPIRouteMetadata = {
    summary: openApiConfig.summary,
    description: openApiConfig.description,
    tags: openApiConfig.tags,
    deprecated: openApiConfig.deprecated,
  };

  // Convert params schema
  if (openApiConfig.params) {
    try {
      metadata.params = zodToJsonSchema(openApiConfig.params);
    } catch {
      // Silently skip invalid schemas - route still works, just no docs
    }
  }

  // Convert query schema
  if (openApiConfig.query) {
    try {
      metadata.query = zodToJsonSchema(openApiConfig.query);
    } catch {
      // Silently skip invalid schemas
    }
  }

  // Convert body schema
  if (openApiConfig.body) {
    try {
      metadata.body = zodToJsonSchema(openApiConfig.body);
    } catch {
      // Silently skip invalid schemas
    }
  }

  // Convert response schemas
  if (openApiConfig.response) {
    metadata.responses = {};

    for (const [statusCode, schemaOrConfig] of Object.entries(openApiConfig.response)) {
      try {
        // Handle both z.ZodType and { schema, description } formats
        const isConfigObject = typeof schemaOrConfig === "object" &&
          schemaOrConfig !== null &&
          "schema" in schemaOrConfig;

        const zodSchema = isConfigObject
          ? (schemaOrConfig as { schema: z.ZodTypeAny }).schema
          : (schemaOrConfig as z.ZodTypeAny);

        const description = isConfigObject
          ? (schemaOrConfig as { description?: string }).description
          : undefined;

        metadata.responses[statusCode] = {
          description: description || getDefaultStatusDescription(Number(statusCode)),
          content: {
            "application/json": {
              schema: zodToJsonSchema(zodSchema),
            },
          },
        };
      } catch {
        // Silently skip invalid schemas
        metadata.responses[statusCode] = {
          description: getDefaultStatusDescription(Number(statusCode)),
        };
      }
    }
  }

  // Attach metadata to handler using Symbol
  const wrappedHandler = handler as WrappedHandler;
  wrappedHandler[OPENAPI_METADATA] = metadata;

  return wrappedHandler;
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

// Re-export z from zod for convenience
// Users can: import { createRoute, z } from "veryfront/openapi";
export { z } from "zod";
