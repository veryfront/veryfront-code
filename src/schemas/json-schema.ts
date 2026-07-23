/**
 * JSON Schema helpers that route through the `SchemaValidator` extension
 * contract, so core modules can convert opaque `Schema<T>` instances to
 * JSON Schema documents without importing zod (or any other validator).
 *
 * @module schemas/json-schema
 */

import type {
  JsonSchema,
  JsonSchemaValidationFunction,
  Schema,
} from "#veryfront/extensions/schema/index.ts";
import { resolveSchemaValidator } from "./define.ts";

/**
 * Convert an opaque `Schema<T>` to a JSON Schema document.
 *
 * Resolves the registered `SchemaValidator` and delegates to its
 * `toJsonSchema` implementation. Callers should pass a `Schema<T>` produced
 * by `defineSchema` or any other contract-aware builder.
 */
export function schemaToJsonSchema(schema: Schema<unknown>): JsonSchema {
  return resolveSchemaValidator().toJsonSchema(schema);
}

/**
 * Returns `true` when the schema permits `undefined`.
 *
 * Resolves the registered `SchemaValidator` and delegates to its
 * `isOptional` implementation.
 */
export function isOptionalSchema(schema: Schema<unknown>): boolean {
  return resolveSchemaValidator().isOptional(schema);
}

/**
 * Compile a raw JSON Schema through the registered validator extension.
 *
 * This helper is intentionally internal. Raw-schema consumers must fail
 * during materialization when a custom validator adapter does not implement
 * the optional compilation capability.
 */
export function compileJsonSchemaValidator<T = unknown>(
  schema: JsonSchema,
): JsonSchemaValidationFunction<T> {
  const validator = resolveSchemaValidator();
  if (!validator.compileJsonSchema) {
    throw new Error(
      "The registered SchemaValidator cannot compile JSON Schema. " +
        "Use a validator extension that implements compileJsonSchema().",
    );
  }

  try {
    return validator.compileJsonSchema<T>(schema);
  } catch (cause) {
    throw new Error("The registered SchemaValidator failed to compile JSON Schema", { cause });
  }
}

/**
 * Compile a raw JSON Schema when the registered adapter supports it.
 *
 * Older third-party adapters predate this optional capability. Callers that
 * only need to transmit a schema can remain compatible and defer the explicit
 * capability error until local validation is actually requested.
 */
export function tryCompileJsonSchemaValidator<T = unknown>(
  schema: JsonSchema,
): JsonSchemaValidationFunction<T> | undefined {
  const validator = resolveSchemaValidator();
  if (!validator.compileJsonSchema) return undefined;

  try {
    return validator.compileJsonSchema<T>(schema);
  } catch (cause) {
    throw new Error("The registered SchemaValidator failed to compile JSON Schema", { cause });
  }
}

export type { JsonSchema };
