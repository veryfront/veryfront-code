import type { Tool, ToolDefinition } from "./types.ts";
import { zodToJsonSchema } from "./schema/zod-json-schema.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { ProjectScopedRegistryManager } from "#veryfront/ai/registry-manager.ts";
import { ScopedRegistryFacade } from "#veryfront/ai/registry-facade.ts";

const toolManager = new ProjectScopedRegistryManager<Tool>("tool");

class ToolRegistryClass extends ScopedRegistryFacade<Tool> {
  getToolsForProvider(): ToolDefinition[] {
    return [...this.getAll().values()].map(toolToProviderDefinition);
  }
}

export const toolRegistry = new ToolRegistryClass(toolManager);

export function toolToProviderDefinition(tool: Tool): ToolDefinition {
  const hasPreConvertedSchema = tool.inputSchemaJson != null;
  const jsonSchema = tool.inputSchemaJson ?? zodToJsonSchema(tool.inputSchema);

  agentLogger.info(
    `[TOOL] Using ${
      hasPreConvertedSchema ? "pre-converted" : "runtime-converted"
    } schema for "${tool.id}"`,
  );

  return {
    name: tool.id,
    description: tool.description,
    parameters: jsonSchema,
  };
}
