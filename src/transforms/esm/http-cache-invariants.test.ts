import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  asBundleHash,
  assertLocal,
  assertPortable,
  asLocalModuleCode,
  CACHE_DIR_TOKEN,
  hasHardcodedCachePaths,
  VeryfrontError,
} from "./http-cache-invariants.ts";

describe("transforms/esm/http-cache-invariants", () => {
  describe("CACHE_DIR_TOKEN", () => {
    it("is a non-empty string", () => {
      assertEquals(typeof CACHE_DIR_TOKEN, "string");
      assertEquals(CACHE_DIR_TOKEN.length > 0, true);
    });

    it("contains __VF_CACHE_DIR__", () => {
      assertEquals(CACHE_DIR_TOKEN.includes("__VF_CACHE_DIR__"), true);
    });
  });

  describe("hasHardcodedCachePaths", () => {
    it("returns false for code without cache paths", () => {
      assertEquals(hasHardcodedCachePaths("const x = 1;"), false);
    });

    it("returns false for empty string", () => {
      assertEquals(hasHardcodedCachePaths(""), false);
    });
  });

  describe("assertPortable", () => {
    it("does not throw for code without hardcoded paths", () => {
      assertPortable("const x = 1;" as never);
    });

    it("does not throw for tokenized code", () => {
      assertPortable(`import "file://${CACHE_DIR_TOKEN}/http-123.mjs";` as never);
    });
  });

  describe("assertLocal", () => {
    it("does not throw for code without tokens", () => {
      assertLocal("const x = 1;" as never);
    });

    it("throws for code with portable tokens", () => {
      assertThrows(
        () => assertLocal(`import "file://${CACHE_DIR_TOKEN}/http-123.mjs";` as never),
        VeryfrontError,
      );
    });
  });

  describe("asBundleHash", () => {
    it("returns hash for numeric string", () => {
      const hash = asBundleHash("12345");
      assertEquals(String(hash), "12345");
    });

    it("throws for non-numeric hash", () => {
      assertThrows(
        () => asBundleHash("abc"),
        VeryfrontError,
      );
    });

    it("throws for empty string", () => {
      assertThrows(
        () => asBundleHash(""),
        VeryfrontError,
      );
    });

    it("throws for hash with letters", () => {
      assertThrows(
        () => asBundleHash("123abc"),
        VeryfrontError,
      );
    });
  });

  describe("asLocalModuleCode", () => {
    it("returns code that has no tokens", () => {
      const code = asLocalModuleCode("const x = 1;");
      assertEquals(String(code), "const x = 1;");
    });

    it("throws for code with portable tokens", () => {
      assertThrows(
        () => asLocalModuleCode(`file://${CACHE_DIR_TOKEN}/http-123.mjs`),
        VeryfrontError,
      );
    });
  });
});
