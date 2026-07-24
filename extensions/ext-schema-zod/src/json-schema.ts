/**
 * Zod-to-JSON-Schema converter used by the `SchemaValidator` adapter.
 *
 * Operates directly on zod's internal `_def` shape to preserve the adapter's
 * stable v3 and v4 compatibility behavior. It is confined to
 * `extensions/ext-schema-zod/` so the rest of the codebase never imports zod
 * to learn what a tool's input schema looks like.
 *
 * @module extensions/ext-schema-zod/json-schema
 */

import type { z } from "zod";
import type { JsonSchema } from "veryfront/extensions/schema";

/** Zod internal _def shape covering fields from both v3 and v4. */
interface ZodDef {
  typeName?: string; // v3
  type?: string; // v4
  value?: unknown; // v3 literal
  values?: unknown; // v3 enum / v4 literal
  entries?: Record<string, unknown>; // v4 enum
  description?: string; // v3 description metadata
  shape?: (() => Record<string, z.ZodTypeAny>) | Record<string, z.ZodTypeAny>;
  element?: z.ZodTypeAny; // v4 array/record
  items?: z.ZodTypeAny[]; // tuple
  options?: z.ZodTypeAny[] | Map<string, z.ZodTypeAny>; // union
  keyType?: z.ZodTypeAny; // record
  valueType?: z.ZodTypeAny; // record
  catchall?: z.ZodTypeAny; // object unknown-key policy / catchall
  unknownKeys?: "strip" | "passthrough" | "strict"; // v3 object unknown-key policy
  innerType?: z.ZodTypeAny; // optional/nullable/default (v3)
  schema?: z.ZodTypeAny; // effects/optional/nullable (v3/v4)
  in?: z.ZodTypeAny; // pipe input (v4)
  out?: z.ZodTypeAny; // pipe output (v4)
  getter?: () => z.ZodTypeAny; // lazy
  checks?: unknown[];
  minLength?: number | { value?: number } | null; // array limits (v3)
  maxLength?: number | { value?: number } | null; // array limits (v3)
}

interface ConversionContext {
  seen: WeakSet<object>;
  depth: number;
  nodeCount: number;
}

const MAX_CONVERSION_DEPTH = 128;
const MAX_CONVERSION_NODES = 100_000;

function assertConversionDepth(depth: number): void {
  if (depth > MAX_CONVERSION_DEPTH) {
    throw new RangeError(
      `Zod schema exceeds the maximum conversion depth of ${MAX_CONVERSION_DEPTH}`,
    );
  }
}

interface ZodCheckDefinition {
  check?: string;
  kind?: string;
  format?: string;
  pattern?: RegExp;
  regex?: RegExp;
  minimum?: number;
  maximum?: number;
  value?: number;
  inclusive?: boolean;
}

interface NumericBoundary {
  value: number;
  exclusive: boolean;
}

const STATIC_DEFAULT_VALUE = Symbol("veryfront.staticJsonSchemaDefault");

interface StaticDefaultValue {
  value: unknown;
}

const LITERAL_TYPE_MAP: Record<string, "string" | "number" | "boolean"> = {
  string: "string",
  number: "number",
  boolean: "boolean",
};

function getLiteralType(
  value: unknown,
): "string" | "number" | "boolean" | "null" | undefined {
  if (value === null) return "null";
  return LITERAL_TYPE_MAP[typeof value];
}

type RecordKeyFrame =
  | { kind: "visit"; schema: z.ZodTypeAny; depth: number }
  | { kind: "exit"; schema: z.ZodTypeAny };

