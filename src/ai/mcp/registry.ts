/**
 * MCP Registry - Central registry for all MCP resources
 */

import type { MCPRegistry } from "../types/mcp.ts";
import type { Tool } from "../types/tool.ts";
import type { Prompt, Resource } from "../types/mcp.ts";
import { toolRegistry } from "../utils/tool.ts";
import { resourceRegistry } from "./resource.ts";
import { promptRegistry } from "./prompt.ts";

/**
 * Get the global MCP registry
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
 */
export function getMCPStats(): {
  tools: number;
  resources: number;
  prompts: number;
  total: number;
} {
  const tools = toolRegistry.getAll().size;
  const resources = resourceRegistry.getAll().size;
  const prompts = promptRegistry.getAll().size;

  return {
    tools,
    resources,
    prompts,
    total: tools + resources + prompts,
  };
}

/**
 * Clear all MCP registries (for testing)
 */
export function clearMCPRegistry(): void {
  toolRegistry.clear();
  resourceRegistry.clear();
  promptRegistry.clear();
}
