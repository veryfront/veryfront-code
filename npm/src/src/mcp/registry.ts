import type { MCPRegistry, MCPStats } from "./types.js";
import type { Tool } from "../tool/index.js";
import type { Resource } from "../resource/index.js";
import type { Prompt } from "../prompt/index.js";
import { toolRegistry } from "../tool/index.js";
import { resourceRegistry } from "../resource/index.js";
import { promptRegistry } from "../prompt/index.js";

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
