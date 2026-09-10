// Deliberately does not import `#veryfront/schemas/_test-setup.ts`: these cases
// are about the failure a consumer sees with no validator registered, and the
// setup module registers one process-wide.
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";
import { getUrlCitedPayloadSchema } from "./payload.ts";
import { parseTypedRunEventRow } from "./envelope.ts";
import {
  assertRunEventSchemaValidator,
  defineRunEventSchema,
  RUN_EVENT_SCHEMA_VALIDATOR_CONTRACT,
  RUN_EVENT_SCHEMA_VALIDATOR_PACKAGE,
} from "./schema-validator.ts";

const CONTRACT = RUN_EVENT_SCHEMA_VALIDATOR_CONTRACT;

let previous: SchemaValidator | undefined;

/**
 * The guard is checked on every getter call rather than memoized, so these
 * cases hold whether or not another test file in the same process already
 * materialized a schema. That order independence is the reason for the
 * uncached check in `defineRunEventSchema`.
 */
describe("run-events/schema-validator", () => {
  beforeEach(() => {
    previous = tryResolve<SchemaValidator>(CONTRACT);
    unregister(CONTRACT);
  });

  afterEach(() => {
    if (previous) register<SchemaValidator>(CONTRACT, previous);
    else unregister(CONTRACT);
  });

  it("names the contract, the package and the registration call", () => {
    const error = assertThrows(() => assertRunEventSchemaValidator());
    assert(error instanceof Error);
    assertStringIncludes(error.message, "veryfront/run-events");
    assertStringIncludes(error.message, `"${CONTRACT}"`);
    assertStringIncludes(error.message, RUN_EVENT_SCHEMA_VALIDATOR_PACKAGE);
    assertStringIncludes(error.message, `register("${CONTRACT}", createZodAdapter())`);
  });

  it("fails a payload schema getter with that same message", () => {
    const error = assertThrows(() => getUrlCitedPayloadSchema());
    assert(error instanceof Error);
    assertStringIncludes(error.message, RUN_EVENT_SCHEMA_VALIDATOR_PACKAGE);
  });

  it("fails parseTypedRunEventRow with that same message", () => {
    const error = assertThrows(() => parseTypedRunEventRow({}));
    assert(error instanceof Error);
    assertStringIncludes(error.message, RUN_EVENT_SCHEMA_VALIDATOR_PACKAGE);
  });

  it("does not fall back to a validator of its own", () => {
    // A fallback would make this succeed and silently accept payloads the real
    // validator rejects, which is the failure mode the guard exists to prevent.
    assertThrows(() => getUrlCitedPayloadSchema());
    assertEquals(tryResolve<SchemaValidator>(CONTRACT), undefined);
  });

  it("passes once a validator is registered", () => {
    register<SchemaValidator>(CONTRACT, createZodAdapter());
    assertRunEventSchemaValidator();
    const getSchema = defineRunEventSchema((v) => v.object({ id: v.string().min(1) }));
    assertEquals(getSchema().parse({ id: "run_1" }), { id: "run_1" });
  });

  it("throws again after the validator is unregistered", () => {
    register<SchemaValidator>(CONTRACT, createZodAdapter());
    const getSchema = defineRunEventSchema((v) => v.object({ id: v.string().min(1) }));
    assertEquals(getSchema().parse({ id: "run_1" }), { id: "run_1" });

    unregister(CONTRACT);
    assertThrows(() => getSchema());
  });
});
