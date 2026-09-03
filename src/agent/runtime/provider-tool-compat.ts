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
/** Maximum nesting of inlined Moonshot `$ref` targets before references are left in place. */
const MOONSHOT_MAX_REF_INLINE_DEPTH = 32;
/** Node budget for one Moonshot schema sanitization pass, bounding `$ref` inlining growth. */
const MOONSHOT_MAX_INLINED_SCHEMA_NODES = 20_000;
/**
 * Serialized-byte budget for one Moonshot schema sanitization pass. Nodes alone do not
 * bound payload size: a single large `description` string counts as one node but is
 * duplicated by every inlined copy of its `$ref` target.
 */
const MOONSHOT_MAX_INLINED_SCHEMA_BYTES = 512 * 1024;
/** Node budget for `$ref` inlining across one tool-set conversion pass. */
const MOONSHOT_MAX_INLINED_TOOL_SET_NODES = 200_000;
/** Serialized-byte budget for `$ref` inlining across one tool-set conversion pass. */
const MOONSHOT_MAX_INLINED_TOOL_SET_BYTES = 8 * 1024 * 1024;
const PERMISSIVE_TOOL_INPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
};

function createPermissiveToolInputSchema(): JsonSchema {
  return {
    ...PERMISSIVE_TOOL_INPUT_SCHEMA,
    properties: {},
  };
}

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

function decodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function resolveLocalJsonPointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) {
    return undefined;
  }

  let current = root;
  for (const rawSegment of ref.slice(2).split("/")) {
    if (!isPlainRecord(current) && !Array.isArray(current)) {
      return undefined;
    }

    const segment = decodeJsonPointerSegment(rawSegment);
    current = Reflect.get(current, segment);
  }

  return current;
}

/**
 * Expansion budget shared by every schema in one tool-set conversion pass.
 *
 * A per-schema budget alone bounds each tool in isolation but not the collection: a
 * remote MCP source may return hundreds of individually-admissible schemas, so the
 * worst case is multiplied by the tool count. This budget is charged only for material
 * produced by `$ref` inlining, so ordinary (ref-free) schemas never consume it no
 * matter how many tools the source advertises.
 */
export interface MoonshotSchemaExpansionBudget {
  remainingNodes: number;
  remainingBytes: number;
}

/** Create a tool-set-wide Moonshot `$ref` expansion budget. */
export function createMoonshotSchemaExpansionBudget(): MoonshotSchemaExpansionBudget {
  return {
    remainingNodes: MOONSHOT_MAX_INLINED_TOOL_SET_NODES,
    remainingBytes: MOONSHOT_MAX_INLINED_TOOL_SET_BYTES,
  };
}

interface MoonshotInlineBudget {
  /** Per-schema allowance, charged for every visited node. */
  remainingNodes: number;
  remainingBytes: number;
  /** Tool-set allowance, charged only for nodes produced by inlining. */
  shared: MoonshotSchemaExpansionBudget;
}

function createMoonshotInlineBudget(
  shared: MoonshotSchemaExpansionBudget,
): MoonshotInlineBudget {
  return {
    remainingNodes: MOONSHOT_MAX_INLINED_SCHEMA_NODES,
    remainingBytes: MOONSHOT_MAX_INLINED_SCHEMA_BYTES,
    shared,
  };
}

/** Approximate the serialized size one schema node contributes, excluding its children. */
function estimateSerializedNodeBytes(value: unknown): number {
  if (typeof value === "string") return value.length + 2;
  if (Array.isArray(value)) return 2;
  if (isPlainRecord(value)) {
    let bytes = 2;
    for (const key of Object.keys(value)) bytes += key.length + 4;
    return bytes;
  }
  return 8;
}

function hasMoonshotInlineBudget(budget: MoonshotInlineBudget): boolean {
  return budget.remainingNodes > 0 && budget.remainingBytes > 0 &&
    budget.shared.remainingNodes > 0 && budget.shared.remainingBytes > 0;
}

function chargeMoonshotInlineBudget(
  budget: MoonshotInlineBudget,
  value: unknown,
  inlineDepth: number,
): void {
  const bytes = estimateSerializedNodeBytes(value);
  budget.remainingNodes -= 1;
  budget.remainingBytes -= bytes;
  if (inlineDepth > 0) {
    // Only material introduced by `$ref` inlining is amplification, so only that is
    // charged to the tool-set budget.
    budget.shared.remainingNodes -= 1;
    budget.shared.remainingBytes -= bytes;
  }
}

