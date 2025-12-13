import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { estimateSize } from "./size-estimator.ts";

describe("platform/adapters/file-cache/size-estimator", () => {
  describe("estimateSize", () => {
    it("should estimate size for Uint8Array", () => {
      const array = new Uint8Array([1, 2, 3, 4, 5]);
      const size = estimateSize(array);

      assertEquals(size, 5, "size should equal byte array length");
    });

    it("should estimate size for empty Uint8Array", () => {
      const array = new Uint8Array([]);
      const size = estimateSize(array);

      assertEquals(size, 0);
    });

    it("should estimate size for string", () => {
      const str = "Hello";
      const size = estimateSize(str);

      assertEquals(size, 10, "size should be string length * 2");
    });

    it("should estimate size for empty string", () => {
      const str = "";
      const size = estimateSize(str);

      assertEquals(size, 0);
    });

    it("should estimate size for long string", () => {
      const str = "a".repeat(100);
      const size = estimateSize(str);

      assertEquals(size, 200, "size should be string length * 2");
    });

    it("should estimate size for object", () => {
      const obj = { name: "test", value: 123 };
      const size = estimateSize(obj);

      const expected = JSON.stringify(obj).length * 2;
      assertEquals(size, expected, "size should be JSON string length * 2");
    });

    it("should estimate size for nested object", () => {
      const obj = { a: { b: { c: "deep" } } };
      const size = estimateSize(obj);

      const expected = JSON.stringify(obj).length * 2;
      assertEquals(size, expected);
    });

    it("should estimate size for array object", () => {
      const arr = [1, 2, 3, 4, 5];
      const size = estimateSize(arr);

      const expected = JSON.stringify(arr).length * 2;
      assertEquals(size, expected);
    });

    it("should estimate size for null", () => {
      const size = estimateSize(null);

      assertEquals(size, 8, "null should have default size of 8");
    });

    it("should estimate size for number", () => {
      const size = estimateSize(123);

      assertEquals(size, 8, "number should have default size of 8");
    });

    it("should estimate size for boolean", () => {
      const trueSize = estimateSize(true);
      const falseSize = estimateSize(false);

      assertEquals(trueSize, 8);
      assertEquals(falseSize, 8);
    });

    it("should estimate size for undefined", () => {
      const size = estimateSize(undefined);

      assertEquals(size, 8, "undefined should have default size of 8");
    });
  });
});
