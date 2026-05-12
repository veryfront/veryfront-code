/**
 * Minimal JSON Schema type used by the `SchemaValidator` contract for
 * `toJsonSchema()`. Kept in the extensions/schema category so the contract
 * can reference it without depending on any non-leaf module.
 *
 * @module extensions/schema/json-schema
 */

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
