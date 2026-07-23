import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { zodToJsonSchema } from "#veryfront/tool/schema";
import {
  getDefaultStatusDescription,
  OPENAPI_METADATA,
  type OpenAPIRouteConfig,
  type OpenAPIRouteMetadata,
  type WrappedHandler,
} from "./types.ts";

export function createRoute<
  TParams extends Schema = Schema,
  TQuery extends Schema = Schema,
  TBody extends Schema = Schema,
>(config: OpenAPIRouteConfig<TParams, TQuery, TBody>): WrappedHandler {
  const { handler, ...openApiConfig } = config;

  const metadata: OpenAPIRouteMetadata = {
    summary: openApiConfig.summary,
    description: openApiConfig.description,
    tags: openApiConfig.tags ? [...openApiConfig.tags] : undefined,
    deprecated: openApiConfig.deprecated,
  };

  if (openApiConfig.params) {
    metadata.params = zodToJsonSchema(openApiConfig.params);
  }

  if (openApiConfig.query) {
    metadata.query = zodToJsonSchema(openApiConfig.query);
  }

  if (openApiConfig.body) {
    metadata.body = zodToJsonSchema(openApiConfig.body);
  }

  if (openApiConfig.response) {
    metadata.responses = {};

    for (const [statusCode, schemaOrConfig] of Object.entries(openApiConfig.response)) {
      const status = Number(statusCode);
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        throw new RangeError(`Invalid HTTP status code: ${statusCode}`);
      }

      const isConfigObject = typeof schemaOrConfig === "object" &&
        schemaOrConfig !== null &&
        "schema" in schemaOrConfig;
      const responseSchema = isConfigObject
        ? (schemaOrConfig as { schema: Schema }).schema
        : (schemaOrConfig as Schema);
      const description = isConfigObject
        ? (schemaOrConfig as { description?: string }).description
        : undefined;

      metadata.responses[statusCode] = {
        description: description ?? getDefaultStatusDescription(status),
        content: {
          "application/json": {
            schema: zodToJsonSchema(responseSchema),
          },
        },
      };
    }
  }

  const wrappedHandler: WrappedHandler = (request, context) => handler(request, context);
  Object.defineProperty(wrappedHandler, OPENAPI_METADATA, {
    configurable: false,
    enumerable: false,
    value: Object.freeze(metadata),
    writable: false,
  });

  return wrappedHandler;
}

export { defineSchema } from "#veryfront/schemas/index.ts";
