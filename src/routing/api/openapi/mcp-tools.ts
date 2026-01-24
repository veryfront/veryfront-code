/**
 * OpenAPI MCP Tools Generator
 *
 * Auto-generates MCP tools from OpenAPI specification, allowing AI agents
 * to call API endpoints directly.
 *
 * @module routing/api/openapi/mcp-tools
 */

import { dynamicTool } from "#veryfront/tool";
import type { Tool } from "#veryfront/tool";
import { logger } from "#veryfront/utils";
import { z } from "zod";
import type { OpenAPIOperation, OpenAPIParameter, OpenAPISpec } from "./types.ts";

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
          execute: (input) =>
            executeAPICall(config, method, path, input as Record<string, unknown>, operation),
          mcp: { enabled: true },
        }),
      );
    }
  }

  logger.debug("[OpenAPI MCP] Generated tools", { count: tools.length });
  return tools;
}

function buildToolDescription(operation: OpenAPIOperation, method: string, path: string): string {
  const summary = operation.summary ?? `${method.toUpperCase()} ${path}`;
  const description = operation.description ? `\n\n${operation.description}` : "";
  const tags = operation.tags?.length ? `\n\nTags: ${operation.tags.join(", ")}` : "";
  const deprecated = operation.deprecated ? "\n\n⚠️ DEPRECATED" : "";

  return `${summary}${description}${tags}${deprecated}`;
}

function buildInputSchema(operation: OpenAPIOperation): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  const params = operation.parameters ?? [];

  for (const param of params) {
    if (param.in !== "path") continue;
    const paramSchema = buildParamSchema(param);
    shape[param.name] = param.required ? paramSchema : paramSchema.optional();
  }

  const queryParams = params.filter((p) => p.in === "query");
  if (queryParams.length) {
    const queryShape: Record<string, z.ZodTypeAny> = {};
    for (const param of queryParams) {
      const paramSchema = buildParamSchema(param);
      queryShape[param.name] = param.required ? paramSchema : paramSchema.optional();
    }
    shape.query = z.object(queryShape).optional().describe("Query parameters");
  }

  const headerParams = params.filter((p) => p.in === "header");
  if (headerParams.length) {
    const headerShape: Record<string, z.ZodTypeAny> = {};
    for (const param of headerParams) {
      const paramSchema = buildParamSchema(param);
      headerShape[param.name] = param.required ? paramSchema : paramSchema.optional();
    }
    shape.headers = z.object(headerShape).optional().describe("Request headers");
  }

  if (operation.requestBody) {
    shape.body = z.record(z.unknown()).optional().describe("Request body (JSON)");
  }

  return z.object(shape);
}

function buildParamSchema(param: OpenAPIParameter): z.ZodTypeAny {
  const schema = param.schema;
  if (!schema) return z.string();

  switch (schema.type) {
    case "integer":
    case "number":
      return z.coerce.number();
    case "boolean":
      return z.coerce.boolean();
    case "array":
      return z.array(z.string());
    default:
      return z.string();
  }
}

async function executeAPICall(
  config: MCPToolsConfig,
  method: string,
  path: string,
  input: Record<string, unknown>,
  operation: OpenAPIOperation,
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
    ...(input.headers as Record<string, string> | undefined),
  };

  const requestInit: RequestInit = {
    method: method.toUpperCase(),
    headers,
  };

  if (["post", "put", "patch"].includes(method) && input.body) {
    requestInit.body = JSON.stringify(input.body);
  }

  logger.debug("[OpenAPI MCP] Executing API call", { method, url });

  try {
    const response = await fetch(url, requestInit);
    const contentType = response.headers.get("content-type") ?? "";

    const data = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    return {
      status: response.status,
      statusText: response.statusText,
      data,
    };
  } catch (error) {
    logger.error("[OpenAPI MCP] API call failed", { method, url, error: String(error) });
    return {
      error: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
