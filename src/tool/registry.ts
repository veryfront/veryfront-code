import type { Tool, ToolDefinition } from "./types.ts";
import { zodToJsonSchema } from "./schema/zod-json-schema.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { ScopedRegistryFacade } from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { TOOL_ID_CONFLICT } from "#veryfront/errors/error-registry/agent.ts";

const toolManager = new ProjectScopedRegistryManager<Tool>("tool");

/**
 * Returns true when `incoming` is considered the same definition as `existing`:
 * same object reference, or matching id + description. Equivalent definitions
 * may replace each other (HMR re-registration must pick up an edited execute
 * or schema); anything else under an existing ID is a conflict.
 */
function isSameToolDefinition(existing: Tool, incoming: Tool): boolean {
  return existing === incoming ||
    (existing.id === incoming.id && existing.description === incoming.description);
}

class ToolRegistryClass extends ScopedRegistryFacade<Tool> {
  override register(id: string, item: Tool): void {
    // Conflict-check against the project's own scope only: a project tool is
    // allowed to shadow a shared/framework tool with the same ID.
    const existing = this.getOwn(id);
    if (existing !== undefined && !isSameToolDefinition(existing, item)) {
      throw TOOL_ID_CONFLICT.create({
        detail:
          `Tool "${id}" is already registered with a different definition. Use a unique tool ID or rename one of the conflicting tools.`,
      });
    }
    if (existing !== undefined && existing !== item) {
      agentLogger.debug(`[tool] "${id}" re-registered with equivalent definition; replacing.`);
    }
    super.register(id, item);
  }

  getToolsForProvider(): ToolDefinition[] {
    return [...this.getAll().values()].map(toolToProviderDefinition);
  }
}

/** Shared tool registry value. */
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
