import type { ToolDefinition } from "#veryfront/tool";
import type { JsonSchema } from "#veryfront/tool/schema";

/** Public API contract for provider tool compat provider. */
export type ProviderToolCompatProvider =
  | "anthropic"
  | "google"
  | "moonshot"
  | "openai"
  | "unknown";

/** Public API contract for provider tool profile. */
export interface ProviderToolProfile {
  provider: ProviderToolCompatProvider;
  maxTools?: number;
  sanitizeSchema: boolean;
}

/** Options accepted by provider tool compat. */
export interface ProviderToolCompatOptions {
  model?: string;
  requiredToolNames?: readonly string[];
}

const OPENAI_MAX_TOOLS = 128;
const PERMISSIVE_TOOL_INPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
};
const PROVIDER_TOOL_PROPERTY_KEY_PATTERN = /^[a-zA-Z0-9_.-]{1,64}$/;

const GOOGLE_UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$id",
  "$ref",
  "$schema",
  "additionalProperties",
  "allOf",
  "default",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "oneOf",
  "prefixItems",
]);

function normalizeModel(model?: string): string {
  return model?.trim().toLowerCase() ?? "";
}

/** Return provider tool profile. */
export function getProviderToolProfile(model?: string): ProviderToolProfile {
  const normalized = normalizeModel(model);
  const parts = normalized.split("/").filter(Boolean);
  const provider = parts[0] === "veryfront-cloud" ? parts[1] : parts[0];
  const modelName = parts.at(-1);

  if (provider === "openai") {
    return { provider: "openai", maxTools: OPENAI_MAX_TOOLS, sanitizeSchema: false };
  }

  if (provider === "google" || provider === "google-ai-studio") {
    return { provider: "google", sanitizeSchema: true };
  }

  if (provider === "anthropic") {
    return { provider: "anthropic", sanitizeSchema: true };
  }

  if (provider === "moonshot" || provider === "moonshotai" || modelName?.startsWith("kimi-")) {
    return { provider: "moonshot", sanitizeSchema: true };
  }

  return { provider: "unknown", sanitizeSchema: false };
}

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}

/** Select provider compatible tool names helper. */
export function selectProviderCompatibleToolNames(
  toolNames: readonly string[],
  options: ProviderToolCompatOptions = {},
): string[] {
  const profile = getProviderToolProfile(options.model);
  const orderedToolNames = uniqueInOrder(toolNames);

  if (profile.maxTools === undefined || orderedToolNames.length <= profile.maxTools) {
    return orderedToolNames;
  }

  const available = new Set(orderedToolNames);
  const requiredToolNames = uniqueInOrder(options.requiredToolNames ?? [])
    .filter((toolName) => available.has(toolName));
  const selected = [...requiredToolNames];
  const selectedSet = new Set(selected);

  for (const toolName of orderedToolNames) {
    if (selected.length >= profile.maxTools) break;
    if (selectedSet.has(toolName)) continue;
    selected.push(toolName);
    selectedSet.add(toolName);
  }

  return selected.slice(0, profile.maxTools);
}

/** Select provider compatible tools helper. */
export function selectProviderCompatibleTools(
  tools: readonly ToolDefinition[],
  options: ProviderToolCompatOptions = {},
): ToolDefinition[] {
  const toolsByName = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    if (!toolsByName.has(tool.name)) toolsByName.set(tool.name, tool);
  }

  const selectedToolNames = selectProviderCompatibleToolNames(
    [...toolsByName.keys()],
    options,
  );

  return selectedToolNames
    .map((toolName) => toolsByName.get(toolName))
    .filter((tool): tool is ToolDefinition => tool !== undefined);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getLiteralType(value: unknown): JsonSchema["type"] | undefined {
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    case "boolean":
      return "boolean";
    default:
      return value === null ? "null" : undefined;
  }
}

function getEnumValuesFromAnyOf(anyOf: unknown): unknown[] | undefined {
  if (!Array.isArray(anyOf)) return undefined;

  const values: unknown[] = [];
  for (const option of anyOf) {
    if (!isPlainRecord(option)) return undefined;
    if ("const" in option) {
      values.push(option.const);
      continue;
    }
    if (Array.isArray(option.enum) && option.enum.length > 0) {
      values.push(...option.enum);
      continue;
    }
    return undefined;
  }

  return values.length > 0 ? uniqueUnknownValues(values) : undefined;
}

function uniqueUnknownValues(values: unknown[]): unknown[] {
  const result: unknown[] = [];
  for (const value of values) {
    if (result.some((existing) => Object.is(existing, value))) continue;
    result.push(value);
  }
  return result;
}

function getSharedLiteralType(values: readonly unknown[]): JsonSchema["type"] | undefined {
  const literalTypes = values.map((value) => getLiteralType(value));
  const firstType = literalTypes[0];

  if (!firstType || literalTypes.some((literalType) => literalType !== firstType)) {
    return undefined;
  }

  return firstType;
}

