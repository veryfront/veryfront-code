/**
 * MCP Dev Server
 *
 * Exposes dev server functionality via MCP (Model Context Protocol).
 * Supports both stdio transport (for local editors like Claude Code)
 * and HTTP transport (for remote access).
 */

import { readTextFile } from "#veryfront/platform/compat/fs.ts";
import { createHttpServer, type HttpServer } from "#veryfront/platform/compat/http/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import type { StdinReader } from "#veryfront/platform/compat/stdin.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { createIssuesManager } from "#veryfront/issues/core.ts";
import { getErrorCollector } from "#veryfront/observability/error-collector.ts";
import { getLogBuffer } from "#veryfront/observability/log-buffer.ts";
import { allTools, getTool, setServerStartTime } from "./tools.ts";
import { startStdioJsonRpc } from "./stdio.ts";
import {
  errorResponse,
  type JSONRPCRequest,
  JSONRPCRequestSchema,
  type JSONRPCResponse,
  parseError,
  PromptsGetParamsSchema,
  ResourcesReadParamsSchema,
  successResponse,
  ToolsCallParamsSchema,
} from "./jsonrpc.ts";

export interface MCPServerConfig {
  /** Enable stdio transport (for Claude Code, Cursor, etc.) */
  stdio?: boolean;
  /** HTTP port for remote MCP access */
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

    if (!this.httpServer) return;
    await this.httpServer.close();
    this.httpServer = null;
  }

  private startHTTP(port: number): void {
    this.httpServer = createHttpServer();

    const handler = async (req: Request): Promise<Response> => {
      const url = new URL(req.url);

      // CORS headers - allow localhost and veryfront dev domains
      const origin = req.headers.get("Origin") ?? "";
      const isAllowedOrigin = origin === "" ||
        origin.startsWith("http://localhost") ||
        origin.startsWith("http://127.0.0.1") ||
        origin.startsWith("http://veryfront.me");

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Accept, mcp-protocol-version, mcp-session-id",
      };

      if (isAllowedOrigin && origin) headers["Access-Control-Allow-Origin"] = origin;

      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

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

      try {
        const body = JSONRPCRequestSchema.parse(await req.json());
        const response = await this.handleRequest(body);
        return new Response(JSON.stringify(response), { headers });
      } catch (e) {
        return new Response(JSON.stringify(parseError(e)), { status: 400, headers });
      }
    };

    this.httpServer.serve(handler, { port, onListen: () => {} });
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
      case "tools/list":
        return Promise.resolve(this.handleToolsList());
      case "tools/call":
        return this.handleToolsCall(params);
      case "resources/list":
        return Promise.resolve(this.handleResourcesList());
      case "resources/read":
        return this.handleResourcesRead(params);
      case "prompts/list":
        return Promise.resolve(this.handlePromptsList());
      case "prompts/get":
        return this.handlePromptsGet(params);
      default:
        return Promise.reject(new Error(`Unknown method: ${method}`));
    }
  }

  private handleInitialize(_params: unknown): unknown {
    return {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      serverInfo: {
        name: this.config.serverName,
        version: this.config.serverVersion,
      },
    };
  }

  private handleToolsList(): unknown {
    return {
      tools: allTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: this.zodToJsonSchema(tool.inputSchema),
      })),
    };
  }

  private handleToolsCall(params: unknown): Promise<unknown> {
    const { name, arguments: args } = ToolsCallParamsSchema.parse(params);

    return withSpan(
      "cli.mcp.handleToolsCall",
      async () => {
        const tool = getTool(name);
        if (!tool) throw new Error(`Unknown tool: ${name}`);

        const input = tool.inputSchema.parse(args ?? {});
        const result = await tool.execute(input);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      },
      { "mcp.tool.name": name },
    );
  }

  private handleResourcesList(): unknown {
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

  private handlePromptsList(): unknown {
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

  // deno-lint-ignore no-explicit-any
  private zodToJsonSchema(schema: any): Record<string, unknown> {
    const def = schema?._def;
    if (!def) return { type: "object", properties: {} };

    const desc = def.description ? { description: def.description } : {};

    switch (def.typeName) {
      case "ZodObject": {
        const shape = def.shape?.() ?? {};
        const properties: Record<string, unknown> = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(shape)) {
          // deno-lint-ignore no-explicit-any
          const fieldDef = (value as any)?._def;
          const fieldSchema = this.zodToJsonSchema(value);

          if (fieldDef?.description) fieldSchema.description = fieldDef.description;
          properties[key] = fieldSchema;

          if (fieldDef?.typeName !== "ZodOptional" && fieldDef?.typeName !== "ZodDefault") {
            required.push(key);
          }
        }

        return { type: "object", properties, ...(required.length ? { required } : {}) };
      }
      case "ZodString":
        return { type: "string", ...desc };
      case "ZodNumber":
        return { type: "number", ...desc };
      case "ZodBoolean":
        return { type: "boolean", ...desc };
      case "ZodArray":
        return { type: "array", items: this.zodToJsonSchema(def.type), ...desc };
      case "ZodEnum":
        return { type: "string", enum: def.values, ...desc };
      case "ZodOptional":
        return this.zodToJsonSchema(def.innerType);
      case "ZodDefault": {
        const inner = this.zodToJsonSchema(def.innerType);
        inner.default = def.defaultValue?.();
        return inner;
      }
      case "ZodNullable": {
        const inner = this.zodToJsonSchema(def.innerType);
        return { ...inner, nullable: true };
      }
      case "ZodLiteral":
        return { const: def.value, ...desc };
      case "ZodUnion": {
        const options = (def.options ?? []).map((o: unknown) => this.zodToJsonSchema(o));
        return { anyOf: options, ...desc };
      }
      case "ZodRecord":
        return {
          type: "object",
          additionalProperties: this.zodToJsonSchema(def.valueType),
          ...desc,
        };
      default:
        return { type: "object" };
    }
  }
}

export function createMCPServer(config: MCPServerConfig): MCPDevServer {
  const server = new MCPDevServer(config);
  server.start();
  return server;
}

export * from "#veryfront/observability/error-collector.ts";
export * from "#veryfront/observability/log-buffer.ts";
export * from "./tools.ts";