function finiteStringRecordKeys(
  schema: z.ZodTypeAny,
  context: ConversionContext,
): string[] | undefined {
  const activeSchemas = new WeakSet<object>();
  const keys: string[] = [];
  const stack: RecordKeyFrame[] = [{
    kind: "visit",
    schema,
    depth: context.depth,
  }];
  let pendingVisitCount = 1;
  let visitedNodes = 0;
  const finish = (result: string[] | undefined): string[] | undefined => {
    context.nodeCount += visitedNodes;
    return result;
  };
  const assertCapacity = (additionalNodes: number): void => {
    if (
      context.nodeCount +
          visitedNodes +
          pendingVisitCount +
          additionalNodes >
        MAX_CONVERSION_NODES
    ) {
      throw new RangeError(
        `Zod schema exceeds the maximum conversion node count of ${MAX_CONVERSION_NODES}`,
      );
    }
  };

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    if (frame.kind === "exit") {
      activeSchemas.delete(frame.schema);
      continue;
    }

    pendingVisitCount--;
    assertConversionDepth(frame.depth);
    visitedNodes++;
    if (context.nodeCount + visitedNodes > MAX_CONVERSION_NODES) {
      throw new RangeError(
        `Zod schema exceeds the maximum conversion node count of ${MAX_CONVERSION_NODES}`,
      );
    }
    if (activeSchemas.has(frame.schema)) return finish(undefined);

    const tag = getTypeTag(frame.schema);
    const def = getDef(frame.schema);
    if (tag === "ZodLiteral" || tag === "literal") {
      const literal = def.value ?? (Array.isArray(def.values) ? def.values[0] : def.values);
      if (typeof literal !== "string") return finish(undefined);
      keys.push(literal);
      continue;
    }

    if (tag === "ZodEnum" || tag === "enum") {
      const rawValues = Array.isArray(def.values)
        ? def.values
        : def.entries
        ? Object.values(def.entries)
        : [];
      assertCapacity(rawValues.length);
      for (const value of rawValues) {
        visitedNodes++;
        if (typeof value !== "string") return finish(undefined);
        keys.push(value);
      }
      continue;
    }

    if (
      tag !== "ZodUnion" &&
      tag !== "ZodDiscriminatedUnion" &&
      tag !== "union"
    ) {
      return finish(undefined);
    }

    const options = def.options ?? [];
    const optionCount = options instanceof Map ? options.size : options.length;
    assertCapacity(optionCount);
    if (optionCount > 0 && frame.depth + 1 > MAX_CONVERSION_DEPTH) {
      throw new RangeError(
        `Zod schema exceeds the maximum conversion depth of ${MAX_CONVERSION_DEPTH}`,
      );
    }
    const optionArray = options instanceof Map ? Array.from(options.values()) : options;
    activeSchemas.add(frame.schema);
    stack.push({ kind: "exit", schema: frame.schema });
    pendingVisitCount += optionCount;
    for (let index = optionArray.length - 1; index >= 0; index--) {
      const option = optionArray[index];
      if (!option) return finish(undefined);
      stack.push({
        kind: "visit",
        schema: option,
        depth: frame.depth + 1,
      });
    }
  }

  return finish(Array.from(new Set(keys)));
}

function getDef(schema: z.ZodTypeAny): ZodDef {
  return schema._def as ZodDef;
}

/** Get the internal type tag from a zod schema (_def.typeName in v3, _def.type in v4). */
function getTypeTag(schema: z.ZodTypeAny): string | undefined {
  const def = getDef(schema);
  return def.typeName ?? def.type;
}

function originatesFromCustomSchema(schema: z.ZodTypeAny): boolean {
  const seen = new WeakSet<object>();
  let current: z.ZodTypeAny | undefined = schema;
  let depth = 0;

  while (current && !seen.has(current)) {
    assertConversionDepth(depth);
    seen.add(current);
    const tag = getTypeTag(current);
    if (tag === "custom" || tag === "ZodCustom") return true;
    if (tag !== "pipe" && tag !== "ZodEffects") return false;

    const def = getDef(current);
    const input = def.schema ?? def.in;
    if (!input || input === current) return false;
    current = input;
    depth++;
  }

  return false;
}

function representedPipeSchema(def: ZodDef): z.ZodTypeAny | undefined {
  const input = def.schema ?? def.in;
  return input && originatesFromCustomSchema(input) && def.out ? def.out : input;
}

