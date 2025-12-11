
import type { MCPRegistry } from "../types/mcp.ts";
import type { Tool } from "../types/tool.ts";
import type { Prompt, Resource } from "../types/mcp.ts";
import { toolRegistry } from "../utils/tool.ts";
import { resourceRegistry } from "./resource.ts";
import { promptRegistry } from "./prompt.ts";

export function getMCPRegistry(): MCPRegistry {
  return {
    tools: toolRegistry.getAll(),
    resources: resourceRegistry.getAll(),
    prompts: promptRegistry.getAll(),
  };
}

export function registerTool(id: string, tool: Tool): void {
  toolRegistry.register(id, tool);
}

export function registerResource(id: string, resource: Resource): void {
  resourceRegistry.register(id, resource);
}

export function registerPrompt(id: string, promptInstance: Prompt): void {
  promptRegistry.register(id, promptInstance);
}

export function getMCPStats(): {
  tools: number;
  resources: number;
  prompts: number;
  total: number;
} {
  const registry = getMCPRegistry();

  return {
    tools: registry.tools.size,
    resources: registry.resources.size,
    prompts: registry.prompts.size,
    total: registry.tools.size + registry.resources.size + registry.prompts.size,
  };
}

export function clearMCPRegistry(): void {
  toolRegistry.clear();
  resourceRegistry.clear();
  promptRegistry.clear();
}
