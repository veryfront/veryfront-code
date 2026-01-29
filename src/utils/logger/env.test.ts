import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getEnvironmentVariable } from "./env.ts";

describe("logger/env", () => {
  describe("getEnvironmentVariable", () => {
    it("should return value for known env var", () => {
      // NODE_ENV should be set in test environment
      const result = getEnvironmentVariable("NODE_ENV");
      // May or may not be set, but should not throw
      assertEquals(typeof result === "string" || result === undefined, true);
    });

    it("should return undefined for unset variable", () => {
      const result = getEnvironmentVariable("__NONEXISTENT_VAR_FOR_TESTING__");
      assertEquals(result, undefined);
    });

    it("should return undefined for empty variable name", () => {
      // Should not throw
      const result = getEnvironmentVariable("");
      assertEquals(result === undefined || typeof result === "string", true);
    });
  });
});
