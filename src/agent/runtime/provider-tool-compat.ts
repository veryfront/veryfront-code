import { snapshotJsonSchemaObject } from "#veryfront/schemas/schema-input.ts";
import {
  resolveVeryfrontCloudModelSurface,
  type VeryfrontCloudSurfaceId,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
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
  /** The authenticated gateway model's resolved wire surface, when available. */
  wireSurface?: VeryfrontCloudSurfaceId;
  requiredToolNames?: readonly string[];
  /** Slots under the tool limit kept for schemas the runtime appends later. */
  reservedToolSlots?: number;
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
const IntrinsicMap = Map;
const IntrinsicSet = Set;
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicMapGet = Map.prototype.get;
const IntrinsicMapHas = Map.prototype.has;
const IntrinsicMapSet = Map.prototype.set;
const IntrinsicSetAdd = Set.prototype.add;
const IntrinsicSetHas = Set.prototype.has;
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
export function getProviderToolProfile(
  model?: string,
  wireSurface?: VeryfrontCloudSurfaceId,
): ProviderToolProfile {
  const normalized = normalizeModel(model);
  const parts = normalized.split("/").filter(Boolean);
  const provider = parts[0] === "veryfront-cloud" ? parts[1] : parts[0];
  const modelName = parts.at(-1);

  // The publisher segment of a Veryfront Cloud ID can differ from the gateway
  // protocol. Authenticated transport facts override publisher-based fallbacks.
  if (parts[0] === "veryfront-cloud" && wireSurface !== undefined) {
    if (wireSurface === "google") return { provider: "google", sanitizeSchema: true };
    if (wireSurface === "anthropic") return { provider: "anthropic", sanitizeSchema: true };
    if (wireSurface === "openai") {
      // An OpenAI-compatible wire retains the backend's reference restrictions.
      if (provider === "moonshot" || provider === "moonshotai") {
        return { provider: "moonshot", maxTools: OPENAI_MAX_TOOLS, sanitizeSchema: true };
      }
      return { provider: "openai", maxTools: OPENAI_MAX_TOOLS, sanitizeSchema: false };
    }
  }

  if (provider === "openai") {
    return { provider: "openai", maxTools: OPENAI_MAX_TOOLS, sanitizeSchema: false };
  }

  if (provider === "google" || provider === "google-ai-studio") {
    return { provider: "google", sanitizeSchema: true };
  }

  if (provider === "anthropic") {
    return { provider: "anthropic", sanitizeSchema: true };
  }

  if (provider === "moonshot" || provider === "moonshotai") {
    return { provider: "moonshot", sanitizeSchema: true };
  }

  // Without authenticated model facts, retain the served catalog fallback for
  // providers whose publisher name does not itself imply a protocol.
  if (parts[0] === "veryfront-cloud") {
    const surface = resolveVeryfrontCloudModelSurface(normalized);
    if (surface === "google") return { provider: "google", sanitizeSchema: true };
    if (surface === "anthropic") return { provider: "anthropic", sanitizeSchema: true };
  }

  if (modelName?.startsWith("kimi-")) {
    return { provider: "moonshot", sanitizeSchema: true };
  }

  return { provider: "unknown", sanitizeSchema: false };
}

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new IntrinsicSet<string>();
  const result: string[] = [];

  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === undefined || IntrinsicReflectApply(IntrinsicSetHas, seen, [value])) continue;
    IntrinsicReflectApply(IntrinsicSetAdd, seen, [value]);
    result[result.length] = value;
  }

  return result;
}

