/**
 * MCP Server Implementation
 *
 * Implements the Model Context Protocol (MCP) specification.
 * Exposes tools, resources, and prompts via JSON-RPC 2.0.
 *
 * @module veryfront/mcp
 */

import { getMCPRegistry } from "./registry.ts";
import { executeTool, zodToJsonSchema } from "#veryfront/tool";
import { resourceRegistry } from "#veryfront/resource";
import { promptRegistry } from "#veryfront/prompt";
import type { MCPServerConfig } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

/**
 * JSON-RPC 2.0 Params type
 */
type JSONRPCParams = Record<string, unknown> | unknown[];

/**
 * Safely extract params as a record for methods that expect object params
 */
function asParamsRecord(params: JSONRPCParams | undefined): Record<string, unknown> {
  if (!params || Array.isArray(params)) {
    return {};
  }
  return params;
}

/**
 * JSON-RPC 2.0 Request
 */
interface JSONRPCRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: JSONRPCParams;
}

/**
 * JSON-RPC 2.0 Response
 */
interface JSONRPCResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * MCP Server
 *
 * @example
 * ```typescript
 * import { createMCPServer } from 'veryfront/mcp';
 *
 * const server = createMCPServer({
 *   enabled: true,
 *   cors: { enabled: true },
 *   auth: { type: 'bearer', validate: (token) => token === 'secret' },
 * });
 *
 * // Use with HTTP server
 * const handler = server.createHTTPHandler();
 * ```
 */
