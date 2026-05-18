import "#veryfront/schemas/_test-setup.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  getCacheBaseDir,
  getCacheDirFromContext,
  getHttpBundleCacheDir,
  getMdxEsmCacheDir,
  runWithCacheDir,
} from "./cache-dir.ts";

const MANAGED_ENV_KEYS = [
  "HOME",
  "NODE_ENV",
  "VERYFRONT_CACHE_DIR",
  "VERYFRONT_MODE",
  "VF_CACHE_DIR",
];

const originalEnv = new Map<string, string | undefined>(
  MANAGED_ENV_KEYS.map((key) => [key, getEnv(key)]),
);

function restoreManagedEnv(): void {
  for (const [key, value] of originalEnv) {
    if (value === undefined) {
      deleteEnv(key);
    } else {
      setEnv(key, value);
    }
  }
}

describe("cache-dir", () => {
  afterEach(() => {
    restoreManagedEnv();
  });

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

    it("should prefer context cache dir over explicit env", () => {
      setEnv("VERYFRONT_CACHE_DIR", "/tmp/env-cache");
      setEnv("NODE_ENV", "production");
      setEnv("HOME", "/tmp/home");

      const result = runWithCacheDir("/tmp/context-cache", getCacheBaseDir);

      assertEquals(result, "/tmp/context-cache");
    });

    it("should prefer VERYFRONT_CACHE_DIR over production default", () => {
      setEnv("VERYFRONT_CACHE_DIR", "/tmp/env-cache");
      setEnv("NODE_ENV", "production");
      setEnv("HOME", "/tmp/home");

      assertEquals(getCacheBaseDir(), "/tmp/env-cache");
    });

    it("should prefer VF_CACHE_DIR over production default", () => {
      deleteEnv("VERYFRONT_CACHE_DIR");
      setEnv("VF_CACHE_DIR", "/tmp/vf-cache");
      setEnv("NODE_ENV", "production");
      setEnv("HOME", "/tmp/home");

      assertEquals(getCacheBaseDir(), "/tmp/vf-cache");
    });

    it("should use a writable home cache in production", () => {
      deleteEnv("VERYFRONT_CACHE_DIR");
      deleteEnv("VF_CACHE_DIR");
      setEnv("NODE_ENV", "production");
      setEnv("VERYFRONT_MODE", "production");
      setEnv("HOME", "/tmp");

      assertEquals(getCacheBaseDir(), "/tmp/.cache/veryfront");
    });

    it("should return the local .cache dir when not in production and no env", () => {
      deleteEnv("NODE_ENV");
      deleteEnv("VERYFRONT_MODE");
      deleteEnv("VERYFRONT_CACHE_DIR");
      deleteEnv("VF_CACHE_DIR");

      const result = getCacheBaseDir();
      assertEquals(typeof result, "string");
      assert(result.length > 0);
      assert(result.endsWith(".cache"));
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
