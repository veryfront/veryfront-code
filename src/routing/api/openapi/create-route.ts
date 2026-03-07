import type { z } from "zod";
import { zodToJsonSchema } from "#veryfront/tool/schema";
import {
  getDefaultStatusDescription,
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
    } catch (_) {
      /* expected: zodToJsonSchema may fail on unsupported schemas */
    }
  }

  if (openApiConfig.query) {
    try {
      metadata.query = zodToJsonSchema(openApiConfig.query);
    } catch (_) {
      /* expected: zodToJsonSchema may fail on unsupported schemas */
    }
  }

  if (openApiConfig.body) {
    try {
      metadata.body = zodToJsonSchema(openApiConfig.body);
    } catch (_) {
      /* expected: zodToJsonSchema may fail on unsupported schemas */
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
      } catch (_) {
        /* expected: zodToJsonSchema may fail on unsupported schemas */
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

export { z } from "zod";
