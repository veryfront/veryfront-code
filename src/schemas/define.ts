/**
 * Lazy schema factory.
 *
 * `defineSchema(factory)` returns a memoized getter that resolves the
 * `SchemaValidator` extension contract on first call and materializes the
 * schema via the provided factory. This indirection lets core modules declare
 * schemas without importing zod directly. A real validator (typically
 * `@veryfront/ext-schema-zod`) must be registered in the contract registry before
 * the schema is first accessed.
 *
 * @module schemas/define
 */

import { resolve } from "#veryfront/extensions/contracts.ts";
import type { Schema, SchemaFactory, SchemaValidator } from "#veryfront/extensions/schema/index.ts";

const SCHEMA_METHOD_NAMES = [
  "optional",
  "nullable",
  "nullish",
  "default",
  "describe",
  "refine",
  "superRefine",
  "transform",
  "strict",
  "strip",
  "passthrough",
  "partial",
  "extend",
  "merge",
  "omit",
  "pick",
  "min",
  "max",
  "int",
  "positive",
  "nonnegative",
  "regex",
  "email",
  "url",
  "uuid",
  "datetime",
  "pipe",
  "parse",
  "safeParse",
] as const;

export function resolveSchemaValidator(): SchemaValidator {
  return resolve<SchemaValidator>("SchemaValidator");
}

/** Assert the runtime surface promised by the opaque Schema contract. */
export function assertSchemaContract<T>(
  value: unknown,
  message: string,
): asserts value is Schema<T> {
  const valid = !!value &&
    (typeof value === "object" || typeof value === "function") &&
    SCHEMA_METHOD_NAMES.every((method) =>
      typeof (value as Record<string, unknown>)[method] === "function"
    );
  if (!valid) throw new TypeError(message);
}

/**
 * Wrap a schema factory so that it is built lazily on first call.
 *
 * @param factory - Receives a `SchemaValidator` and returns a `Schema<T>`.
 * @returns A zero-arg getter that caches and returns the built schema.
 * Requires a SchemaValidator extension to be registered before first use.
 *
 * @example
 * ```ts
 * const getUserSchema = defineSchema((v) =>
 *   v.object({ id: v.string().uuid(), name: v.string().min(1) })
 * );
 *
 * const user = getUserSchema().parse(input);
 * ```
 */
export function defineSchema<T>(factory: SchemaFactory<T>): () => Schema<T> {
  let cached: Schema<T> | undefined;
  let materializing = false;

  return () => {
    if (cached !== undefined) return cached;
    if (materializing) {
      throw new Error(
        "Schema factory recursively invoked its own getter; use v.lazy() for recursion",
      );
    }

    materializing = true;
    try {
      const schema = factory(resolveSchemaValidator());
      assertSchemaContract<T>(
        schema,
        "Schema factory must return a Schema contract implementation",
      );
      cached = schema;
      return schema;
    } finally {
      materializing = false;
    }
  };
}