function sanitizeMoonshotSchemaValue(
  value: unknown,
  root: unknown,
  seenRefs: ReadonlySet<string>,
  inlineDepth: number,
  budget: MoonshotInlineBudget,
): unknown {
  // `seenRefs` only blocks cycles along the current path, so sibling references to the
  // same target still re-expand. Shared node/byte budgets and a depth cap keep a hostile
  // (or merely dense) schema from expanding exponentially during inlining.
  chargeMoonshotInlineBudget(budget, value, inlineDepth);

  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeMoonshotSchemaValue(item, root, seenRefs, inlineDepth, budget)
    );
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  if (
    typeof value.$ref === "string" &&
    !value.$ref.startsWith("#/$defs/") &&
    !value.$ref.startsWith("#/definitions/") &&
    !seenRefs.has(value.$ref) &&
    inlineDepth < MOONSHOT_MAX_REF_INLINE_DEPTH &&
    hasMoonshotInlineBudget(budget)
  ) {
    const resolved = resolveLocalJsonPointer(root, value.$ref);
    if (resolved !== undefined && resolved !== value) {
      const nextSeenRefs = new Set(seenRefs);
      nextSeenRefs.add(value.$ref);
      const nextInlineDepth = inlineDepth + 1;
      const sanitizedResolved = sanitizeMoonshotSchemaValue(
        resolved,
        root,
        nextSeenRefs,
        nextInlineDepth,
        budget,
      );
      const { $ref: _ref, ...siblings } = value;
      const sanitizedSiblings = Object.keys(siblings).length > 0
        ? sanitizeMoonshotSchemaValue(siblings, root, nextSeenRefs, nextInlineDepth, budget)
        : undefined;

      return isPlainRecord(sanitizedResolved) && isPlainRecord(sanitizedSiblings)
        ? { ...sanitizedResolved, ...sanitizedSiblings }
        : sanitizedResolved;
    }
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string") {
      sanitized.$ref = child.replace(/^#\/definitions\//, "#/$defs/");
      continue;
    }

    if (key === "definitions") {
      sanitized.$defs = sanitizeMoonshotSchemaValue(child, root, seenRefs, inlineDepth, budget);
      continue;
    }

    if (key === "properties" && isPlainRecord(child)) {
      sanitized.properties = Object.fromEntries(
        Object.entries(child).map(([propertyName, propertySchema]) => [
          propertyName,
          sanitizeMoonshotSchemaValue(propertySchema, root, seenRefs, inlineDepth, budget),
        ]),
      );
      continue;
    }

    sanitized[key] = sanitizeMoonshotSchemaValue(child, root, seenRefs, inlineDepth, budget);
  }

  return sanitized;
}

type AnthropicCompositionKeyword = "allOf" | "anyOf";

function getSchemaRequiredNames(schema: Record<string, unknown>): string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === "string")
    : [];
}

function getMergedRequiredNames(
  schemas: readonly Record<string, unknown>[],
  keyword: AnthropicCompositionKeyword,
): string[] {
  if (schemas.length === 0) return [];
  const requiredBySchema = schemas.map(getSchemaRequiredNames);
  if (keyword === "allOf") {
    return [...new Set(requiredBySchema.flat())];
  }

  return requiredBySchema[0]?.filter((name) =>
    requiredBySchema.slice(1).every((required) => required.includes(name))
  ) ?? [];
}

function getMergedPropertySchema(
  schemas: readonly unknown[],
  keyword: AnthropicCompositionKeyword,
): unknown {
  if (schemas.length === 1) return schemas[0];
  const [first, ...rest] = schemas;
  const serializedFirst = JSON.stringify(first);
  if (rest.every((schema) => JSON.stringify(schema) === serializedFirst)) {
    return first;
  }
  return { [keyword]: schemas };
}

