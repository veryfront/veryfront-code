
import { getMCPRegistry } from "./registry.ts";
import { executeTool, zodToJsonSchema } from "../utils/tool.ts";
import { resourceRegistry } from "./resource.ts";
import { promptRegistry } from "./prompt.ts";
import type { MCPServerConfig } from "../types/mcp.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

type JSONRPCParams = Record<string, unknown> | unknown[];

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: JSONRPCParams;
}

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

export class MCPServer {
  private config: MCPServerConfig;

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
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
  }

  private dispatch(method: string, params: JSONRPCParams | undefined): Promise<unknown> {
    switch (method) {
      case "tools/list":
        return this.listTools();

      case "tools/call":
        return this.callTool(params);

      case "resources/list":
        return this.listResources();

      case "resources/read":
        return this.readResource(params);

      case "prompts/list":
        return this.listPrompts();

      case "prompts/get":
        return this.getPrompt(params);

      case "initialize":
        return this.initialize(params);

      default:
        throw toError(createError({
          type: "agent",
          message: `Unknown method: ${method}`,
        }));
    }
  }

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

  private listTools(): Promise<{ tools: Array<Record<string, unknown>> }> {
    const registry = getMCPRegistry();
    const tools: Array<Record<string, unknown>> = [];

    for (const [id, tool] of registry.tools.entries()) {
      if (tool.mcp?.enabled !== false) {
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

  private async callTool(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const paramsObj = params as Record<string, unknown> | undefined;
    const { name, arguments: args } = paramsObj || {};

    if (!name) {
      throw toError(createError({
        type: "agent",
        message: "Tool name is required",
      }));
    }

    const result = await executeTool(name as string, args);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

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

  private async readResource(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const paramsObj = params as Record<string, unknown> | undefined;
    const { uri } = paramsObj || {};

    if (!uri) {
      throw toError(createError({
        type: "agent",
        message: "Resource URI is required",
      }));
    }

    const resource = resourceRegistry.findByPattern(uri as string);

    if (!resource) {
      throw toError(createError({
        type: "agent",
        message: `Resource not found: ${uri}`,
      }));
    }

    const resourceParams = resourceRegistry.extractParams(uri as string, resource.pattern);

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
  }

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

  private async getPrompt(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const paramsObj = params as Record<string, unknown> | undefined;
    const { name, arguments: args } = paramsObj || {};

    if (!name) {
      throw toError(createError({
        type: "agent",
        message: "Prompt name is required",
      }));
    }

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
  }

  createHTTPHandler(): (request: Request) => Promise<Response> {
    return async (request: Request) => {
      if (request.method === "OPTIONS") {
        return this.handleCORS();
      }

      if (this.config.auth && this.config.auth.type !== "none") {
        const authorized = await this.validateAuth(request);
        if (!authorized) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

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

  private handleCORS(): Response {
    return new Response(null, {
      status: 204,
      headers: this.getCORSHeaders(),
    });
  }

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

export function createMCPServer(config: MCPServerConfig): MCPServer {
  return new MCPServer(config);
}
