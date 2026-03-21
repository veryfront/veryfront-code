import { getMCPRegistry, registerTool } from "./registry.ts";
import { executeTool } from "#veryfront/tool";
import type { ToolExecutionContext } from "#veryfront/tool";
import { zodToJsonSchema } from "#veryfront/tool/schema/index.ts";
import { resourceRegistry } from "#veryfront/resource";
import { promptRegistry } from "#veryfront/prompt";
import type { MCPServerConfig } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { validateContentType } from "#veryfront/security/input-validation/limits.ts";
import { VeryfrontError } from "#veryfront/security/input-validation/errors.ts";
import type { IntegrationRuntimeConfig } from "../integrations/types.ts";
import { logger as baseLogger } from "#veryfront/utils";

const logger = baseLogger.component("mcp-server");

const MAX_REQUEST_BODY_SIZE = 1_048_576; // 1 MB

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

export interface IntegrationLoaderConfig {
  integrations: Record<string, IntegrationRuntimeConfig | undefined>;
  apiBaseUrl: string;
  apiToken?: string;
}

export class MCPServer {
  private config: MCPServerConfig;
  private integrationLoader?: IntegrationLoaderConfig;
  private integrationsLoaded = false;

  constructor(config: MCPServerConfig) {
    this.config = config;

    if (!config.auth || config.auth.type === "none") {
      logger.warn("MCP server has no authentication configured — all requests will be accepted");
    }
  }

  /**
   * Configure integration tools to be lazily loaded on first tools/list call.
   * Integration tools are fetched from the API and registered in the global tool registry.
   */
  setIntegrationLoader(config: IntegrationLoaderConfig): void {
    this.integrationLoader = config;
    this.integrationsLoaded = false;
  }

  handleRequest(request: JSONRPCRequest, context?: ToolExecutionContext): Promise<JSONRPCResponse> {
    return withSpan(
      "mcp.handleRequest",
      async () => {
        try {
          const result = await this.dispatch(request.method, request.params, context);
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

  private dispatch(
    method: string,
    params: JSONRPCParams | undefined,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    switch (method) {
      case "tools/list":
        return this.listTools();
      case "tools/call":
        return this.callTool(params, context);
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

  private async listTools(): Promise<{ tools: Array<Record<string, unknown>> }> {
    // Lazily load integration tools on first call
    if (this.integrationLoader && !this.integrationsLoaded) {
      try {
        this.integrationsLoaded = await this.loadIntegrationTools(this.integrationLoader);
      } catch (_) {
        // expected: non-fatal integration loading failure; tools won't be available
        // Keep integrationsLoaded=false so a later tools/list can retry.
      }
    }

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

    return { tools };
  }

  private callTool(
    params: JSONRPCParams | undefined,
    context?: ToolExecutionContext,
  ): Promise<Record<string, unknown>> {
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
        const result = await executeTool(toolName, args, context);

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
      const requestOrigin = request.headers.get("Origin");
      if (request.method === "OPTIONS") return this.handleCORS(requestOrigin);

      if (this.config.auth?.type && this.config.auth.type !== "none") {
        const authorized = await this.validateAuth(request);
        if (!authorized) return new Response("Unauthorized", { status: 401 });
      }

      // Enforce request body size limit (fast path via Content-Length header)
      const contentLength = request.headers.get("content-length");
      if (contentLength && Number(contentLength) > MAX_REQUEST_BODY_SIZE) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Request body too large" },
          }),
          { status: 413, headers: { "Content-Type": "application/json" } },
        );
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
        const bodyText = await request.text();
        if (bodyText.length > MAX_REQUEST_BODY_SIZE) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32600, message: "Request body too large" },
            }),
            { status: 413, headers: { "Content-Type": "application/json" } },
          );
        }
        rpcRequest = JSON.parse(bodyText) as JSONRPCRequest;
      } catch (_) {
        // expected: malformed JSON in request body
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

      // Extract end-user identity from request headers for per-user token flows
      const context = this.extractRequestContext(request);
      const rpcResponse = await this.handleRequest(rpcRequest, context);

      return new Response(JSON.stringify(rpcResponse), {
        headers: {
          "Content-Type": "application/json",
          ...this.getCORSHeaders(requestOrigin),
        },
      });
    };
  }

  private extractRequestContext(request: Request): ToolExecutionContext | undefined {
    const context: ToolExecutionContext = {};

    const endUserId = request.headers.get("x-end-user-id");
    // Allowlist: alphanumeric, hyphens, underscores, dots, @ (for email-style IDs)
    if (endUserId && endUserId.length <= 255 && /^[a-zA-Z0-9._@-]+$/.test(endUserId)) {
      context.endUserId = endUserId;
    }

    const projectId = request.headers.get("x-project-id");
    // Keep project IDs strict but compatible with UUID/slug formats.
    if (projectId && projectId.length <= 255 && /^[a-zA-Z0-9._-]+$/.test(projectId)) {
      context.projectId = projectId;
    }

    return Object.keys(context).length > 0 ? context : undefined;
  }

  private async validateAuth(request: Request): Promise<boolean> {
    const auth = this.config.auth;
    if (!auth || auth.type === "none") return true;

    const authHeader = request.headers.get("Authorization");
    if (!authHeader) return false;

    if (auth.type !== "bearer") return false;

    const token = authHeader.replace("Bearer ", "");

    // When bearer auth is configured without a validate function, reject all requests
    if (!auth.validate) {
      logger.warn("Bearer auth configured without validate function — rejecting request");
      return false;
    }

    return await auth.validate(token);
  }

  private handleCORS(requestOrigin?: string | null): Response {
    return new Response(null, { status: 204, headers: this.getCORSHeaders(requestOrigin) });
  }

  private getCORSHeaders(requestOrigin?: string | null): Record<string, string> {
    if (!this.config.cors?.enabled) return {};

    const origins = this.config.cors.origins;
    if (!origins || origins.length === 0) return {};

    // Match request origin against the configured origins list
    const matchedOrigin = requestOrigin && origins.includes(requestOrigin)
      ? requestOrigin
      : undefined;

    if (!matchedOrigin) return {};

    return {
      "Access-Control-Allow-Origin": matchedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-End-User-Id, X-Project-Id",
    };
  }

  private async loadIntegrationTools(config: IntegrationLoaderConfig): Promise<boolean> {
    const { fetchConnector } = await import("../integrations/connector-fetcher.ts");
    const { createIntegrationTools } = await import("../integrations/tool-factory.ts");
    const { integrations, apiBaseUrl, apiToken } = config;
    let allConnectorsLoaded = true;

    for (const [name, integrationConfig] of Object.entries(integrations)) {
      const connector = await fetchConnector(name, apiBaseUrl, apiToken);
      if (!connector) {
        allConnectorsLoaded = false;
        continue;
      }

      const tools = createIntegrationTools(
        connector,
        integrationConfig ?? {},
        apiBaseUrl,
        apiToken,
      );
      for (const tool of tools) {
        registerTool(tool.id, tool);
      }
    }

    return allConnectorsLoaded;
  }
}

export function createMCPServer(config: MCPServerConfig): MCPServer {
  return new MCPServer(config);
}
