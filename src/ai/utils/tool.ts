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
    type: "function" as const,
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
 * Configuration for dynamic tools where input/output types are unknown at compile time
 */
export interface DynamicToolConfig {
  /** Tool identifier (optional, auto-generated if not provided) */
  id?: string;

  /** Tool description for the AI model */
  description: string;

  /**
   * Input schema - can be a Zod schema (z.unknown(), z.any(), or z.object({}))
   * A schema is still required for validation even though types are unknown
   */
  inputSchema: unknown;

  /**
   * Tool execution function - input is typed as unknown and must be validated/cast at runtime
   */
  execute: (
    input: unknown,
    context?: ToolExecutionContext,
  ) => Promise<unknown> | unknown;

  /**
   * Optional conversion function that maps the tool result to an output
   * that can be used by the language model
   */
  toModelOutput?: (output: unknown) => unknown;

  /** MCP configuration */
  mcp?: {
    /** Expose via MCP */
    enabled?: boolean;
    /** Require authentication */
    requiresAuth?: boolean;
    /** Cache policy */
    cachePolicy?: "no-cache" | "cache" | "cache-first";
  };
}

/**
 * Create a dynamic tool where input/output types are not known at compile time.
 *
 * Use this for:
 * - MCP (Model Context Protocol) tools without schemas
 * - User-defined functions loaded at runtime
 * - Tools loaded from external sources or databases
 * - Dynamic tool generation based on user input
 *
 * @example
 * ```typescript
 * import { dynamicTool } from 'veryfront/ai';
 * import { z } from 'zod';
 *
 * export const customTool = dynamicTool({
 *   description: 'Execute a custom user-defined function',
 *   inputSchema: z.object({}),
 *   execute: async (input) => {
 *     // input is typed as 'unknown' - validate/cast at runtime
 *     const { action, parameters } = input as any;
 *     return { result: `Executed ${action}` };
 *   },
 * });
 * ```
 */
export function dynamicTool(config: DynamicToolConfig): Tool<unknown, unknown> {
  const id = config.id || generateToolId();

  // Try to convert schema to JSON Schema if possible
  let inputSchemaJson: JsonSchema | undefined;

  // Check if it's a zod-like schema with _def
  const zodLikeSchema = config.inputSchema as {
    _def?: { typeName?: string; shape?: (() => Record<string, unknown>) | Record<string, unknown> };
  };

  if (zodLikeSchema?._def?.typeName) {
    try {
      // deno-lint-ignore no-explicit-any
      inputSchemaJson = zodToJsonSchema(config.inputSchema as any);
      agentLogger.info(
        `[DYNAMIC_TOOL] Converted schema for "${id}": ${
          Object.keys(inputSchemaJson.properties || {}).length
        } properties`,
      );
    } catch {
      // For z.unknown() or z.any(), create a permissive schema
      inputSchemaJson = { type: "object", properties: {}, additionalProperties: true };
      agentLogger.info(`[DYNAMIC_TOOL] Using permissive schema for "${id}"`);
    }
  } else if (zodLikeSchema?._def?.shape) {
    // Try to introspect shape
    try {
      const shape = typeof zodLikeSchema._def.shape === "function"
        ? zodLikeSchema._def.shape()
        : zodLikeSchema._def.shape;

      const properties: Record<string, JsonSchema> = {};
      for (const key of Object.keys(shape || {})) {
        properties[key] = { type: "string" as const };
      }
      inputSchemaJson = {
        type: "object" as const,
        properties,
        additionalProperties: true,
      };
      agentLogger.info(`[DYNAMIC_TOOL] Introspected schema for "${id}"`);
    } catch {
      inputSchemaJson = { type: "object", properties: {}, additionalProperties: true };
    }
  } else {
    // Fully dynamic - accept anything
    inputSchemaJson = { type: "object", properties: {}, additionalProperties: true };
    agentLogger.info(`[DYNAMIC_TOOL] Using fully dynamic schema for "${id}"`);
  }

  return {
    id,
    type: "dynamic" as const,
    description: config.description,
    inputSchema: config.inputSchema as any,
    inputSchemaJson,
    execute: async (input: unknown, context?: ToolExecutionContext) => {
      // For dynamic tools, we do minimal validation
      // The tool implementation is responsible for runtime validation
      const result = await config.execute(input, context);

      // Apply output transformation if provided
      if (config.toModelOutput) {
        return config.toModelOutput(result);
      }

      return result;
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
// deno-lint-ignore no-explicit-any
const _globalTool = globalThis as any;
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
