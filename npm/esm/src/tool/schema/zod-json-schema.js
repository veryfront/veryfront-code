import { ZodFirstPartyTypeKind } from "zod";
const LITERAL_TYPE_MAP = {
    string: "string",
    number: "number",
    boolean: "boolean",
};
function getLiteralType(value) {
    return LITERAL_TYPE_MAP[typeof value];
}
export function zodToJsonSchema(schema) {
    // Guard against invalid schemas (can happen with different zod instances in npm bundle)
    if (!schema || typeof schema !== "object" || !("_def" in schema)) {
        throw new Error("Invalid Zod schema: missing _def property");
    }
    const details = unwrapSchema(schema);
    const json = convert(details.schema);
    return details.nullable ? { anyOf: [json, { type: "null" }] } : json;
}
export function isOptionalSchema(schema) {
    return unwrapSchema(schema).optional;
}
function convert(schema) {
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
            const literal = schema._def.value;
            return { const: literal, type: getLiteralType(literal) };
        }
        case ZodFirstPartyTypeKind.ZodEnum:
            return {
                type: "string",
                enum: schema._def.values,
            };
        case ZodFirstPartyTypeKind.ZodNativeEnum:
            return {
                enum: Object.values(schema._def.values).filter((value) => typeof value !== "number"),
            };
        case ZodFirstPartyTypeKind.ZodObject: {
            const obj = schema;
            const properties = {};
            const required = [];
            const shape = typeof obj._def.shape === "function" ? obj._def.shape() : obj._def.shape;
            for (const [key, value] of Object.entries(shape ?? {})) {
                const zodSchema = value;
                properties[key] = zodToJsonSchema(zodSchema);
                if (!isOptionalSchema(zodSchema))
                    required.push(key);
            }
            const json = { type: "object", properties };
            if (required.length)
                json.required = required;
            return json;
        }
        case ZodFirstPartyTypeKind.ZodArray: {
            const array = schema;
            return { type: "array", items: zodToJsonSchema(array._def.type) };
        }
        case ZodFirstPartyTypeKind.ZodTuple: {
            const tuple = schema;
            const items = tuple._def.items;
            return {
                type: "array",
                prefixItems: items.map((item) => zodToJsonSchema(item)),
                minItems: items.length,
                maxItems: items.length,
            };
        }
        case ZodFirstPartyTypeKind.ZodUnion: {
            const union = schema;
            return { anyOf: union._def.options.map((option) => zodToJsonSchema(option)) };
        }
        case ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
            const union = schema;
            return {
                anyOf: Array.from(union._def.options.values()).map((option) => zodToJsonSchema(option)),
            };
        }
        case ZodFirstPartyTypeKind.ZodRecord:
            return {
                type: "object",
                additionalProperties: zodToJsonSchema(schema._def.valueType),
            };
        case ZodFirstPartyTypeKind.ZodDefault: {
            const def = schema;
            const inner = zodToJsonSchema(def._def.innerType);
            const defaultValue = def._def.defaultValue();
            if (typeof inner === "object" && !("anyOf" in inner)) {
                inner.default = defaultValue;
            }
            return inner;
        }
        case ZodFirstPartyTypeKind.ZodLazy:
            return convert(schema._def.getter());
        case ZodFirstPartyTypeKind.ZodEffects:
            return convert(schema._def.schema);
        default:
            return { type: "object" };
    }
}
function unwrapSchema(schema) {
    let current = schema;
    let nullable = false;
    let optional = false;
    while (true) {
        switch (current._def.typeName) {
            case ZodFirstPartyTypeKind.ZodNullable:
                nullable = true;
                current = current._def.innerType;
                continue;
            case ZodFirstPartyTypeKind.ZodOptional:
                optional = true;
                current = current._def.innerType;
                continue;
            case ZodFirstPartyTypeKind.ZodEffects:
                current = current._def.schema;
                continue;
            default:
                return { schema: current, nullable, optional };
        }
    }
}
