import type { z } from "zod";
import type { JsonSchema } from "./json-schema.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

const LITERAL_TYPE_MAP: Record<string, "string" | "number" | "boolean"> = {
  string: "string",
  number: "number",
  boolean: "boolean",
};

function getLiteralType(value: unknown): "string" | "number" | "boolean" | undefined {
  return LITERAL_TYPE_MAP[typeof value];
}

/** Get the internal type tag from a zod schema (_def.typeName in v3, _def.type in v4). */
function getTypeTag(schema: z.ZodTypeAny): string | undefined {
  // deno-lint-ignore no-explicit-any
  const def = schema._def as any;
  return def.typeName ?? def.type;
}

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  // Guard against invalid schemas (can happen with different zod instances in npm bundle)
  if (!schema || typeof schema !== "object" || !("_def" in schema)) {
    throw INVALID_ARGUMENT.create({ detail: "Invalid Zod schema: missing _def property" });
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
  // deno-lint-ignore no-explicit-any
  const def = schema._def as any;

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
      const itemType = def.element ?? def.type;
      return { type: "array", items: zodToJsonSchema(itemType) };
    }

    case "ZodTuple":
    case "tuple": {
      const items = def.items;
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
    case "record":
      return {
        type: "object",
        additionalProperties: zodToJsonSchema(def.valueType ?? def.element),
      };

    case "ZodDefault":
    case "default": {
      const innerType = def.innerType ?? def.schema;
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
      return convert(def.getter());

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
    // deno-lint-ignore no-explicit-any
    const def = current._def as any;

    switch (tag) {
      case "ZodNullable":
      case "nullable":
        nullable = true;
        current = def.innerType ?? def.schema;
        break;

      case "ZodOptional":
      case "optional":
        optional = true;
        current = def.innerType ?? def.schema;
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
