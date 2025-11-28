import type { z } from "zod";
import { ZodFirstPartyTypeKind } from "zod";
import type { JsonSchema } from "../types/json-schema.ts";

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  // Guard against invalid schemas (can happen with different zod instances in npm bundle)
  if (!schema || typeof schema !== "object" || !("_def" in schema)) {
    throw new Error("Invalid Zod schema: missing _def property");
  }

  const details = unwrapSchema(schema);
  const json = convert(details.schema);
  if (details.nullable) {
    return { anyOf: [json, { type: "null" }] };
  }
  return json;
}

export function isOptionalSchema(schema: z.ZodTypeAny): boolean {
  const { optional } = unwrapSchema(schema);
  return optional;
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  switch (schema._def.typeName) {
    case ZodFirstPartyTypeKind.ZodString:
      return { type: "string" };
    case ZodFirstPartyTypeKind.ZodNumber:
      return { type: "number" };
    case ZodFirstPartyTypeKind.ZodBoolean:
      return { type: "boolean" };
    case ZodFirstPartyTypeKind.ZodBigInt:
      return { type: "integer" };
    case ZodFirstPartyTypeKind.ZodLiteral: {
      const literal = (schema as z.ZodLiteral<unknown>)._def.value;
      return {
        const: literal,
        type: typeof literal === "string"
          ? "string"
          : typeof literal === "number"
          ? "number"
          : typeof literal === "boolean"
          ? "boolean"
          : undefined,
      };
    }
    case ZodFirstPartyTypeKind.ZodEnum:
      return {
        type: "string",
        enum: (schema as z.ZodEnum<[string, ...string[]]>)._def.values,
      };
    case ZodFirstPartyTypeKind.ZodNativeEnum:
      return {
        enum: Object.values((schema as z.ZodNativeEnum<any>)._def.values).filter(
          (value) => typeof value !== "number",
        ),
      };
    case ZodFirstPartyTypeKind.ZodObject: {
      const obj = schema as z.ZodObject<any>;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      // Access shape - it might be a function (lazy getter) or an object
      const shape = typeof obj._def.shape === "function" ? obj._def.shape() : obj._def.shape;

      for (const [key, value] of Object.entries(shape || {})) {
        const zodSchema = value as z.ZodTypeAny;
        properties[key] = zodToJsonSchema(zodSchema);
        if (!isOptionalSchema(zodSchema)) {
          required.push(key);
        }
      }

      const json: JsonSchema = { type: "object", properties };
      if (required.length > 0) {
        json.required = required;
      }
      return json;
    }
    case ZodFirstPartyTypeKind.ZodArray: {
      const array = schema as z.ZodArray<z.ZodTypeAny>;
      return {
        type: "array",
        items: zodToJsonSchema(array._def.type),
      };
    }
    case ZodFirstPartyTypeKind.ZodTuple: {
      const tuple = schema as z.ZodTuple;
      return {
        type: "array",
        prefixItems: tuple._def.items.map((item) => zodToJsonSchema(item)),
        minItems: tuple._def.items.length,
        maxItems: tuple._def.items.length,
      };
    }
    case ZodFirstPartyTypeKind.ZodUnion: {
      const union = schema as z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>;
      return {
        anyOf: union._def.options.map((option) => zodToJsonSchema(option)),
      };
    }
    case ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
      const union = schema as z.ZodDiscriminatedUnion<string, z.ZodObject<any>[]>;
      return {
        anyOf: Array.from(union._def.options.values()).map((option) => zodToJsonSchema(option)),
      };
    }
    case ZodFirstPartyTypeKind.ZodRecord:
      return {
        type: "object",
        additionalProperties: zodToJsonSchema((schema as z.ZodRecord<any>)._def.valueType),
      };
    case ZodFirstPartyTypeKind.ZodDefault: {
      const def = schema as z.ZodDefault<z.ZodTypeAny>;
      const inner = zodToJsonSchema(def._def.innerType);
      const defaultValue = def._def.defaultValue();
      if (typeof inner === "object" && !("anyOf" in inner)) {
        inner.default = defaultValue;
      }
      return inner;
    }
    case ZodFirstPartyTypeKind.ZodLazy:
      return convert((schema as z.ZodLazy<any>)._def.getter());
    case ZodFirstPartyTypeKind.ZodEffects:
      return convert((schema as z.ZodEffects<any>)._def.schema);
    default:
      return { type: "object" };
  }
}

function unwrapSchema(schema: z.ZodTypeAny) {
  let current: z.ZodTypeAny = schema;
  let nullable = false;
  let optional = false;

  while (true) {
    switch (current._def.typeName) {
      case ZodFirstPartyTypeKind.ZodNullable:
        nullable = true;
        current = (current as z.ZodNullable<z.ZodTypeAny>)._def.innerType;
        continue;
      case ZodFirstPartyTypeKind.ZodOptional:
        optional = true;
        current = (current as z.ZodOptional<z.ZodTypeAny>)._def.innerType;
        continue;
      case ZodFirstPartyTypeKind.ZodEffects:
        current = (current as z.ZodEffects<any>)._def.schema;
        continue;
      default:
        return { schema: current, nullable, optional };
    }
  }
}
