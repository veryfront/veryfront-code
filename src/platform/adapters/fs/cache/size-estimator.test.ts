import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { estimateSize } from "./size-estimator.ts";

describe("estimateSize", () => {
  it("should export estimateSize function", () => {
    assertExists(estimateSize);
    assertEquals(typeof estimateSize, "function");
  });

  describe("Uint8Array", () => {
    it("should return byte length for Uint8Array", () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      assertEquals(estimateSize(bytes), 5);
    });

    it("should return 0 for empty Uint8Array", () => {
      const bytes = new Uint8Array([]);
      assertEquals(estimateSize(bytes), 0);
    });

    it("should handle large Uint8Array", () => {
      const bytes = new Uint8Array(1000);
      assertEquals(estimateSize(bytes), 1000);
    });
  });

  describe("string", () => {
    it("should return string length * 2", () => {
      assertEquals(estimateSize("hello"), 10);
    });

    it("should return 0 for empty string", () => {
      assertEquals(estimateSize(""), 0);
    });

    it("should handle unicode strings", () => {
      assertEquals(estimateSize("こんにちは"), 10);
    });
  });

  describe("object", () => {
    it("should return JSON length * 2 for objects", () => {
      const obj = { foo: "bar" };
      const expectedSize = JSON.stringify(obj).length * 2;
      assertEquals(estimateSize(obj), expectedSize);
    });

    it("should handle arrays", () => {
      const arr = [1, 2, 3];
      const expectedSize = JSON.stringify(arr).length * 2;
      assertEquals(estimateSize(arr), expectedSize);
    });

    it("should handle nested objects", () => {
      const obj = { a: { b: { c: 1 } } };
      const expectedSize = JSON.stringify(obj).length * 2;
      assertEquals(estimateSize(obj), expectedSize);
    });
  });

  describe("primitives", () => {
    it("should return 8 for numbers", () => {
      assertEquals(estimateSize(42), 8);
    });

    it("should return 8 for booleans", () => {
      assertEquals(estimateSize(true), 8);
      assertEquals(estimateSize(false), 8);
    });

    it("should return 8 for undefined", () => {
      assertEquals(estimateSize(undefined), 8);
    });

    it("should return 8 for null", () => {
      assertEquals(estimateSize(null), 8);
    });
  });
});
