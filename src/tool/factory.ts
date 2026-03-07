import type { Tool, ToolConfig, ToolExecutionContext } from "./types.ts";
import type { JsonSchema } from "./schema/json-schema.ts";
import type { z } from "zod";
import { zodToJsonSchema } from "./schema/zod-json-schema.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { createError, getErrorMessage, toError } from "#veryfront/errors/veryfront-error.ts";

interface ZodLikeSchema {
  _def?: {
    typeName?: string;
    shape?: (() => Record<string, unknown>) | Record<string, unknown>;
  };
  parse?: (input: unknown) => void;
}

function hasValidZodTypeName(schema: unknown): schema is ZodLikeSchema {
  if (schema === null || typeof schema !== "object") return false;
  if (!("_def" in schema)) return false;
  return !!(schema as ZodLikeSchema)._def?.typeName;
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

function permissiveFallback(logPrefix: string, toolId: string, detail: string): JsonSchema {
  agentLogger.info(`[${logPrefix}] ${detail} for "${toolId}"`);
  return { type: "object", properties: {}, additionalProperties: true };
}

function schemaError(toolId: string, message: string): never {
  throw toError(createError({ type: "agent", message: `Tool "${toolId}" ${message}` }));
}

function tryConvert(
  fn: () => JsonSchema,
  toolId: string,
  logPrefix: string,
  permissive: boolean,
  errorDetail: string,
): JsonSchema | null {
  try {
    return fn();
  } catch (error) {
    if (permissive) return permissiveFallback(logPrefix, toolId, "Using permissive schema");
    schemaError(toolId, `${errorDetail}: ${getErrorMessage(error)}`);
  }
}

function logSchemaResult(logPrefix: string, toolId: string, method: string, schema: JsonSchema) {
  agentLogger.info(
    `[${logPrefix}] ${method} schema for "${toolId}": ${
      Object.keys(schema.properties || {}).length
    } properties`,
  );
}

function convertSchemaToJson(
  schema: unknown,
  toolId: string,
  logPrefix: string,
  permissive = false,
): JsonSchema {
  if (hasValidZodTypeName(schema)) {
    const result = tryConvert(
      // deno-lint-ignore no-explicit-any
      () => zodToJsonSchema(schema as any),
      toolId,
      logPrefix,
      permissive,
      "input schema conversion failed",
    );
    if (result) {
      logSchemaResult(logPrefix, toolId, "Pre-converted", result);
      return result;
    }
  }

  const shape = getSchemaShape(schema as ZodLikeSchema);
  if (shape) {
    const result = tryConvert(
      () => buildSchemaFromShape(shape, permissive),
      toolId,
      logPrefix,
      permissive,
      "schema introspection failed",
    );
    if (result) {
      logSchemaResult(logPrefix, toolId, "Introspected", result);
      return result;
    }
  }

  if (permissive) return permissiveFallback(logPrefix, toolId, "Using fully dynamic schema");

  schemaError(
    toolId,
    "input schema is not a valid Zod schema. Use the same Zod instance or set allowUnknownSchema to true.",
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
              message: `Tool "${id}" input validation failed: ${getErrorMessage(error)}`,
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
