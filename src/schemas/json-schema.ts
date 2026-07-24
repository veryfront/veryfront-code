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
  SchemaValidator,
} from "#veryfront/extensions/schema/index.ts";
import { resolveSchemaValidator } from "./define.ts";
import { snapshotBoundedJsonValue } from "./json-value.ts";

function snapshotBoundedJsonSchemaObject(value: unknown): JsonSchema | undefined {
  const snapshot = snapshotBoundedJsonValue(value);
  return snapshot.success &&
      !!snapshot.value &&
      typeof snapshot.value === "object" &&
      !Array.isArray(snapshot.value)
    ? snapshot.value
    : undefined;
}

/**
 * Convert an opaque `Schema<T>` to a JSON Schema document.
 *
 * Resolves the registered `SchemaValidator` and delegates to its
 * `toJsonSchema` implementation. Callers should pass a `Schema<T>` produced
 * by `defineSchema` or any other contract-aware builder.
 */
export function schemaToJsonSchema(schema: Schema<unknown>): JsonSchema {
  const jsonSchema = snapshotBoundedJsonSchemaObject(
    resolveSchemaValidator().toJsonSchema(schema),
  );
  if (!jsonSchema) {
    throw new TypeError(
      "SchemaValidator.toJsonSchema() must return a bounded JSON Schema object",
    );
  }
  return jsonSchema;
}

/**
 * Returns `true` when the schema permits `undefined`.
 *
 * Resolves the registered `SchemaValidator` and delegates to its
 * `isOptional` implementation.
 */
export function isOptionalSchema(schema: Schema<unknown>): boolean {
  const optional = resolveSchemaValidator().isOptional(schema);
  if (typeof optional !== "boolean") {
    throw new TypeError("SchemaValidator.isOptional() must return a boolean");
  }
  return optional;
}

function compileWithValidator<T>(
  validator: SchemaValidator,
  compiler: NonNullable<SchemaValidator["compileJsonSchema"]>,
  schema: JsonSchema,
): JsonSchemaValidationFunction<T> {
  const snapshot = snapshotBoundedJsonSchemaObject(schema);
  if (!snapshot) {
    throw new TypeError("JSON Schema must be a bounded JSON Schema object");
  }

  let compiled: JsonSchemaValidationFunction<T>;
  try {
    compiled = compiler.call(validator, snapshot) as JsonSchemaValidationFunction<T>;
  } catch (cause) {
    throw new Error("The registered SchemaValidator failed to compile JSON Schema", { cause });
  }
  if (typeof compiled !== "function") {
    throw new TypeError("SchemaValidator.compileJsonSchema() must return a validation function");
  }
  return compiled;
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
  const compiler = validator.compileJsonSchema;
  if (!compiler) {
    throw new Error(
      "The registered SchemaValidator cannot compile JSON Schema. " +
        "Use a validator extension that implements compileJsonSchema().",
    );
  }

  return compileWithValidator<T>(validator, compiler, schema);
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
  const compiler = validator.compileJsonSchema;
  if (!compiler) return undefined;
  return compileWithValidator<T>(validator, compiler, schema);
}

export type { JsonSchema };
