import type { Tool, ToolConfig, ToolExecutionContext } from "./types.ts";
import type { JsonSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { zodToJsonSchema } from "./schema/zod-json-schema.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { createError, getErrorMessage, INVALID_ARGUMENT, toError } from "#veryfront/errors";
import { snapshotJsonValue } from "./json-value.ts";

interface ContractSchemaShape {
  __zod?: unknown;
  _output?: unknown;
  parse: (input: unknown) => unknown;
  safeParse?: (input: unknown) => unknown;
}

const JSON_SCHEMA_TYPE_NAMES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);
const JSON_SCHEMA_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$anchor",
  "$dynamicAnchor",
  "$ref",
  "$dynamicRef",
  "$vocabulary",
  "$comment",
  "$defs",
  "definitions",
  "type",
  "title",
  "description",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
  "examples",
  "properties",
  "patternProperties",
  "propertyNames",
  "required",
  "dependentRequired",
  "dependentSchemas",
  "minProperties",
  "maxProperties",
  "items",
  "prefixItems",
  "contains",
  "minContains",
  "maxContains",
  "minItems",
  "maxItems",
  "uniqueItems",
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "anyOf",
  "allOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "enum",
  "const",
  "multipleOf",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
]);
const MAX_TOOL_ID_LENGTH = 128;
const MAX_TOOL_DESCRIPTION_LENGTH = 16_384;
const MAX_DELEGATED_INTEGRATION_TOOLS = 256;
const MAX_MCP_TITLE_LENGTH = 512;

function hasUnsafeControlCharacters(value: string, allowFormattingWhitespace: boolean): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 127) return true;
    if (code < 32 && !(allowFormattingWhitespace && (code === 9 || code === 10 || code === 13))) {
      return true;
    }
  }
  return false;
}

function isJsonSchemaType(value: unknown): boolean {
  return typeof value === "string"
    ? JSON_SCHEMA_TYPE_NAMES.has(value)
    : Array.isArray(value) && value.length > 0 &&
      value.every((entry) => typeof entry === "string" && JSON_SCHEMA_TYPE_NAMES.has(entry));
}

function tryGetPlainObjectDescriptors(value: unknown): PropertyDescriptorMap | undefined {
  if (value === null || typeof value !== "object") return undefined;
  try {
    if (Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    return undefined;
  }
}

function isPlainJsonSchemaObject(value: unknown): value is JsonSchema {
  return tryGetPlainObjectDescriptors(value) !== undefined;
}

function isJsonSchemaObject(value: unknown): value is JsonSchema {
  const descriptors = tryGetPlainObjectDescriptors(value);
  if (!descriptors) return false;
  return Object.keys(descriptors).some((key) =>
    descriptors[key]?.enumerable === true && JSON_SCHEMA_KEYWORDS.has(key)
  );
}

function isContractSchema(value: unknown): value is ContractSchemaShape {
  if (value === null || typeof value !== "object") return false;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const branded = descriptors.__zod;
    if (branded && "value" in branded) return true;
    const output = descriptors._output;
    const parse = descriptors.parse;
    return Boolean(
      output && "value" in output && parse && "value" in parse &&
        typeof parse.value === "function",
    );
  } catch {
    return false;
  }
}