export class MCPServer {
  private config: MCPServerConfig;

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  /**
   * Handle JSON-RPC request
   */
  handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    return withSpan("mcp.handleRequest", async () => {
      try {
        const result = await this.dispatch(request.method, request.params);

        return {
          jsonrpc: "2.0",
          id: request.id,
          result,
        };
      } catch (error) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }, { "mcp.method": request.method });
  }

  /**
   * Dispatch request to appropriate handler
   */
  private dispatch(method: string, params: JSONRPCParams | undefined): Promise<unknown> {
    switch (method) {
      // Tool methods
      case "tools/list":
        return this.listTools();

      case "tools/call":
        return this.callTool(params);

      // Resource methods
      case "resources/list":
        return this.listResources();

      case "resources/read":
        return this.readResource(params);

      // Prompt methods
      case "prompts/list":
        return this.listPrompts();

      case "prompts/get":
        return this.getPrompt(params);

      // Server info
      case "initialize":
        return this.initialize(params);

      default:
        throw toError(createError({
          type: "agent",
          message: `Unknown method: ${method}`,
        }));
    }
  }

  /**
   * Initialize connection
   */
  private initialize(_params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    return Promise.resolve({
      protocolVersion: "2024-11-05",
      serverInfo: {
        name: "veryfront-mcp",
        version: "0.1.0",
      },
      capabilities: {
        tools: {},
        resources: { subscribe: true },
        prompts: {},
      },
    });
  }

  /**
   * List all available tools
   */
  private listTools(): Promise<{ tools: Array<Record<string, unknown>> }> {
    const registry = getMCPRegistry();
    const tools: Array<Record<string, unknown>> = [];

    for (const [id, tool] of registry.tools.entries()) {
      // Only expose tools with MCP enabled
      if (tool.mcp?.enabled !== false) {
        // Use pre-converted schema or convert at runtime
        const inputSchema = tool.inputSchemaJson || zodToJsonSchema(tool.inputSchema);

        tools.push({
          name: id,
          description: tool.description,
          inputSchema,
        });
      }
    }

    return Promise.resolve({ tools });
  }

  /**
   * Call a tool
   */
  private callTool(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const { name, arguments: args } = asParamsRecord(params);

    if (!name) {
      throw toError(createError({
        type: "agent",
        message: "Tool name is required",
      }));
    }

    return withSpan("mcp.callTool", async () => {
      const result = await executeTool(name as string, args);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }, { "mcp.tool.name": name as string });
  }

  /**
   * List all available resources
   */
  private listResources(): Promise<{ resources: Array<Record<string, unknown>> }> {
    const registry = getMCPRegistry();
    const resources: Array<Record<string, unknown>> = [];

    for (const [id, resource] of registry.resources.entries()) {
      resources.push({
        uri: resource.pattern,
        name: id,
        description: resource.description,
        mimeType: "application/json",
      });
    }

    return Promise.resolve({ resources });
  }

  /**
   * Read a resource
   */
  private readResource(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const { uri } = asParamsRecord(params);

    if (!uri) {
      throw toError(createError({
        type: "agent",
        message: "Resource URI is required",
      }));
    }

    return withSpan("mcp.readResource", async () => {
      const resource = resourceRegistry.findByPattern(uri as string);

      if (!resource) {
        throw toError(createError({
          type: "agent",
          message: `Resource not found: ${uri}`,
        }));
      }

      // Extract params from URI
      const resourceParams = resourceRegistry.extractParams(uri as string, resource.pattern);

      // Load resource data
      const data = await resource.load(resourceParams);

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }, { "mcp.resource.uri": uri as string });
  }

  /**
   * List all available prompts
   */
  private listPrompts(): Promise<{ prompts: Array<Record<string, unknown>> }> {
    const registry = getMCPRegistry();
    const prompts: Array<Record<string, unknown>> = [];

    for (const [id, promptInstance] of registry.prompts.entries()) {
      prompts.push({
        name: id,
        description: promptInstance.description,
      });
    }

    return Promise.resolve({ prompts });
  }

  /**
   * Get a prompt
   */
  private getPrompt(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const { name, arguments: args } = asParamsRecord(params);

    if (!name) {
      throw toError(createError({
        type: "agent",
        message: "Prompt name is required",
      }));
    }

    return withSpan("mcp.getPrompt", async () => {
      const content = await promptRegistry.getContent(
        name as string,
        args as Record<string, unknown> | undefined,
      );

      return {
        description: `Prompt: ${name}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: content,
            },
          },
        ],
      };
    }, { "mcp.prompt.name": name as string });
  }

  /**
   * Create HTTP handler for MCP server
   */
  createHTTPHandler(): (request: Request) => Promise<Response> {
    return async (request: Request) => {
      // Handle CORS
      if (request.method === "OPTIONS") {
        return this.handleCORS();
      }

      // Validate auth
      if (this.config.auth && this.config.auth.type !== "none") {
        const authorized = await this.validateAuth(request);
        if (!authorized) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      // Parse JSON-RPC request
      try {
        const rpcRequest: JSONRPCRequest = await request.json();
        const rpcResponse = await this.handleRequest(rpcRequest);

        return new Response(JSON.stringify(rpcResponse), {
          headers: {
            "Content-Type": "application/json",
            ...this.getCORSHeaders(),
          },
        });
      } catch {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32700,
              message: "Parse error",
            },
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }
    };
  }

  /**
   * Validate authentication
   */
  private async validateAuth(request: Request): Promise<boolean> {
    if (!this.config.auth || this.config.auth.type === "none") {
      return true;
    }

    const authHeader = request.headers.get("Authorization");

    if (!authHeader) {
      return false;
    }

    if (this.config.auth.type === "bearer") {
      const token = authHeader.replace("Bearer ", "");

      if (this.config.auth.validate) {
        return await this.config.auth.validate(token);
      }

      return false;
    }

    return false;
  }

  /**
   * Handle CORS preflight
   */
  private handleCORS(): Response {
    return new Response(null, {
      status: 204,
      headers: this.getCORSHeaders(),
    });
  }

  /**
   * Get CORS headers
   */
  private getCORSHeaders(): Record<string, string> {
    if (!this.config.cors?.enabled) {
      return {};
    }

    const origins = this.config.cors.origins || ["*"];

    return {
      "Access-Control-Allow-Origin": origins[0] || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
  }
}

/**
 * Create an MCP server instance
 *
 * @example
 * ```typescript
 * import { createMCPServer } from 'veryfront/mcp';
 *
 * const server = createMCPServer({
 *   enabled: true,
 *   cors: { enabled: true, origins: ['https://example.com'] },
 * });
 *
 * const handler = server.createHTTPHandler();
 * ```
 */
export function createMCPServer(config: MCPServerConfig): MCPServer {
  return new MCPServer(config);
}
