import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import { parseRuntime } from "./runtime.ts";

describe("parseRuntime", () => {
  it("returns 'node' for input 'node'", () => {
    assertEquals(parseRuntime("node"), "node");
  });

  it("returns 'bun' for input 'bun'", () => {
    assertEquals(parseRuntime("bun"), "bun");
  });

  it("returns 'deno' for input 'deno'", () => {
    assertEquals(parseRuntime("deno"), "deno");
  });

  it("throws on unknown string", () => {
    assertThrows(
      () => parseRuntime("rust"),
      Error,
      'Invalid runtime value: "rust"',
    );
  });

  it("throws on number", () => {
    assertThrows(() => parseRuntime(42), Error, "Invalid runtime value");
  });

  it("throws on null", () => {
    assertThrows(() => parseRuntime(null), Error, "Invalid runtime value");
  });

  it("error message lists valid values", () => {
    try {
      parseRuntime("foo");
      throw new Error("should have thrown");
    } catch (e) {
      assertEquals(
        (e as Error).message.includes("node, bun, deno"),
        true,
      );
    }
  });
});
