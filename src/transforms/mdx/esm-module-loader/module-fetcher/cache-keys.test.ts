import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getTransformCacheKey, getVersionedPathCacheKey } from "./cache-keys.ts";
import { MDX_ESM_CACHE_NAMESPACE } from "../cache-format.ts";

describe("transforms/mdx/esm-module-loader/module-fetcher/cache-keys", () => {
  describe("getTransformCacheKey", () => {
    it("includes cache namespace, projectId, path, hash, and ssr suffix", () => {
      const key = getTransformCacheKey("proj1", "lib/utils.ts", "abc123");
      assertEquals(key, `${MDX_ESM_CACHE_NAMESPACE}:proj1:lib/utils.ts:abc123:ssr`);
    });

    it("always ends with :ssr", () => {
      const key = getTransformCacheKey("p", "/path", "h");
      assertEquals(key.endsWith(":ssr"), true);
    });

    it("handles empty strings", () => {
      const key = getTransformCacheKey("", "", "");
      assertEquals(key, `${MDX_ESM_CACHE_NAMESPACE}::::ssr`);
    });

    it("preserves special characters in path", () => {
      const key = getTransformCacheKey("proj", "@/components/Button.tsx", "def456");
      assertEquals(key.includes("@/components/Button.tsx"), true);
    });
  });

  describe("getVersionedPathCacheKey", () => {
    it("includes cache namespace and path", () => {
      const key = getVersionedPathCacheKey("lib/utils.ts");
      assertEquals(key, `${MDX_ESM_CACHE_NAMESPACE}:lib/utils.ts`);
    });

    it("handles empty path", () => {
      const key = getVersionedPathCacheKey("");
      assertEquals(key, `${MDX_ESM_CACHE_NAMESPACE}:`);
    });

    it("starts with cache namespace prefix", () => {
      const key = getVersionedPathCacheKey("any/path");
      assertEquals(key.startsWith(`${MDX_ESM_CACHE_NAMESPACE}:`), true);
    });
  });
});