function mergeAnthropicObjectSchemas(
  schemas: readonly Record<string, unknown>[],
  keyword: AnthropicCompositionKeyword,
): Record<string, unknown> {
  const mergedProperties = new Map<string, unknown[]>();
  for (const schema of schemas) {
    if (!isPlainRecord(schema.properties)) continue;
    for (const [name, propertySchema] of Object.entries(schema.properties)) {
      const variants = mergedProperties.get(name) ?? [];
      variants.push(propertySchema);
      mergedProperties.set(name, variants);
    }
  }

  const properties = Object.fromEntries(
    [...mergedProperties].map(([name, variants]) => [
      name,
      getMergedPropertySchema(variants, keyword),
    ]),
  );
  const required = getMergedRequiredNames(schemas, keyword);
  const additionalProperties = schemas.length > 0 &&
      schemas.every((schema) => schema.additionalProperties === false)
    ? false
    : undefined;
  const defs = Object.assign(
    {},
    ...schemas.flatMap((schema) => isPlainRecord(schema.$defs) ? [schema.$defs] : []),
  );
  const definitions = Object.assign(
    {},
    ...schemas.flatMap((schema) => isPlainRecord(schema.definitions) ? [schema.definitions] : []),
  );

  return {
    type: "object",
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
    ...(required.length > 0 ? { required } : {}),
    ...(additionalProperties === false ? { additionalProperties } : {}),
    ...(Object.keys(defs).length > 0 ? { $defs: defs } : {}),
    ...(Object.keys(definitions).length > 0 ? { definitions } : {}),
  };
}

function sanitizeAnthropicSchemaRoot(
  schema: unknown,
  rootSchema: unknown = schema,
  seenRefs: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  if (!isPlainRecord(schema)) {
    return createPermissiveToolInputSchema();
  }

  if (typeof schema.$ref === "string" && !seenRefs.has(schema.$ref)) {
    const resolved = resolveLocalJsonPointer(rootSchema, schema.$ref);
    if (isPlainRecord(resolved) && resolved !== schema) {
      const nextSeenRefs = new Set(seenRefs);
      nextSeenRefs.add(schema.$ref);
      const { $ref: _ref, ...siblings } = schema;
      return sanitizeAnthropicSchemaRoot(
        { ...resolved, ...siblings },
        rootSchema,
        nextSeenRefs,
      );
    }
  }

  const {
    allOf: rawAllOf,
    anyOf: rawAnyOf,
    oneOf: rawOneOf,
    ...root
  } = schema;
  let sanitized: Record<string, unknown> = { ...root, type: "object" };

  for (
    const [rawBranches, keyword] of [
      [rawAllOf, "allOf"],
      [rawAnyOf, "anyOf"],
      [rawOneOf, "anyOf"],
    ] as const
  ) {
    if (!Array.isArray(rawBranches) || rawBranches.length === 0) continue;
    const branches = rawBranches.map((branch) =>
      sanitizeAnthropicSchemaRoot(branch, rootSchema, seenRefs)
    );
    const composed = mergeAnthropicObjectSchemas(branches, keyword);
    sanitized = {
      ...sanitized,
      ...mergeAnthropicObjectSchemas([sanitized, composed], "allOf"),
    };
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
    return createPermissiveToolInputSchema();
  }

  if (Object.hasOwn(schema, "type")) {
    return schema;
  }

  return {
    type: "object",
    ...schema,
  } as JsonSchema;
}

/** Options accepted by {@link sanitizeProviderToolSchema}. */
export interface SanitizeProviderToolSchemaOptions
  extends Pick<ProviderToolCompatOptions, "model"> {
  /**
   * Expansion budget shared across every tool in one conversion pass. Callers that
   * sanitize a whole tool set should create one budget and reuse it so `$ref` inlining
   * is bounded for the collection, not merely per schema.
   */
  moonshotExpansionBudget?: MoonshotSchemaExpansionBudget;
}

/** Zod schema for sanitize provider tool. */
export function sanitizeProviderToolSchema(
  schema: JsonSchema,
  options: SanitizeProviderToolSchemaOptions = {},
): JsonSchema {
  const profile = getProviderToolProfile(options.model);
  if (!profile.sanitizeSchema) return schema;

  const propertyKeySafeSchema = sanitizeProviderSchemaPropertyKeys(schema);

  if (profile.provider === "google") {
    return sanitizeGoogleSchemaValue(propertyKeySafeSchema) as JsonSchema;
  }

  if (profile.provider === "moonshot") {
    const budget = createMoonshotInlineBudget(
      options.moonshotExpansionBudget ?? createMoonshotSchemaExpansionBudget(),
    );
    return sanitizeMoonshotSchemaValue(
      propertyKeySafeSchema,
      propertyKeySafeSchema,
      new Set(),
      0,
      budget,
    ) as JsonSchema;
  }

  if (profile.provider === "anthropic") {
    return sanitizeAnthropicSchemaRoot(propertyKeySafeSchema) as JsonSchema;
  }

  return propertyKeySafeSchema as JsonSchema;
}