function getGoogleCompatibleSchemaType(type: unknown): unknown {
  if (!Array.isArray(type)) return type;

  const nonNullTypes = type.filter((value) => value !== "null");
  return nonNullTypes.length === 1 ? nonNullTypes[0] : undefined;
}

function sanitizeProviderSchemaPropertyKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProviderSchemaPropertyKeys(item));
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  const rawProperties = isPlainRecord(value.properties) ? value.properties : undefined;
  const retainedPropertyNames = rawProperties ? new Set<string>() : undefined;

  for (const [key, child] of Object.entries(value)) {
    if (key === "properties" && rawProperties) {
      const properties: Record<string, unknown> = {};
      for (const [propertyName, propertySchema] of Object.entries(rawProperties)) {
        if (!PROVIDER_TOOL_PROPERTY_KEY_PATTERN.test(propertyName)) continue;
        retainedPropertyNames?.add(propertyName);
        properties[propertyName] = sanitizeProviderSchemaPropertyKeys(propertySchema);
      }
      sanitized.properties = properties;
      continue;
    }

    if (key === "required" && Array.isArray(child)) {
      sanitized.required = retainedPropertyNames
        ? child.filter((item) => typeof item === "string" && retainedPropertyNames.has(item))
        : child.filter((item) => typeof item === "string");
      continue;
    }

    sanitized[key] = sanitizeProviderSchemaPropertyKeys(child);
  }

  return sanitized;
}

function sanitizeGoogleSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeGoogleSchemaValue(item));
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  const enumFromAnyOf = getEnumValuesFromAnyOf(value.anyOf);
  const constValue = value.const;

  for (const [key, child] of Object.entries(value)) {
    if (key === "const" || key === "anyOf" || GOOGLE_UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      continue;
    }

    if (key === "type") {
      const compatibleType = getGoogleCompatibleSchemaType(child);
      if (compatibleType !== undefined) sanitized.type = compatibleType;
      continue;
    }

    if (key === "properties" && isPlainRecord(child)) {
      sanitized.properties = Object.fromEntries(
        Object.entries(child).map(([propertyName, propertySchema]) => [
          propertyName,
          sanitizeGoogleSchemaValue(propertySchema),
        ]),
      );
      continue;
    }

    if (key === "items") {
      sanitized.items = sanitizeGoogleSchemaValue(child);
      continue;
    }

    sanitized[key] = sanitizeGoogleSchemaValue(child);
  }

  if (enumFromAnyOf) {
    sanitized.enum = enumFromAnyOf;
    if (!sanitized.type) {
      const sharedType = getSharedLiteralType(enumFromAnyOf);
      if (sharedType) sanitized.type = sharedType;
    }
  } else if ("const" in value) {
    sanitized.enum = [constValue];
    if (!sanitized.type) {
      const literalType = getLiteralType(constValue);
      if (literalType) sanitized.type = literalType;
    }
  }

  if (sanitized.type === "array" && !Object.hasOwn(sanitized, "items")) {
    sanitized.items = {};
  }

  return sanitized;
}

function sanitizeMoonshotSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMoonshotSchemaValue(item));
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string") {
      sanitized.$ref = child.replace(/^#\/definitions\//, "#/$defs/");
      continue;
    }

    if (key === "definitions") {
      sanitized.$defs = sanitizeMoonshotSchemaValue(child);
      continue;
    }

    if (key === "properties" && isPlainRecord(child)) {
      sanitized.properties = Object.fromEntries(
        Object.entries(child).map(([propertyName, propertySchema]) => [
          propertyName,
          sanitizeMoonshotSchemaValue(propertySchema),
        ]),
      );
      continue;
    }

    sanitized[key] = sanitizeMoonshotSchemaValue(child);
  }

  return sanitized;
}

/**
 * Normalize a provider tool input schema so every function tool has a
 * provider-safe JSON Schema object at the root. Remote/MCP tools can omit the
 * root `type`; Anthropic rejects those as `input_schema.type` missing.
 */
export function normalizeProviderToolInputSchema(schema: JsonSchema): JsonSchema {
  if (!isPlainRecord(schema) || Object.keys(schema).length === 0) {
    return { ...PERMISSIVE_TOOL_INPUT_SCHEMA };
  }

  if (Object.hasOwn(schema, "type")) {
    return schema;
  }

  return {
    type: "object",
    ...schema,
  } as JsonSchema;
}

/** Zod schema for sanitize provider tool. */
export function sanitizeProviderToolSchema(
  schema: JsonSchema,
  options: Pick<ProviderToolCompatOptions, "model"> = {},
): JsonSchema {
  const profile = getProviderToolProfile(options.model);
  if (!profile.sanitizeSchema) return schema;

  const propertyKeySafeSchema = sanitizeProviderSchemaPropertyKeys(schema);

  if (profile.provider === "google") {
    return sanitizeGoogleSchemaValue(propertyKeySafeSchema) as JsonSchema;
  }

  if (profile.provider === "moonshot") {
    return sanitizeMoonshotSchemaValue(propertyKeySafeSchema) as JsonSchema;
  }

  return propertyKeySafeSchema as JsonSchema;
}