/** Select provider compatible tool names helper. */
export function selectProviderCompatibleToolNames(
  toolNames: readonly string[],
  options: ProviderToolCompatOptions = {},
): string[] {
  const profile = getProviderToolProfile(options.model, options.wireSurface);
  const maxTools = profile.maxTools === undefined
    ? undefined
    : Math.max(0, profile.maxTools - Math.max(0, options.reservedToolSlots ?? 0));
  const orderedToolNames = uniqueInOrder(toolNames);

  if (maxTools === undefined || orderedToolNames.length <= maxTools) {
    return orderedToolNames;
  }

  const available = new IntrinsicSet<string>();
  for (let index = 0; index < orderedToolNames.length; index++) {
    const toolName = orderedToolNames[index];
    if (toolName !== undefined) IntrinsicReflectApply(IntrinsicSetAdd, available, [toolName]);
  }
  const requiredCandidates = uniqueInOrder(options.requiredToolNames ?? []);
  const selected: string[] = [];
  const selectedSet = new IntrinsicSet<string>();
  for (let index = 0; index < requiredCandidates.length; index++) {
    const toolName = requiredCandidates[index];
    if (
      toolName !== undefined && IntrinsicReflectApply(IntrinsicSetHas, available, [toolName])
    ) {
      selected[selected.length] = toolName;
      IntrinsicReflectApply(IntrinsicSetAdd, selectedSet, [toolName]);
    }
  }

  for (let index = 0; index < orderedToolNames.length; index++) {
    const toolName = orderedToolNames[index];
    if (toolName === undefined) continue;
    if (selected.length >= maxTools) break;
    if (IntrinsicReflectApply(IntrinsicSetHas, selectedSet, [toolName])) continue;
    selected[selected.length] = toolName;
    IntrinsicReflectApply(IntrinsicSetAdd, selectedSet, [toolName]);
  }

  const bounded: string[] = [];
  for (let index = 0; index < selected.length && index < maxTools; index++) {
    const toolName = selected[index];
    if (toolName !== undefined) bounded[bounded.length] = toolName;
  }
  return bounded;
}

