import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { isCompiledBinary } from "./platform.ts";

describe("utils/platform", () => {
  describe("isCompiledBinary", () => {
    it("should return a boolean", () => {
      const result = isCompiledBinary();
      assertEquals(typeof result, "boolean");
    });

    it("should not throw errors", () => {
      // Just ensure it can be called without throwing
      isCompiledBinary();
      assertEquals(true, true);
    });
  });
});
