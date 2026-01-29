import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isCompiledBinary } from "./platform.ts";

describe("platform", () => {
  describe("isCompiledBinary", () => {
    it("should return a boolean", () => {
      const result = isCompiledBinary();
      assert(typeof result === "boolean");
    });

    it("should return false in test environment (not compiled)", () => {
      // When running tests via `deno test`, we are NOT in a compiled binary
      assertEquals(isCompiledBinary(), false);
    });
  });
});
