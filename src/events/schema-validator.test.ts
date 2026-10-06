// Deliberately does not import `#veryfront/schemas/_test-setup.ts`: these cases
// verify the consumer-facing failure when no validator is registered.
import { assert, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";
import { createEventParser, parseEvent } from "./parser.ts";
import {
  assertEventSchemaValidator,
  EVENT_SCHEMA_VALIDATOR_CONTRACT,
  EVENT_SCHEMA_VALIDATOR_PACKAGE,
  registerEventSchemaValidator,
  tryResolveEventSchemaValidator,
  unregisterEventSchemaValidator,
} from "./schema-validator.ts";

let previous: SchemaValidator | undefined;

describe("events/schema-validator", () => {
  beforeEach(() => {
    previous = tryResolveEventSchemaValidator();
    unregisterEventSchemaValidator();
  });

  afterEach(() => {
    if (previous) registerEventSchemaValidator(previous);
    else unregisterEventSchemaValidator();
  });

  it("names the public events module and validator package", () => {
    const error = assertThrows(() => assertEventSchemaValidator());
    assert(error instanceof Error);
    assertStringIncludes(error.message, "veryfront/events");
    assertStringIncludes(error.message, EVENT_SCHEMA_VALIDATOR_PACKAGE);
    assertStringIncludes(error.message, "registerEventSchemaValidator(createZodAdapter())");
  });

  it("fails parseEvent with the same actionable registration guidance", () => {
    const error = assertThrows(() => parseEvent({}));
    assert(error instanceof Error);
    assertStringIncludes(error.message, "veryfront/events");
  });

  it("passes once a JSON Schema capable validator is registered", () => {
    registerEventSchemaValidator(createZodAdapter());
    assertEventSchemaValidator();
  });

  it("creates an injected parser without the shared registration hook", () => {
    const parser = createEventParser(createZodAdapter());
    const result = parser.safeParseEvent({});
    assert(!result.success);
  });

  it("names the shared validator contract for producers that already use the extension", () => {
    assertStringIncludes(EVENT_SCHEMA_VALIDATOR_CONTRACT, "SchemaValidator");
  });
});
