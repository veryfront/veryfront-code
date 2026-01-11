import type { Tool, ToolConfig, ToolDefinition, ToolExecutionContext } from "../types/tool.ts";
import type { JsonSchema } from "../types/json-schema.ts";
import { zodToJsonSchema } from "./zod-json-schema.ts";
import { agentLogger } from "@veryfront/utils/logger/logger.ts";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";

/**
 * Schema type for checking Zod-like schemas
 */
interface ZodLikeSchema {
  _def?: {
    typeName?: string;
    shape?: (() => Record<string, unknown>) | Record<string, unknown>;
  };
  parse?: (input: unknown) => void;
}

/**
 * Check if a schema is a valid Zod schema with typeName
 */
function hasValidZodTypeName(schema: unknown): schema is ZodLikeSchema {
  return (
    schema !== null &&
    typeof schema === "object" &&
    "_def" in schema &&
    !!(schema as ZodLikeSchema)._def?.typeName
  );
}

/**
 * Extract shape from a Zod-like schema (external instance)
 */
function getSchemaShape(schema: ZodLikeSchema): Record<string, unknown> | null {
  const shape = schema._def?.shape;
  return shape ? (typeof shape === "function" ? shape() : shape) : null;
}

/**
 * Build JSON Schema from shape keys (fallback when full conversion fails)
 */
function buildSchemaFromShape(
  shape: Record<string, unknown>,
  additionalProperties = false,
): JsonSchema {
  const keys = Object.keys(shape);
  const properties = Object.fromEntries(keys.map((key) => [key, { type: "string" as const }]));
  return {
    type: "object" as const,
    properties,
    required: additionalProperties ? undefined : keys,
    ...(additionalProperties && { additionalProperties: true }),
  };
}

/**
 * Convert a schema to JSON Schema with fallback strategies.
 * Handles internal Zod, external Zod instances, and unknown schemas.
 */
function convertSchemaToJson(
  schema: unknown,
  toolId: string,
  logPrefix: string,
  permissive = false,
): JsonSchema {
  const fallbackSchema: JsonSchema = permissive
    ? { type: "object", properties: {}, additionalProperties: true }
    : { type: "object", properties: {} };

  // Strategy 1: Full Zod conversion if typeName is present
  if (hasValidZodTypeName(schema)) {
    try {
      // deno-lint-ignore no-explicit-any
      const result = zodToJsonSchema(schema as any);
      agentLogger.info(
        `[${logPrefix}] Pre-converted schema for "${toolId}": ${
          Object.keys(result.properties || {}).length
        } properties`,
      );
      return result;
    } catch (error) {
      if (permissive) {
        agentLogger.info(`[${logPrefix}] Using permissive schema for "${toolId}"`);
        return fallbackSchema;
      }
      agentLogger.warn(`[${logPrefix}] Failed to pre-convert schema for "${toolId}":`, error);
    }
  }

  // Strategy 2: Introspect shape from external Zod instance
  const zodLike = schema as ZodLikeSchema;
  const shape = getSchemaShape(zodLike);
  if (shape) {
    try {
      const result = buildSchemaFromShape(shape, permissive);
      agentLogger.info(
        `[${logPrefix}] Introspected schema for "${toolId}" from external zod: ${
          Object.keys(result.properties || {}).length
        } properties`,
      );
      return result;
    } catch {
      agentLogger.warn(`[${logPrefix}] Schema for "${toolId}" could not be introspected.`);
      return fallbackSchema;
    }
  }

  // Strategy 3: Fallback to empty/permissive schema
  const logFn = permissive ? agentLogger.info : agentLogger.warn;
  const message = permissive
    ? `[${logPrefix}] Using fully dynamic schema for "${toolId}"`
    : `[${logPrefix}] Schema for "${toolId}" is not a valid Zod schema (different zod instance?). Input validation may be limited.`;
  logFn(message);
  return fallbackSchema;
}

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

  // Pre-convert Zod schema to JSON Schema using unified conversion logic
  const inputSchemaJson = convertSchemaToJson(config.inputSchema, id, "TOOL", false);

  return {
    id,
    type: "function" as const,
    description: config.description,
    inputSchema: config.inputSchema,
    inputSchemaJson, // Store pre-converted schema
    execute: async (input: TInput, context?: ToolExecutionContext) => {
      // Validate input if zod schema with parse method is available
      const schema = config.inputSchema as ZodLikeSchema;
      if (schema && typeof schema.parse === "function") {
        try {
          schema.parse(input);
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
   * Input schema - any Zod schema is accepted. For dynamic tools where the input shape
   * is truly unknown at compile time, it is recommended to use z.unknown(), z.any(),
   * or z.object({}). A schema is still required for validation even though types are unknown.
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

  // Convert schema to JSON Schema with permissive fallback for dynamic tools
  const inputSchemaJson = convertSchemaToJson(config.inputSchema, id, "DYNAMIC_TOOL", true);

  return {
    id,
    type: "dynamic" as const,
    description: config.description,
    inputSchema: config.inputSchema as any,
    inputSchemaJson,
    execute: async (input: unknown, context?: ToolExecutionContext) => {
      // For dynamic tools, we skip input validation entirely.
      // The tool implementation is responsible for runtime validation.
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

  return await tool.execute(input, context);
}

export { zodToJsonSchema } from "./zod-json-schema.ts";
