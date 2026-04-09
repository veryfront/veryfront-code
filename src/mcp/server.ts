import { getMCPRegistry } from "./registry.ts";
import { executeTool } from "#veryfront/tool";
import type { ToolExecutionContext } from "#veryfront/tool";
import { zodToJsonSchema } from "#veryfront/tool/schema/index.ts";
import { resourceRegistry } from "#veryfront/resource";
import { promptRegistry } from "#veryfront/prompt";
import type { MCPServerConfig, ToolListEntry } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { validateContentType } from "#veryfront/security/input-validation/limits.ts";
import { VeryfrontError } from "#veryfront/security/input-validation/errors.ts";
import type { IntegrationRuntimeConfig } from "../integrations/types.ts";
import { logger as baseLogger } from "#veryfront/utils";
import { SessionManager } from "./session.ts";

const logger = baseLogger.component("mcp-server");

const MAX_REQUEST_BODY_SIZE = 1_048_576; // 1 MB
const MAX_CONTEXT_HEADER_LENGTH = 255;
const JSON_CONTENT_TYPE = "application/json";
const END_USER_ID_PATTERN = /^[a-zA-Z0-9._@-]+$/;
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

type JSONRPCParams = Record<string, unknown> | unknown[];

class JsonRpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function errorCode(error: unknown): number {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "number") return code;
  }
  return -32603;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function toParamsRecord(params: JSONRPCParams | undefined): Record<string, unknown> {
  if (!params || Array.isArray(params)) return {};
  return params;
}

function createJSONResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", JSON_CONTENT_TYPE);
  return new Response(JSON.stringify(body), { ...init, headers });
}

function createJSONRPCErrorResponse(status: number, code: number, message: string): Response {
  return createJSONResponse(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code, message },
    },
    { status },
  );
}

