import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { computeSourceHash } from "./hash-utils.ts";

describe("studio/hash-utils", () => {
  describe("computeSourceHash", () => {
    it("should return a hex string", () => {
      const result = computeSourceHash("hello world");
      assertEquals(/^[0-9a-f]+$/.test(result), true);
    });

    it("should be deterministic", () => {
      const input = "const x = 1;";
      assertEquals(computeSourceHash(input), computeSourceHash(input));
    });

    it("should differ for different inputs", () => {
      assertNotEquals(computeSourceHash("const x = 1;"), computeSourceHash("const x = 2;"));
    });

    it("should handle empty string", () => {
      const result = computeSourceHash("");
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("should handle unicode content", () => {
      const result = computeSourceHash("const emoji = '🎉';");
      assertEquals(/^[0-9a-f]+$/.test(result), true);
    });

    it("should produce different hashes for whitespace differences", () => {
      assertNotEquals(computeSourceHash("a b"), computeSourceHash("a  b"));
    });
  });
});
