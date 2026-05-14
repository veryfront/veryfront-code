/**
 * OpenAPI MCP Tools Generator
 *
 * Auto-generates MCP tools from OpenAPI specification, allowing AI agents
 * to call API endpoints directly.
 *
 * @module routing/api/openapi/mcp-tools
 */

import { dynamicTool } from "#veryfront/tool";
import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import { logger as baseLogger } from "#veryfront/utils";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { Schema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import type { OpenAPIOperation, OpenAPIParameter, OpenAPISpec } from "./types.ts";

const logger = baseLogger.component("open-api-mcp");

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

function isHttpMethod(method: string): method is HttpMethod {
  return HTTP_METHODS.includes(method as HttpMethod);
}

/**
 * Configuration for MCP tools generation.
 */
export interface MCPToolsConfig {
  /** Base URL for API calls (e.g., "http://localhost:3000") */
  baseUrl: string;
  /** Tool naming prefix (default: "api") */
  toolPrefix?: string;
  /** Additional headers to include in requests */
  headers?: Record<string, string>;
}

/**
 * Generate MCP tools from an OpenAPI specification.
 *
 * Each API endpoint becomes a callable tool that AI agents can invoke.
 */
export function generateMCPToolsFromSpec(spec: OpenAPISpec, config: MCPToolsConfig): Tool[] {
  const tools: Tool[] = [];
  const toolPrefix = config.toolPrefix ?? "api";

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem) continue;

    for (const [method, operationValue] of Object.entries(pathItem)) {
      if (!isHttpMethod(method)) continue;

      const operation = operationValue as OpenAPIOperation | undefined;
      if (!operation) continue;

      tools.push(
        dynamicTool({
          id: `${toolPrefix}:${operation.operationId}`,
          description: buildToolDescription(operation, method, path),
          inputSchema: buildInputSchema(operation),
          execute: (input, context?) =>
            executeAPICall(
              config,
              method,
              path,
              input as Record<string, unknown>,
              operation,
              context,
            ),
          mcp: { enabled: true },
        }),
      );
    }
  }

  logger.debug("Generated tools", { count: tools.length });
  return tools;
}

function buildToolDescription(operation: OpenAPIOperation, method: string, path: string): string {
  const summary = operation.summary ?? `${method.toUpperCase()} ${path}`;
  const description = operation.description ? `\n\n${operation.description}` : "";
  const tags = operation.tags?.length ? `\n\nTags: ${operation.tags.join(", ")}` : "";
  const deprecated = operation.deprecated ? "\n\n⚠️ DEPRECATED" : "";

  return `${summary}${description}${tags}${deprecated}`;
}

function buildInputSchema(operation: OpenAPIOperation): Schema<unknown> {
  return lazySchema(defineSchema((v) => {
    const shape: Record<string, Schema<unknown>> = {};
    const params = operation.parameters ?? [];

    for (const param of params) {
      if (param.in !== "path") continue;
      shape[param.name] = withRequired(buildParamSchema(v, param), param.required);
    }

    addParamGroup(v, shape, params, "query", "query", "Query parameters");
    addParamGroup(v, shape, params, "header", "headers", "Request headers");

    if (operation.requestBody) {
      shape.body = v.record(v.string(), v.unknown()).optional().describe("Request body (JSON)");
    }

    return v.object(shape);
  }));
}

function addParamGroup(
  v: SchemaValidator,
  shape: Record<string, Schema<unknown>>,
  params: OpenAPIParameter[],
  paramIn: "query" | "header",
  key: "query" | "headers",
  description: string,
): void {
  const groupParams = params.filter((p) => p.in === paramIn);
  if (!groupParams.length) return;

  const groupShape: Record<string, Schema<unknown>> = {};
  for (const param of groupParams) {
    groupShape[param.name] = withRequired(buildParamSchema(v, param), param.required);
  }

  shape[key] = v.object(groupShape).optional().describe(description);
}

function withRequired(schema: Schema<unknown>, required?: boolean): Schema<unknown> {
  return required ? schema : schema.optional();
}

function buildParamSchema(
  v: SchemaValidator,
  param: OpenAPIParameter,
): Schema<unknown> {
  const schema = param.schema;
  if (!schema) return v.string();

  switch (schema.type) {
    case "integer":
    case "number":
      return v.coerce.number();
    case "boolean":
      return v.coerce.boolean();
    case "array":
      return v.array(v.string());
    default:
      return v.string();
  }
}

async function executeAPICall(
  config: MCPToolsConfig,
  method: string,
  path: string,
  input: Record<string, unknown>,
  operation: OpenAPIOperation,
  context?: ToolExecutionContext,
): Promise<unknown> {
  let url = `${config.baseUrl}${path}`;

  const params = operation.parameters ?? [];
  for (const param of params) {
    if (param.in !== "path") continue;

    const value = input[param.name];
    if (value === undefined) continue;

    url = url.replace(`{${param.name}}`, encodeURIComponent(String(value)));
  }

  const queryParams = input.query as Record<string, unknown> | undefined;
  if (queryParams && Object.keys(queryParams).length) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      if (value === undefined || value === null) continue;
      searchParams.append(key, String(value));
    }
    url += `?${searchParams.toString()}`;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...config.headers,
    ...((input.headers as Record<string, string> | undefined) ?? {}),
  };

  // Propagate end-user identity for per-user token resolution
  const endUserId = context?.endUserId;
  if (typeof endUserId === "string" && endUserId.length > 0) {
    headers["X-End-User-Id"] = endUserId;
  }

  const requestInit: RequestInit = {
    method: method.toUpperCase(),
    headers,
  };

  if (["post", "put", "patch"].includes(method) && input.body) {
    requestInit.body = JSON.stringify(input.body);
  }

  logger.debug("Executing API call", { method, url });

  try {
    const response = await fetch(url, requestInit);
    const contentType = response.headers.get("content-type") ?? "";

    let data: unknown;
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return {
      status: response.status,
      statusText: response.statusText,
      data,
    };
  } catch (error) {
    logger.error("API call failed", { method, url, error: String(error) });
    return {
      error: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
