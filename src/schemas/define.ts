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
import { assertSchema } from "./schema-guard.ts";

/** Resolve the schema-validator implementation registered during bootstrap. */
export function resolveSchemaValidator(): SchemaValidator {
  return resolve<SchemaValidator>("SchemaValidator");
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
  if (typeof factory !== "function") {
    throw new TypeError("Schema factory must be a function");
  }
  let cached: Schema<T> | undefined;
  let building = false;
  return () => {
    if (cached !== undefined) return cached;
    if (building) throw new TypeError("Schema factory cannot resolve recursively");

    building = true;
    try {
      const v = resolveSchemaValidator();
      const candidate = factory(v);
      assertSchema(candidate, "factory");
      cached = candidate;
      return candidate;
    } finally {
      building = false;
    }
  };
}
