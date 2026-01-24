import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { estimateSize } from "./size-estimator.ts";

describe("estimateSize", () => {
  it("should export estimateSize function", () => {
    assertExists(estimateSize);
    assertEquals(typeof estimateSize, "function");
  });

  describe("Uint8Array", () => {
    it("should return byte length for Uint8Array", () => {
      assertEquals(estimateSize(new Uint8Array([1, 2, 3, 4, 5])), 5);
    });

    it("should return 0 for empty Uint8Array", () => {
      assertEquals(estimateSize(new Uint8Array()), 0);
    });

    it("should handle large Uint8Array", () => {
      assertEquals(estimateSize(new Uint8Array(1000)), 1000);
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
    function assertJsonSize(value: unknown): void {
      assertEquals(estimateSize(value), JSON.stringify(value).length * 2);
    }

    it("should return JSON length * 2 for objects", () => {
      assertJsonSize({ foo: "bar" });
    });

    it("should handle arrays", () => {
      assertJsonSize([1, 2, 3]);
    });

    it("should handle nested objects", () => {
      assertJsonSize({ a: { b: { c: 1 } } });
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
