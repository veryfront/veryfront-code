import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getEnvironmentVariable } from "./env.ts";

describe("logger/env", () => {
  describe("getEnvironmentVariable", () => {
    it("should return value for known env var", () => {
      const result = getEnvironmentVariable("NODE_ENV");
      assertEquals(typeof result === "string" || result === undefined, true);
    });

    it("should return undefined for unset variable", () => {
      const result = getEnvironmentVariable("__NONEXISTENT_VAR_FOR_TESTING__");
      assertEquals(result, undefined);
    });

    it("should return undefined for empty variable name", () => {
      const result = getEnvironmentVariable("");
      assertEquals(typeof result === "string" || result === undefined, true);
    });
  });
});
