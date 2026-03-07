import type { z } from "zod";
import type { JsonSchema } from "#veryfront/tool/schema";
import type { AppRouteHandler } from "../module-loader/types.ts";

export const OPENAPI_METADATA = Symbol.for("veryfront.openapi.metadata");

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

export interface WrappedHandler extends AppRouteHandler {
  [OPENAPI_METADATA]?: OpenAPIRouteMetadata;
}

export interface OpenAPISpec {
  openapi: "3.1.0";
  info: OpenAPIInfo;
  paths: Record<string, OpenAPIPathItem>;
  tags?: OpenAPITag[];
  servers?: OpenAPIServer[];
}

interface OpenAPIInfo {
  title: string;
  version: string;
  description?: string;
}

interface OpenAPITag {
  name: string;
  description?: string;
}

interface OpenAPIServer {
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

interface OpenAPIRequestBody {
  required?: boolean;
  description?: string;
  content: {
    "application/json"?: { schema: JsonSchema };
  };
}

interface OpenAPIResponse {
  description: string;
  content?: {
    "application/json"?: { schema: JsonSchema };
  };
}

const STATUS_DESCRIPTIONS: Record<number, string> = {
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

export function getDefaultStatusDescription(statusCode: number): string {
  return STATUS_DESCRIPTIONS[statusCode] ?? `Response with status ${statusCode}`;
}
