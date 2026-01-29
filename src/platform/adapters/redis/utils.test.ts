import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { arrayToObject } from "./utils.ts";

describe("platform/adapters/redis/utils", () => {
  describe("arrayToObject", () => {
    it("should convert key-value pairs to object", () => {
      assertEquals(arrayToObject(["a", "1", "b", "2"]), { a: "1", b: "2" });
    });

    it("should handle empty array", () => {
      assertEquals(arrayToObject([]), {});
    });

    it("should handle single pair", () => {
      assertEquals(arrayToObject(["key", "value"]), { key: "value" });
    });

    it("should skip entries with undefined values (odd-length arrays)", () => {
      const result = arrayToObject(["a", "1", "b"]);
      assertEquals(result, { a: "1" });
    });

    it("should handle empty string keys", () => {
      const result = arrayToObject(["", "val"]);
      // Empty string is falsy, so it gets skipped by the if (!key) check
      assertEquals(result, {});
    });

    it("should handle empty string values", () => {
      assertEquals(arrayToObject(["key", ""]), { key: "" });
    });
  });
});
