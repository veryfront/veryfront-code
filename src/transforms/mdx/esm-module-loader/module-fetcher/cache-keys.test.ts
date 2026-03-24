import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getTransformCacheKey, getVersionedPathCacheKey } from "./cache-keys.ts";
import { MDX_ESM_CACHE_NAMESPACE } from "../cache-format.ts";

describe("transforms/mdx/esm-module-loader/module-fetcher/cache-keys", () => {
  describe("getTransformCacheKey", () => {
    it("includes cache namespace, projectId, content source, path, hash, and ssr suffix", () => {
      const key = getTransformCacheKey("proj1", "preview-main", "lib/utils.ts", "abc123");
      assertEquals(
        key,
        `${MDX_ESM_CACHE_NAMESPACE}:proj1:preview-main:lib/utils.ts:abc123:ssr`,
      );
    });

    it("always ends with :ssr", () => {
      const key = getTransformCacheKey("p", "preview-main", "/path", "h");
      assertEquals(key.endsWith(":ssr"), true);
    });

    it("handles empty strings", () => {
      const key = getTransformCacheKey("", "", "", "");
      assertEquals(key, `${MDX_ESM_CACHE_NAMESPACE}:::::ssr`);
    });

    it("preserves special characters in path", () => {
      const key = getTransformCacheKey("proj", "preview-main", "@/components/Button.tsx", "def456");
      assertEquals(key.includes("@/components/Button.tsx"), true);
    });

    it("isolates by content source", () => {
      const previewKey = getTransformCacheKey("proj", "preview-main", "lib/utils.ts", "abc123");
      const releaseKey = getTransformCacheKey("proj", "release-42", "lib/utils.ts", "abc123");
      assertEquals(previewKey === releaseKey, false);
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
