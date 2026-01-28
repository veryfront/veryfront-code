/**
 * Tool Registry
 *
 * Project-scoped registry for AI tools. Each project has its own isolated
 * tool namespace, preventing cross-project tool access.
 *
 * @module
 */

import type { Tool, ToolDefinition } from "./types.ts";
import { zodToJsonSchema } from "./schema/zod-json-schema.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { ProjectScopedRegistryManager } from "#veryfront/ai/registry-manager.ts";

const toolManager = new ProjectScopedRegistryManager<Tool>("tool");

class ToolRegistryClass {
  register(id: string, toolInstance: Tool): void {
    toolManager.register(id, toolInstance);
  }

  /**
   * Register a framework-provided tool available to all projects.
   */
  registerShared(id: string, toolInstance: Tool): void {
    toolManager.registerShared(id, toolInstance);
  }

  get(id: string): Tool | undefined {
    return toolManager.get(id);
  }

  has(id: string): boolean {
    return toolManager.has(id);
  }

  getAllIds(): string[] {
    return toolManager.getAllIds();
  }

  getAll(): Map<string, Tool> {
    return toolManager.getAll();
  }

  clear(): void {
    toolManager.clear();
  }

  /**
   * Clear everything (for testing).
   */
  clearAll(): void {
    toolManager.clearAll();
  }

  getToolsForProvider(): ToolDefinition[] {
    return [...this.getAll().values()].map(toolToProviderDefinition);
  }

  getStats() {
    return toolManager.getStats();
  }
}

// Singleton instance - maintains same interface but now project-scoped internally
export const toolRegistry = new ToolRegistryClass();

export function toolToProviderDefinition(tool: Tool): ToolDefinition {
  const jsonSchema = tool.inputSchemaJson ?? zodToJsonSchema(tool.inputSchema);

  agentLogger.info(
    `[TOOL] Using ${
      tool.inputSchemaJson ? "pre-converted" : "runtime-converted"
    } schema for "${tool.id}"`,
  );

  return {
    name: tool.id,
    description: tool.description,
    parameters: jsonSchema,
  };
}
