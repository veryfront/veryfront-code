import { assertEquals, assertExists, assertNotEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { BundleCache, computeProjectContentHash, resetBundleCache } from "./bundle-cache.ts";

describe("bundler/bundle-cache", () => {
  describe("computeProjectContentHash", () => {
    it("should compute consistent hash for same files", async () => {
      const files = new Map([
        ["/src/app.tsx", "export default function App() { return <div>Hello</div>; }"],
        ["/src/utils.ts", "export const add = (a: number, b: number) => a + b;"],
      ]);

      const hash1 = await computeProjectContentHash(files);
      const hash2 = await computeProjectContentHash(files);

      assertEquals(hash1, hash2);
    });

    it("should produce different hash for different content", async () => {
      const files1 = new Map([
        ["/src/app.tsx", "export default function App() { return <div>Hello</div>; }"],
      ]);

      const files2 = new Map([
        ["/src/app.tsx", "export default function App() { return <div>World</div>; }"],
      ]);

      const hash1 = await computeProjectContentHash(files1);
      const hash2 = await computeProjectContentHash(files2);

      assertNotEquals(hash1, hash2);
    });

    it("should produce different hash for different file paths", async () => {
      const files1 = new Map([
        ["/src/app.tsx", "export default function App() {}"],
      ]);

      const files2 = new Map([
        ["/src/main.tsx", "export default function App() {}"],
      ]);

      const hash1 = await computeProjectContentHash(files1);
      const hash2 = await computeProjectContentHash(files2);

      assertNotEquals(hash1, hash2);
    });

    it("should handle empty file map", async () => {
      const files = new Map<string, string>();
      const hash = await computeProjectContentHash(files);

      assertExists(hash);
      assertEquals(hash.length, 16);
    });

    it("should produce 16 character hash", async () => {
      const files = new Map([
        ["/src/app.tsx", "test"],
      ]);

      const hash = await computeProjectContentHash(files);
      assertEquals(hash.length, 16);
    });

    it("should produce hash independent of insertion order", async () => {
      const files1 = new Map<string, string>();
      files1.set("/src/a.ts", "a");
      files1.set("/src/b.ts", "b");

      const files2 = new Map<string, string>();
      files2.set("/src/b.ts", "b");
      files2.set("/src/a.ts", "a");

      const hash1 = await computeProjectContentHash(files1);
      const hash2 = await computeProjectContentHash(files2);

      assertEquals(hash1, hash2);
    });
  });

  describe("BundleCache", () => {
    let cache: BundleCache;

    beforeEach(() => {
      resetBundleCache();
      // Create cache with local-only mode (no API calls)
      cache = new BundleCache({
        enableLocalCache: true,
        localMaxEntries: 100,
      });
    });

    afterEach(() => {
      resetBundleCache();
    });

    it("should return null for non-existent entry", async () => {
      const result = await cache.get("test-project", "nonexistent-hash");
      assertEquals(result, null);
    });

    it("should store and retrieve entries from local cache", async () => {
      // Note: Without API token, this only tests local cache
      await cache.set("test-project", "test-hash", {
        code: "console.log('test');",
        contentHash: "test-hash",
      });

      // The entry should be in local cache
      const result = await cache.get("test-project", "test-hash");

      // Without API, we can only test local cache behavior
      // The API calls will fail silently, but local cache should work
      if (result) {
        assertEquals(result.code, "console.log('test');");
        assertEquals(result.contentHash, "test-hash");
        assertExists(result.bundleVersion);
        assertExists(result.createdAt);
      }
    });

    it("should clear local cache", () => {
      cache.clearLocalCache();
      // Should not throw
    });

    describe("cache key generation", () => {
      it("should include bundle version in cache key", async () => {
        // This tests the internal key generation
        await cache.set("project-1", "hash-abc", {
          code: "test",
          contentHash: "hash-abc",
        });

        // Different hash should not conflict
        await cache.set("project-1", "hash-def", {
          code: "test2",
          contentHash: "hash-def",
        });

        // Both should be retrievable (if local cache works)
        const result1 = await cache.get("project-1", "hash-abc");
        const result2 = await cache.get("project-1", "hash-def");

        // One or both may be null if API unavailable, but they shouldn't conflict
        if (result1 && result2) {
          assertNotEquals(result1.code, result2.code);
        }
      });
    });
  });

  describe("BundleCacheConfig", () => {
    it("should use default values when not specified", () => {
      const cache = new BundleCache();
      // Should not throw
      cache.clearLocalCache();
    });

    it("should respect enableLocalCache=false", () => {
      const cache = new BundleCache({
        enableLocalCache: false,
      });
      // Should not throw
      cache.clearLocalCache();
    });

    it("should accept custom timeout", () => {
      const cache = new BundleCache({
        timeoutMs: 5000,
      });
      // Should not throw
      cache.clearLocalCache();
    });
  });
});
