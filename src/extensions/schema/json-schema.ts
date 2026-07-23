/**
 * JSON Schema object used by the `SchemaValidator` contract for
 * `toJsonSchema()`. Common generated keywords are typed explicitly. Other
 * standard and vendor keywords remain available so the contract does not
 * become coupled to one JSON Schema draft.
 *
 * @module extensions/schema/json-schema
 */

/** Primitive type names accepted by JSON Schema's `type` keyword. */
export type JsonSchemaTypeName =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

/**
 * JSON Schema object with typed common keywords and support for draft-specific
 * or vendor-defined keywords.
 */
export type JsonSchema = {
  type?: JsonSchemaTypeName | JsonSchemaTypeName[];
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
  /** Additional JSON Schema or vendor extension keyword. */
  [keyword: string]: unknown;
};
