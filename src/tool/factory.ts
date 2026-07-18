import type { Tool, ToolConfig, ToolExecutionContext } from "./types.ts";
import type { JsonSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { zodToJsonSchema } from "./schema/zod-json-schema.ts";
import { agentLogger } from "#veryfront/utils";
import { createError, getErrorMessage, INVALID_ARGUMENT, toError } from "#veryfront/errors";

interface ContractSchemaShape {
  __zod?: unknown;
  _output?: unknown;
  parse: (input: unknown) => unknown;
  safeParse?: (input: unknown) => unknown;
}

interface SchemaWithParse {
  parse: (input: unknown) => unknown;
}

function isJsonSchemaObject(value: unknown): value is JsonSchema {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string";
}

function isContractSchema(value: unknown): value is ContractSchemaShape {
  if (value === null || typeof value !== "object") return false;
  if ("__zod" in value) return true;
  return (
    "_output" in value &&
    typeof (value as { parse?: unknown }).parse === "function"
  );
}

function hasSchemaParse(schema: unknown): schema is SchemaWithParse {
  return typeof (schema as { parse?: unknown } | null | undefined)?.parse === "function";
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
  if (isJsonSchemaObject(schema)) {
    logSchemaResult(logPrefix, toolId, "Raw JSON", schema);
    return schema;
  }

  // Contract Schema<T> values route through the SchemaValidator contract.
  if (isContractSchema(schema)) {
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

  if (permissive) return permissiveFallback(logPrefix, toolId, "Using fully dynamic schema");

  schemaError(
    toolId,
    "input schema is not a valid Veryfront schema. Use defineSchema() or set allowUnknownSchema to true.",
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

/** Create a typed tool definition. */
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
  const outputSchemaJson = config.outputSchema
    ? convertSchemaToJson(
      config.outputSchema,
      id,
      "TOOL_OUTPUT",
      config.allowUnknownSchema ?? false,
    )
    : undefined;

  const createdTool: Tool<TInput, TOutput> = {
    id,
    type: "function" as const,
    description: config.description,
    ...(config.delegatedIntegrationTools
      ? { delegatedIntegrationTools: [...config.delegatedIntegrationTools] }
      : {}),
    inputSchema: config.inputSchema as Schema<TInput>,
    inputSchemaJson,
    outputSchema: config.outputSchema as Schema<TOutput> | undefined,
    outputSchemaJson,
    execute: async (input: TInput, context?: ToolExecutionContext) => {
      let validated = input;
      if (hasSchemaParse(config.inputSchema)) {
        try {
          validated = config.inputSchema.parse(input) as TInput;
        } catch (error) {
          throw toError(
            createError({
              type: "agent",
              message: `Tool "${id}" input validation failed: ${getErrorMessage(error)}`,
            }),
          );
        }
      }

      return await config.execute(validated, context);
    },
    mcp: config.mcp,
  };

  return explicitId ? createdTool : markGeneratedToolId(createdTool);
}

/** Configuration used by dynamic tool. */
export interface DynamicToolConfig {
  id?: string;
  description: string;
  inputSchema: unknown;
  inputSchemaJson?: JsonSchema;
  execute: (input: unknown, context?: ToolExecutionContext) => Promise<unknown> | unknown;
  toModelOutput?: (output: unknown) => unknown;
  mcp?: ToolConfig["mcp"];
}

/** Create a dynamic tool definition. */
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
        input = config.inputSchema.parse(input);
      } else if (input === undefined) {
        input = {};
      } else if (input === null || typeof input !== "object") {
        throw INVALID_ARGUMENT.create({ detail: "dynamicTool: input must be a non-null object" });
      }
      const result = await config.execute(input, context);
      return config.toModelOutput ? config.toModelOutput(result) : result;
    },
    mcp: config.mcp,
  };

  return explicitId ? createdTool : markGeneratedToolId(createdTool);
}
