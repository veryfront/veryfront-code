import type { Tool, ToolConfig, ToolDefinition, ToolExecutionContext } from "../types/tool.ts";
import type { JsonSchema } from "../types/json-schema.ts";
import { zodToJsonSchema } from "./zod-json-schema.ts";
import { agentLogger } from "../../core/utils/logger/logger.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

/**
 * Create a tool
 *
 * @example
 * ```typescript
 * import { tool } from 'veryfront/ai';
 * import { z } from 'zod';

 *
 * export default tool({
 *   description: 'Search the web',
 *   inputSchema: z.object({
 *     query: z.string(),
 *   }),
 *   execute: async ({ query }) => {
 *     const results = await searchWeb(query);
 *     return results;
 *   },
 * });
 * ```
 */
export function tool<TInput = any, TOutput = any>(
  config: ToolConfig<TInput, TOutput>,
): Tool<TInput, TOutput> {
  const id = config.id || generateToolId();

  // Pre-convert Zod schema to JSON Schema immediately
  // This happens BEFORE any bundling, in a clean environment
  let inputSchemaJson: JsonSchema | undefined;
  try {
    inputSchemaJson = zodToJsonSchema(config.inputSchema);
    agentLogger.info(
      `[TOOL] Pre-converted schema for "${id}": ${
        Object.keys(inputSchemaJson.properties || {}).length
      } properties`,
    );
  } catch (error) {
    agentLogger.warn(`[TOOL] Failed to pre-convert schema for "${id}":`, error);
    // Continue without pre-converted schema - will fall back to runtime conversion
  }

  return {
    id,
    description: config.description,
    inputSchema: config.inputSchema,
    inputSchemaJson, // Store pre-converted schema
    execute: async (input: TInput, context?: ToolExecutionContext) => {
      // Validate input
      try {
        config.inputSchema.parse(input);
      } catch (error) {
        throw toError(createError({
          type: "agent",
          message: `Tool "${id}" input validation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }));
      }

      // Execute tool
      return await config.execute(input, context);
    },
    mcp: config.mcp,
  };
}

/**
 * Generate a unique tool ID
 */
let toolIdCounter = 0;
function generateToolId(): string {
  return `tool_${Date.now()}_${toolIdCounter++}`;
}

/**
 * Tool registry for managing tools
 */
class ToolRegistryClass {
  private tools = new Map<string, Tool>();

  register(id: string, toolInstance: Tool): void {
    if (this.tools.has(id)) {
      agentLogger.warn(`Tool "${id}" is already registered. Overwriting.`);
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

// Singleton instance
export const toolRegistry = new ToolRegistryClass();

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

/**
 * Execute a tool by ID
 */
export async function executeTool(
  toolId: string,
  input: unknown,
  context?: ToolExecutionContext,
): Promise<unknown> {
  const tool = toolRegistry.get(toolId);

  if (!tool) {
    throw toError(createError({
      type: "agent",
      message: `Tool "${toolId}" not found`,
    }));
  }

  try {
    const result = await tool.execute(input, context);
    return result;
  } catch (error) {
    throw toError(createError({
      type: "agent",
      message: `Tool "${toolId}" execution failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }));
  }
}

export { zodToJsonSchema } from "./zod-json-schema.ts";
