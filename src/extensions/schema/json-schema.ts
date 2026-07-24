/**
 * Minimal JSON Schema type used by the `SchemaValidator` contract for
 * `toJsonSchema()`. Kept in the extensions/schema category so the contract
 * can reference it without depending on any non-leaf module.
 *
 * @module extensions/schema/json-schema
 */

export type JsonSchemaPrimitiveType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

export type JsonSchema = {
  [keyword: string]: unknown;
  $schema?: string;
  type?: JsonSchemaPrimitiveType | readonly JsonSchemaPrimitiveType[];
  description?: string;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  enum?: readonly unknown[];
  const?: unknown;
  default?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  propertyNames?: JsonSchema;
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: readonly JsonSchema[];
  allOf?: readonly JsonSchema[];
  prefixItems?: readonly JsonSchema[];
  minItems?: number;
  maxItems?: number;
};
