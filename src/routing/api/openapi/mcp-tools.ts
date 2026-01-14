/**
 * OpenAPI MCP Tools Generator
 *
 * Auto-generates MCP tools from OpenAPI specification, allowing AI agents
 * to call API endpoints directly.
 *
 * @module routing/api/openapi/mcp-tools
 */

import { dynamicTool } from "@veryfront/ai/utils/tool.ts";
import { z } from "zod";
import type { Tool } from "@veryfront/ai/types/tool.ts";
import type { OpenAPIOperation, OpenAPIParameter, OpenAPISpec } from "./types.ts";
import { logger } from "@veryfront/utils";

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
 *
 * @param spec - OpenAPI specification
 * @param config - Tool generation configuration
 * @returns Array of generated MCP tools
 *
 * @example
 * ```typescript
 * const spec = await generateOpenAPISpec(router, projectDir, adapter, config);
 * const tools = generateMCPToolsFromSpec(spec, {
 *   baseUrl: "http://localhost:3000",
 *   toolPrefix: "api",
 * });
 *
 * // Tools: api:getUsers, api:getUserById, api:createUser, etc.
 * for (const tool of tools) {
 *   registerTool(tool.id, tool);
 * }
 * ```
 */
export function generateMCPToolsFromSpec(
  spec: OpenAPISpec,
  config: MCPToolsConfig,
): Tool[] {
  const tools: Tool[] = [];
  const toolPrefix = config.toolPrefix || "api";

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem) continue;

    for (const [method, operationValue] of Object.entries(pathItem)) {
      if (!isHttpMethod(method)) continue;

      const operation = operationValue as OpenAPIOperation;
      if (!operation) continue;

      const toolId = `${toolPrefix}:${operation.operationId}`;
      const inputSchema = buildInputSchema(operation);

      const generatedTool = dynamicTool({
        id: toolId,
        description: buildToolDescription(operation, method, path),
        inputSchema,
        execute: (input) => {
          return executeAPICall(config, method, path, input as Record<string, unknown>, operation);
        },
        mcp: { enabled: true },
      });

      tools.push(generatedTool);
    }
  }

  logger.debug("[OpenAPI MCP] Generated tools", { count: tools.length });
  return tools;
}

/**
 * Build a descriptive summary for the tool.
 */
function buildToolDescription(operation: OpenAPIOperation, method: string, path: string): string {
  const summary = operation.summary || `${method.toUpperCase()} ${path}`;
  const description = operation.description ? `\n\n${operation.description}` : "";
  const tags = operation.tags?.length ? `\n\nTags: ${operation.tags.join(", ")}` : "";
  const deprecated = operation.deprecated ? "\n\n⚠️ DEPRECATED" : "";

  return `${summary}${description}${tags}${deprecated}`;
}

/**
 * Build Zod input schema from OpenAPI operation parameters.
 */
function buildInputSchema(operation: OpenAPIOperation): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  const requiredFields: string[] = [];

  // Process parameters
  const params = operation.parameters || [];

  // Path parameters
  for (const param of params.filter((p) => p.in === "path")) {
    const paramSchema = buildParamSchema(param);
    shape[param.name] = param.required ? paramSchema : paramSchema.optional();
    if (param.required) {
      requiredFields.push(param.name);
    }
  }

  // Query parameters as nested object
  const queryParams = params.filter((p) => p.in === "query");
  if (queryParams.length > 0) {
    const queryShape: Record<string, z.ZodTypeAny> = {};
    for (const param of queryParams) {
      const paramSchema = buildParamSchema(param);
      queryShape[param.name] = param.required ? paramSchema : paramSchema.optional();
    }
    shape.query = z.object(queryShape).optional().describe("Query parameters");
  }

  // Header parameters as nested object
  const headerParams = params.filter((p) => p.in === "header");
  if (headerParams.length > 0) {
    const headerShape: Record<string, z.ZodTypeAny> = {};
    for (const param of headerParams) {
      const paramSchema = buildParamSchema(param);
      headerShape[param.name] = param.required ? paramSchema : paramSchema.optional();
    }
    shape.headers = z.object(headerShape).optional().describe("Request headers");
  }

  // Request body
  if (operation.requestBody) {
    shape.body = z.record(z.unknown()).optional().describe("Request body (JSON)");
  }

  return z.object(shape);
}

/**
 * Build a Zod schema for a single parameter based on its OpenAPI schema.
 */
function buildParamSchema(param: OpenAPIParameter): z.ZodTypeAny {
  const schema = param.schema;

  if (!schema) {
    return z.string();
  }

  // Handle basic types
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

/**
 * Execute an API call based on tool input.
 */
async function executeAPICall(
  config: MCPToolsConfig,
  method: string,
  path: string,
  input: Record<string, unknown>,
  operation: OpenAPIOperation,
): Promise<unknown> {
  // Build URL with path parameters
  let url = `${config.baseUrl}${path}`;

  // Replace path parameters
  const params = operation.parameters || [];
  for (const param of params.filter((p) => p.in === "path")) {
    const value = input[param.name];
    if (value !== undefined) {
      url = url.replace(`{${param.name}}`, encodeURIComponent(String(value)));
    }
  }

  // Add query parameters
  const queryParams = input.query as Record<string, unknown> | undefined;
  if (queryParams && Object.keys(queryParams).length > 0) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    url += `?${searchParams.toString()}`;
  }

  // Build headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...config.headers,
  };

  // Add custom headers from input
  const inputHeaders = input.headers as Record<string, string> | undefined;
  if (inputHeaders) {
    Object.assign(headers, inputHeaders);
  }

  // Build request options
  const requestInit: RequestInit = {
    method: method.toUpperCase(),
    headers,
  };

  // Add body for methods that support it
  if (["post", "put", "patch"].includes(method) && input.body) {
    requestInit.body = JSON.stringify(input.body);
  }

  // Execute request
  logger.debug("[OpenAPI MCP] Executing API call", { method, url });

  try {
    const response = await fetch(url, requestInit);

    // Parse response
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const data = await response.json();
      return {
        status: response.status,
        statusText: response.statusText,
        data,
      };
    }

    const text = await response.text();
    return {
      status: response.status,
      statusText: response.statusText,
      data: text,
    };
  } catch (error) {
    logger.error("[OpenAPI MCP] API call failed", { method, url, error: String(error) });
    return {
      error: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
