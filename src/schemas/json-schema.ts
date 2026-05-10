/**
 * JSON Schema helpers that route through the `SchemaValidator` extension
 * contract, so core modules can convert opaque `Schema<T>` instances to
 * JSON Schema documents without importing zod (or any other validator).
 *
 * @module schemas/json-schema
 */

import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type {
  JsonSchema,
  Schema,
  SchemaValidator,
} from "#veryfront/extensions/schema/index.ts";

function requireValidator(): SchemaValidator {
  const v = tryResolve<SchemaValidator>("SchemaValidator");
  if (!v) {
    throw new Error("SchemaValidator contract unresolved — install ext-zod");
  }
  return v;
}

/**
 * Convert an opaque `Schema<T>` to a JSON Schema document.
 *
 * Resolves the registered `SchemaValidator` and delegates to its
 * `toJsonSchema` implementation. Callers should pass a `Schema<T>` produced
 * by `defineSchema` or any other contract-aware builder.
 */
export function schemaToJsonSchema(schema: Schema<unknown>): JsonSchema {
  return requireValidator().toJsonSchema(schema);
}

/**
 * Returns `true` when the schema permits `undefined`.
 *
 * Resolves the registered `SchemaValidator` and delegates to its
 * `isOptional` implementation.
 */
export function isOptionalSchema(schema: Schema<unknown>): boolean {
  return requireValidator().isOptional(schema);
}

export type { JsonSchema };
