import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { hasBunRuntime, hasDenoRuntime, hasNodeProcess } from "./runtime-guards.ts";

describe("runtime-guards", () => {
  describe("hasDenoRuntime", () => {
    it("should return true for Deno-like global", () => {
      assertEquals(hasDenoRuntime({ Deno: { env: { get: () => undefined } } }), true);
    });

    it("should return false for missing Deno", () => {
      assertEquals(hasDenoRuntime({}), false);
    });

    it("should return false for Deno without env.get function", () => {
      assertEquals(hasDenoRuntime({ Deno: { env: {} } }), false);
    });

    it("should return false for null", () => {
      assertEquals(hasDenoRuntime(null), false);
    });

    it("should return false for non-object", () => {
      assertEquals(hasDenoRuntime("string"), false);
    });

    it("should return false for undefined", () => {
      assertEquals(hasDenoRuntime(undefined), false);
    });
  });

  describe("hasNodeProcess", () => {
    it("should return true for Node-like global", () => {
      assertEquals(hasNodeProcess({ process: { env: {} } }), true);
    });

    it("should return false for missing process", () => {
      assertEquals(hasNodeProcess({}), false);
    });

    it("should return false for process without env object", () => {
      assertEquals(hasNodeProcess({ process: {} }), false);
    });

    it("should return false for null", () => {
      assertEquals(hasNodeProcess(null), false);
    });
  });

  describe("hasBunRuntime", () => {
    it("should return true for Bun-like global", () => {
      assertEquals(hasBunRuntime({ Bun: { version: "1.0.0" } }), true);
    });

    it("should return false for missing Bun", () => {
      assertEquals(hasBunRuntime({}), false);
    });

    it("should return false for null", () => {
      assertEquals(hasBunRuntime(null), false);
    });

    it("should return false for non-object", () => {
      assertEquals(hasBunRuntime(42), false);
    });
  });
});
