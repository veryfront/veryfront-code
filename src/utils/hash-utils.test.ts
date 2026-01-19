import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  computeCodeHash,
  computeContentHash,
  computeHash,
  getContentHash,
  shortHash,
  simpleHash,
} from "./hash-utils.ts";

describe("hash-utils", () => {
  describe("computeHash", () => {
    it("should compute SHA-256 hash of content", async () => {
      const hash = await computeHash("hello world");
      // SHA-256 produces 64 hex characters
      assertEquals(hash.length, 64);
      assertEquals(/^[0-9a-f]+$/.test(hash), true);
    });

    it("should produce consistent hashes for same input", async () => {
      const hash1 = await computeHash("test content");
      const hash2 = await computeHash("test content");
      assertEquals(hash1, hash2);
    });

    it("should produce different hashes for different input", async () => {
      const hash1 = await computeHash("content a");
      const hash2 = await computeHash("content b");
      assertNotEquals(hash1, hash2);
    });

    it("should handle empty string", async () => {
      const hash = await computeHash("");
      assertEquals(hash.length, 64);
    });

    it("should handle unicode content", async () => {
      const hash = await computeHash("こんにちは世界");
      assertEquals(hash.length, 64);
    });
  });

  describe("getContentHash (deprecated alias)", () => {
    it("should be an alias for computeHash", async () => {
      const hash1 = await computeHash("test");
      const hash2 = await getContentHash("test");
      assertEquals(hash1, hash2);
    });
  });

  describe("computeContentHash (deprecated alias)", () => {
    it("should be an alias for computeHash", async () => {
      const hash1 = await computeHash("test");
      const hash2 = await computeContentHash("test");
      assertEquals(hash1, hash2);
    });
  });

  describe("computeCodeHash", () => {
    it("should hash code only", async () => {
      const hash = await computeCodeHash({ code: "const x = 1;" });
      assertEquals(hash.length, 64);
    });

    it("should include css in hash when provided", async () => {
      const hashWithoutCss = await computeCodeHash({ code: "const x = 1;" });
      const hashWithCss = await computeCodeHash({
        code: "const x = 1;",
        css: ".foo { color: red; }",
      });
      assertNotEquals(hashWithoutCss, hashWithCss);
    });

    it("should include sourceMap in hash when provided", async () => {
      const hashWithoutMap = await computeCodeHash({ code: "const x = 1;" });
      const hashWithMap = await computeCodeHash({
        code: "const x = 1;",
        sourceMap: "//# sourceMappingURL=...",
      });
      assertNotEquals(hashWithoutMap, hashWithMap);
    });

    it("should produce consistent hash for same bundle", async () => {
      const bundle = {
        code: "const x = 1;",
        css: ".foo {}",
        sourceMap: "map",
      };
      const hash1 = await computeCodeHash(bundle);
      const hash2 = await computeCodeHash(bundle);
      assertEquals(hash1, hash2);
    });
  });

  describe("simpleHash", () => {
    it("should produce a number", () => {
      const hash = simpleHash("test");
      assertEquals(typeof hash, "number");
    });

    it("should produce non-negative numbers", () => {
      const hash1 = simpleHash("test");
      const hash2 = simpleHash("another string");
      const hash3 = simpleHash("negative test");
      assertEquals(hash1 >= 0, true);
      assertEquals(hash2 >= 0, true);
      assertEquals(hash3 >= 0, true);
    });

    it("should produce consistent hashes", () => {
      const hash1 = simpleHash("consistent");
      const hash2 = simpleHash("consistent");
      assertEquals(hash1, hash2);
    });

    it("should produce different hashes for different strings", () => {
      const hash1 = simpleHash("string a");
      const hash2 = simpleHash("string b");
      assertNotEquals(hash1, hash2);
    });

    it("should handle empty string", () => {
      const hash = simpleHash("");
      assertEquals(hash, 0);
    });
  });

  describe("shortHash", () => {
    it("should return first 8 characters of full hash", async () => {
      const full = await computeHash("test content");
      const short = await shortHash("test content");
      assertEquals(short.length, 8);
      assertEquals(short, full.slice(0, 8));
    });

    it("should produce consistent short hashes", async () => {
      const hash1 = await shortHash("hello");
      const hash2 = await shortHash("hello");
      assertEquals(hash1, hash2);
    });

    it("should be different for different content", async () => {
      const hash1 = await shortHash("content 1");
      const hash2 = await shortHash("content 2");
      assertNotEquals(hash1, hash2);
    });
  });
});
