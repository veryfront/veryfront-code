// Deliberately does not import `#veryfront/schemas/_test-setup.ts`: these cases
// verify the consumer-facing failure when no validator is registered.
import { assert, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";
import { createAgentEventParser, parseAgentEvent } from "./parser.ts";
import {
  AGENT_EVENT_SCHEMA_VALIDATOR_CONTRACT,
  AGENT_EVENT_SCHEMA_VALIDATOR_PACKAGE,
  assertAgentEventSchemaValidator,
  registerAgentEventSchemaValidator,
  tryResolveAgentEventSchemaValidator,
  unregisterAgentEventSchemaValidator,
} from "./schema-validator.ts";

let previous: SchemaValidator | undefined;

describe("events/schema-validator", () => {
  beforeEach(() => {
    previous = tryResolveAgentEventSchemaValidator();
    unregisterAgentEventSchemaValidator();
  });

  afterEach(() => {
    if (previous) registerAgentEventSchemaValidator(previous);
    else unregisterAgentEventSchemaValidator();
  });

  it("names the public events module and validator package", () => {
    const error = assertThrows(() => assertAgentEventSchemaValidator());
    assert(error instanceof Error);
    assertStringIncludes(error.message, "veryfront/events");
    assertStringIncludes(error.message, AGENT_EVENT_SCHEMA_VALIDATOR_PACKAGE);
    assertStringIncludes(error.message, "registerAgentEventSchemaValidator(createZodAdapter())");
  });

  it("fails parseAgentEvent with the same actionable registration guidance", () => {
    const error = assertThrows(() => parseAgentEvent({}));
    assert(error instanceof Error);
    assertStringIncludes(error.message, "veryfront/events");
  });

  it("passes once a JSON Schema capable validator is registered", () => {
    registerAgentEventSchemaValidator(createZodAdapter());
    assertAgentEventSchemaValidator();
  });

  it("creates an injected parser without the shared registration hook", () => {
    const parser = createAgentEventParser(createZodAdapter());
    const result = parser.safeParseAgentEvent({});
    assert(!result.success);
  });

  it("names the shared validator contract for producers that already use the extension", () => {
    assertStringIncludes(AGENT_EVENT_SCHEMA_VALIDATOR_CONTRACT, "SchemaValidator");
  });
});
