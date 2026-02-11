import { getMCPRegistry } from "./registry.ts";
import { executeTool } from "#veryfront/tool";
import { zodToJsonSchema } from "#veryfront/tool/schema/index.ts";
import { resourceRegistry } from "#veryfront/resource";
import { promptRegistry } from "#veryfront/prompt";
import type { MCPServerConfig } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { validateContentType } from "#veryfront/security/input-validation/limits.ts";
import { VeryfrontError } from "#veryfront/security/input-validation/errors.ts";

type JSONRPCParams = Record<string, unknown> | unknown[];

function asParamsRecord(params: JSONRPCParams | undefined): Record<string, unknown> {
  if (!params || Array.isArray(params)) return {};
  return params;
}

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

  handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    return withSpan(
      "mcp.handleRequest",
      async () => {
        try {
          const result = await this.dispatch(request.method, request.params);
          return { jsonrpc: "2.0", id: request.id, result };
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
      },
      { "mcp.method": request.method },
    );
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
        throw toError(
          createError({
            type: "agent",
            message: `Unknown method: ${method}`,
          }),
        );
    }
  }

  private initialize(_params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    return Promise.resolve({
      protocolVersion: "2024-11-05",
      serverInfo: { name: "veryfront-mcp", version: VERSION },
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
      if (tool.mcp?.enabled === false) continue;

      tools.push({
        name: id,
        description: tool.description,
        inputSchema: tool.inputSchemaJson ?? zodToJsonSchema(tool.inputSchema),
      });
    }

    return Promise.resolve({ tools });
  }

  private callTool(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const { name, arguments: args } = asParamsRecord(params);

    if (!name) {
      throw toError(
        createError({
          type: "agent",
          message: "Tool name is required",
        }),
      );
    }

    const toolName = String(name);

    return withSpan(
      "mcp.callTool",
      async () => {
        const result = await executeTool(toolName, args);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      },
      { "mcp.tool.name": toolName },
    );
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

  private readResource(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const { uri } = asParamsRecord(params);

    if (!uri) {
      throw toError(
        createError({
          type: "agent",
          message: "Resource URI is required",
        }),
      );
    }

    const resourceUri = String(uri);

    return withSpan(
      "mcp.readResource",
      async () => {
        const resource = resourceRegistry.findByPattern(resourceUri);

        if (!resource) {
          throw toError(
            createError({
              type: "agent",
              message: `Resource not found: ${resourceUri}`,
            }),
          );
        }

        const resourceParams = resourceRegistry.extractParams(resourceUri, resource.pattern);
        const data = await resource.load(resourceParams);

        return {
          contents: [
            {
              uri: resourceUri,
              mimeType: "application/json",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      },
      { "mcp.resource.uri": resourceUri },
    );
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

  private getPrompt(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const { name, arguments: args } = asParamsRecord(params);

    if (!name) {
      throw toError(
        createError({
          type: "agent",
          message: "Prompt name is required",
        }),
      );
    }

    const promptName = String(name);

    return withSpan(
      "mcp.getPrompt",
      async () => {
        const content = await promptRegistry.getContent(
          promptName,
          args as Record<string, unknown> | undefined,
        );

        return {
          description: `Prompt: ${promptName}`,
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
      },
      { "mcp.prompt.name": promptName },
    );
  }

  createHTTPHandler(): (request: Request) => Promise<Response> {
    return async (request: Request) => {
      if (request.method === "OPTIONS") return this.handleCORS();

      if (this.config.auth?.type && this.config.auth.type !== "none") {
        const authorized = await this.validateAuth(request);
        if (!authorized) return new Response("Unauthorized", { status: 401 });
      }

      try {
        validateContentType(request, "application/json");
      } catch (error) {
        const message = error instanceof VeryfrontError ? error.message : "Invalid Content-Type";
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      let rpcRequest: JSONRPCRequest;
      try {
        rpcRequest = await request.json();
      } catch {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const rpcResponse = await this.handleRequest(rpcRequest);

      return new Response(JSON.stringify(rpcResponse), {
        headers: {
          "Content-Type": "application/json",
          ...this.getCORSHeaders(),
        },
      });
    };
  }

  private async validateAuth(request: Request): Promise<boolean> {
    const auth = this.config.auth;
    if (!auth || auth.type === "none") return true;

    const authHeader = request.headers.get("Authorization");
    if (!authHeader) return false;

    if (auth.type !== "bearer") return false;

    const token = authHeader.replace("Bearer ", "");
    if (!auth.validate) return false;

    return await auth.validate(token);
  }

  private handleCORS(): Response {
    return new Response(null, { status: 204, headers: this.getCORSHeaders() });
  }

  private getCORSHeaders(): Record<string, string> {
    if (!this.config.cors?.enabled) return {};

    const origin = this.config.cors.origins?.[0] ?? "*";

    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
  }
}

export function createMCPServer(config: MCPServerConfig): MCPServer {
  return new MCPServer(config);
}