/** Select provider compatible tools helper. */
export function selectProviderCompatibleTools(
  tools: readonly ToolDefinition[],
  options: ProviderToolCompatOptions = {},
): ToolDefinition[] {
  const toolsByName = new IntrinsicMap<string, ToolDefinition>();
  const orderedToolNames: string[] = [];
  for (let index = 0; index < tools.length; index++) {
    const tool = tools[index];
    if (tool === undefined || IntrinsicReflectApply(IntrinsicMapHas, toolsByName, [tool.name])) {
      continue;
    }
    IntrinsicReflectApply(IntrinsicMapSet, toolsByName, [tool.name, tool]);
    orderedToolNames[orderedToolNames.length] = tool.name;
  }

  const selectedToolNames = selectProviderCompatibleToolNames(
    orderedToolNames,
    options,
  );

  const selectedTools: ToolDefinition[] = [];
  for (let index = 0; index < selectedToolNames.length; index++) {
    const toolName = selectedToolNames[index];
    if (toolName === undefined) continue;
    const tool = IntrinsicReflectApply(IntrinsicMapGet, toolsByName, [toolName]) as
      | ToolDefinition
      | undefined;
    if (tool !== undefined) selectedTools[selectedTools.length] = tool;
  }
  return selectedTools;
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
  // Collected before the key loop: `required` may precede `properties`.
  const retainedPropertyNames = rawProperties
    ? new Set(
      Object.keys(rawProperties).filter((name) => PROVIDER_TOOL_PROPERTY_KEY_PATTERN.test(name)),
    )
    : undefined;

  for (const [key, child] of Object.entries(value)) {
    if (key === "properties" && rawProperties) {
      const properties: Record<string, unknown> = {};
      for (const [propertyName, propertySchema] of Object.entries(rawProperties)) {
        if (!retainedPropertyNames?.has(propertyName)) continue;
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

/**
 * Encoded size of a JSON string literal, including quotes.
 *
 * Character count undercounts badly for schemas the budget is meant to bound: control
 * characters expand to six-byte `\uXXXX` escapes and non-ASCII text costs two to four
 * UTF-8 bytes, so a hostile description can serialize to many times its length. This
 * walks code points rather than allocating an intermediate `JSON.stringify` result.
 */
function estimateEncodedStringBytes(value: string): number {
  let bytes = 2;

  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x22 || code === 0x5c) {
      bytes += 2;
    } else if (
      code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d
    ) {
      bytes += 2;
    } else if (code < 0x20) {
      bytes += 6;
    } else if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdfff) {
      // Iterating code points only yields a surrogate when it is unpaired, and
      // `JSON.stringify` escapes those to `\uXXXX`.
      bytes += 6;
    } else if (code < 0x10000) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }

  return bytes;
}

/** Approximate the serialized size one schema node contributes, excluding its children. */
function estimateSerializedNodeBytes(value: unknown): number {
  if (typeof value === "string") return estimateEncodedStringBytes(value);
  if (Array.isArray(value)) return 2;
  if (isPlainRecord(value)) {
    let bytes = 2;
    for (const key of Object.keys(value)) bytes += estimateEncodedStringBytes(key) + 2;
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

type ObjectCompositionKeyword = "allOf" | "anyOf";

function getSchemaRequiredNames(schema: Record<string, unknown>): string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === "string")
    : [];
}

function getMergedRequiredNames(
  schemas: readonly Record<string, unknown>[],
  keyword: ObjectCompositionKeyword,
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
  keyword: ObjectCompositionKeyword,
): unknown {
  const seen = new Set<string>();
  const distinct = schemas.filter((schema) => {
    const serialized = privateJsonStringify(schema);
    if (seen.has(serialized)) return false;
    seen.add(serialized);
    return true;
  });
  return distinct.length === 1 ? distinct[0] : { [keyword]: distinct };
}

function mergeObjectSchemas(
  schemas: readonly Record<string, unknown>[],
  keyword: ObjectCompositionKeyword,
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

  if (keyword === "anyOf") {
    // An alternative that omits a property still admits any value for it unless
    // it closes additional properties, so it widens the folded property schema.
    for (const [name, variants] of mergedProperties) {
      for (const schema of schemas) {
        if (isPlainRecord(schema.properties) && Object.hasOwn(schema.properties, name)) continue;
        const additional = schema.additionalProperties;
        if (additional === false) continue;
        variants.push(isPlainRecord(additional) ? additional : {});
      }
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

/** Shared allowance for root composition normalization across one tool set. */
export interface RootSchemaExpansionBudget {
  remainingNodes: number;
  remainingBytes: number;
}

/** Bound total root normalization work across one conversion pass. */
export function createRootSchemaExpansionBudget(): RootSchemaExpansionBudget {
  return { remainingNodes: 200_000, remainingBytes: 8 * 1024 * 1024 };
}

interface RootNormalizationBudget extends RootSchemaExpansionBudget {
  shared: RootSchemaExpansionBudget;
}

function createRootNormalizationBudget(shared: RootSchemaExpansionBudget): RootNormalizationBudget {
  return { remainingNodes: 20_000, remainingBytes: 512 * 1024, shared };
}

const MAX_ROOT_NORMALIZATION_DEPTH = 64;

function rootNormalizationBudgetExceeded(): TypeError {
  return new TypeError("Tool schema root normalization budget exceeded");
}

/**
 * Charge a subtree that normalization introduced (a resolved reference copy or
 * a retained source copy). The accepted input itself is never charged, so an
 * unchanged schema cannot exhaust the per-schema or shared allowance.
 */
function chargeRootNormalizationGrowth(value: unknown, budget: RootNormalizationBudget): void {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    const bytes = estimateSerializedNodeBytes(current);
    budget.remainingNodes--;
    budget.remainingBytes -= bytes;
    budget.shared.remainingNodes--;
    budget.shared.remainingBytes -= bytes;
    if (
      budget.remainingNodes < 0 || budget.remainingBytes < 0 ||
      budget.shared.remainingNodes < 0 || budget.shared.remainingBytes < 0
    ) {
      throw rootNormalizationBudgetExceeded();
    }
    if (current !== null && typeof current === "object") {
      for (const key of Object.keys(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !("value" in descriptor)) {
          throw new TypeError("Tool schema root normalization requires data properties");
        }
        pending.push(descriptor.value);
      }
    }
  }
}

function normalizeObjectSchemaRoot(
  schema: unknown,
  rootSchema: unknown = schema,
  seenRefs: ReadonlySet<string> = new Set(),
  budget = createRootNormalizationBudget(createRootSchemaExpansionBudget()),
  depth = 0,
): Record<string, unknown> {
  if (depth > MAX_ROOT_NORMALIZATION_DEPTH) throw rootNormalizationBudgetExceeded();
  if (depth === 0 && isPlainRecord(schema)) {
    // Admit the input once under the same bounded contract as public raw schemas.
    // The smaller normalization allowance applies only to introduced material.
    const accepted = snapshotJsonSchemaObject(schema);
    if (!accepted) throw new TypeError("Tool schema root normalization requires bounded JSON data");
    if (rootSchema === schema) rootSchema = accepted;
    schema = accepted;
  }
  if (!isPlainRecord(schema)) {
    return createPermissiveToolInputSchema();
  }

  if (typeof schema.$ref === "string" && !seenRefs.has(schema.$ref)) {
    const resolved = resolveLocalJsonPointer(rootSchema, schema.$ref);
    if (isPlainRecord(resolved) && resolved !== schema) {
      const nextSeenRefs = new Set(seenRefs);
      nextSeenRefs.add(schema.$ref);
      const { $ref: _ref, ...siblings } = schema;
      const target = normalizeObjectSchemaRoot(
        resolved,
        rootSchema,
        nextSeenRefs,
        budget,
        depth + 1,
      );
      chargeRootNormalizationGrowth(target, budget);
      const siblingRoot = normalizeObjectSchemaRoot(
        siblings,
        rootSchema,
        seenRefs,
        budget,
        depth + 1,
      );
      return {
        ...target,
        ...siblingRoot,
        ...mergeObjectSchemas([target, siblingRoot], "allOf"),
      };
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
      normalizeObjectSchemaRoot(branch, rootSchema, seenRefs, budget, depth + 1)
    );
    const composed = mergeObjectSchemas(branches, keyword);
    sanitized = {
      ...sanitized,
      ...mergeObjectSchemas([sanitized, composed], "allOf"),
    };
  }

  // `#/$defs/<name>` resolves against the document root, never a branch, so a
  // branch definition reusing a root name must not replace the root binding.
  for (const key of ["$defs", "definitions"] as const) {
    if (!isPlainRecord(root[key])) continue;
    sanitized[key] = { ...(isPlainRecord(sanitized[key]) ? sanitized[key] : {}), ...root[key] };
  }

  return sanitized;
}

const OPENAI_UNSUPPORTED_ROOT_SCHEMA_KEYS = ["allOf", "anyOf", "oneOf", "not", "enum"] as const;

/**
 * OpenAI rejects function parameters whose root carries `oneOf`, `anyOf`,
 * `allOf`, `not`, or `enum` (`invalid_function_parameters`). Fold root
 * compositions into one object schema the way Anthropic roots are folded and
 * drop root `not` and `enum`. Nested schemas are left as they are, and a
 * schema without these root keywords is returned by identity.
 */
// Keywords whose values are instance data, not schemas, so `$ref` keys inside
// them are literal object keys.
const LITERAL_SCHEMA_KEYWORDS = new Set(["const", "default", "enum", "examples"]);
// Keywords whose values map names to schemas, so their keys are never keywords.
const SCHEMA_MAP_KEYWORDS = new Set([
  "$defs",
  "definitions",
  "dependencies",
  "dependentSchemas",
  "patternProperties",
  "properties",
]);

function isRemovedRootReference(ref: string): boolean {
  // A bare `#` names the authored root, which folding replaces.
  if (ref === "#") return true;
  const token = ref.startsWith("#/") ? ref.slice(2).split("/")[0] : undefined;
  return token !== undefined &&
    (OPENAI_UNSUPPORTED_ROOT_SCHEMA_KEYS as readonly string[]).includes(token);
}

function hasRemovedRootReference(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasRemovedRootReference);
  if (!isPlainRecord(value)) return false;
  return Object.entries(value).some(([key, item]) => {
    if (key === "$ref" && typeof item === "string") return isRemovedRootReference(item);
    if (LITERAL_SCHEMA_KEYWORDS.has(key)) return false;
    if (SCHEMA_MAP_KEYWORDS.has(key) && isPlainRecord(item)) {
      return Object.values(item).some(hasRemovedRootReference);
    }
    return hasRemovedRootReference(item);
  });
}

function rewriteSourceRootReferences(value: unknown, prefix: string): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteSourceRootReferences(item, prefix));
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (key === "$ref" && typeof item === "string" && (item === "#" || item.startsWith("#/"))) {
        return [key, prefix + item.slice(1)];
      }
      if (LITERAL_SCHEMA_KEYWORDS.has(key)) return [key, item];
      if (SCHEMA_MAP_KEYWORDS.has(key) && isPlainRecord(item)) {
        return [
          key,
          Object.fromEntries(
            Object.entries(item).map((
              [name, schema],
            ) => [name, rewriteSourceRootReferences(schema, prefix)]),
          ),
        ];
      }
      return [key, rewriteSourceRootReferences(item, prefix)];
    }),
  );
}

