/**
 * Veryfront MCP Module
 *
 * Model Context Protocol (MCP) implementation for exposing tools, resources,
 * and prompts to AI assistants.
 *
 * @example
 * ```typescript
 * import {
 *   createMCPServer,
 *   getMCPRegistry,
 *   getMCPStats,
 *   // Convenience re-exports
 *   tool,
 *   toolRegistry,
 *   prompt,
 *   promptRegistry,
 *   resource,
 *   resourceRegistry,
 * } from 'veryfront/mcp';
 *
 * // Create MCP server
 * const server = createMCPServer({
 *   enabled: true,
 *   cors: { enabled: true },
 * });
 *
 * // Get stats
 * const stats = getMCPStats();
 * console.log(`Tools: ${stats.tools}, Resources: ${stats.resources}, Prompts: ${stats.prompts}`);
 * ```
 *
 * @module veryfront/mcp
 */

// =============================================================================
// Types
// =============================================================================
export type { MCPRegistry, MCPServerConfig, MCPStats } from "./types.ts";

// =============================================================================
// Registry
// =============================================================================
export {
  clearMCPRegistry,
  getMCPRegistry,
  getMCPStats,
  registerPrompt,
  registerResource,
  registerTool,
} from "./registry.ts";

// =============================================================================
// Server
// =============================================================================
export { createMCPServer, MCPServer } from "./server.ts";

// =============================================================================
// Convenience Re-exports
// These allow MCP-focused users to import everything from one place
// =============================================================================

// Tool
export { executeTool, tool, toolRegistry, zodToJsonSchema } from "#veryfront/tool";
export type { Tool, ToolConfig } from "#veryfront/tool";

// Prompt
export { prompt, promptRegistry } from "#veryfront/prompt";
export type { Prompt, PromptConfig } from "#veryfront/prompt";

// Resource
export { resource, resourceRegistry } from "#veryfront/resource";
export type { Resource, ResourceConfig } from "#veryfront/resource";
