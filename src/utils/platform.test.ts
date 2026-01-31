import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isCompiledBinary } from "./platform.ts";

describe("platform", () => {
  describe("isCompiledBinary", () => {
    it("should return a boolean", () => {
      assertEquals(typeof isCompiledBinary(), "boolean");
    });

    it("should return false in test environment (not compiled)", () => {
      assertEquals(isCompiledBinary(), false);
    });
  });
});
