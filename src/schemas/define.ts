/**
 * Lazy schema factory.
 *
 * `defineSchema(factory)` returns a memoized getter that resolves the
 * `SchemaValidator` extension contract on first call and materializes the
 * schema via the provided factory. This indirection lets core modules declare
 * schemas without importing zod directly — a real validator (typically
 * `@veryfront/ext-zod`) must be registered in the contract registry before
 * the schema is first accessed.
 *
 * @module schemas/define
 */

import { register, tryResolve } from "#veryfront/extensions/contracts.ts";
import type { Schema, SchemaFactory, SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { createZodAdapter } from "../../extensions/ext-zod/src/adapter.ts";

export function resolveSchemaValidator(): SchemaValidator {
  const existing = tryResolve<SchemaValidator>("SchemaValidator");
  if (existing) return existing;

  const fallback = createZodAdapter();
  register<SchemaValidator>("SchemaValidator", fallback);
  return fallback;
}

/**
 * Wrap a schema factory so that it is built lazily on first call.
 *
 * @param factory - Receives a `SchemaValidator` and returns a `Schema<T>`.
 * @returns A zero-arg getter that caches and returns the built schema.
 * Installs the default zod-backed validator when no contract is registered.
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
  return () => {
    if (cached) return cached;
    const v = resolveSchemaValidator();
    cached = factory(v);
    return cached;
  };
}
