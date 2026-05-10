/**
 * Zod-to-JSON-Schema converter used by the `SchemaValidator` adapter.
 *
 * Operates directly on zod's internal `_def` shape (covers both v3 and v4)
 * because zod ships no first-class JSON-Schema export. Confined to
 * `extensions/ext-zod/` so the rest of the codebase never has to import zod
 * to learn what a tool's input schema looks like.
 *
 * @module extensions/ext-zod/json-schema
 */

import type { z } from "zod";
import type { JsonSchema } from "veryfront/extensions/schema";

/** Zod internal _def shape — covers fields from both v3 and v4. */
interface ZodDef {
  typeName?: string; // v3
  type?: string; // v4
  value?: unknown; // v3 literal
  values?: unknown; // v3 enum / v4 literal
  entries?: Record<string, unknown>; // v4 enum
  shape?: (() => Record<string, z.ZodTypeAny>) | Record<string, z.ZodTypeAny>;
  element?: z.ZodTypeAny; // v4 array/record
  items?: z.ZodTypeAny[]; // tuple
  options?: z.ZodTypeAny[] | Map<string, z.ZodTypeAny>; // union
  valueType?: z.ZodTypeAny; // record
  innerType?: z.ZodTypeAny; // optional/nullable/default (v3)
  schema?: z.ZodTypeAny; // effects/optional/nullable (v3/v4)
  in?: z.ZodTypeAny; // pipe input (v4)
  getter?: () => z.ZodTypeAny; // lazy
  defaultValue?: (() => unknown) | unknown;
}

const LITERAL_TYPE_MAP: Record<string, "string" | "number" | "boolean"> = {
  string: "string",
  number: "number",
  boolean: "boolean",
};

function getLiteralType(value: unknown): "string" | "number" | "boolean" | undefined {
  return LITERAL_TYPE_MAP[typeof value];
}

function getDef(schema: z.ZodTypeAny): ZodDef {
  return schema._def as ZodDef;
}

/** Get the internal type tag from a zod schema (_def.typeName in v3, _def.type in v4). */
function getTypeTag(schema: z.ZodTypeAny): string | undefined {
  const def = getDef(schema);
  return def.typeName ?? def.type;
}

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  // Guard against invalid schemas (can happen with different zod instances in npm bundle)
  if (!schema || typeof schema !== "object" || !("_def" in schema)) {
    throw new Error("Invalid Zod schema: missing _def property");
  }

  const { schema: unwrapped, nullable } = unwrapSchema(schema);
  const json = convert(unwrapped);

  return nullable ? { anyOf: [json, { type: "null" }] } : json;
}

export function isOptionalSchema(schema: z.ZodTypeAny): boolean {
  return unwrapSchema(schema).optional;
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  const tag = getTypeTag(schema);
  const def = getDef(schema);

  switch (tag) {
    case "ZodString":
    case "string":
      return { type: "string" };

    case "ZodNumber":
    case "number":
      return { type: "number" };

    case "ZodBoolean":
    case "boolean":
      return { type: "boolean" };

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
        properties[key] = zodToJsonSchema(zodSchema);
        if (!isOptionalSchema(zodSchema)) required.push(key);
      }

      const json: JsonSchema = { type: "object", properties };
      if (required.length) json.required = required;

      return json;
    }

    case "ZodArray":
    case "array": {
      // v3: _def.type (item schema), v4: _def.element (item schema)
      const itemType = def.element ?? (def.type as unknown as z.ZodTypeAny | undefined);
      if (!itemType || typeof itemType === "string") return { type: "array" };
      return { type: "array", items: zodToJsonSchema(itemType) };
    }

    case "ZodTuple":
    case "tuple": {
      const items = def.items ?? [];
      return {
        type: "array",
        prefixItems: items.map((item: z.ZodTypeAny) => zodToJsonSchema(item)),
        minItems: items.length,
        maxItems: items.length,
      };
    }

    case "ZodUnion":
    case "ZodDiscriminatedUnion":
    case "union": {
      const options = def.options ?? [];
      const optionArray = options instanceof Map ? Array.from(options.values()) : options;
      return { anyOf: optionArray.map((option: z.ZodTypeAny) => zodToJsonSchema(option)) };
    }

    case "ZodRecord":
    case "record": {
      const valueSchema = def.valueType ?? def.element;
      if (!valueSchema) return { type: "object" };
      return { type: "object", additionalProperties: zodToJsonSchema(valueSchema) };
    }

    case "ZodDefault":
    case "default": {
      const innerType = def.innerType ?? def.schema;
      if (!innerType) return { type: "object" };
      const inner = zodToJsonSchema(innerType);
      const defaultValue = typeof def.defaultValue === "function"
        ? def.defaultValue()
        : def.defaultValue;

      if (typeof inner === "object" && !("anyOf" in inner) && defaultValue !== undefined) {
        inner.default = defaultValue;
      }

      return inner;
    }

    case "ZodLazy":
    case "lazy":
      return def.getter ? convert(def.getter()) : { type: "object" };

    case "ZodEffects":
    case "pipe": {
      // v3: ZodEffects wraps schema in _def.schema
      // v4: pipe wraps in _def.in (input schema)
      const innerSchema = def.schema ?? def.in;
      return innerSchema ? convert(innerSchema) : { type: "object" };
    }

    default:
      return { type: "object" };
  }
}

function unwrapSchema(
  schema: z.ZodTypeAny,
): { schema: z.ZodTypeAny; nullable: boolean; optional: boolean } {
  let current: z.ZodTypeAny = schema;
  let nullable = false;
  let optional = false;

  while (true) {
    const tag = getTypeTag(current);
    const def = getDef(current);

    switch (tag) {
      case "ZodNullable":
      case "nullable":
        nullable = true;
        current = (def.innerType ?? def.schema)!;
        break;

      case "ZodOptional":
      case "optional":
        optional = true;
        current = (def.innerType ?? def.schema)!;
        break;

      case "ZodEffects":
      case "pipe":
        current = def.schema ?? def.in ?? current;
        if (current === schema) return { schema: current, nullable, optional };
        break;

      default:
        return { schema: current, nullable, optional };
    }
  }
}