/** Record a literal default without evaluating Zod's possibly dynamic getter. */
export function recordStaticJsonSchemaDefault(schema: z.ZodTypeAny, value: unknown): void {
  Object.defineProperty(getDef(schema), STATIC_DEFAULT_VALUE, {
    configurable: true,
    enumerable: true,
    value: { value } satisfies StaticDefaultValue,
    writable: false,
  });
}

function getStaticJsonSchemaDefault(def: ZodDef): StaticDefaultValue | undefined {
  const marked = (def as Record<PropertyKey, unknown>)[STATIC_DEFAULT_VALUE];
  if (!marked || typeof marked !== "object" || !("value" in marked)) return undefined;
  return marked as StaticDefaultValue;
}

function getCheckDefinitions(def: ZodDef): ZodCheckDefinition[] {
  return (def.checks ?? []).flatMap((check): ZodCheckDefinition[] => {
    if (!check || typeof check !== "object") return [];
    const internal = (check as { _zod?: { def?: unknown } })._zod?.def;
    const definition = internal ?? check;
    return definition && typeof definition === "object" ? [definition as ZodCheckDefinition] : [];
  });
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function addConjunctiveConstraints(
  json: JsonSchema,
  keyword: "format" | "pattern",
  values: string[],
): void {
  const uniqueValues = Array.from(new Set(values));
  if (uniqueValues.length === 0) return;
  if (uniqueValues.length === 1) {
    json[keyword] = uniqueValues[0];
    return;
  }
  json.allOf = [
    ...(json.allOf ?? []),
    ...uniqueValues.map((value) => ({ [keyword]: value })),
  ];
}

const STRING_FORMAT_MAP: Readonly<Record<string, string>> = {
  email: "email",
  url: "uri",
  uuid: "uuid",
  datetime: "date-time",
};

function convertString(def: ZodDef): JsonSchema {
  const json: JsonSchema = { type: "string" };
  const patterns: string[] = [];
  const formats: string[] = [];

  for (const check of getCheckDefinitions(def)) {
    if (check.check === "min_length" && finiteNumber(check.minimum)) {
      json.minLength = Math.max(json.minLength ?? 0, check.minimum);
      continue;
    }
    if (check.check === "max_length" && finiteNumber(check.maximum)) {
      json.maxLength = Math.min(json.maxLength ?? Number.POSITIVE_INFINITY, check.maximum);
      continue;
    }

    const format = check.check === "string_format" ? check.format : check.kind;
    if (format === "min" && finiteNumber(check.value)) {
      json.minLength = Math.max(json.minLength ?? 0, check.value);
    } else if (format === "max" && finiteNumber(check.value)) {
      json.maxLength = Math.min(json.maxLength ?? Number.POSITIVE_INFINITY, check.value);
    } else if (format === "regex") {
      const regex = check.pattern ?? check.regex;
      if (regex && regex.flags.length === 0) patterns.push(regex.source);
    } else if (format && STRING_FORMAT_MAP[format]) {
      formats.push(STRING_FORMAT_MAP[format]);
    }
  }

  addConjunctiveConstraints(json, "pattern", patterns);
  addConjunctiveConstraints(json, "format", formats);
  return json;
}

function tighterLowerBoundary(
  current: NumericBoundary | undefined,
  candidate: NumericBoundary,
): NumericBoundary {
  if (!current || candidate.value > current.value) return candidate;
  if (candidate.value < current.value) return current;
  return { value: current.value, exclusive: current.exclusive || candidate.exclusive };
}

function tighterUpperBoundary(
  current: NumericBoundary | undefined,
  candidate: NumericBoundary,
): NumericBoundary {
  if (!current || candidate.value < current.value) return candidate;
  if (candidate.value > current.value) return current;
  return { value: current.value, exclusive: current.exclusive || candidate.exclusive };
}

function convertNumber(def: ZodDef): JsonSchema {
  let integer = false;
  let lower: NumericBoundary | undefined;
  let upper: NumericBoundary | undefined;

  for (const check of getCheckDefinitions(def)) {
    if (
      (check.check === "number_format" && check.format === "safeint") ||
      check.kind === "int"
    ) {
      integer = true;
      lower = tighterLowerBoundary(lower, {
        value: -Number.MAX_SAFE_INTEGER,
        exclusive: false,
      });
      upper = tighterUpperBoundary(upper, {
        value: Number.MAX_SAFE_INTEGER,
        exclusive: false,
      });
      continue;
    }

    if (check.check === "greater_than" && finiteNumber(check.value)) {
      lower = tighterLowerBoundary(lower, {
        value: check.value,
        exclusive: check.inclusive !== true,
      });
    } else if (check.check === "less_than" && finiteNumber(check.value)) {
      upper = tighterUpperBoundary(upper, {
        value: check.value,
        exclusive: check.inclusive !== true,
      });
    } else if (check.kind === "min" && finiteNumber(check.value)) {
      lower = tighterLowerBoundary(lower, {
        value: check.value,
        exclusive: check.inclusive === false,
      });
    } else if (check.kind === "max" && finiteNumber(check.value)) {
      upper = tighterUpperBoundary(upper, {
        value: check.value,
        exclusive: check.inclusive === false,
      });
    }
  }

  const json: JsonSchema = { type: integer ? "integer" : "number" };
  if (lower) {
    if (lower.exclusive) json.exclusiveMinimum = lower.value;
    else json.minimum = lower.value;
  }
  if (upper) {
    if (upper.exclusive) json.exclusiveMaximum = upper.value;
    else json.maximum = upper.value;
  }
  return json;
}

function arrayLimit(value: ZodDef["minLength"]): number | undefined {
  if (finiteNumber(value)) return value;
  if (value && typeof value === "object" && finiteNumber(value.value)) return value.value;
  return undefined;
}

function applyArrayLimits(json: JsonSchema, def: ZodDef): void {
  const minimums: number[] = [];
  const maximums: number[] = [];
  const legacyMinimum = arrayLimit(def.minLength);
  const legacyMaximum = arrayLimit(def.maxLength);
  if (legacyMinimum !== undefined) minimums.push(legacyMinimum);
  if (legacyMaximum !== undefined) maximums.push(legacyMaximum);

  for (const check of getCheckDefinitions(def)) {
    if (check.check === "min_length" && finiteNumber(check.minimum)) {
      minimums.push(check.minimum);
    } else if (check.check === "max_length" && finiteNumber(check.maximum)) {
      maximums.push(check.maximum);
    }
  }

  if (minimums.length > 0) json.minItems = Math.max(...minimums);
  if (maximums.length > 0) json.maxItems = Math.min(...maximums);
}

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return convertSchema(schema, {
    seen: new WeakSet(),
    depth: 0,
    nodeCount: 0,
  });
}

