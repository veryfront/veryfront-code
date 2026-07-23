/**
 * JSON Schema helpers that route through the `SchemaValidator` extension
 * contract, so core modules can convert opaque `Schema<T>` instances to
 * JSON Schema documents without importing zod (or any other validator).
 *
 * @module schemas/json-schema
 */

import type { JsonSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { resolveSchemaValidator } from "./define.ts";
import { assertSchema } from "./schema-guard.ts";

/**
 * Convert an opaque `Schema<T>` to a JSON Schema document.
 *
 * Resolves the registered `SchemaValidator` and delegates to its
 * `toJsonSchema` implementation. Callers should pass a `Schema<T>` produced
 * by `defineSchema` or any other contract-aware builder.
 */
export function schemaToJsonSchema(schema: Schema<unknown>): JsonSchema {
  assertSchema(schema, "argument");
  return resolveSchemaValidator().toJsonSchema(schema);
}

/**
 * Returns `true` when the schema permits `undefined`.
 *
 * Resolves the registered `SchemaValidator` and delegates to its
 * `isOptional` implementation.
 */
export function isOptionalSchema(schema: Schema<unknown>): boolean {
  assertSchema(schema, "argument");
  return resolveSchemaValidator().isOptional(schema);
}

export type { JsonSchema };
