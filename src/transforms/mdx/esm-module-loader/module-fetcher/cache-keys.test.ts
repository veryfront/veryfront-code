import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getTransformCacheKey, getVersionedPathCacheKey } from "./cache-keys.ts";
import { VERSION } from "#veryfront/utils/version.ts";

describe("transforms/mdx/esm-module-loader/module-fetcher/cache-keys", () => {
  describe("getTransformCacheKey", () => {
    it("includes version, projectId, path, hash, and ssr suffix", () => {
      const key = getTransformCacheKey("proj1", "lib/utils.ts", "abc123");
      assertEquals(key, `v${VERSION}:proj1:lib/utils.ts:abc123:ssr`);
    });

    it("always ends with :ssr", () => {
      const key = getTransformCacheKey("p", "/path", "h");
      assertEquals(key.endsWith(":ssr"), true);
    });

    it("handles empty strings", () => {
      const key = getTransformCacheKey("", "", "");
      assertEquals(key, `v${VERSION}::::ssr`);
    });

    it("preserves special characters in path", () => {
      const key = getTransformCacheKey("proj", "@/components/Button.tsx", "def456");
      assertEquals(key.includes("@/components/Button.tsx"), true);
    });
  });

  describe("getVersionedPathCacheKey", () => {
    it("includes version and path", () => {
      const key = getVersionedPathCacheKey("lib/utils.ts");
      assertEquals(key, `v${VERSION}:lib/utils.ts`);
    });

    it("handles empty path", () => {
      const key = getVersionedPathCacheKey("");
      assertEquals(key, `v${VERSION}:`);
    });

    it("starts with version prefix", () => {
      const key = getVersionedPathCacheKey("any/path");
      assertEquals(key.startsWith(`v${VERSION}:`), true);
    });
  });
});
