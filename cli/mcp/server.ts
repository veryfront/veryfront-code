/**
 * MCP Dev Server
 *
 * Exposes dev server functionality via MCP (Model Context Protocol).
 * Supports stdio transport for local editors and loopback HTTP transport for
 * browser integrations during `veryfront dev`.
 */

import { cwd, readTextFile } from "veryfront/platform";
import { createHttpServer, type HttpServer } from "veryfront/platform/http";
import type { StdinReader } from "veryfront/platform";
import { cliLogger } from "#cli/utils";
import { withSpan } from "veryfront/observability/otlp-setup";
import { createIssuesManager } from "veryfront/issues";
import type { ToolListEntry } from "veryfront/mcp";
import { getErrorCollector, getLogBuffer } from "veryfront/observability";
import { isRequestBodyTooLargeError, readBodyWithLimit } from "veryfront/security";
import { zodToJsonSchema } from "veryfront/tool/schema";
import { allTools, getTool, setServerStartTime } from "./tools.ts";
import { startStdioJsonRpc } from "./stdio.ts";
import {
  buildInitializeResult,
  errorResponse,
  JsonRpcError,
  type JSONRPCRequest,
  JSONRPCRequestSchema,
  type JSONRPCResponse,
  parseError,
  PromptsGetParamsSchema,
  ResourcesReadParamsSchema,
  successResponse,
  ToolsCallParamsSchema,
} from "./jsonrpc.ts";

const MAX_HTTP_REQUEST_BODY_SIZE = 1_048_576;

function isAllowedHTTPOrigin(origin: string): boolean {
  if (!origin) return true;

  try {
    const url = new URL(origin);
    if (url.protocol !== "http:") return false;

    return url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "veryfront.me";
  } catch {
    return false;
  }
}

function requestBodyTooLargeResponse(headers: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Request body too large" },
    }),
    { status: 413, headers },
  );
}

export interface MCPServerConfig {
  /** Enable stdio transport (for Claude Code, Cursor, etc.) */
  stdio?: boolean;
  /** Loopback HTTP port used by local development integrations. */
  httpPort?: number;
  /** Server name for MCP protocol */
  serverName?: string;
  /** Server version */
  serverVersion?: string;
}

export class MCPDevServer {
  private config: MCPServerConfig;
  private running = false;
  private stdinReader: StdinReader | null = null;
  private httpServer: HttpServer | null = null;
  private httpServePromise: Promise<void> | null = null;

  constructor(config: MCPServerConfig = {}) {
    this.config = {
      serverName: "veryfront-dev",
      serverVersion: "1.0.0",
      ...config,
    };

    // Set server start time for status tool
    setServerStartTime(Date.now());
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    if (this.config.stdio) {
      this.stdinReader = startStdioJsonRpc<JSONRPCRequest, JSONRPCResponse>({
        isRunning: () => this.running,
        parseRequest: (payload) => JSONRPCRequestSchema.parse(payload),
        handleRequest: (request) => this.handleRequest(request),
        toErrorResponse: (error) => parseError(error),
      });
    }
    if (this.config.httpPort) this.startHTTP(this.config.httpPort);
  }

  async stop(): Promise<void> {
    this.running = false;

    this.stdinReader?.releaseLock();
    this.stdinReader = null;

    const httpServer = this.httpServer;
    const httpServePromise = this.httpServePromise;
    this.httpServer = null;
    this.httpServePromise = null;

    if (!httpServer) return;
    await httpServer.close();
    await httpServePromise?.catch(() => undefined);
  }

