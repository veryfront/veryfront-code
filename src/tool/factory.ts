import type { Tool, ToolConfig, ToolExecutionContext } from "./types.ts";
import type { JsonSchema } from "./schema/json-schema.ts";
import type { z } from "zod";
import { zodToJsonSchema } from "./schema/zod-json-schema.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

interface ZodLikeSchema {
  _def?: {
    typeName?: string;
    shape?: (() => Record<string, unknown>) | Record<string, unknown>;
  };
  parse?: (input: unknown) => void;
}

function hasValidZodTypeName(schema: unknown): schema is ZodLikeSchema {
  return (
    schema !== null &&
    typeof schema === "object" &&
    "_def" in schema &&
    !!(schema as ZodLikeSchema)._def?.typeName
  );
}

function getSchemaShape(schema: ZodLikeSchema): Record<string, unknown> | null {
  const shape = schema._def?.shape;
  if (!shape) return null;
  return typeof shape === "function" ? shape() : shape;
}

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
    ...(additionalProperties ? { additionalProperties: true } : {}),
  };
}

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

      throw toError(
        createError({
          type: "agent",
          message: `Tool "${toolId}" input schema conversion failed: ${formatErrorMessage(error)}`,
        }),
      );
    }
  }

  const shape = getSchemaShape(schema as ZodLikeSchema);
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

      throw toError(
        createError({
          type: "agent",
          message: `Tool "${toolId}" schema introspection failed: ${formatErrorMessage(error)}`,
        }),
      );
    }
  }

  if (permissive) {
    agentLogger.info(`[${logPrefix}] Using fully dynamic schema for "${toolId}"`);
    return fallbackSchema;
  }

  throw toError(
    createError({
      type: "agent",
      message:
        `Tool "${toolId}" input schema is not a valid Zod schema. Use the same Zod instance or set allowUnknownSchema to true.`,
    }),
  );
}

let toolIdCounter = 0;
function generateToolId(): string {
  return `tool_${Date.now()}_${toolIdCounter++}`;
}

export function tool<TInput = unknown, TOutput = unknown>(
  config: ToolConfig<TInput, TOutput>,
): Tool<TInput, TOutput> {
  const id = config.id || generateToolId();

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
    inputSchemaJson,
    execute: async (input: TInput, context?: ToolExecutionContext) => {
      const schema = config.inputSchema as ZodLikeSchema;
      if (typeof schema?.parse === "function") {
        try {
          schema.parse(input);
        } catch (error) {
          throw toError(
            createError({
              type: "agent",
              message: `Tool "${id}" input validation failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            }),
          );
        }
      }

      return await config.execute(input, context);
    },
    mcp: config.mcp,
  };
}

export interface DynamicToolConfig {
  id?: string;
  description: string;
  inputSchema: unknown;
  execute: (input: unknown, context?: ToolExecutionContext) => Promise<unknown> | unknown;
  toModelOutput?: (output: unknown) => unknown;
  mcp?: {
    enabled?: boolean;
    requiresAuth?: boolean;
    cachePolicy?: "no-cache" | "cache" | "cache-first";
  };
}

export function dynamicTool(config: DynamicToolConfig): Tool<unknown, unknown> {
  const id = config.id || generateToolId();

  const inputSchemaJson = convertSchemaToJson(config.inputSchema, id, "DYNAMIC_TOOL", true);

  return {
    id,
    type: "dynamic" as const,
    description: config.description,
    inputSchema: config.inputSchema as z.ZodSchema<unknown>,
    inputSchemaJson,
    execute: async (input: unknown, context?: ToolExecutionContext) => {
      const result = await config.execute(input, context);
      return config.toModelOutput ? config.toModelOutput(result) : result;
    },
    mcp: config.mcp,
  };
}
