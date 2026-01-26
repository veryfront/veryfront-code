export type JsonSchema = {
    type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
    description?: string;
    enum?: unknown[];
    const?: unknown;
    default?: unknown;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    items?: JsonSchema;
    additionalProperties?: boolean | JsonSchema;
    anyOf?: JsonSchema[];
    prefixItems?: JsonSchema[];
    minItems?: number;
    maxItems?: number;
};
//# sourceMappingURL=json-schema.d.ts.map