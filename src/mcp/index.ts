/**
 * Model Context Protocol server implementation. Provides tool, prompt,
 * and resource registries exposed over the MCP transport.
 *
 * @module mcp
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

export { createMCPServer, MCPServer } from "./server.ts";
