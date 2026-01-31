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
      assertEquals(getCacheDirFromContext(), undefined);
    });
  });

  describe("runWithCacheDir", () => {
    it("should make cache dir available within the callback", () => {
      const result = runWithCacheDir("/tmp/test-cache", getCacheDirFromContext);
      assertEquals(result, "/tmp/test-cache");
    });

    it("should restore undefined context after callback completes", () => {
      runWithCacheDir("/tmp/test-cache", () => {});
      assertEquals(getCacheDirFromContext(), undefined);
    });

    it("should return the callback result", () => {
      assertEquals(runWithCacheDir("/tmp/test-cache", () => 42), 42);
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
      const result = runWithCacheDir("/tmp/context-cache", getCacheBaseDir);
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
      const result = runWithCacheDir("/tmp/test", getMdxEsmCacheDir);
      assert(result.startsWith("/tmp/test"));
      assert(result.endsWith("veryfront-mdx-esm"));
    });
  });

  describe("getHttpBundleCacheDir", () => {
    it("should return path ending with veryfront-http-bundle", () => {
      const result = runWithCacheDir("/tmp/test", getHttpBundleCacheDir);
      assert(result.startsWith("/tmp/test"));
      assert(result.endsWith("veryfront-http-bundle"));
    });
  });
});
