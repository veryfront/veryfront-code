import type { Tool, ToolConfig, ToolExecutionContext } from "./types.ts";
import type { JsonSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { zodToJsonSchema } from "./schema/zod-json-schema.ts";
import { agentLogger } from "#veryfront/utils";
import { createError, getErrorMessage, INVALID_ARGUMENT, toError } from "#veryfront/errors";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import {
  canIdentifyProxyWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const objectCreate = Object.create;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const ownKeys = Reflect.ownKeys;
const structuredCloneValue = globalThis.structuredClone;

function hasOwn(object: PropertyDescriptor, key: PropertyKey): boolean {
  return apply(objectHasOwnProperty, object, [key]) as boolean;
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

function snapshotJsonSchemaObject(value: unknown): JsonSchema | undefined {
  const snapshot = snapshotBoundedJsonValue(value);
  return snapshot.success &&
      typeof snapshot.value === "object" &&
      snapshot.value !== null &&
      !Array.isArray(snapshot.value)
    ? snapshot.value
    : undefined;
}

// Inferring "this is a raw JSON Schema" from an unknown value needs positive
// evidence. Without it, foreign shapes such as a Zod internal ({ _def: ... })
// would be shipped verbatim to providers as inputSchemaJson. Unions and $ref
// schemas legitimately omit `type`, so membership — not `type` — is the test.
//
// The set is the full draft 2020-12 keyword vocabulary, because a schema whose
// only keyword is a constraint ({ pattern }, { minimum }, { maxItems }) is as
// valid as one carrying `type`, and a partial list rejects it. Keywords are
// grouped by the vocabulary meta-schema that defines them; `definitions` is the
// draft-07 spelling of `$defs`, which providers still emit.
const JSON_SCHEMA_KEYWORDS = new Set([
  // Core
  "$anchor",
  "$comment",
  "$defs",
  "$dynamicAnchor",
  "$dynamicRef",
  "$id",
  "$ref",
  "$schema",
  "$vocabulary",
  "definitions",
  // Applicator
  "additionalProperties",
  "allOf",
  "anyOf",
  "contains",
  "dependentSchemas",
  "else",
  "if",
  "items",
  "not",
  "oneOf",
  "patternProperties",
  "prefixItems",
  "properties",
  "propertyNames",
  "then",
  // Unevaluated
  "unevaluatedItems",
  "unevaluatedProperties",
  // Validation
  "const",
  "dependentRequired",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "maxContains",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minContains",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "pattern",
  "required",
  "type",
  "uniqueItems",
  // Meta-data
  "default",
  "deprecated",
  "description",
  "examples",
  "readOnly",
  "title",
  "writeOnly",
  // Format annotation
  "format",
  // Content
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
]);

function isInferredJsonSchemaObject(value: JsonSchema): boolean {
  return Object.keys(value).some((key) => JSON_SCHEMA_KEYWORDS.has(key));
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

function captureSchemaParser(
  schema: unknown,
): ((input: unknown) => unknown) | undefined {
  if (!hasSchemaParse(schema)) return undefined;
  const parse = schema.parse;
  return (input) => Reflect.apply(parse, schema, [input]);
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
  agentLogger.debug(
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

  const jsonSchema = snapshotJsonSchemaObject(schema);
  if (jsonSchema && isInferredJsonSchemaObject(jsonSchema)) {
    logSchemaResult(logPrefix, toolId, "Raw JSON", jsonSchema);
    return jsonSchema;
  }

  if (permissive) return permissiveFallback(logPrefix, toolId, "Using fully dynamic schema");

  schemaError(
    toolId,
    "input schema is not a valid Veryfront schema. Use defineSchema() or set allowUnknownSchema to true.",
  );
}

function snapshotMcpConfig(
  value: ToolConfig["mcp"] | undefined,
  toolId: string,
): ToolConfig["mcp"] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) {
    schemaError(toolId, "MCP configuration must be a bounded JSON object");
  }
  let inspectedValue: object = value;
  if (canIdentifyProxyWithoutHooks) {
    if (isProxyWithoutHooks(value)) {
      schemaError(toolId, "MCP configuration must contain only data properties");
    }
  } else {
    if (typeof structuredCloneValue !== "function") {
      schemaError(toolId, "MCP configuration must contain only data properties");
    }
    // Local MCP metadata crosses the same edge-runtime trust boundary as
    // provider-bound JSON: hosts without no-hook Proxy detection use the
    // captured structured clone primitive to reject Proxies before reflection
    // and then validate the owned clone.
    try {
      inspectedValue = apply(structuredCloneValue, globalThis, [value]) as object;
    } catch {
      schemaError(toolId, "MCP configuration must contain only data properties");
    }
  }
  if (arrayIsArray(inspectedValue)) {
    schemaError(toolId, "MCP configuration must be a bounded JSON object");
  }

  const canonicalInput = objectCreate(null) as Record<string, unknown>;
  let keys: PropertyKey[];
  try {
    keys = ownKeys(inspectedValue);
  } catch {
    schemaError(toolId, "MCP configuration must be a bounded JSON object");
  }
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    if (typeof key !== "string") {
      schemaError(toolId, "MCP configuration must be a bounded JSON object");
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = objectGetOwnPropertyDescriptor(inspectedValue, key);
    } catch {
      schemaError(toolId, "MCP configuration must contain only data properties");
    }
    if (!descriptor || !hasOwn(descriptor, "value")) {
      schemaError(toolId, "MCP configuration must contain only data properties");
    }
    if (descriptor.enumerable && descriptor.value !== undefined) {
      // A null prototype makes assignment safe even for `__proto__` and other
      // special names without consulting inherited setters.
      canonicalInput[key] = descriptor.value;
    }
  }

  const snapshot = snapshotBoundedJsonValue(canonicalInput);
  if (
    !snapshot.success ||
    typeof snapshot.value !== "object" ||
    snapshot.value === null ||
    arrayIsArray(snapshot.value)
  ) {
    schemaError(toolId, "MCP configuration must be a bounded JSON object");
  }
  return snapshot.value as ToolConfig["mcp"];
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
  const inputSchema = config.inputSchema;
  const outputSchema = config.outputSchema;
  const parseInput = captureSchemaParser(inputSchema);
  const execute = config.execute;
  if (typeof execute !== "function") {
    schemaError(id, "execute must be a function");
  }

  const inputSchemaJson = convertSchemaToJson(
    inputSchema,
    id,
    "TOOL",
    config.allowUnknownSchema ?? false,
  );
  const outputSchemaJson = outputSchema
    ? convertSchemaToJson(
      outputSchema,
      id,
      "TOOL_OUTPUT",
      config.allowUnknownSchema ?? false,
    )
    : undefined;
  const delegatedIntegrationTools = config.delegatedIntegrationTools
    ? [...config.delegatedIntegrationTools]
    : undefined;
  const mcp = snapshotMcpConfig(config.mcp, id);

  const createdTool: Tool<TInput, TOutput> = {
    id,
    type: "function" as const,
    description: config.description,
    ...(delegatedIntegrationTools ? { delegatedIntegrationTools } : {}),
    inputSchema: inputSchema as Schema<TInput>,
    inputSchemaJson,
    outputSchema: outputSchema as Schema<TOutput> | undefined,
    outputSchemaJson,
    execute: async (input: TInput, context?: ToolExecutionContext) => {
      let validated = input;
      if (parseInput) {
        try {
          validated = parseInput(input) as TInput;
        } catch (error) {
          throw toError(
            createError({
              type: "agent",
              message: `Tool "${id}" input validation failed: ${getErrorMessage(error)}`,
            }),
          );
        }
      }

      return await execute(validated, context);
    },
    mcp,
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
  const inputSchema = config.inputSchema;
  const parseInput = captureSchemaParser(inputSchema);
  const execute = config.execute;
  const toModelOutput = config.toModelOutput;
  if (typeof execute !== "function") {
    schemaError(id, "execute must be a function");
  }
  if (toModelOutput !== undefined && typeof toModelOutput !== "function") {
    schemaError(id, "toModelOutput must be a function");
  }

  const inputSchemaJson = config.inputSchemaJson === undefined
    ? convertSchemaToJson(inputSchema, id, "DYNAMIC_TOOL", true)
    : snapshotJsonSchemaObject(config.inputSchemaJson);
  if (!inputSchemaJson) {
    schemaError(id, "inputSchemaJson must be a bounded JSON Schema object");
  }
  const mcp = snapshotMcpConfig(config.mcp, id);

  const createdTool: Tool<unknown, unknown> = {
    id,
    type: "dynamic" as const,
    description: config.description,
    inputSchema: inputSchema as Schema<unknown>,
    inputSchemaJson,
    execute: async (input: unknown, context?: ToolExecutionContext) => {
      if (parseInput) {
        input = parseInput(input);
      } else if (input === undefined) {
        input = {};
      } else if (input === null || typeof input !== "object") {
        throw INVALID_ARGUMENT.create({ detail: "dynamicTool: input must be a non-null object" });
      }
      const result = await execute(input, context);
      return toModelOutput ? toModelOutput(result) : result;
    },
    mcp,
  };

  return explicitId ? createdTool : markGeneratedToolId(createdTool);
}
