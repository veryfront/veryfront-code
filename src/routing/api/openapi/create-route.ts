import type { z } from "zod";
import { zodToJsonSchema } from "#veryfront/tool/schema";
import {
  OPENAPI_METADATA,
  type OpenAPIRouteConfig,
  type OpenAPIRouteMetadata,
  type WrappedHandler,
} from "./types.ts";

export function createRoute<
  TParams extends z.ZodTypeAny = z.ZodTypeAny,
  TQuery extends z.ZodTypeAny = z.ZodTypeAny,
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
>(config: OpenAPIRouteConfig<TParams, TQuery, TBody>): WrappedHandler {
  const { handler, ...openApiConfig } = config;

  const metadata: OpenAPIRouteMetadata = {
    summary: openApiConfig.summary,
    description: openApiConfig.description,
    tags: openApiConfig.tags,
    deprecated: openApiConfig.deprecated,
  };

  if (openApiConfig.params) {
    try {
      metadata.params = zodToJsonSchema(openApiConfig.params);
    } catch {
      // Silently skip invalid schemas - route still works, just no docs
    }
  }

  if (openApiConfig.query) {
    try {
      metadata.query = zodToJsonSchema(openApiConfig.query);
    } catch {
      // Silently skip invalid schemas
    }
  }

  if (openApiConfig.body) {
    try {
      metadata.body = zodToJsonSchema(openApiConfig.body);
    } catch {
      // Silently skip invalid schemas
    }
  }

  if (openApiConfig.response) {
    metadata.responses = {};

    for (const [statusCode, schemaOrConfig] of Object.entries(openApiConfig.response)) {
      const status = Number(statusCode);

      try {
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
          description: description ?? getDefaultStatusDescription(status),
          content: {
            "application/json": {
              schema: zodToJsonSchema(zodSchema),
            },
          },
        };
      } catch {
        metadata.responses[statusCode] = {
          description: getDefaultStatusDescription(status),
        };
      }
    }
  }

  const wrappedHandler = handler as WrappedHandler;
  wrappedHandler[OPENAPI_METADATA] = metadata;

  return wrappedHandler;
}

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

  return descriptions[statusCode] ?? `Response with status ${statusCode}`;
}

export { z } from "zod";
