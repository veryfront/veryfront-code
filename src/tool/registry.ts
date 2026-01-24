import type { Tool, ToolDefinition } from "./types.ts";
import { zodToJsonSchema } from "./schema/zod-json-schema.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";

class ToolRegistryClass {
  private tools = new Map<string, Tool>();

  register(id: string, toolInstance: Tool): void {
    if (this.tools.has(id)) {
      agentLogger.debug(`Tool "${id}" is already registered. Overwriting.`);
    }

    this.tools.set(id, toolInstance);
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  getAllIds(): string[] {
    return [...this.tools.keys()];
  }

  getAll(): Map<string, Tool> {
    return new Map(this.tools);
  }

  clear(): void {
    this.tools.clear();
  }

  getToolsForProvider(): ToolDefinition[] {
    return [...this.tools.values()].map(toolToProviderDefinition);
  }
}

const TOOL_REGISTRY_KEY = "__veryfront_tool_registry__";

type GlobalToolRegistry = {
  [TOOL_REGISTRY_KEY]?: ToolRegistryClass;
};

const globalRegistry = globalThis as GlobalToolRegistry;

export const toolRegistry: ToolRegistryClass = globalRegistry[TOOL_REGISTRY_KEY] ??=
  new ToolRegistryClass();

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