function convertSchema(schema: z.ZodTypeAny, context: ConversionContext): JsonSchema {
  // Guard against invalid schemas (can happen with different zod instances in npm bundle)
  if (!schema || typeof schema !== "object" || !("_def" in schema)) {
    throw new Error("Invalid Zod schema: missing _def property");
  }

  const { schema: unwrapped, nullable } = unwrapSchema(schema);
  const json = convert(unwrapped, context);
  const description = getDescription(schema) ?? getDescription(unwrapped);
  if (description && json.description === undefined) json.description = description;

  return nullable ? { anyOf: [json, { type: "null" }] } : json;
}

export function isOptionalSchema(schema: z.ZodTypeAny): boolean {
  return unwrapSchema(schema).optional || hasDefaultSchema(schema);
}

function convert(schema: z.ZodTypeAny, context: ConversionContext): JsonSchema {
  if (context.seen.has(schema)) return {};
  assertConversionDepth(context.depth);
  context.nodeCount += 1;
  if (context.nodeCount > MAX_CONVERSION_NODES) {
    throw new RangeError(
      `Zod schema exceeds the maximum conversion node count of ${MAX_CONVERSION_NODES}`,
    );
  }

  context.seen.add(schema);
  context.depth += 1;

  try {
    return convertInner(schema, context);
  } finally {
    context.depth -= 1;
    context.seen.delete(schema);
  }
}

