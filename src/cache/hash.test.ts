import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  fastHash,
  getCacheKey,
  getCompoundCacheKey,
  getHttpBundleFilename,
  getVersionedCacheKey,
  hashString,
  hashToString,
  isCacheKey,
  parseCacheKey,
  parseHttpBundleFilename,
  sha256Hash,
  sha256Short,
} from "./hash.ts";

describe("cache/hash", () => {
  describe("fastHash", () => {
    it("should return a positive number", () => {
      const hash = fastHash("test");
      assertEquals(typeof hash, "number");
      assertEquals(hash >= 0, true);
    });

    it("should be consistent", () => {
      assertEquals(fastHash("hello"), fastHash("hello"));
    });

    it("should differ for different inputs", () => {
      assertNotEquals(fastHash("a"), fastHash("b"));
    });

    it("should handle empty string", () => {
      assertEquals(typeof fastHash(""), "number");
    });
  });

  describe("hashToString", () => {
    it("should return base36 string", () => {
      assertEquals(hashToString(12345), (12345).toString(36));
    });

    it("should handle zero", () => {
      assertEquals(hashToString(0), "0");
    });
  });

  describe("hashString", () => {
    it("should return a string", () => {
      assertEquals(typeof hashString("test"), "string");
    });

    it("should be consistent", () => {
      assertEquals(hashString("foo"), hashString("foo"));
    });
  });

  describe("getCacheKey", () => {
    it("should produce type:hash format", () => {
      assertEquals(getCacheKey("http", "https://esm.sh/react").startsWith("http:"), true);
    });

    it("should produce consistent keys", () => {
      assertEquals(
        getCacheKey("mod", "pages/index.tsx"),
        getCacheKey("mod", "pages/index.tsx"),
      );
    });

    it("should differ for different types with same input", () => {
      assertNotEquals(getCacheKey("http", "test"), getCacheKey("mod", "test"));
    });
  });

  describe("getVersionedCacheKey", () => {
    it("should produce type:vN:hash format", () => {
      assertEquals(
        getVersionedCacheKey("mod", 12, "pages/index.tsx").startsWith("mod:v12:"),
        true,
      );
    });

    it("should handle string version", () => {
      assertEquals(getVersionedCacheKey("mod", "19", "test").includes(":v19:"), true);
    });
  });

  describe("getCompoundCacheKey", () => {
    it("should combine multiple components", () => {
      assertEquals(
        getCompoundCacheKey("mod", ["projectId", "filePath", "hash"]).startsWith("mod:"),
        true,
      );
    });

    it("should differ for different component order", () => {
      assertNotEquals(
        getCompoundCacheKey("mod", ["a", "b"]),
        getCompoundCacheKey("mod", ["b", "a"]),
      );
    });
  });

  describe("parseCacheKey", () => {
    it("should parse simple type:hash key", () => {
      const result = parseCacheKey("http:abc123");
      assertEquals(result?.type, "http");
      assertEquals(result?.hash, "abc123");
      assertEquals(result?.version, undefined);
    });

    it("should parse versioned key", () => {
      const result = parseCacheKey("mod:v12:abc123");
      assertEquals(result?.type, "mod");
      assertEquals(result?.version, "12");
      assertEquals(result?.hash, "abc123");
    });

    it("should return null for invalid key", () => {
      assertEquals(parseCacheKey("nocolon"), null);
    });

    it("should handle keys with multiple colons", () => {
      const result = parseCacheKey("mod:abc:def:ghi");
      assertEquals(result?.type, "mod");
      assertEquals(result?.hash, "abc:def:ghi");
    });
  });

  describe("sha256Hash", () => {
    it("should return 64 character hex string", async () => {
      const hash = await sha256Hash("hello");
      assertEquals(hash.length, 64);
      assertEquals(/^[0-9a-f]+$/.test(hash), true);
    });

    it("should be consistent", async () => {
      assertEquals(await sha256Hash("test"), await sha256Hash("test"));
    });
  });

  describe("sha256Short", () => {
    it("should return 8 character string", async () => {
      assertEquals((await sha256Short("hello")).length, 8);
    });

    it("should be prefix of full hash", async () => {
      const full = await sha256Hash("test");
      assertEquals(await sha256Short("test"), full.slice(0, 8));
    });
  });

  describe("getHttpBundleFilename", () => {
    it("should return http-{hash}.mjs format", () => {
      const filename = getHttpBundleFilename("https://esm.sh/react@19");
      assertEquals(filename.startsWith("http-"), true);
      assertEquals(filename.endsWith(".mjs"), true);
    });

    it("should be consistent", () => {
      assertEquals(
        getHttpBundleFilename("https://esm.sh/react"),
        getHttpBundleFilename("https://esm.sh/react"),
      );
    });
  });

  describe("parseHttpBundleFilename", () => {
    it("should extract hash from valid filename", () => {
      assertEquals(parseHttpBundleFilename("http-12345.mjs"), "12345");
    });

    it("should return null for invalid filename", () => {
      assertEquals(parseHttpBundleFilename("module.js"), null);
    });

    it("should return null for non-numeric hash", () => {
      assertEquals(parseHttpBundleFilename("http-abcdef.mjs"), null);
    });
  });

  describe("isCacheKey", () => {
    it("should return true for valid cache keys", () => {
      assertEquals(isCacheKey("http:abc123"), true);
      assertEquals(isCacheKey("mod:xyz789"), true);
    });

    it("should return false for non-cache-key strings", () => {
      assertEquals(isCacheKey("not-a-key"), false);
      assertEquals(isCacheKey(""), false);
      assertEquals(isCacheKey("/path/to/file"), false);
    });
  });
});
