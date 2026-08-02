import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { type CacheBackend, CacheBackends } from "#veryfront/cache/backend.ts";
import { SSRCacheManager } from "../ssr-cache-manager.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

const API_CACHE_KEY_MAX_LENGTH = 512;
const SSR_MODULE_CACHE_PREFIX = "ssr-module";
const CANONICAL_PIN_KEY = "on:z7bg3qnfgtcb";

describe("SSR distributed cache keys", () => {
  it("bounds long read and write keys with the same full SHA-256 identity", async () => {
    const readKeys: string[] = [];
    const writeKeys: string[] = [];
    const backend: CacheBackend = {
      type: "api",
      get(key) {
        readKeys.push(key);
        return Promise.resolve(null);
      },
      set(key) {
        writeKeys.push(key);
        return Promise.resolve();
      },
      del() {
        return Promise.resolve();
      },
    };
    const originalSSRModuleBackend = CacheBackends.ssrModule;
    CacheBackends.ssrModule = () => Promise.resolve(backend);

    try {
      const redis = await import("./redis.ts?bounded-key-test");
      const hostLabel = "a".repeat(50);
      const moduleServerOrigin = `https://${
        [hostLabel, hostLabel, hostLabel, hostLabel].join(".")
      }.example.test`;
      const manager = new SSRCacheManager({
        projectDir: "/project",
        projectId: "project-id",
        contentSourceId: "preview-main",
        adapter: denoAdapter,
        dev: true,
        reactVersion: "19.1.1",
        dependencyPinningCacheKey: CANONICAL_PIN_KEY,
        moduleServerOrigin,
      });
      const rawKey = manager.getCacheKey(
        `/project/${"nested/".repeat(90)}page.tsx:content-hash`,
      );
      const fullyPrefixedRawKey = `${SSR_MODULE_CACHE_PREFIX}:${rawKey}`;
      const unsafeRawKey = manager.getCacheKey(
        "/project/app/(marketing)/[slug].tsx:content-hash",
      );
      const fullyPrefixedUnsafeKey = `${SSR_MODULE_CACHE_PREFIX}:${unsafeRawKey}`;

      assertEquals(fullyPrefixedRawKey.length > API_CACHE_KEY_MAX_LENGTH, true);
      assertEquals(fullyPrefixedUnsafeKey.length <= API_CACHE_KEY_MAX_LENGTH, true);

      await redis.getFromRedis(rawKey);
      await redis.setInRedis(rawKey, "export default 1;");
      await redis.getFromRedis(unsafeRawKey);
      await redis.setInRedis(unsafeRawKey, "export default 1;");
      await redis.getFromRedis("short-key");
      await redis.setInRedis("short-key", "export default 1;");

      const expectedLongKey = `sha256:${await computeHash(fullyPrefixedRawKey)}`;
      const expectedUnsafeKey = `sha256:${await computeHash(fullyPrefixedUnsafeKey)}`;
      assertEquals(readKeys, [expectedLongKey, expectedUnsafeKey, "short-key"]);
      assertEquals(writeKeys, [expectedLongKey, expectedUnsafeKey, "short-key"]);
      assertEquals(
        `${SSR_MODULE_CACHE_PREFIX}:${expectedLongKey}`.length <= API_CACHE_KEY_MAX_LENGTH,
        true,
      );
    } finally {
      CacheBackends.ssrModule = originalSSRModuleBackend;
    }
  });
});

describe("SSR distributed cache availability", () => {
  it("reports disabled until initialization selects a backend", async () => {
    const redis = await import("./redis.ts?uninitialized-availability-test");
    assertEquals(redis.isSSRDistributedCacheEnabled(), false);
  });

  it("reports disabled when initialization finds no distributed backend", async () => {
    const originalSSRModuleBackend = CacheBackends.ssrModule;
    CacheBackends.ssrModule =
      (() => Promise.resolve(null)) as unknown as typeof CacheBackends.ssrModule;

    try {
      const redis = await import("./redis.ts?absent-backend-availability-test");
      assertEquals(await redis.initializeSSRDistributedCache(), false);
      assertEquals(redis.isSSRDistributedCacheEnabled(), false);
    } finally {
      CacheBackends.ssrModule = originalSSRModuleBackend;
    }
  });

  it("reports enabled once initialization resolves a backend", async () => {
    const backend: CacheBackend = {
      type: "api",
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      del: () => Promise.resolve(),
    };
    const originalSSRModuleBackend = CacheBackends.ssrModule;
    CacheBackends.ssrModule = () => Promise.resolve(backend);

    try {
      const redis = await import("./redis.ts?present-backend-availability-test");
      assertEquals(redis.isSSRDistributedCacheEnabled(), false);
      assertEquals(await redis.initializeSSRDistributedCache(), true);
      assertEquals(redis.isSSRDistributedCacheEnabled(), true);
    } finally {
      CacheBackends.ssrModule = originalSSRModuleBackend;
    }
  });
});
