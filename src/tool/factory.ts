import type { Tool, ToolConfig, ToolExecutionContext } from "./types.ts";
import type { JsonSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { zodToJsonSchema } from "./schema/zod-json-schema.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { createError, getErrorMessage, toError } from "#veryfront/errors/veryfront-error.ts";

interface ZodLikeSchema {
  _def?: {
    typeName?: string; // v3
    type?: string; // v4
    shape?: (() => Record<string, unknown>) | Record<string, unknown>;
  };
  parse?: (input: unknown) => void;
}

interface ContractSchemaShape {
  __zod?: unknown;
  _output?: unknown;
  parse: (input: unknown) => unknown;
  safeParse?: (input: unknown) => unknown;
}

interface SchemaWithParse {
  parse: (input: unknown) => unknown;
}

function isContractSchema(value: unknown): value is ContractSchemaShape {
  if (value === null || typeof value !== "object") return false;
  if ("__zod" in value) return true;
  return (
    "_output" in value &&
    typeof (value as { parse?: unknown }).parse === "function"
  );
}

function hasValidZodTypeName(schema: unknown): schema is ZodLikeSchema {
  if (schema === null || typeof schema !== "object") return false;
  if (!("_def" in schema)) return false;
  const def = (schema as ZodLikeSchema)._def;
  return !!(def?.typeName ?? def?.type);
}

function getSchemaShape(schema: ZodLikeSchema): Record<string, unknown> | null {
  const shape = schema._def?.shape;
  if (!shape) return null;
  return typeof shape === "function" ? shape() : shape;
}

function hasSchemaParse(schema: unknown): schema is SchemaWithParse {
  return typeof (schema as { parse?: unknown } | null | undefined)?.parse === "function";
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
  convertSchema: () => JsonSchema,
  toolId: string,
  logPrefix: string,
  permissive: boolean,
  failureLabel: string,
): JsonSchema {
  try {
    return convertSchema();
  } catch (error) {
    if (permissive) return permissiveFallback(logPrefix, toolId, "Using permissive schema");
    schemaError(toolId, `${failureLabel}: ${getErrorMessage(error)}`);
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
  // Modern path: contract Schema<T> (defineSchema-produced) — route through
  // the SchemaValidator contract via zodToJsonSchema (which detects both
  // wrapped and raw zod shapes).
  if (isContractSchema(schema) || hasValidZodTypeName(schema)) {
    const result = tryConvert(
      () => zodToJsonSchema(schema),
      toolId,
      logPrefix,
      permissive,
      "input schema conversion failed",
    );
    logSchemaResult(logPrefix, toolId, "Pre-converted", result);
    return result;
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
    logSchemaResult(logPrefix, toolId, "Introspected", result);
    return result;
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

function markGeneratedToolId<TInput, TOutput>(tool: Tool<TInput, TOutput>): Tool<TInput, TOutput> {
  return {
    ...tool,
    __veryfrontGeneratedId: tool.id,
  };
}

export function tool<TInput = unknown, TOutput = unknown>(
  config: ToolConfig<TInput, TOutput>,
): Tool<TInput, TOutput> {
  const explicitId = typeof config.id === "string" && config.id.length > 0 ? config.id : undefined;
  const id = explicitId ?? generateToolId();

  const inputSchemaJson = convertSchemaToJson(
    config.inputSchema,
    id,
    "TOOL",
    config.allowUnknownSchema ?? false,
  );

  const createdTool: Tool<TInput, TOutput> = {
    id,
    type: "function" as const,
    description: config.description,
    inputSchema: config.inputSchema,
    inputSchemaJson,
    execute: async (input: TInput, context?: ToolExecutionContext) => {
      if (hasSchemaParse(config.inputSchema)) {
        try {
          config.inputSchema.parse(input);
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

  return explicitId ? createdTool : markGeneratedToolId(createdTool);
}

export interface DynamicToolConfig {
  id?: string;
  description: string;
  inputSchema: unknown;
  inputSchemaJson?: JsonSchema;
  execute: (input: unknown, context?: ToolExecutionContext) => Promise<unknown> | unknown;
  toModelOutput?: (output: unknown) => unknown;
  mcp?: ToolConfig["mcp"];
}

export function dynamicTool(config: DynamicToolConfig): Tool<unknown, unknown> {
  const explicitId = typeof config.id === "string" && config.id.length > 0 ? config.id : undefined;
  const id = explicitId ?? generateToolId();

  const inputSchemaJson = config.inputSchemaJson ??
    convertSchemaToJson(config.inputSchema, id, "DYNAMIC_TOOL", true);

  const createdTool: Tool<unknown, unknown> = {
    id,
    type: "dynamic" as const,
    description: config.description,
    inputSchema: config.inputSchema as Schema<unknown>,
    inputSchemaJson,
    execute: async (input: unknown, context?: ToolExecutionContext) => {
      if (hasSchemaParse(config.inputSchema)) {
        config.inputSchema.parse(input);
      } else if (input === undefined) {
        input = {};
      } else if (input === null || typeof input !== "object") {
        throw new Error("dynamicTool: input must be a non-null object");
      }
      const result = await config.execute(input, context);
      return config.toModelOutput ? config.toModelOutput(result) : result;
    },
    mcp: config.mcp,
  };

  return explicitId ? createdTool : markGeneratedToolId(createdTool);
}
