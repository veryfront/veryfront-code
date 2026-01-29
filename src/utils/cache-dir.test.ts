import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getCacheBaseDir,
  getCacheDirFromContext,
  getHttpBundleCacheDir,
  getMdxEsmCacheDir,
  runWithCacheDir,
} from "./cache-dir.ts";

describe("cache-dir", () => {
  describe("getCacheDirFromContext", () => {
    it("should return undefined when not in a context", () => {
      const result = getCacheDirFromContext();
      assertEquals(result, undefined);
    });
  });

  describe("runWithCacheDir", () => {
    it("should make cache dir available within the callback", () => {
      const result = runWithCacheDir("/tmp/test-cache", () => {
        return getCacheDirFromContext();
      });
      assertEquals(result, "/tmp/test-cache");
    });

    it("should restore undefined context after callback completes", () => {
      runWithCacheDir("/tmp/test-cache", () => {});
      const result = getCacheDirFromContext();
      assertEquals(result, undefined);
    });

    it("should return the callback result", () => {
      const result = runWithCacheDir("/tmp/test-cache", () => 42);
      assertEquals(result, 42);
    });

    it("should support nested contexts", () => {
      runWithCacheDir("/tmp/outer", () => {
        assertEquals(getCacheDirFromContext(), "/tmp/outer");
        runWithCacheDir("/tmp/inner", () => {
          assertEquals(getCacheDirFromContext(), "/tmp/inner");
        });
        assertEquals(getCacheDirFromContext(), "/tmp/outer");
      });
    });
  });

  describe("getCacheBaseDir", () => {
    it("should return context cache dir when in a context", () => {
      const result = runWithCacheDir("/tmp/context-cache", () => {
        return getCacheBaseDir();
      });
      assertEquals(result, "/tmp/context-cache");
    });

    it("should return a string ending with .cache when not in context and no env", () => {
      const result = getCacheBaseDir();
      assertEquals(typeof result, "string");
      assert(result.length > 0);
    });
  });

  describe("getMdxEsmCacheDir", () => {
    it("should return path ending with veryfront-mdx-esm", () => {
      const result = runWithCacheDir("/tmp/test", () => {
        return getMdxEsmCacheDir();
      });
      assert(result.endsWith("veryfront-mdx-esm"));
      assert(result.startsWith("/tmp/test"));
    });
  });

  describe("getHttpBundleCacheDir", () => {
    it("should return path ending with veryfront-http-bundle", () => {
      const result = runWithCacheDir("/tmp/test", () => {
        return getHttpBundleCacheDir();
      });
      assert(result.endsWith("veryfront-http-bundle"));
      assert(result.startsWith("/tmp/test"));
    });
  });
});