function retainSourceRootReferences(
  schema: JsonSchema,
  normalized: Record<string, unknown>,
  budget: RootNormalizationBudget,
): Record<string, unknown> {
  if (!hasRemovedRootReference(schema)) return normalized;
  const definitions = isPlainRecord(normalized.$defs) ? normalized.$defs : {};
  let name = "source_root";
  for (let index = 1; Object.hasOwn(definitions, name); index++) name = `source_root_${index}`;
  const prefix = `#/$defs/${name}`;
  const source = rewriteSourceRootReferences(schema, prefix);
  const result = rewriteSourceRootReferences(normalized, prefix) as Record<string, unknown>;
  chargeRootNormalizationGrowth(source, budget);
  result.$defs = { ...(isPlainRecord(result.$defs) ? result.$defs : {}), [name]: source };
  return result;
}

function sanitizeOpenAISchemaRoot(
  schema: JsonSchema,
  shared: RootSchemaExpansionBudget,
): JsonSchema {
  if (
    !isPlainRecord(schema) ||
    !OPENAI_UNSUPPORTED_ROOT_SCHEMA_KEYS.some((key) => Object.hasOwn(schema, key))
  ) {
    return schema;
  }
  // Admit the complete schema before removing keys, so the reference scan below
  // never walks data outside the bounded JSON contract.
  const accepted = snapshotJsonSchemaObject(schema);
  if (!accepted) throw new TypeError("Tool schema root normalization requires bounded JSON data");
  const budget = createRootNormalizationBudget(shared);
  const { not: _not, enum: _enum, ...root } = accepted;
  const normalized = normalizeObjectSchemaRoot(
    root,
    root,
    new Set(),
    budget,
  );
  const { not: _resolvedNot, enum: _resolvedEnum, ...normalizedRoot } = normalized;
  return retainSourceRootReferences(accepted, normalizedRoot, budget) as JsonSchema;
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
  extends Pick<ProviderToolCompatOptions, "model" | "wireSurface"> {
  /**
   * Expansion budget shared across every tool in one conversion pass. Callers that
   * sanitize a whole tool set should create one budget and reuse it so `$ref` inlining
   * is bounded for the collection, not merely per schema.
   */
  moonshotExpansionBudget?: MoonshotSchemaExpansionBudget;
  /** Shared root composition allowance for the complete tool set. */
  rootExpansionBudget?: RootSchemaExpansionBudget;
}

/** Zod schema for sanitize provider tool. */
export function sanitizeProviderToolSchema(
  schema: JsonSchema,
  options: SanitizeProviderToolSchemaOptions = {},
): JsonSchema {
  const profile = getProviderToolProfile(options.model, options.wireSurface);
  // OpenAI keeps its property keys as authored; only the root shape is fixed.
  if (profile.provider === "openai") {
    return sanitizeOpenAISchemaRoot(
      schema,
      options.rootExpansionBudget ?? createRootSchemaExpansionBudget(),
    );
  }
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
    return normalizeObjectSchemaRoot(
      propertyKeySafeSchema,
      propertyKeySafeSchema,
      new Set(),
      createRootNormalizationBudget(
        options.rootExpansionBudget ?? createRootSchemaExpansionBudget(),
      ),
    ) as JsonSchema;
  }

  return propertyKeySafeSchema as JsonSchema;
}
