import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getTransformCacheKey, getVersionedPathCacheKey } from "./cache-keys.ts";
import { MDX_ESM_CACHE_NAMESPACE } from "../cache-format.ts";

describe("transforms/mdx/esm-module-loader/module-fetcher/cache-keys", () => {
  describe("getTransformCacheKey", () => {
    it("uses a namespaced full digest and ssr suffix", () => {
      const key = getTransformCacheKey("proj1", "preview-main", "19.1.1", "lib/utils.ts", "abc123");
      assertEquals(
        new RegExp(`^${MDX_ESM_CACHE_NAMESPACE}:transform:[a-f0-9]{64}:ssr$`).test(key),
        true,
      );
    });

    it("always ends with :ssr", () => {
      const key = getTransformCacheKey("p", "preview-main", "19.1.1", "/path", "h");
      assertEquals(key.endsWith(":ssr"), true);
    });

    it("handles empty strings", () => {
      const key = getTransformCacheKey("", "", "", "", "");
      assertEquals(key.startsWith(`${MDX_ESM_CACHE_NAMESPACE}:transform:`), true);
      assertEquals(key.endsWith(":ssr"), true);
    });

    it("frames special characters in path deterministically", () => {
      const key = getTransformCacheKey(
        "proj",
        "preview-main",
        "19.1.1",
        "@/components/Button.tsx",
        "def456",
      );
      assertEquals(
        key,
        getTransformCacheKey(
          "proj",
          "preview-main",
          "19.1.1",
          "@/components/Button.tsx",
          "def456",
        ),
      );
    });

    it("isolates by content source", () => {
      const previewKey = getTransformCacheKey(
        "proj",
        "preview-main",
        "19.1.1",
        "lib/utils.ts",
        "abc123",
      );
      const releaseKey = getTransformCacheKey(
        "proj",
        "release-42",
        "19.1.1",
        "lib/utils.ts",
        "abc123",
      );
      assertEquals(previewKey === releaseKey, false);
    });

    it("isolates by react version", () => {
      const react18Key = getTransformCacheKey(
        "proj",
        "preview-main",
        "18.3.1",
        "lib/utils.ts",
        "abc123",
      );
      const react19Key = getTransformCacheKey(
        "proj",
        "preview-main",
        "19.1.1",
        "lib/utils.ts",
        "abc123",
      );
      assertEquals(react18Key === react19Key, false);
    });
  });

  describe("getVersionedPathCacheKey", () => {
    it("includes cache namespace, react version, and path", () => {
      const key = getVersionedPathCacheKey("lib/utils.ts", "19.1.1");
      assertEquals(key, `${MDX_ESM_CACHE_NAMESPACE}:path:["19.1.1","lib/utils.ts",null]`);
    });

    it("handles empty path", () => {
      const key = getVersionedPathCacheKey("", "19.1.1");
      assertEquals(key, `${MDX_ESM_CACHE_NAMESPACE}:path:["19.1.1","",null]`);
    });

    it("starts with cache namespace prefix", () => {
      const key = getVersionedPathCacheKey("any/path", "19.1.1");
      assertEquals(key.startsWith(`${MDX_ESM_CACHE_NAMESPACE}:`), true);
    });

    it("isolates by react version", () => {
      const react18Key = getVersionedPathCacheKey("lib/utils.ts", "18.3.1");
      const react19Key = getVersionedPathCacheKey("lib/utils.ts", "19.1.1");
      assertEquals(react18Key === react19Key, false);
    });

    it("isolates by full source-content digest", () => {
      const first = getVersionedPathCacheKey("lib/utils.ts", "19.1.1", "a".repeat(64));
      const second = getVersionedPathCacheKey("lib/utils.ts", "19.1.1", "b".repeat(64));
      assertEquals(first === second, false);
    });
  });
});
