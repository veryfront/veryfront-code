/**
 * MCP Registry
 *
 * Central registry aggregating tools, resources, and prompts for MCP.
 *
 * @module veryfront/mcp
 */

import type { MCPRegistry, MCPStats } from "./types.ts";
import type { Tool } from "#veryfront/tool";
import type { Resource } from "#veryfront/resource";
import type { Prompt } from "#veryfront/prompt";
import { toolRegistry } from "#veryfront/tool";
import { resourceRegistry } from "#veryfront/resource";
import { promptRegistry } from "#veryfront/prompt";

/**
 * Get the global MCP registry
 *
 * @example
 * ```typescript
 * import { getMCPRegistry } from 'veryfront/mcp';
 *
 * const registry = getMCPRegistry();
 * console.log(`Tools: ${registry.tools.size}`);
 * console.log(`Resources: ${registry.resources.size}`);
 * console.log(`Prompts: ${registry.prompts.size}`);
 * ```
 */
export function getMCPRegistry(): MCPRegistry {
  return {
    tools: toolRegistry.getAll(),
    resources: resourceRegistry.getAll(),
    prompts: promptRegistry.getAll(),
  };
}

/**
 * Register a tool in the MCP registry
 */
export function registerTool(id: string, tool: Tool): void {
  toolRegistry.register(id, tool);
}

/**
 * Register a resource in the MCP registry
 */
export function registerResource(id: string, resource: Resource): void {
  resourceRegistry.register(id, resource);
}

/**
 * Register a prompt in the MCP registry
 */
export function registerPrompt(id: string, promptInstance: Prompt): void {
  promptRegistry.register(id, promptInstance);
}

/**
 * Get MCP registry stats
 *
 * @example
 * ```typescript
 * import { getMCPStats } from 'veryfront/mcp';
 *
 * const stats = getMCPStats();
 * console.log(`Total MCP items: ${stats.total}`);
 * ```
 */
export function getMCPStats(): MCPStats {
  const tools = toolRegistry.getAll().size;
  const resources = resourceRegistry.getAll().size;
  const prompts = promptRegistry.getAll().size;
  return { tools, resources, prompts, total: tools + resources + prompts };
}

/**
 * Clear all MCP registries (for testing)
 */
export function clearMCPRegistry(): void {
  toolRegistry.clear();
  resourceRegistry.clear();
  promptRegistry.clear();
}
