/**
 * The registration guard every run event schema getter goes through.
 *
 * Schemas in this module are lazy: `defineSchema` resolves the
 * `SchemaValidator` contract the first time a getter is called, and throws if
 * nothing has registered one. That throw names the contract but reads as an
 * install instruction, which is the wrong advice for a consumer that has the
 * package and simply has not registered it yet (Veryfront Studio is exactly
 * that case: it depends on the package and registers the validator itself
 * rather than going through app bootstrap).
 *
 * `defineRunEventSchema` wraps every getter so the failure names the module
 * that needs the contract and shows the registration call, not just the
 * package to install. There is deliberately no hand-rolled fallback validator
 * here: a second validator implementation would accept payloads the real one
 * rejects, and this module's whole purpose is to agree with the API's schemas.
 *
 * @module run-events/schema-validator
 */

import { tryResolve } from "#veryfront/extensions/contracts.ts";
import { MISSING_EXTENSION_ERROR } from "#veryfront/extensions/errors.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { Schema, SchemaFactory, SchemaValidator } from "#veryfront/extensions/schema/index.ts";

/** The contract name every schema in this module resolves. */
export const RUN_EVENT_SCHEMA_VALIDATOR_CONTRACT = "SchemaValidator";

/** The package that provides it. */
export const RUN_EVENT_SCHEMA_VALIDATOR_PACKAGE = "@veryfront/ext-schema-zod";

const REGISTRATION_GUIDANCE = [
  `veryfront/run-events needs the "${RUN_EVENT_SCHEMA_VALIDATOR_CONTRACT}" contract to build a schema,`,
  "and nothing has registered one.",
  `Add ${RUN_EVENT_SCHEMA_VALIDATOR_PACKAGE} and register it once at startup:`,
  'import { register, tryResolve } from "veryfront/extensions/contracts";',
  `import { createZodAdapter } from "${RUN_EVENT_SCHEMA_VALIDATOR_PACKAGE}";`,
  `if (!tryResolve("${RUN_EVENT_SCHEMA_VALIDATOR_CONTRACT}")) register("${RUN_EVENT_SCHEMA_VALIDATOR_CONTRACT}", createZodAdapter());`,
  "The gate keeps an existing validator: register replaces whatever is registered, and inside a Veryfront app bootstrap owns it.",
].join(" ");

/**
 * Throw a message a consumer can act on when no `SchemaValidator` is
 * registered. Every getter in this module calls this before materializing, so
 * the first failure explains the registration rather than surfacing the
 * generic missing-extension throw from the contract registry.
 *
 * @throws When no `SchemaValidator` contract is registered.
 */
export function assertRunEventSchemaValidator(): void {
  if (tryResolve<SchemaValidator>(RUN_EVENT_SCHEMA_VALIDATOR_CONTRACT) !== undefined) {
    return;
  }
  throw MISSING_EXTENSION_ERROR.create({
    message: REGISTRATION_GUIDANCE,
    detail:
      `Register the ${RUN_EVENT_SCHEMA_VALIDATOR_CONTRACT} contract from ${RUN_EVENT_SCHEMA_VALIDATOR_PACKAGE} before reading run events.`,
  });
}

/**
 * Declare a lazy run event schema that reports a missing validator clearly.
 *
 * The guard runs on every call rather than once: caching it would make the
 * error depend on whether some earlier code path had already materialized the
 * schema in this process, which is exactly the kind of order-dependent
 * behavior a contract module should not have. The check is a map lookup, far
 * below the cost of the validation it precedes.
 *
 * @param factory - Receives a `SchemaValidator` and returns the schema.
 * @returns A zero-arg getter, memoized by `defineSchema` after first use.
 */
export function defineRunEventSchema<T>(factory: SchemaFactory<T>): () => Schema<T> {
  const getSchema = defineSchema(factory);
  return () => {
    assertRunEventSchemaValidator();
    return getSchema();
  };
}
