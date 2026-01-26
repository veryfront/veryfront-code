/**
 * OpenAPI Route Types
 *
 * Types for defining OpenAPI-documented routes with Zod schema validation.
 *
 * @module routing/api/openapi/types
 */

import type { z } from "zod";
import type { JsonSchema } from "../../../tool/schema/index.js";
import type { AppRouteHandler } from "../module-loader/types.js";

/**
 * Symbol for storing OpenAPI metadata on handler functions.
 * Using a Symbol ensures the metadata doesn't conflict with other properties.
 */
export const OPENAPI_METADATA = Symbol.for("veryfront.openapi.metadata");

/**
 * Configuration for createRoute wrapper function.
 * Users define their route with Zod schemas for automatic OpenAPI generation.
 */
export interface OpenAPIRouteConfig<
  TParams extends z.ZodTypeAny = z.ZodTypeAny,
  TQuery extends z.ZodTypeAny = z.ZodTypeAny,
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
> {
  summary?: string;
  description?: string;
  tags?: string[];
  params?: TParams;
  query?: TQuery;
  body?: TBody;
  response?: Record<
    number,
    z.ZodTypeAny | { schema: z.ZodTypeAny; description?: string }
  >;
  deprecated?: boolean;
  handler: AppRouteHandler;
}

/**
 * Converted OpenAPI metadata stored on handler functions.
 * Zod schemas are converted to JSON Schema format.
 */
export interface OpenAPIRouteMetadata {
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  params?: JsonSchema;
  query?: JsonSchema;
  body?: JsonSchema;
  responses?: Record<
    string,
    {
      description?: string;
      content?: {
        "application/json"?: { schema: JsonSchema };
      };
    }
  >;
}

/**
 * Handler function with optional OpenAPI metadata attached.
 */
export interface WrappedHandler extends AppRouteHandler {
  [OPENAPI_METADATA]?: OpenAPIRouteMetadata;
}

/**
 * OpenAPI 3.1.0 specification types
 */
export interface OpenAPISpec {
  openapi: "3.1.0";
  info: OpenAPIInfo;
  paths: Record<string, OpenAPIPathItem>;
  tags?: OpenAPITag[];
  servers?: OpenAPIServer[];
}

export interface OpenAPIInfo {
  title: string;
  version: string;
  description?: string;
}

export interface OpenAPITag {
  name: string;
  description?: string;
}

export interface OpenAPIServer {
  url: string;
  description?: string;
}

export interface OpenAPIPathItem {
  get?: OpenAPIOperation;
  post?: OpenAPIOperation;
  put?: OpenAPIOperation;
  patch?: OpenAPIOperation;
  delete?: OpenAPIOperation;
  head?: OpenAPIOperation;
  options?: OpenAPIOperation;
}

export interface OpenAPIOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  operationId?: string;
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses: Record<string, OpenAPIResponse>;
  deprecated?: boolean;
}

export interface OpenAPIParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema: JsonSchema;
}

export interface OpenAPIRequestBody {
  required?: boolean;
  description?: string;
  content: {
    "application/json"?: { schema: JsonSchema };
  };
}

export interface OpenAPIResponse {
  description: string;
  content?: {
    "application/json"?: { schema: JsonSchema };
  };
}
