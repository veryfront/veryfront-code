import type { Tool, ToolDefinition } from "./types.ts";
import { zodToJsonSchema } from "./schema/zod-json-schema.ts";
import { agentLogger } from "@veryfront/utils/logger/logger.ts";

/**
 * Tool registry for managing tools
 */
class ToolRegistryClass {
  private tools = new Map<string, Tool>();

  register(id: string, toolInstance: Tool): void {
    if (this.tools.has(id)) {
      // Debug level - overwriting is expected during hot reload and re-discovery
      agentLogger.debug(`Tool "${id}" is already registered. Overwriting.`);
    }

    this.tools.set(id, toolInstance);
  }

  /**
   * Get a tool by ID
   */
  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  /**
   * Check if a tool exists
   */
  has(id: string): boolean {
    return this.tools.has(id);
  }

  /**
   * Get all tool IDs
   */
  getAllIds(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get all tools
   */
  getAll(): Map<string, Tool> {
    return new Map(this.tools);
  }

  /**
   * Clear all tools (for testing)
   */
  clear(): void {
    this.tools.clear();
  }

  getToolsForProvider(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(toolToProviderDefinition);
  }
}

// Singleton instance using globalThis to share across module contexts
// This is necessary for esbuild-bundled API routes to access the same registry
const TOOL_REGISTRY_KEY = "__veryfront_tool_registry__";

interface GlobalToolRegistry {
  [TOOL_REGISTRY_KEY]?: ToolRegistryClass;
}

const _globalTool = globalThis as unknown as GlobalToolRegistry;
export const toolRegistry: ToolRegistryClass = _globalTool[TOOL_REGISTRY_KEY] ||=
  new ToolRegistryClass();

export function toolToProviderDefinition(tool: Tool): ToolDefinition {
  // Use pre-converted JSON Schema if available (preferred)
  // Fall back to runtime conversion if needed
  const jsonSchema = tool.inputSchemaJson || zodToJsonSchema(tool.inputSchema);

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