function convertInner(schema: z.ZodTypeAny, context: ConversionContext): JsonSchema {
  const tag = getTypeTag(schema);
  const def = getDef(schema);

  switch (tag) {
    case "ZodString":
    case "string":
      return convertString(def);

    case "ZodNumber":
    case "number":
      return convertNumber(def);

    case "ZodBoolean":
    case "boolean":
      return { type: "boolean" };

    case "ZodNull":
    case "null":
      return { type: "null" };

    case "ZodUnknown":
    case "unknown":
    case "ZodAny":
    case "any":
    case "ZodCustom":
    case "custom":
      return {};

    case "ZodBigInt":
    case "bigint":
      return { type: "integer" };

    case "ZodLiteral":
    case "literal": {
      // v3: _def.value, v4: _def.values (array of accepted values)
      const literal = def.value ?? (Array.isArray(def.values) ? def.values[0] : def.values);
      return { const: literal, type: getLiteralType(literal) };
    }

    case "ZodEnum":
    case "ZodNativeEnum":
    case "enum": {
      // v3: _def.values (array), v4: _def.entries (object {key: value})
      const values = def.values ?? (def.entries ? Object.values(def.entries) : []);
      if (Array.isArray(values)) {
        return { type: "string", enum: values };
      }
      // Native enum: filter out reverse-mapped numeric keys
      return {
        enum: Object.values(values).filter((value) => typeof value !== "number"),
      };
    }

    case "ZodObject":
    case "object": {
      const shape = typeof def.shape === "function" ? def.shape() : def.shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape ?? {})) {
        const zodSchema = value as z.ZodTypeAny;
        Object.defineProperty(properties, key, {
          configurable: true,
          enumerable: true,
          value: convertSchema(zodSchema, context),
          writable: true,
        });
        if (!isOptionalSchema(zodSchema)) required.push(key);
      }

      const json: JsonSchema = { type: "object", properties };
      if (required.length) json.required = required;
      const additionalProperties = getObjectAdditionalProperties(def, context);
      if (additionalProperties !== undefined) json.additionalProperties = additionalProperties;

      return json;
    }

    case "ZodArray":
    case "array": {
      // v3: _def.type (item schema), v4: _def.element (item schema)
      const itemType = def.element ?? (def.type as unknown as z.ZodTypeAny | undefined);
      const json: JsonSchema = { type: "array" };
      if (itemType && typeof itemType !== "string") {
        json.items = convertSchema(itemType, context);
      }
      applyArrayLimits(json, def);
      return json;
    }

    case "ZodTuple":
    case "tuple": {
      const items = def.items ?? [];
      return {
        type: "array",
        prefixItems: items.map((item: z.ZodTypeAny) => convertSchema(item, context)),
        minItems: items.length,
        maxItems: items.length,
      };
    }

    case "ZodUnion":
    case "ZodDiscriminatedUnion":
    case "union": {
      const options = def.options ?? [];
      const optionArray = options instanceof Map ? Array.from(options.values()) : options;
      return { anyOf: optionArray.map((option: z.ZodTypeAny) => convertSchema(option, context)) };
    }

    case "ZodRecord":
    case "record": {
      const valueSchema = def.valueType ?? def.element;
      if (!valueSchema) return { type: "object" };
      const valueJsonSchema = convertSchema(valueSchema, context);
      const finiteKeys = def.keyType && finiteStringRecordKeys(def.keyType, context);
      if (finiteKeys) {
        const properties: Record<string, JsonSchema> = {};
        for (const key of finiteKeys) {
          Object.defineProperty(properties, key, {
            configurable: true,
            enumerable: true,
            value: valueJsonSchema,
            writable: true,
          });
        }
        return {
          type: "object",
          properties,
          required: finiteKeys,
          additionalProperties: false,
        };
      }

      const json: JsonSchema = {
        type: "object",
        additionalProperties: valueJsonSchema,
      };
      if (def.keyType) {
        const propertyNames = convertSchema(def.keyType, context);
        if (
          Object.keys(propertyNames).length !== 1 ||
          propertyNames.type !== "string"
        ) {
          json.propertyNames = propertyNames;
        }
      }
      return json;
    }

    case "ZodDefault":
    case "default": {
      const innerType = def.innerType ?? def.schema;
      if (!innerType) return { type: "object" };
      const inner = convertSchema(innerType, context);
      const staticDefault = getStaticJsonSchemaDefault(def);
      if (staticDefault) inner.default = staticDefault.value;

      return inner;
    }

    case "ZodLazy":
    case "lazy":
      return def.getter ? convertSchema(def.getter(), context) : { type: "object" };

    case "ZodEffects":
    case "pipe": {
      // v3: ZodEffects wraps schema in _def.schema
      // v4: pipe wraps in _def.in (input schema)
      const innerSchema = representedPipeSchema(def);
      return innerSchema ? convert(innerSchema, context) : { type: "object" };
    }

    default:
      return { type: "object" };
  }
}

