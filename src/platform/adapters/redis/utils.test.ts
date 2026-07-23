import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { arrayToObject } from "./utils.ts";

describe("platform/adapters/redis/utils", () => {
  describe("arrayToObject", () => {
    it("should convert key-value pairs array to object", () => {
      assertEquals(arrayToObject(["a", "1", "b", "2"]), { a: "1", b: "2" });
    });

    it("should return empty object for empty array", () => {
      assertEquals(arrayToObject([]), {});
    });

    it("should handle single key-value pair", () => {
      assertEquals(arrayToObject(["key", "val"]), { key: "val" });
    });

    it("should skip pairs where key is empty string", () => {
      assertEquals(arrayToObject(["", "val"]), {});
    });

    it("should handle odd-length array by ignoring trailing key", () => {
      assertEquals(arrayToObject(["a", "1", "b"]), { a: "1" });
    });

    it("should preserve empty string values", () => {
      assertEquals(arrayToObject(["key", ""]), { key: "" });
    });

    it("preserves special Redis field names without changing the object prototype", () => {
      const result = arrayToObject([
        "__proto__",
        "prototype-field",
        "constructor",
        "constructor-field",
      ]);

      assertEquals(Object.getPrototypeOf(result), Object.prototype);
      assertEquals(Object.hasOwn(result, "__proto__"), true);
      assertEquals(result.__proto__, "prototype-field");
      assertEquals(
        Object.getOwnPropertyDescriptor(result, "constructor")?.value,
        "constructor-field",
      );
      assertEquals(Object.hasOwn(Object.prototype, "prototype-field"), false);
    });

    it("should handle large arrays", () => {
      const arr: string[] = [];
      for (let i = 0; i < 100; i++) {
        arr.push(`k${i}`, `v${i}`);
      }
      const result = arrayToObject(arr);
      assertEquals(Object.keys(result).length, 100);
      assertEquals(result.k0, "v0");
      assertEquals(result.k99, "v99");
    });
  });
});