function readAllowedHeader(
  request: Request,
  headerName: string,
  pattern: RegExp,
): string | undefined {
  const value = request.headers.get(headerName);
  if (!value || value.length > MAX_CONTEXT_HEADER_LENGTH || !pattern.test(value)) {
    return undefined;
  }
  return value;
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

const MCP_SUPPORTED_VERSIONS = ["2025-11-25", "2024-11-05"];

export class MCPServer {
  private static LOG_LEVELS = [
    "debug",
    "info",
    "notice",
    "warning",
    "error",
    "critical",
    "alert",
    "emergency",
  ] as const;
  private logLevel: typeof MCPServer.LOG_LEVELS[number] = "warning";
  private config: MCPServerConfig;
  private integrationLoader?: IntegrationLoaderConfig;
  private integrationsLoaded = false;
  private sessionManager = new SessionManager();

  constructor(config: MCPServerConfig) {
    this.config = config;

    if (!config.auth || config.auth.type === "none") {
      logger.warn("MCP server has no authentication configured — all requests will be accepted");
    }
  }

  /**
   * Configure integration tools to be loaded from the API.
   *
   * When API-side integration tools are available (apiBaseUrl + apiToken),
   * tools are loaded remotely via the API's /integrations/tools/list endpoint.
   * Otherwise falls back to the legacy local loading path.
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
            error: { code: errorCode(error), message: errorMessage(error) },
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
        return this.listTools(params);
      case "tools/call":
        return this.callTool(params, context);
      case "resources/list":
        return this.listResources(params);
      case "resources/read":
        return this.readResource(params);
      case "resources/templates/list":
        return this.listResourceTemplates(params);
      case "prompts/list":
        return this.listPrompts(params);
      case "prompts/get":
        return this.getPrompt(params);
      case "initialize":
        return this.initialize(params);
      case "notifications/initialized":
        return Promise.resolve({});
      case "notifications/cancelled":
        // TODO(#841): propagate cancellation to in-flight tool executions via AbortController
        return Promise.resolve({});
      case "completion/complete":
        return this.complete(params);
      case "logging/setLevel":
        return this.setLogLevel(params);
      default:
        throw toError(
          createError({
            type: "agent",
            message: `Unknown method: ${method}`,
          }),
        );
    }
  }

  private initialize(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const p = toParamsRecord(params);
    const requested = typeof p.protocolVersion === "string" ? p.protocolVersion : undefined;
    const negotiated = requested && MCP_SUPPORTED_VERSIONS.includes(requested)
      ? requested
      : MCP_SUPPORTED_VERSIONS[0];

    return Promise.resolve({
      protocolVersion: negotiated,
      serverInfo: {
        name: "veryfront-mcp",
        title: "Veryfront MCP Server",
        version: VERSION,
        description:
          "Veryfront development server tools for real-time errors, route preview, HMR control, and scaffolding",
      },
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        prompts: { listChanged: true },
        completions: {},
        logging: {},
      },
      instructions:
        "Veryfront MCP server provides development tools. Use vf_get_errors to check for code errors, vf_get_logs for server logs, vf_scaffold for code generation, and vf_get_project_context for project structure.",
    });
  }

  private async listTools(_params?: JSONRPCParams): Promise<{ tools: ToolListEntry[] }> {
    // Sync integration config to API on first tools/list call
    if (this.integrationLoader && !this.integrationsLoaded) {
      try {
        this.integrationsLoaded = await this.loadRemoteIntegrationTools(this.integrationLoader);
      } catch (_) {
        // Config sync failed — non-fatal, integration tools from API won't reflect config
      }
    }

    const registry = getMCPRegistry();
    const tools: ToolListEntry[] = [];

    for (const [id, tool] of registry.tools.entries()) {
      if (tool.mcp?.enabled === false) continue;

      const entry: ToolListEntry = {
        name: id,
        description: tool.description,
        inputSchema: tool.inputSchemaJson ?? zodToJsonSchema(tool.inputSchema),
      };
      if (tool.mcp?.title) entry.title = tool.mcp.title;
      if (tool.mcp?.annotations) entry.annotations = tool.mcp.annotations;
      tools.push(entry);
    }

    return { tools };
  }

  private callTool(
    params: JSONRPCParams | undefined,
    context?: ToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    const p = toParamsRecord(params);
    const { name, arguments: args } = p;
    const meta = (p._meta ?? {}) as Record<string, unknown>;
    const rawToken = meta.progressToken;
    const progressToken = (typeof rawToken === "string" || typeof rawToken === "number")
      ? rawToken
      : undefined;

    if (!name) {
      throw toError(createError({ type: "agent", message: "Tool name is required" }));
    }

    const toolName = String(name);

    const registry = getMCPRegistry();
    const tool = registry.tools.get(toolName);
    if (!tool) {
      throw new JsonRpcError(-32602, `Unknown tool: ${toolName}`);
    }

    if (tool.inputSchema && typeof tool.inputSchema.parse === "function") {
      try {
        tool.inputSchema.parse(args ?? {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new JsonRpcError(-32602, `Invalid arguments for tool ${toolName}: ${message}`);
      }
    }

    const toolContext: ToolExecutionContext | undefined = progressToken !== undefined
      ? { ...context, progressToken }
      : context;

    return withSpan(
      "mcp.callTool",
      async () => {
        try {
          const result = await executeTool(toolName, args, toolContext);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: false,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: message }],
            isError: true,
          };
        }
      },
      { "mcp.tool.name": toolName },
    );
  }

  private listResourceTemplates(
    _params?: JSONRPCParams,
  ): Promise<{ resourceTemplates: Array<Record<string, unknown>> }> {
    const registry = getMCPRegistry();
    const templates: Array<Record<string, unknown>> = [];

    for (const [id, resource] of registry.resources.entries()) {
      if (/:(\w+)/.test(resource.pattern)) {
        const uriTemplate = resource.pattern.replace(/:(\w+)/g, "{$1}");
        const entry: Record<string, unknown> = {
          uriTemplate,
          name: id,
          description: resource.description,
          mimeType: "application/json",
        };
        if (resource.title) entry.title = resource.title;
        templates.push(entry);
      }
    }

    return Promise.resolve({ resourceTemplates: templates });
  }

  private listResources(
    _params?: JSONRPCParams,
  ): Promise<{ resources: Array<Record<string, unknown>> }> {
    const registry = getMCPRegistry();
    const resources: Array<Record<string, unknown>> = [];

    for (const [id, resource] of registry.resources.entries()) {
      const entry: Record<string, unknown> = {
        uri: resource.pattern,
        name: id,
        description: resource.description,
        mimeType: "application/json",
      };
      if (resource.title) entry.title = resource.title;
      resources.push(entry);
    }

    return Promise.resolve({ resources });
  }

  private readResource(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const { uri } = toParamsRecord(params);

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

  private listPrompts(
    _params?: JSONRPCParams,
  ): Promise<{ prompts: Array<Record<string, unknown>> }> {
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
    const { name, arguments: args } = toParamsRecord(params);

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

  private complete(
    _params: JSONRPCParams | undefined,
  ): Promise<{ completion: { values: string[]; total?: number; hasMore: boolean } }> {
    // Stub: returns empty completions for all refs.
    // Real logic will resolve values from resource templates and prompts.
    return Promise.resolve({
      completion: { values: [], total: 0, hasMore: false },
    });
  }

  private setLogLevel(
    params: JSONRPCParams | undefined,
  ): Promise<Record<string, unknown>> {
    const p = toParamsRecord(params);
    const level = p.level as string;
    if (
      !MCPServer.LOG_LEVELS.includes(
        level as typeof MCPServer.LOG_LEVELS[number],
      )
    ) {
      return Promise.reject({
        code: -32602,
        message: `Invalid log level: ${level}. Valid levels: ${MCPServer.LOG_LEVELS.join(", ")}`,
      });
    }
    this.logLevel = level as typeof MCPServer.LOG_LEVELS[number];
    return Promise.resolve({});
  }

  createHTTPHandler(): (request: Request) => Promise<Response> {
    return async (request: Request) => {
      const requestOrigin = request.headers.get("Origin");

      // CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: this.getCORSHeaders(requestOrigin) });
      }

      // Origin validation (DNS rebinding protection)
      if (requestOrigin && this.config.cors?.enabled && this.config.cors.origins?.length) {
        if (!this.config.cors.origins.includes(requestOrigin)) {
          return createJSONRPCErrorResponse(403, -32600, "Forbidden: Origin not allowed");
        }
      }

      // Auth check (applies to all methods including DELETE)
      if (this.config.auth?.type && this.config.auth.type !== "none") {
        const authorized = await this.validateAuth(request);
        if (!authorized) return new Response("Unauthorized", { status: 401 });
      }

      // DELETE = terminate session
      if (request.method === "DELETE") {
        const sessionId = request.headers.get("MCP-Session-Id");
        if (sessionId) this.sessionManager.terminate(sessionId);
        return new Response(null, { status: 200, headers: this.getCORSHeaders(requestOrigin) });
      }

      // Only POST allowed for JSON-RPC messages
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      // Enforce request body size limit (fast path via Content-Length header)
      const contentLength = request.headers.get("content-length");
      if (contentLength && Number(contentLength) > MAX_REQUEST_BODY_SIZE) {
        return createJSONRPCErrorResponse(413, -32600, "Request body too large");
      }

      try {
        validateContentType(request, JSON_CONTENT_TYPE);
      } catch (error) {
        const message = error instanceof VeryfrontError ? error.message : "Invalid Content-Type";
        return createJSONRPCErrorResponse(400, -32700, message);
      }

      let rpcRequest: JSONRPCRequest;
      try {
        const bodyText = await request.text();
        if (bodyText.length > MAX_REQUEST_BODY_SIZE) {
          return createJSONRPCErrorResponse(413, -32600, "Request body too large");
        }
        rpcRequest = JSON.parse(bodyText) as JSONRPCRequest;
      } catch (_) {
        // expected: malformed JSON in request body
        return createJSONRPCErrorResponse(400, -32700, "Parse error");
      }

      // Session management: initialize creates session, everything else requires it
      const responseHeaders: Record<string, string> = {
        ...this.getCORSHeaders(requestOrigin),
      };

      if (rpcRequest.method === "initialize") {
        const context = this.extractRequestContext(request);
        const rpcResponse = await this.handleRequest(rpcRequest, context);
        const sessionId = this.sessionManager.create();
        responseHeaders["MCP-Session-Id"] = sessionId;
        return createJSONResponse(rpcResponse, { headers: responseHeaders });
      }

      // Post-init: require session ID when sessions are active
      if (this.sessionManager.size > 0) {
        const sessionId = request.headers.get("MCP-Session-Id");
        if (!sessionId) {
          return createJSONRPCErrorResponse(400, -32600, "Missing MCP-Session-Id header");
        }
        if (!this.sessionManager.isValid(sessionId)) {
          return createJSONRPCErrorResponse(404, -32600, "Session not found or expired");
        }
      }

      // Notifications have no id member — return 202 Accepted
      // Note: id:0 is a valid request ID per JSON-RPC 2.0, so check for undefined
      if (rpcRequest.id === undefined) {
        const context = this.extractRequestContext(request);
        await this.handleRequest(rpcRequest, context);
        return new Response(null, { status: 202, headers: responseHeaders });
      }

      const context = this.extractRequestContext(request);
      const rpcResponse = await this.handleRequest(rpcRequest, context);
      return createJSONResponse(rpcResponse, { headers: responseHeaders });
    };
  }

  private extractRequestContext(request: Request): ToolExecutionContext | undefined {
    const context: ToolExecutionContext = {};

    const endUserId = readAllowedHeader(request, "x-end-user-id", END_USER_ID_PATTERN);
    if (endUserId) {
      context.endUserId = endUserId;
    }

    const projectId = readAllowedHeader(request, "x-project-id", PROJECT_ID_PATTERN);
    if (projectId) {
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

    // z.function() in v4 doesn't carry arg/return types — cast to expected signature
    const validate = auth.validate as (token: string) => Promise<boolean>;
    return await validate(token);
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
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, MCP-Session-Id, X-End-User-Id, X-Project-Id",
      "Vary": "Origin",
    };
  }

  private async loadRemoteIntegrationTools(config: IntegrationLoaderConfig): Promise<boolean> {
    const { apiBaseUrl, apiToken } = config;
    if (!apiToken) return false; // No token means we can't call the API

    const { syncIntegrationConfig } = await import(
      "../integrations/remote-tools.ts"
    );

    // Sync config to API — this is the only responsibility of the MCP server path.
    // Actual tool discovery happens per-request in the agent runtime (getAvailableTools)
    // and the API's MCP tools/list handler.
    const integrationConfigs: Record<string, { scope?: string; tools?: string[] }> = {};
    for (const [name, cfg] of Object.entries(config.integrations)) {
      integrationConfigs[name] = {
        scope: cfg?.scope ?? (cfg?.perUser ? "endUser" : "project"),
        tools: cfg?.tools,
      };
    }
    await syncIntegrationConfig(apiBaseUrl, apiToken, integrationConfigs);
    return true;
  }
}

export function createMCPServer(config: MCPServerConfig): MCPServer {
  return new MCPServer(config);
}
