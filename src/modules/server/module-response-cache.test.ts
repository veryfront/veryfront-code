import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import {
  __setReleaseModuleResponseDistributedCacheForTests,
  clearReleaseModuleResponseCache,
  getReleaseModuleResponse,
  type ReleaseModuleResponseCacheEntry,
  rememberReleaseModuleResponse,
} from "./module-response-cache.ts";

class FakeDistributedCache implements CacheBackend {
  readonly type = "redis" as const;
  readonly values = new Map<string, string>();
  readonly ttlSeconds = new Map<string, number | undefined>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.values.set(key, value);
    this.ttlSeconds.set(key, ttlSeconds);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.values.delete(key);
    this.ttlSeconds.delete(key);
    return Promise.resolve();
  }
}

describe("release module response cache", () => {
  afterEach(() => {
    __setReleaseModuleResponseDistributedCacheForTests(undefined);
    clearReleaseModuleResponseCache();
  });

  it("recovers release module responses from distributed cache when local cache is empty", async () => {
    const distributedCache = new FakeDistributedCache();
    __setReleaseModuleResponseDistributedCacheForTests(distributedCache);

    const cacheKey = "release-module-response:test";
    const entry: ReleaseModuleResponseCacheEntry = {
      body: "export const value = 1;\n",
      status: 200,
      headers: [["cache-control", "public, max-age=31536000, immutable"]],
    };

    await rememberReleaseModuleResponse(cacheKey, entry);
    clearReleaseModuleResponseCache();

    const recovered = await getReleaseModuleResponse(cacheKey);

    assertEquals(recovered?.source, "distributed");
    assertEquals(recovered?.entry, entry);
    assertEquals(typeof distributedCache.ttlSeconds.get(cacheKey), "number");
  });

  it("does not use disk cache backends for release module responses", async () => {
    const diskCache = new FakeDistributedCache();
    Object.defineProperty(diskCache, "type", { value: "disk" });
    __setReleaseModuleResponseDistributedCacheForTests(diskCache);

    const cacheKey = "release-module-response:disk";
    const entry: ReleaseModuleResponseCacheEntry = {
      body: "export const value = 1;\n",
      status: 200,
      headers: [["cache-control", "public, max-age=31536000, immutable"]],
    };

    await rememberReleaseModuleResponse(cacheKey, entry);
    clearReleaseModuleResponseCache();

    const recovered = await getReleaseModuleResponse(cacheKey);

    assertEquals(recovered, undefined);
    assertEquals(diskCache.values.size, 0);
  });
});
