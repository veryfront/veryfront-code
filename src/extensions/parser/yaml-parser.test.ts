import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createYamlParserProvider, snapshotYamlParserProvider } from "./yaml-parser.ts";

describe("extensions/parser/yaml-parser", () => {
  it("should freeze the captured provider generation", () => {
    const provider = createYamlParserProvider(() => ({ ok: true }));

    assertEquals(Object.isFrozen(provider), true);
    assertEquals(provider.parseYaml("a: 1"), { ok: true });
  });

  it("should forward the source and options to the captured parser", () => {
    const calls: unknown[][] = [];
    const provider = createYamlParserProvider((source, options) => {
      calls.push([source, options]);
      return null;
    });

    provider.parseYaml("a: 1", { schema: "json" });

    assertEquals(calls, [["a: 1", { schema: "json" }]]);
  });

  it("should ignore later mutation of the registration object", () => {
    const registration = { parseYaml: () => "first" };
    const provider = snapshotYamlParserProvider(registration);
    registration.parseYaml = () => "second";

    assertEquals(provider.parseYaml("a: 1"), "first");
  });

  it("should reject a registration without a callable parseYaml", () => {
    for (const value of [null, "parser", {}, { parseYaml: 42 }]) {
      assertThrows(() => snapshotYamlParserProvider(value), TypeError, "parseYaml");
    }
  });

  it("should reject an accessor-backed parseYaml under a poisoned prototype", () => {
    const registration = {};
    Object.defineProperty(registration, "parseYaml", {
      configurable: true,
      enumerable: true,
      get: () => () => "from-accessor",
    });
    // A poisoned Object.prototype.value makes a naive `descriptor.value` read
    // look like a data property holding a function.
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      value: () => "poisoned",
    });
    try {
      assertThrows(() => snapshotYamlParserProvider(registration), TypeError, "parseYaml");
    } finally {
      delete (Object.prototype as Record<string, unknown>).value;
    }
  });

  it("should reject a non-string source before calling the parser", () => {
    let called = false;
    const provider = createYamlParserProvider(() => {
      called = true;
      return null;
    });

    assertThrows(
      () => provider.parseYaml(42 as unknown as string),
      TypeError,
      "must be a string",
    );
    assertEquals(called, false);
  });

  it("should reject an asynchronous parser rather than leak a pending value", () => {
    const provider = createYamlParserProvider(() => Promise.resolve({ a: 1 }));

    assertThrows(
      () => provider.parseYaml("a: 1"),
      TypeError,
      "must be synchronous",
    );
  });
});