function getSchemaParser(schema: unknown): ((input: unknown) => unknown) | undefined {
  if ((typeof schema !== "object" && typeof schema !== "function") || schema === null) {
    return undefined;
  }

  const visited = new Set<object>();
  let current: object | null = schema;
  for (let depth = 0; current !== null && depth < 32; depth += 1) {
    if (visited.has(current)) return undefined;
    visited.add(current);
    try {
      const descriptor = Object.getOwnPropertyDescriptor(current, "parse");
      if (descriptor) {
        return "value" in descriptor && typeof descriptor.value === "function"
          ? descriptor.value.bind(schema)
          : undefined;
      }
      current = Object.getPrototypeOf(current);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function permissiveFallback(logPrefix: string, toolId: string, detail: string): JsonSchema {
  agentLogger.debug(`[${logPrefix}] ${detail} for "${toolId}"`);
  return { type: "object", properties: {}, additionalProperties: true };
}

function snapshotJsonSchema(schema: JsonSchema, toolId: string): JsonSchema {
  try {
    const snapshot = snapshotJsonValue(schema, { label: "JSON schema" });
    if (Object.hasOwn(snapshot, "type") && !isJsonSchemaType(snapshot.type)) {
      schemaError(toolId, "JSON schema has an invalid type keyword");
    }
    return snapshot;
  } catch (error) {
    schemaError(toolId, getErrorMessage(error));
  }
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
  schemaLabel = "input",
): JsonSchema {
  // Contract Schema<T> values route through the SchemaValidator contract.
  if (isContractSchema(schema)) {
    const result = tryConvert(
      () => zodToJsonSchema(schema),
      toolId,
      logPrefix,
      permissive,
      `${schemaLabel} schema conversion failed`,
    );
    const snapshot = snapshotJsonSchema(result, toolId);
    logSchemaResult(logPrefix, toolId, "Pre-converted", snapshot);
    return snapshot;
  }

  if (isJsonSchemaObject(schema)) {
    const snapshot = snapshotJsonSchema(schema, toolId);
    logSchemaResult(logPrefix, toolId, "Raw JSON", snapshot);
    return snapshot;
  }

  if (permissive) return permissiveFallback(logPrefix, toolId, "Using fully dynamic schema");

  schemaError(
    toolId,
    `${schemaLabel} schema is not a valid Veryfront schema. Use defineSchema() or set allowUnknownSchema to true.`,
  );
}

function generateToolId(): string {
  return `tool_${crypto.randomUUID().replaceAll("-", "")}`;
}

function resolveToolId(value: unknown): { id: string; explicit: boolean } {
  if (value === undefined) return { id: generateToolId(), explicit: false };
  if (
    typeof value !== "string" || value.trim().length === 0 ||
    value.length > MAX_TOOL_ID_LENGTH || value.trim() !== value ||
    hasUnsafeControlCharacters(value, false)
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Tool id must be a non-empty string" });
  }
  return { id: value, explicit: true };
}

function validateToolDescription(value: unknown): asserts value is string {
  if (
    typeof value !== "string" || value.trim().length === 0 ||
    value.length > MAX_TOOL_DESCRIPTION_LENGTH || hasUnsafeControlCharacters(value, true)
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Tool description must be a non-empty string" });
  }
}

function validateToolRuntimeConfig(input: {
  description: unknown;
  execute: unknown;
  allowUnknownSchema?: unknown;
}): void {
  validateToolDescription(input.description);
  if (typeof input.execute !== "function") {
    throw INVALID_ARGUMENT.create({ detail: "Tool execute must be a function" });
  }
  if (
    input.allowUnknownSchema !== undefined &&
    typeof input.allowUnknownSchema !== "boolean"
  ) {
    throw INVALID_ARGUMENT.create({ detail: "allowUnknownSchema must be a boolean" });
  }
}

function snapshotMcpConfig(mcp: ToolConfig["mcp"]): ToolConfig["mcp"] {
  if (mcp === undefined) return undefined;
  const descriptors = getPlainDataDescriptors(mcp, "mcp configuration");
  const enabled = readOptionalDataProperty(descriptors, "enabled", "mcp.enabled");
  const requiresAuth = readOptionalDataProperty(
    descriptors,
    "requiresAuth",
    "mcp.requiresAuth",
  );
  const cachePolicy = readOptionalDataProperty(
    descriptors,
    "cachePolicy",
    "mcp.cachePolicy",
  );
  const title = readOptionalDataProperty(descriptors, "title", "mcp.title");
  const rawAnnotations = readOptionalDataProperty(
    descriptors,
    "annotations",
    "mcp.annotations",
  );

  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw INVALID_ARGUMENT.create({ detail: "mcp.enabled must be a boolean" });
  }
  if (requiresAuth !== undefined && typeof requiresAuth !== "boolean") {
    throw INVALID_ARGUMENT.create({ detail: "mcp.requiresAuth must be a boolean" });
  }
  if (
    cachePolicy !== undefined &&
    (typeof cachePolicy !== "string" ||
      !["no-cache", "cache", "cache-first"].includes(cachePolicy))
  ) {
    throw INVALID_ARGUMENT.create({ detail: "mcp.cachePolicy is invalid" });
  }
  validateMcpTitle(title, "mcp.title");

  let annotations: NonNullable<ToolConfig["mcp"]>["annotations"];
  if (rawAnnotations !== undefined) {
    const annotationDescriptors = getPlainDataDescriptors(rawAnnotations, "mcp.annotations");
    const annotationTitle = readOptionalDataProperty(
      annotationDescriptors,
      "title",
      "mcp.annotations.title",
    );
    validateMcpTitle(annotationTitle, "mcp.annotations.title");
    const normalizedAnnotations: NonNullable<ToolConfig["mcp"]>["annotations"] = {
      ...(annotationTitle === undefined ? {} : { title: annotationTitle as string }),
    };
    for (
      const property of [
        "readOnlyHint",
        "destructiveHint",
        "idempotentHint",
        "openWorldHint",
      ] as const
    ) {
      const value = readOptionalDataProperty(
        annotationDescriptors,
        property,
        `mcp.annotations.${property}`,
      );
      if (value !== undefined && typeof value !== "boolean") {
        throw INVALID_ARGUMENT.create({
          detail: `mcp.annotations.${property} must be a boolean`,
        });
      }
      if (value !== undefined) normalizedAnnotations[property] = value as boolean;
    }
    annotations = normalizedAnnotations;
  }

  return {
    ...(enabled === undefined ? {} : { enabled }),
    ...(requiresAuth === undefined ? {} : { requiresAuth }),
    ...(cachePolicy === undefined ? {} : { cachePolicy }),
    ...(title === undefined ? {} : { title: title as string }),
    ...(annotations === undefined ? {} : { annotations }),
  } as ToolConfig["mcp"];
}

function getPlainDataDescriptors(value: unknown, path: string): PropertyDescriptorMap {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw INVALID_ARGUMENT.create({ detail: `${path} must be an object` });
  }
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw INVALID_ARGUMENT.create({ detail: `${path} could not be inspected` });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw INVALID_ARGUMENT.create({ detail: `${path} must be a plain object` });
  }
  return descriptors;
}

