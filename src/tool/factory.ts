import type { Tool, ToolConfig, ToolExecutionContext } from "./types.ts";
import type { JsonSchema } from "./schema/json-schema.ts";
import type { z } from "zod";
import { zodToJsonSchema } from "./schema/zod-json-schema.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

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
  const formatErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

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
      throw toError(createError({
        type: "agent",
        message: `Tool "${toolId}" input schema conversion failed: ${formatErrorMessage(error)}`,
      }));
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
    } catch (error) {
      if (permissive) {
        agentLogger.info(`[${logPrefix}] Using permissive schema for "${toolId}"`);
        return fallbackSchema;
      }
      throw toError(createError({
        type: "agent",
        message: `Tool "${toolId}" schema introspection failed: ${formatErrorMessage(error)}`,
      }));
    }
  }

  // Strategy 3: Fallback to empty/permissive schema
  if (permissive) {
    agentLogger.info(`[${logPrefix}] Using fully dynamic schema for "${toolId}"`);
    return fallbackSchema;
  }

  throw toError(createError({
    type: "agent",
    message:
      `Tool "${toolId}" input schema is not a valid Zod schema. Use the same Zod instance or set allowUnknownSchema to true.`,
  }));
}

/**
 * Generate a unique tool ID
 */
let toolIdCounter = 0;
function generateToolId(): string {
  return `tool_${Date.now()}_${toolIdCounter++}`;
}

/**
 * Create a tool
 *
 * @example
 * ```typescript
 * import { tool } from 'veryfront/tool';
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
export function tool<TInput = unknown, TOutput = unknown>(
  config: ToolConfig<TInput, TOutput>,
): Tool<TInput, TOutput> {
  const id = config.id || generateToolId();

  // Pre-convert Zod schema to JSON Schema using unified conversion logic
  const inputSchemaJson = convertSchemaToJson(
    config.inputSchema,
    id,
    "TOOL",
    config.allowUnknownSchema ?? false,
  );

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
 * import { dynamicTool } from 'veryfront/tool';
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
    // Dynamic tools accept unknown schemas - cast to satisfy Tool interface
    inputSchema: config.inputSchema as z.ZodSchema<unknown>,
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
