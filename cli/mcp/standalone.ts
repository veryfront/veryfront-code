/**
 * Standalone MCP Server
 *
 * Runs as a separate process (`veryfront mcp`), communicates over stdio.
 * Pulls runtime data from the dev server's Dashboard API over HTTP.
 * Falls back gracefully when the dev server is not running.
 */

import { readTextFile } from "veryfront/platform";
import type { StdinReader } from "veryfront/platform";
import { DevServerClient } from "./dev-server-client.ts";
import { startStdioJsonRpc } from "./stdio.ts";
import {
  errorResponse,
  type JSONRPCRequest,
  JSONRPCRequestSchema,
  type JSONRPCResponse,
  parseError,
  PromptsGetParamsSchema,
  successResponse,
  ToolsCallParamsSchema,
} from "./jsonrpc.ts";

const DEFAULT_DEV_PORT = 8080;
const NOT_RUNNING_MSG = "Dev server not running. Start with: veryfront";

interface StandaloneTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface StandaloneMCPConfig {
  port?: number;
}

export class StandaloneMCPServer {
  private client: DevServerClient;
  private tools: StandaloneTool[];
  private running = false;
  private stdinReader: StdinReader | null = null;

  constructor(config: StandaloneMCPConfig = {}) {
    const port = config.port ?? DEFAULT_DEV_PORT;
    this.client = new DevServerClient({ port });
    this.tools = this.createTools();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stdinReader = startStdioJsonRpc<JSONRPCRequest, JSONRPCResponse>({
      isRunning: () => this.running,
      parseRequest: (payload) => JSONRPCRequestSchema.parse(payload),
      handleRequest: (request) => this.handleRequest(request),
      toErrorResponse: (error) => parseError(error),
    });
  }

  stop(): void {
    this.running = false;
    this.stdinReader?.releaseLock();
    this.stdinReader = null;
  }

  private async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    const { id, method, params } = request;

    try {
      const result = await this.dispatchMethod(method, params);
      return successResponse(id, result);
    } catch (e) {
      return errorResponse(id, e);
    }
  }

  private dispatchMethod(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "initialize":
        return Promise.resolve({
          protocolVersion: "2024-11-05",
          capabilities: { tools: {}, prompts: {} },
          serverInfo: { name: "veryfront-mcp", version: "1.0.0" },
        });
      case "notifications/initialized":
        return Promise.resolve({});
      case "tools/list":
        return Promise.resolve({
          tools: this.tools.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        });
      case "tools/call":
        return this.handleToolsCall(params);
      case "prompts/list":
        return Promise.resolve(this.handlePromptsList());
      case "prompts/get":
        return this.handlePromptsGet(params);
      default:
        return Promise.reject(new Error(`Unknown method: ${method}`));
    }
  }

  private async handleToolsCall(params: unknown): Promise<unknown> {
    const { name, arguments: args } = ToolsCallParamsSchema.parse(params);

    const tool = this.tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);

    const result = await tool.execute(args ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
          name: "flywheel",
          description:
            "Development flywheel - autonomous run/observe/fix/verify cycle with browser automation",
          arguments: [],
        },
      ],
    };
  }

  private async handlePromptsGet(params: unknown): Promise<unknown> {
    const { name } = PromptsGetParamsSchema.parse(params);

    const filePath = name === "veryfront"
      ? "./skills/veryfront/SKILL.md"
      : name === "flywheel"
      ? "./skills/flywheel/SKILL.md"
      : undefined;

    if (!filePath) throw new Error(`Unknown prompt: ${name}`);

    try {
      const fullPath = new URL(filePath, import.meta.url).pathname;
      const content = await readTextFile(fullPath);

      return {
        description: `Veryfront skill: ${name}`,
        messages: [{ role: "user", content: { type: "text", text: content } }],
      };
    } catch {
      throw new Error(`Failed to read prompt: ${name}`);
    }
  }

  private createTools(): StandaloneTool[] {
    const client = this.client;

    return [
      {
        name: "vf_get_errors",
        description:
          "Get live compile, runtime, bundle, and HMR errors from the dev server. Returns errors from the ErrorCollector with optional type filtering.",
        inputSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["compile", "runtime", "bundle", "hmr", "module"],
              description: "Filter by error type",
            },
          },
        },
        async execute(args) {
          try {
            return await client.getLiveErrors(args.type as string | undefined);
          } catch {
            return { error: NOT_RUNNING_MSG };
          }
        },
      },
      {
        name: "vf_get_logs",
        description:
          "Get recent server log entries from the dev server's LogBuffer. Supports filtering by level, source, and pattern.",
        inputSchema: {
          type: "object",
          properties: {
            level: {
              type: "string",
              enum: ["debug", "info", "warn", "error"],
              description: "Filter by log level",
            },
            source: {
              type: "string",
              description: "Filter by log source",
            },
            pattern: {
              type: "string",
              description: "Filter by message pattern (substring match)",
            },
            limit: {
              type: "number",
              description: "Maximum number of entries to return",
            },
          },
        },
        async execute(args) {
          try {
            return await client.getLiveLogs({
              level: args.level as string | undefined,
              source: args.source as string | undefined,
              pattern: args.pattern as string | undefined,
              limit: args.limit as number | undefined,
            });
          } catch {
            return { error: NOT_RUNNING_MSG };
          }
        },
      },
      {
        name: "vf_get_status",
        description:
          "Get dev server status including MCP tool/resource/prompt counts and uptime. Useful for checking if the dev server is running and healthy.",
        inputSchema: { type: "object", properties: {} },
        async execute() {
          try {
            return await client.getStats();
          } catch {
            return { error: NOT_RUNNING_MSG };
          }
        },
      },
      {
        name: "vf_trigger_hmr",
        description:
          "Trigger a hot module reload in the browser. Optionally specify a file path that changed.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path that changed (optional)",
            },
          },
        },
        async execute(args) {
          try {
            return await client.triggerHmr(args.path as string | undefined);
          } catch {
            return { error: NOT_RUNNING_MSG };
          }
        },
      },
    ];
  }
}

export function createStandaloneMCPServer(config: StandaloneMCPConfig = {}): StandaloneMCPServer {
  const server = new StandaloneMCPServer(config);
  server.start();
  return server;
}
