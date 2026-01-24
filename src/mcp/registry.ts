import type { MCPRegistry, MCPStats } from "./types.ts";
import type { Tool } from "#veryfront/tool";
import type { Resource } from "#veryfront/resource";
import type { Prompt } from "#veryfront/prompt";
import { toolRegistry } from "#veryfront/tool";
import { resourceRegistry } from "#veryfront/resource";
import { promptRegistry } from "#veryfront/prompt";

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

export function registerPrompt(id: string, prompt: Prompt): void {
  promptRegistry.register(id, prompt);
}

export function getMCPStats(): MCPStats {
  const tools = toolRegistry.getAll().size;
  const resources = resourceRegistry.getAll().size;
  const prompts = promptRegistry.getAll().size;

  return { tools, resources, prompts, total: tools + resources + prompts };
}

export function clearMCPRegistry(): void {
  toolRegistry.clear();
  resourceRegistry.clear();
  promptRegistry.clear();
}