function readOptionalDataProperty(
  descriptors: PropertyDescriptorMap,
  property: string,
  path: string,
): unknown {
  const descriptor = descriptors[property];
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw INVALID_ARGUMENT.create({ detail: `${path} must be a data property` });
  }
  return descriptor.value;
}

function validateMcpTitle(value: unknown, path: string): void {
  if (
    value !== undefined &&
    (typeof value !== "string" || value.trim().length === 0 || value.trim() !== value ||
      value.length > MAX_MCP_TITLE_LENGTH || hasUnsafeControlCharacters(value, true))
  ) {
    throw INVALID_ARGUMENT.create({ detail: `${path} must be a non-empty string` });
  }
}

function snapshotDelegatedIntegrationTools(
  value: readonly string[] | undefined,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  let snapshot: unknown;
  try {
    snapshot = snapshotJsonValue(value, {
      label: "delegatedIntegrationTools",
      maxDepth: 2,
      maxNodes: MAX_DELEGATED_INTEGRATION_TOOLS + 1,
      maxBytes: 64 * 1024,
    });
  } catch (error) {
    throw INVALID_ARGUMENT.create({ detail: getErrorMessage(error) });
  }
  if (
    !Array.isArray(snapshot) || snapshot.length > MAX_DELEGATED_INTEGRATION_TOOLS ||
    snapshot.some((name) =>
      typeof name !== "string" || name.trim().length === 0 || name.trim() !== name ||
      name.length > MAX_TOOL_ID_LENGTH || hasUnsafeControlCharacters(name, false)
    ) || new Set(snapshot).size !== snapshot.length
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "delegated integration tool names must be unique non-empty strings",
    });
  }
  return snapshot;
}

