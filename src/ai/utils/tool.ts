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

  // Check if we have a valid zod schema (has _def property)
  const hasValidZodSchema = config.inputSchema &&
    typeof config.inputSchema === "object" &&
    "_def" in config.inputSchema &&
    (config.inputSchema as { _def?: { typeName?: string } })._def?.typeName;

  // Pre-convert Zod schema to JSON Schema immediately
  // This happens BEFORE any bundling, in a clean environment
  let inputSchemaJson: JsonSchema | undefined;
  if (hasValidZodSchema) {
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
  } else {
    // Try to introspect the schema from external zod instance
    const externalSchema = config.inputSchema as {
      _def?: {
        typeName?: string;
        shape?: (() => Record<string, unknown>) | Record<string, unknown>;
      };
    };

    if (externalSchema?._def?.shape) {
      try {
        const shape = typeof externalSchema._def.shape === "function"
          ? externalSchema._def.shape()
          : externalSchema._def.shape;

        // Build JSON Schema from shape inspection
        const properties: Record<string, JsonSchema> = {};
        for (const key of Object.keys(shape || {})) {
          // Default to string type for unknown schemas
          properties[key] = { type: "string" as const };
        }
        inputSchemaJson = {
          type: "object" as const,
          properties,
          required: Object.keys(properties),
        };
        agentLogger.info(
          `[TOOL] Introspected schema for "${id}" from external zod: ${
            Object.keys(properties).length
          } properties`,
        );
      } catch {
        inputSchemaJson = { type: "object", properties: {} };
        agentLogger.warn(
          `[TOOL] Schema for "${id}" could not be introspected. Using empty schema.`,
        );
      }
    } else {
      agentLogger.warn(
        `[TOOL] Schema for "${id}" is not a valid Zod schema (different zod instance?). ` +
          `Skipping pre-conversion. Input validation may be limited.`,
      );
      // Create a basic schema from inspection if possible
      inputSchemaJson = { type: "object", properties: {} };
    }
  }

  return {
    id,
    description: config.description,
    inputSchema: config.inputSchema,
    inputSchemaJson, // Store pre-converted schema
    execute: async (input: TInput, context?: ToolExecutionContext) => {
      // Validate input if zod schema is available
      if (hasValidZodSchema) {
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
      } else if (
        config.inputSchema &&
        typeof config.inputSchema === "object" &&
        "parse" in config.inputSchema &&
        typeof (config.inputSchema as { parse?: unknown }).parse === "function"
      ) {
        // Try to use parse method if available (external zod instance)
        try {
          (config.inputSchema as { parse: (input: unknown) => void }).parse(input);
        } catch (error) {
          throw toError(createError({
            type: "agent",
            message: `Tool "${id}" input validation failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          }));
        }
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
