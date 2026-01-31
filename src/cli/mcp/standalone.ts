/**
 * Standalone MCP Server
 *
 * Runs as a separate process (`veryfront mcp`), communicates over stdio.
 * Pulls runtime data from the dev server's Dashboard API over HTTP.
 * Falls back gracefully when the dev server is not running.
 */

import { readTextFile } from "#veryfront/platform/compat/fs.ts";
import { writeStdoutAsync } from "#veryfront/platform/compat/process.ts";
import { getStdinReader, type StdinReader } from "#veryfront/platform/compat/stdin.ts";
import { DevServerClient } from "./dev-server-client.ts";

const DEFAULT_DEV_PORT = 8080;
const NOT_RUNNING_MSG = "Dev server not running. Start with: veryfront";

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
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
    this.startStdio();
  }

  stop(): void {
    this.running = false;
    this.stdinReader?.releaseLock();
    this.stdinReader = null;
  }

  private startStdio(): void {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    this.stdinReader = getStdinReader();

    const readLoop = async (): Promise<void> => {
      let buffer = "";

      while (this.running) {
        try {
          const { value, done } = await this.stdinReader!.read();
          if (done) break;
          if (!value) continue;

          buffer += decoder.decode(value, { stream: true });

          while (true) {
            const newlineIndex = buffer.indexOf("\n");
            if (newlineIndex === -1) break;

            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);

            if (!line) continue;

            try {
              const request = JSON.parse(line) as JSONRPCRequest;
              const response = await this.handleRequest(request);
              await writeStdoutAsync(encoder.encode(`${JSON.stringify(response)}\n`));
            } catch (e) {
              const errorResponse: JSONRPCResponse = {
                jsonrpc: "2.0",
                error: {
                  code: -32700,
                  message: "Parse error",
                  data: e instanceof Error ? e.message : String(e),
                },
              };
              await writeStdoutAsync(encoder.encode(`${JSON.stringify(errorResponse)}\n`));
            }
          }
        } catch {
          break;
        }
      }
    };

    void readLoop();
  }

  private async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    const { id, method, params } = request;

    try {
      const result = await this.dispatchMethod(method, params);
      return { jsonrpc: "2.0", id, result };
    } catch (e) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: e instanceof Error ? e.message : String(e),
        },
      };
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
    const { name, arguments: args } = params as {
      name: string;
      arguments?: Record<string, unknown>;
    };

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
    const { name } = params as { name: string };

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