function getObjectAdditionalProperties(
  def: ZodDef,
  context: ConversionContext,
): boolean | JsonSchema | undefined {
  if (def.unknownKeys === "passthrough") return true;
  if (def.unknownKeys === "strict") return false;
  if (def.unknownKeys === "strip") return undefined;

  if (!def.catchall) return undefined;

  const catchallTag = getTypeTag(def.catchall);
  if (catchallTag === "unknown" || catchallTag === "ZodUnknown") return true;
  if (catchallTag === "never" || catchallTag === "ZodNever") return false;
  return convertSchema(def.catchall, context);
}

function unwrapSchema(
  schema: z.ZodTypeAny,
): { schema: z.ZodTypeAny; nullable: boolean; optional: boolean } {
  const seen = new WeakSet<object>();
  let current: z.ZodTypeAny = schema;
  let nullable = false;
  let optional = false;
  let depth = 0;

  while (true) {
    assertConversionDepth(depth);
    if (seen.has(current)) return { schema: current, nullable, optional };
    seen.add(current);
    const tag = getTypeTag(current);
    const def = getDef(current);

    switch (tag) {
      case "ZodNullable":
      case "nullable":
        nullable = true;
        current = (def.innerType ?? def.schema)!;
        depth++;
        break;

      case "ZodOptional":
      case "optional":
        optional = true;
        current = (def.innerType ?? def.schema)!;
        depth++;
        break;

      case "ZodEffects":
      case "pipe":
        current = representedPipeSchema(def) ?? current;
        if (current === schema) return { schema: current, nullable, optional };
        depth++;
        break;

      default:
        return { schema: current, nullable, optional };
    }
  }
}

function hasDefaultSchema(schema: z.ZodTypeAny): boolean {
  const seen = new WeakSet<object>();
  let current: z.ZodTypeAny = schema;
  let depth = 0;

  while (true) {
    assertConversionDepth(depth);
    if (seen.has(current)) return false;
    seen.add(current);
    const tag = getTypeTag(current);
    const def = getDef(current);

    switch (tag) {
      case "ZodDefault":
      case "default":
        return true;

      case "ZodNullable":
      case "nullable":
      case "ZodOptional":
      case "optional":
      case "ZodEffects":
      case "pipe": {
        const inner = def.innerType ?? def.schema ?? def.in;
        if (!inner || inner === current) return false;
        current = inner;
        depth++;
        break;
      }

      default:
        return false;
    }
  }
}

function getDescription(schema: z.ZodTypeAny): string | undefined {
  const direct = (schema as { description?: unknown }).description;
  if (typeof direct === "string") return direct;

  const defDescription = getDef(schema).description;
  return typeof defDescription === "string" ? defDescription : undefined;
}
