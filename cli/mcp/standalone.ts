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
        return Promise.resolve(buildInitializeResult(
          params,
          {
            name: "veryfront-mcp",
            title: "Veryfront Standalone MCP Server",
            version: "1.0.0",
            description: "Veryfront standalone MCP server for CLI-based development tools",
          },
          "Veryfront standalone MCP server provides development tools. Use vf_get_errors to check for code errors, vf_get_logs for server logs, and vf_get_status for dev server health.",
        ));
      case "notifications/initialized":
        return Promise.resolve({});
      case "tools/list":
        return Promise.resolve(this.handleToolsList(params));
      case "tools/call":
        return this.handleToolsCall(params);
      case "resources/list":
        return Promise.resolve(this.handleResourcesList(params));
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

  private async handleToolsCall(params: unknown): Promise<unknown> {
    const { name: toolName, arguments: args } = ToolsCallParamsSchema.parse(params);

    const tool = this.tools.find((t) => t.name === toolName);
    if (!tool) throw new JsonRpcError(-32602, `Unknown tool: ${toolName}`);

    try {
      const result = await tool.execute(args ?? {});
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
  }

  private handleToolsList(_params?: unknown): unknown {
    return {
      tools: this.tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    };
  }

  private handleResourcesList(_params?: unknown): unknown {
    return {
      resources: [
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
          uri: "veryfront://skills",
          name: "Available Skills",
          description: "List of all available agent skills",
          mimeType: "application/json",
        },
      ],
    };
  }

  private async handleResourcesRead(params: unknown): Promise<unknown> {
    const { uri } = ResourcesReadParamsSchema.parse(params);

    if (uri === "veryfront://schema") {
      const { generateSchema } = await import("../commands/schema/command.ts");
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify(generateSchema(), null, 2),
        }],
      };
    }

    if (uri === "veryfront://agents-md") {
      try {
        const agentsPath = new URL("../../AGENTS.md", import.meta.url).pathname;
        const content = await readTextFile(agentsPath);
        return { contents: [{ uri, mimeType: "text/markdown", text: content }] };
      } catch {
        return { contents: [{ uri, mimeType: "text/markdown", text: "AGENTS.md not found" }] };
      }
    }

    if (uri === "veryfront://skills") {
      const { listCoreSkills } = await import("../skills/loader.ts");
      const skills = await listCoreSkills();
      const data = skills.map((s) => ({
        name: s.manifest.name,
        version: s.manifest.version,
        description: s.manifest.description,
        requires: s.manifest.requires,
      }));
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify(data, null, 2),
        }],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
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
        name: "vf_get_schema",
        description:
          "Get the CLI command schema for discovering available commands, arguments, and flags.",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "Get schema for a specific command",
            },
            category: {
              type: "string",
              description: "Filter by category",
            },
          },
        },
        async execute(args) {
          const { generateCommandSchema, generateSchema } = await import(
            "../commands/schema/command.ts"
          );
          if (args.command) {
            return generateCommandSchema(args.command as string) ??
              { error: `Unknown command: ${args.command}` };
          }
          return generateSchema(
            args.category as
              | "development"
              | "deploy"
              | "project"
              | "files"
              | "ai"
              | "auth"
              | undefined,
          );
        },
      },
      {
        name: "vf_get_project_info",
        description: "Get project metadata including project slug, version, and environment.",
        inputSchema: { type: "object", properties: {} },
        async execute() {
          const { VERSION } = await import("#cli/utils");
          try {
            const { getEnvironmentConfig } = await import("veryfront/config");
            const config = getEnvironmentConfig();
            return {
              version: VERSION,
              projectSlug: config.projectSlug ?? null,
              nodeEnv: config.nodeEnv,
              veryfrontEnv: config.veryfrontEnv,
            };
          } catch {
            return { version: VERSION };
          }
        },
      },
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
      {
        name: "vf_run_tests",
        description: "Run the project's test suite and get structured pass/fail results. " +
          "Returns a summary with total, passed, failed, skipped counts and failure details " +
          "including file path, test name, error message, and line number. " +
          "Do not use for lint checks — use vf_run_lint instead.",
        inputSchema: {
          type: "object",
          properties: {
            filter: {
              type: "string",
              description: "Filter tests by name pattern",
            },
            parallel: {
              type: "boolean",
              description: "Run tests in parallel",
            },
            timeout: {
              type: "number",
              description:
                "Maximum time to wait for test completion in milliseconds (default: 300000)",
            },
          },
        },
        async execute(args) {
          const { executeTests } = await import("./tools/run-tests-tool.ts");
          return executeTests({
            filter: args.filter as string | undefined,
            parallel: args.parallel as boolean | undefined,
            timeout: args.timeout as number | undefined,
          });
        },
      },
      ...this.createContext7Tools(),
    ];
  }

  private createContext7Tools(): StandaloneTool[] {
    const isAvailable = () => Boolean(Deno.env.get("CONTEXT7_API_KEY"));

    let source: {
      executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    } | undefined;

    const getSource = async () => {
      if (!source) {
        const { createContext7ToolSource } = await import("veryfront/tool");
        source = createContext7ToolSource();
      }
      return source;
    };

    const notConfigured = {
      error: "context7_not_configured",
      message: "Context7 API key not configured. Set the CONTEXT7_API_KEY environment variable.",
    };

    return [
      {
        name: "c7_resolve_library",
        description: "Resolves a package or product name to a Context7-compatible library ID. " +
          "Call this before c7_query_docs to obtain the correct library ID. " +
          "Returns matching libraries with metadata (name, description, snippet count, reputation).",
        inputSchema: {
          type: "object",
          properties: {
            libraryName: {
              type: "string",
              description:
                "Library name to search for. Use the official name with proper punctuation — e.g., 'Next.js' not 'nextjs'.",
            },
            query: {
              type: "string",
              description:
                "The question or task you need help with. Used to rank results by relevance.",
            },
          },
          required: ["libraryName", "query"],
        },
        async execute(args) {
          if (!isAvailable()) return notConfigured;
          try {
            return await (await getSource()).executeTool("resolve-library-id", args);
          } catch (error) {
            return {
              error: "context7_request_failed",
              message: error instanceof Error ? error.message : String(error),
            };
          }
        },
      },
      {
        name: "c7_query_docs",
        description:
          "Retrieves up-to-date documentation and code examples from Context7 for a library. " +
          "You must call c7_resolve_library first to obtain the library ID, unless the user " +
          "provides one directly in '/org/project' format.",
        inputSchema: {
          type: "object",
          properties: {
            libraryId: {
              type: "string",
              description:
                "Context7-compatible library ID (e.g., '/vercel/next.js', '/supabase/supabase').",
            },
            query: {
              type: "string",
              description:
                "The question or task you need help with. Be specific and include relevant details.",
            },
          },
          required: ["libraryId", "query"],
        },
        async execute(args) {
          if (!isAvailable()) return notConfigured;
          try {
            return await (await getSource()).executeTool("query-docs", args);
          } catch (error) {
            return {
              error: "context7_request_failed",
              message: error instanceof Error ? error.message : String(error),
            };
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