function throwIfToolExecutionAborted(context: ToolExecutionContext | undefined): void {
  context?.abortSignal?.throwIfAborted();
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
  const { id, explicit } = resolveToolId(config.id);
  validateToolRuntimeConfig(config);
  const inputSchema = config.inputSchema;
  const outputSchema = config.outputSchema;
  const execute = config.execute;
  const delegatedIntegrationTools = snapshotDelegatedIntegrationTools(
    config.delegatedIntegrationTools,
  );
  const inputParser = getSchemaParser(inputSchema);
  const outputParser = outputSchema === undefined ? undefined : getSchemaParser(outputSchema);
  const mcp = snapshotMcpConfig(config.mcp);

  const inputSchemaJson = convertSchemaToJson(
    inputSchema,
    id,
    "TOOL",
    config.allowUnknownSchema ?? false,
  );
  const outputSchemaJson = outputSchema === undefined ? undefined : convertSchemaToJson(
    outputSchema,
    id,
    "TOOL_OUTPUT",
    config.allowUnknownSchema ?? false,
    "output",
  );

  const createdTool: Tool<TInput, TOutput> = {
    id,
    type: "function" as const,
    description: config.description,
    ...(delegatedIntegrationTools ? { delegatedIntegrationTools } : {}),
    inputSchema: inputSchema as Schema<TInput>,
    inputSchemaJson,
    ...(outputParser === undefined ? {} : { outputSchema: outputSchema as Schema<TOutput> }),
    outputSchemaJson,
    execute: async (input: TInput, context?: ToolExecutionContext) => {
      throwIfToolExecutionAborted(context);
      let validated = input;
      if (inputParser) {
        try {
          validated = inputParser(input) as TInput;
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

  return explicit ? createdTool : markGeneratedToolId(createdTool);
}

/** Configuration used by dynamic tool. */
export interface DynamicToolConfig {
  /** Optional stable tool identifier. */
  id?: string;
  /** Human-readable behavior description for the model. */
  description: string;
  /** Runtime input parser, or an opaque marker for schema-less tools. */
  inputSchema: unknown;
  /** Optional precomputed JSON Schema sent to model providers. */
  inputSchemaJson?: JsonSchema;
  /** Tool execution callback. */
  execute: (input: unknown, context?: ToolExecutionContext) => Promise<unknown> | unknown;
  /** Optional transform applied to the execution result before it reaches the model. */
  toModelOutput?: (output: unknown) => unknown;
  /** Optional MCP exposure and annotation configuration. */
  mcp?: ToolConfig["mcp"];
}

/** Create a dynamic tool definition. */
export function dynamicTool(config: DynamicToolConfig): Tool<unknown, unknown> {
  const { id, explicit } = resolveToolId(config.id);
  validateToolRuntimeConfig(config);
  const inputSchema = config.inputSchema;
  const inputParser = getSchemaParser(inputSchema);
  const execute = config.execute;
  const toModelOutput = config.toModelOutput;
  if (toModelOutput !== undefined && typeof toModelOutput !== "function") {
    throw INVALID_ARGUMENT.create({ detail: "toModelOutput must be a function" });
  }

  const inputSchemaJson = config.inputSchemaJson === undefined
    ? convertSchemaToJson(inputSchema, id, "DYNAMIC_TOOL", true)
    : isPlainJsonSchemaObject(config.inputSchemaJson)
    ? snapshotJsonSchema(config.inputSchemaJson, id)
    : schemaError(id, "input JSON schema is invalid");

  const createdTool: Tool<unknown, unknown> = {
    id,
    type: "dynamic" as const,
    description: config.description,
    inputSchema: inputSchema as Schema<unknown>,
    inputSchemaJson,
    execute: async (input: unknown, context?: ToolExecutionContext) => {
      throwIfToolExecutionAborted(context);
      if (inputParser) {
        try {
          input = inputParser(input);
        } catch (error) {
          throw toError(
            createError({
              type: "agent",
              message: `Tool "${id}" input validation failed: ${getErrorMessage(error)}`,
            }),
          );
        }
      } else if (input === undefined) {
        input = {};
      } else if (input === null || typeof input !== "object") {
        throw INVALID_ARGUMENT.create({ detail: "dynamicTool: input must be a non-null object" });
      }
      const result = await execute(input, context);
      return toModelOutput ? toModelOutput(result) : result;
    },
    mcp: snapshotMcpConfig(config.mcp),
  };

  return explicit ? createdTool : markGeneratedToolId(createdTool);
}
