/**
 * MCP server exposing tools, prompts, and resources.
 *
 * @module mcp
 *
 * @example
 * ```ts
 * import { createMCPServer } from "veryfront/mcp";
 * import { tool } from "veryfront/tool";
 * import { z } from "zod";
 *
 * // Tools auto-register with MCP when defined
 * tool({
 *   id: "search",
 *   description: "Search docs",
 *   inputSchema: z.object({ query: z.string() }),
 *   execute: async ({ query }) => ({ results: [] }),
 * });
 *
 * // Start MCP server — registered tools are exposed automatically
 * const server = createMCPServer();
 * ```
 */

export type { MCPServerConfig, MCPStats, MCPTool } from "./types.ts";

export {
  clearMCPRegistry,
  getMCPRegistry,
  getMCPStats,
  registerPrompt,
  registerResource,
  registerTool,
} from "./registry.ts";

export { createMCPServer, type IntegrationLoaderConfig, MCPServer } from "./server.ts";
