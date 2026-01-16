/**
 * MCP Dev Server
 *
 * Exposes dev server functionality via MCP (Model Context Protocol).
 * Supports both stdio transport (for local editors like Claude Code)
 * and HTTP transport (for remote access).
 */

import { allTools, getTool, listTools, setServerStartTime } from "./tools.ts";
import { getErrorCollector } from "./error-collector.ts";
import { getLogBuffer } from "./log-buffer.ts";

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// MCP Server
// ============================================================================

export class MCPDevServer {
  private config: MCPServerConfig;
  private running = false;
  private stdinReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private httpServer: Deno.HttpServer | null = null;

  constructor(config: MCPServerConfig = {}) {
    this.config = {
      serverName: "veryfront-dev",
      serverVersion: "1.0.0",
      ...config,
    };

    // Set server start time for status tool
    setServerStartTime(Date.now());
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    if (this.config.stdio) {
      this.startStdio();
    }

    if (this.config.httpPort) {
      await this.startHTTP(this.config.httpPort);
    }
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.stdinReader) {
      await this.stdinReader.cancel();
      this.stdinReader = null;
    }

    if (this.httpServer) {
      await this.httpServer.shutdown();
      this.httpServer = null;
    }
  }

  /**
   * Start stdio transport
   */
  private startStdio(): void {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    // Read from stdin
    this.stdinReader = Deno.stdin.readable.getReader();

    const readLoop = async () => {
      let buffer = "";

      while (this.running) {
        try {
          const { value, done } = await this.stdinReader!.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete JSON-RPC messages (newline-delimited)
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);

            if (line) {
              try {
                const request = JSON.parse(line) as JSONRPCRequest;
                const response = await this.handleRequest(request);
                const output = JSON.stringify(response) + "\n";
                await Deno.stdout.write(encoder.encode(output));
              } catch (e) {
                const errorResponse: JSONRPCResponse = {
                  jsonrpc: "2.0",
                  error: {
                    code: -32700,
                    message: "Parse error",
                    data: e instanceof Error ? e.message : String(e),
                  },
                };
                await Deno.stdout.write(encoder.encode(JSON.stringify(errorResponse) + "\n"));
              }
            }
          }
        } catch {
          // stdin closed or error
          break;
        }
      }
    };

    readLoop();
  }

  /**
   * Start HTTP transport
   */
  private async startHTTP(port: number): Promise<void> {
    this.httpServer = Deno.serve(
      { port, onListen: () => {} },
      async (req) => {
        // CORS headers
        const headers = {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        // Handle OPTIONS (CORS preflight)
        if (req.method === "OPTIONS") {
          return new Response(null, { status: 204, headers });
        }

        // Only accept POST
        if (req.method !== "POST") {
          return new Response(
            JSON.stringify({ error: "Method not allowed" }),
            { status: 405, headers },
          );
        }

        try {
          const body = await req.json() as JSONRPCRequest;
          const response = await this.handleRequest(body);
          return new Response(JSON.stringify(response), { headers });
        } catch (e) {
          const errorResponse: JSONRPCResponse = {
            jsonrpc: "2.0",
            error: {
              code: -32700,
              message: "Parse error",
              data: e instanceof Error ? e.message : String(e),
            },
          };
          return new Response(JSON.stringify(errorResponse), { status: 400, headers });
        }
      },
    );
  }

  /**
   * Handle a JSON-RPC request
   */
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

  /**
   * Dispatch a method call
   */
  private async dispatchMethod(method: string, params: unknown): Promise<unknown> {
    // MCP protocol methods
    switch (method) {
      case "initialize":
        return this.handleInitialize(params);
      case "tools/list":
        return this.handleToolsList();
      case "tools/call":
        return this.handleToolsCall(params);
      case "resources/list":
        return this.handleResourcesList();
      case "resources/read":
        return this.handleResourcesRead(params);
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  /**
   * Handle initialize request
   */
  private handleInitialize(_params: unknown): unknown {
    return {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
        resources: {},
      },
      serverInfo: {
        name: this.config.serverName,
        version: this.config.serverVersion,
      },
    };
  }

  /**
   * Handle tools/list request
   */
  private handleToolsList(): unknown {
    return {
      tools: allTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: this.zodToJsonSchema(tool.inputSchema),
      })),
    };
  }

  /**
   * Handle tools/call request
   */
  private async handleToolsCall(params: unknown): Promise<unknown> {
    const { name, arguments: args } = params as {
      name: string;
      arguments?: Record<string, unknown>;
    };

    const tool = getTool(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    // Validate and parse input
    const input = tool.inputSchema.parse(args ?? {});

    // Execute tool
    const result = await tool.execute(input);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * Handle resources/list request
   */
  private handleResourcesList(): unknown {
    return {
      resources: [
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
      ],
    };
  }

  /**
   * Handle resources/read request
   */
  private handleResourcesRead(params: unknown): unknown {
    const { uri } = params as { uri: string };

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

    throw new Error(`Unknown resource: ${uri}`);
  }

  /**
   * Convert Zod schema to JSON Schema (simplified)
   */
  private zodToJsonSchema(schema: unknown): unknown {
    // This is a simplified conversion - in production, use zod-to-json-schema
    // For now, return a generic object schema
    return {
      type: "object",
      properties: {},
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create and start an MCP dev server
 */
export async function createMCPServer(config: MCPServerConfig): Promise<MCPDevServer> {
  const server = new MCPDevServer(config);
  await server.start();
  return server;
}

// ============================================================================
// Index Exports
// ============================================================================

export * from "./error-collector.ts";
export * from "./log-buffer.ts";
export * from "./tools.ts";
