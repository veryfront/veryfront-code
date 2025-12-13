import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import {
  computeHash,
  getContentHash,
  computeContentHash,
  computeCodeHash,
  simpleHash,
  shortHash,
  type BundleCode,
} from "./hash-utils.ts";

describe("utils/hash-utils", () => {
  describe("computeHash", () => {
    it("should compute SHA-256 hash", async () => {
      const hash = await computeHash("test");
      assertEquals(typeof hash, "string");
      assertEquals(hash.length, 64); // SHA-256 produces 64 hex characters
    });

    it("should produce consistent hashes", async () => {
      const hash1 = await computeHash("test");
      const hash2 = await computeHash("test");
      assertEquals(hash1, hash2);
    });

    it("should produce different hashes for different content", async () => {
      const hash1 = await computeHash("test1");
      const hash2 = await computeHash("test2");
      assert(hash1 !== hash2);
    });

    it("should handle empty strings", async () => {
      const hash = await computeHash("");
      assertEquals(typeof hash, "string");
      assertEquals(hash.length, 64);
    });
  });

  describe("getContentHash", () => {
    it("should be an alias for computeHash", async () => {
      const content = "test content";
      const hash1 = await getContentHash(content);
      const hash2 = await computeHash(content);
      assertEquals(hash1, hash2);
    });
  });

  describe("computeContentHash", () => {
    it("should be an alias for computeHash", async () => {
      const content = "test content";
      const hash1 = await computeContentHash(content);
      const hash2 = await computeHash(content);
      assertEquals(hash1, hash2);
    });
  });

  describe("computeCodeHash", () => {
    it("should hash bundle code", async () => {
      const bundle: BundleCode = { code: "const x = 1;" };
      const hash = await computeCodeHash(bundle);
      assertEquals(typeof hash, "string");
      assertEquals(hash.length, 64);
    });

    it("should include CSS in hash", async () => {
      const bundle1: BundleCode = { code: "const x = 1;" };
      const bundle2: BundleCode = { code: "const x = 1;", css: ".class{}" };
      const hash1 = await computeCodeHash(bundle1);
      const hash2 = await computeCodeHash(bundle2);
      assert(hash1 !== hash2);
    });

    it("should include source map in hash", async () => {
      const bundle1: BundleCode = { code: "const x = 1;" };
      const bundle2: BundleCode = { code: "const x = 1;", sourceMap: "map" };
      const hash1 = await computeCodeHash(bundle1);
      const hash2 = await computeCodeHash(bundle2);
      assert(hash1 !== hash2);
    });

    it("should combine all parts", async () => {
      const bundle: BundleCode = {
        code: "const x = 1;",
        css: ".class{}",
        sourceMap: "map",
      };
      const hash = await computeCodeHash(bundle);
      assert(hash.length === 64);
    });
  });

  describe("simpleHash", () => {
    it("should return a number", () => {
      const hash = simpleHash("test");
      assertEquals(typeof hash, "number");
    });

    it("should return non-negative numbers", () => {
      const hash = simpleHash("test");
      assert(hash >= 0);
    });

    it("should produce consistent hashes", () => {
      const hash1 = simpleHash("test");
      const hash2 = simpleHash("test");
      assertEquals(hash1, hash2);
    });

    it("should produce different hashes for different strings", () => {
      const hash1 = simpleHash("test1");
      const hash2 = simpleHash("test2");
      assert(hash1 !== hash2);
    });

    it("should handle empty strings", () => {
      const hash = simpleHash("");
      assertEquals(typeof hash, "number");
      assertEquals(hash, 0);
    });

    it("should handle long strings", () => {
      const longString = "a".repeat(1000);
      const hash = simpleHash(longString);
      assert(hash > 0);
    });
  });

  describe("shortHash", () => {
    it("should return 8-character hash", async () => {
      const hash = await shortHash("test");
      assertEquals(hash.length, 8);
    });

    it("should be prefix of full hash", async () => {
      const content = "test";
      const full = await computeHash(content);
      const short = await shortHash(content);
      assertEquals(full.startsWith(short), true);
    });

    it("should produce consistent short hashes", async () => {
      const hash1 = await shortHash("test");
      const hash2 = await shortHash("test");
      assertEquals(hash1, hash2);
    });
  });

  describe("hash consistency", () => {
    it("should all hash functions agree on same content", async () => {
      const content = "test content";
      const hash1 = await computeHash(content);
      const hash2 = await getContentHash(content);
      const hash3 = await computeContentHash(content);
      assertEquals(hash1, hash2);
      assertEquals(hash2, hash3);
    });
  });
});