  private startHTTP(port: number): void {
    const httpServer = createHttpServer();
    this.httpServer = httpServer;

    const handler = async (req: Request): Promise<Response> => {
      const url = new URL(req.url);

      // CORS headers - allow localhost and veryfront dev domains
      const origin = req.headers.get("Origin") ?? "";
      const isAllowedOrigin = isAllowedHTTPOrigin(origin);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Accept, mcp-protocol-version, mcp-session-id",
      };

      if (isAllowedOrigin && origin) headers["Access-Control-Allow-Origin"] = origin;

      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

      if (origin && !isAllowedOrigin) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Forbidden: Origin not allowed" },
          }),
          { status: 403, headers },
        );
      }

      if (url.pathname !== "/mcp") {
        return new Response(JSON.stringify({ error: "Not found. MCP endpoint is at /mcp" }), {
          status: 404,
          headers,
        });
      }

      if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers,
        });
      }

      const contentLength = req.headers.get("content-length");
      if (contentLength && Number(contentLength) > MAX_HTTP_REQUEST_BODY_SIZE) {
        return requestBodyTooLargeResponse(headers);
      }

      try {
        const bodyText = await readBodyWithLimit(req, MAX_HTTP_REQUEST_BODY_SIZE);
        const body = JSONRPCRequestSchema.parse(JSON.parse(bodyText));
        const response = await this.handleRequest(body);
        return new Response(JSON.stringify(response), { headers });
      } catch (e) {
        if (isRequestBodyTooLargeError(e)) {
          return requestBodyTooLargeResponse(headers);
        }
        return new Response(JSON.stringify(parseError(e)), { status: 400, headers });
      }
    };

    const servePromise = httpServer.serve(handler, { port, onListen: () => {} });
    this.httpServePromise = servePromise;
    void servePromise.catch(() => {
      if (!this.running) return;
      cliLogger.warn(
        `Veryfront could not start the local MCP server on port ${port}. Local MCP tools are disabled for this dev session.`,
      );
      if (this.httpServer === httpServer) {
        this.httpServer = null;
        this.httpServePromise = null;
      }
    });
  }

  private handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    const { id, method, params } = request;

    return withSpan(
      "cli.mcp.handleRequest",
      async () => {
        try {
          const result = await this.dispatchMethod(method, params);
          return successResponse(id, result);
        } catch (e) {
          return errorResponse(id, e);
        }
      },
      { "mcp.method": method },
    );
  }

  private dispatchMethod(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "initialize":
        return Promise.resolve(this.handleInitialize(params));
      case "notifications/initialized":
        return Promise.resolve({});
      case "tools/list":
        return Promise.resolve(this.handleToolsList(params));
      case "tools/call":
        return this.handleToolsCall(params);
      case "resources/list":
        return Promise.resolve(this.handleResourcesList(params));
      case "resources/templates/list":
        return Promise.resolve(this.handleResourceTemplatesList());
      case "resources/read":
        return this.handleResourcesRead(params);
      case "prompts/list":
        return Promise.resolve(this.handlePromptsList(params));
      case "prompts/get":
        return this.handlePromptsGet(params);
      default:
        return Promise.reject(new Error(`Unknown method: ${method}`));
    }
  }

  private handleInitialize(params: unknown): unknown {
    return buildInitializeResult(
      params,
      {
        name: this.config.serverName ?? "veryfront-dev",
        title: "Veryfront Dev MCP Server",
        version: this.config.serverVersion ?? "1.0.0",
        description:
          "Veryfront development server tools for real-time errors, logs, HMR, and scaffolding",
      },
      "Veryfront dev MCP server provides development tools. Use vf_get_errors to check for code errors, vf_get_logs for server logs, and vf_trigger_hmr for hot module reload.",
    );
  }

  private handleToolsList(_params?: unknown): { tools: ToolListEntry[] } {
    return {
      tools: allTools.map((tool) => {
        const entry: ToolListEntry = {
          name: tool.name,
          description: tool.description,
          inputSchema: zodToJsonSchema(tool.inputSchema) as Record<string, unknown>,
        };
        if (tool.title) entry.title = tool.title;
        if (tool.annotations) entry.annotations = tool.annotations;
        return entry;
      }),
    };
  }

  private handleToolsCall(params: unknown): Promise<unknown> {
    const { name: toolName, arguments: args } = ToolsCallParamsSchema.parse(params);

    const tool = getTool(toolName);
    if (!tool) {
      throw new JsonRpcError(-32602, `Unknown tool: ${toolName}`);
    }

    let input: unknown;
    try {
      input = tool.inputSchema.parse(args ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new JsonRpcError(-32602, `Invalid arguments for tool ${toolName}: ${message}`);
    }

    return withSpan(
      "cli.mcp.handleToolsCall",
      async () => {
        try {
          const result = await tool.execute(input);

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

  private handleResourceTemplatesList(): { resourceTemplates: Array<Record<string, unknown>> } {
    return { resourceTemplates: [] };
  }

  private handleResourcesList(_params?: unknown): unknown {
    return {
      resources: [
        {
          uri: "veryfront://skill",
          name: "Veryfront Skill",
          description: "How to build Veryfront apps - conventions, patterns, workflows",
          mimeType: "text/markdown",
        },
        {
          uri: "veryfront://errors",
          name: "Dev Server Errors",
          description: "Current compilation and runtime errors",
          mimeType: "application/json",
        },
        {
          uri: "veryfront://logs",
          name: "Dev Server Logs",
          description: "Recent server logs",
          mimeType: "application/json",
        },
        {
          uri: "issues://",
          name: "Project Issues",
          description: "File-based issues, tasks, and plans",
          mimeType: "application/json",
        },
        {
          uri: "veryfront://schema",
          name: "CLI Schema",
          description: "Full CLI command schema for agent discovery",
          mimeType: "application/json",
        },
        {
          uri: "veryfront://agents-md",
          name: "Root AGENTS.md",
          description: "Agent onboarding documentation",
          mimeType: "text/markdown",
        },
        {
          uri: "veryfront://config",
          name: "Project Config",
          description: "Resolved project configuration",
          mimeType: "application/json",
        },
        {
          uri: "veryfront://skills",
          name: "Available Skills",
          description: "List of all available agent skills",
          mimeType: "application/json",
        },
      ],
    };
  }

  private handleResourcesRead(params: unknown): Promise<unknown> {
    const { uri } = ResourcesReadParamsSchema.parse(params);

    return withSpan(
      "cli.mcp.handleResourcesRead",
      async () => {
        if (uri === "veryfront://skill") {
          try {
            const skillPath = new URL("./skills/veryfront/SKILL.md", import.meta.url).pathname;
            const content = await readTextFile(skillPath);
            return {
              contents: [
                {
                  uri,
                  mimeType: "text/markdown",
                  text: content,
                },
              ],
            };
          } catch {
            throw new Error("Skill file not found");
          }
        }

        if (uri === "veryfront://errors") {
          const errors = getErrorCollector().getAll();
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(errors, null, 2),
              },
            ],
          };
        }

        if (uri === "veryfront://logs") {
          const logs = getLogBuffer().tail(100);
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(logs, null, 2),
              },
            ],
          };
        }

        if (uri === "veryfront://schema") {
          const { generateSchema } = await import("../commands/schema/command.ts");
          return {
            contents: [{
              uri,
              mimeType: "application/json",
              text: JSON.stringify(generateSchema()),
            }],
          };
        }

        if (uri === "veryfront://agents-md") {
          const content = await readTextFile("AGENTS.md").catch(() => "AGENTS.md not found");
          return {
            contents: [{ uri, mimeType: "text/markdown", text: content }],
          };
        }

        if (uri === "veryfront://config") {
          const { getEnvironmentConfig } = await import("veryfront/config");
          const config = getEnvironmentConfig();
          return {
            contents: [{
              uri,
              mimeType: "application/json",
              text: JSON.stringify(config, null, 2),
            }],
          };
        }

        if (uri === "veryfront://skills") {
          const { listCoreSkills } = await import("../skills/loader.ts");
          const skills = await listCoreSkills();
          const data = skills.map((s) => ({
            name: s.metadata.name,
            description: s.metadata.description,
            allowedTools: s.metadata.allowedTools,
            directory: s.directory,
          }));
          return {
            contents: [{
              uri,
              mimeType: "application/json",
              text: JSON.stringify(data, null, 2),
            }],
          };
        }

        if (!uri.startsWith("issues://")) throw new Error(`Unknown resource: ${uri}`);

        const manager = createIssuesManager(cwd());

        if (uri === "issues://") {
          const result = await manager.list({ state: "open" });
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        const id = uri.slice("issues://".length);
        const issue = await manager.get(id);
        if (!issue) throw new Error(`Issue not found: ${id}`);

        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(issue, null, 2),
            },
          ],
        };
      },
      { "mcp.resource.uri": uri },
    );
  }

  private handlePromptsList(_params?: unknown): unknown {
    return {
      prompts: [
        {
          name: "veryfront",
          description: "Build Veryfront apps - conventions, patterns, workflows, scaffolding",
          arguments: [],
        },
        {
          name: "veryfront-routing",
          description: "Veryfront routing conventions and file-based routing patterns",
          arguments: [],
        },
        {
          name: "veryfront-ai-tools",
          description: "AI tool patterns for Veryfront agents",
          arguments: [],
        },
        {
          name: "veryfront-components",
          description: "Component patterns and best practices for Veryfront",
          arguments: [],
        },
        {
          name: "flywheel",
          description:
            "Development flywheel - autonomous run/observe/fix/verify cycle with browser automation",
          arguments: [],
        },
      ],
    };
  }

  private handlePromptsGet(params: unknown): Promise<unknown> {
    const { name } = PromptsGetParamsSchema.parse(params);

    return withSpan(
      "cli.mcp.handlePromptsGet",
      async () => {
        const promptFiles: Record<string, string> = {
          veryfront: "./skills/veryfront/SKILL.md",
          "veryfront-routing": "./skills/veryfront/references/ROUTES.md",
          "veryfront-ai-tools": "./skills/veryfront/references/AI-TOOLS.md",
          "veryfront-components": "./skills/veryfront/references/COMPONENTS.md",
          flywheel: "./skills/flywheel/SKILL.md",
        };

        const filePath = promptFiles[name];
        if (!filePath) throw new Error(`Unknown prompt: ${name}`);

        try {
          const fullPath = new URL(filePath, import.meta.url).pathname;
          const content = await readTextFile(fullPath);

          return {
            description: `Veryfront skill: ${name}`,
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
        } catch {
          throw new Error(`Failed to read prompt: ${name}`);
        }
      },
      { "mcp.prompt.name": name },
    );
  }
}

export function createMCPServer(config: MCPServerConfig): MCPDevServer {
  const server = new MCPDevServer(config);
  server.start();
  return server;
}

export * from "veryfront/observability";
export * from "./tools.ts";
