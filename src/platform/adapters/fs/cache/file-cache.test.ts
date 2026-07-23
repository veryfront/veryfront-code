import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  FileCache,
  initializeFileCacheBackend,
  isFileCacheDistributedEnabled,
} from "./file-cache.ts";
import { type CacheBackend, CacheBackends, MemoryCacheBackend } from "#veryfront/cache/backend.ts";

type FileCacheModule = typeof import("./file-cache.ts");

function createDistributedBackend(): CacheBackend {
  return {
    type: "redis",
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
    del: () => Promise.resolve(),
  };
}

async function importFreshFileCacheModule(label: string): Promise<FileCacheModule> {
  return await import(
    new URL(`./file-cache.ts?${label}-${crypto.randomUUID()}`, import.meta.url).href
  ) as FileCacheModule;
}

describe("FileCache", () => {
  let cache: FileCache;

  beforeEach((): void => {
    cache = new FileCache();
  });

  afterEach((): void => {
    cache.clear();
  });

  describe("class instantiation", () => {
    it("should be instantiable with default options", () => {
      assertExists(new FileCache());
    });

    it("should be instantiable with custom options", () => {
      assertExists(
        new FileCache({
          enabled: true,
          ttl: 30000,
          maxSize: 500,
          maxMemory: 50 * 1024 * 1024,
        }),
      );
    });

    it("rejects limits that can make eviction non-terminating or expiry invalid", () => {
      for (
        const options of [
          { maxSize: 0 },
          { maxMemory: 0 },
          { ttl: 0 },
          { ttl: Number.NaN },
        ]
      ) {
        assertThrows(() => new FileCache(options), RangeError);
      }
    });
  });

  describe("get/set", () => {
    it("should set and get a value", () => {
      cache.set("key1", "value1");
      assertEquals(cache.get("key1"), "value1");
    });

    it("should return undefined for non-existent key", () => {
      assertEquals(cache.get("non-existent"), undefined);
    });

    it("should handle object values", () => {
      const obj = { foo: "bar", num: 123 };
      cache.set("obj-key", obj);
      assertEquals(cache.get("obj-key"), obj);
    });

    it("should handle Uint8Array values", () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      cache.set("bytes-key", bytes);
      assertEquals(cache.get("bytes-key"), bytes);
    });
  });

  describe("has", () => {
    it("should return true for existing key", () => {
      cache.set("key1", "value1");
      assertEquals(cache.has("key1"), true);
    });

    it("should return false for non-existent key", () => {
      assertEquals(cache.has("non-existent"), false);
    });
  });

  describe("delete", () => {
    it("should delete existing key", () => {
      cache.set("key1", "value1");
      assertEquals(cache.delete("key1"), true);
      assertEquals(cache.has("key1"), false);
    });

    it("should return false for non-existent key", () => {
      assertEquals(cache.delete("non-existent"), false);
    });
  });

  describe("deleteByPrefix", () => {
    it("should delete keys matching prefix", () => {
      cache.set("prefix:key1", "value1");
      cache.set("prefix:key2", "value2");
      cache.set("other:key3", "value3");

      assertEquals(cache.deleteByPrefix("prefix:"), 2);
      assertEquals(cache.has("prefix:key1"), false);
      assertEquals(cache.has("prefix:key2"), false);
      assertEquals(cache.has("other:key3"), true);
    });
  });

  describe("deleteByPrefixAndSuffix", () => {
    it("should delete keys matching prefix and suffix", () => {
      cache.set("prefix:data:suffix", "value1");
      cache.set("prefix:other:suffix", "value2");
      cache.set("prefix:data:other", "value3");

      assertEquals(cache.deleteByPrefixAndSuffix("prefix:", "suffix"), 2);
      assertEquals(cache.has("prefix:data:suffix"), false);
      assertEquals(cache.has("prefix:other:suffix"), false);
      assertEquals(cache.has("prefix:data:other"), true);
    });
  });

  describe("clear", () => {
    it("should clear all entries", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.clear();
      assertEquals(cache.has("key1"), false);
      assertEquals(cache.has("key2"), false);
    });
  });

  describe("stats", () => {
    it("should return cache stats", () => {
      cache.set("key1", "value1");
      cache.get("key1");
      cache.get("non-existent");

      const stats = cache.stats();

      assertEquals(stats.size, 1);
      assertEquals(stats.hits, 1);
      assertEquals(stats.misses, 1);
      assertEquals(stats.hitRate, 0.5);
      assertEquals(typeof stats.memoryUsed, "number");
      assertEquals(typeof stats.backend, "string");
    });
  });

  describe("disabled cache", () => {
    it("should not cache when disabled", () => {
      const disabledCache = new FileCache({ enabled: false });
      disabledCache.set("key1", "value1");
      assertEquals(disabledCache.get("key1"), undefined);
      assertEquals(disabledCache.has("key1"), false);
    });

    it("has() should return false when disabled", () => {
      const disabledCache = new FileCache({ enabled: false });
      assertEquals(disabledCache.has("key1"), false);
    });

    it("setAsync() should resolve immediately when disabled", async () => {
      const disabledCache = new FileCache({ enabled: false });
      await disabledCache.setAsync("key1", "value1");
      assertEquals(disabledCache.get("key1"), undefined);
    });

    it("getAsync() should return undefined when disabled", async () => {
      const disabledCache = new FileCache({ enabled: false });
      const result = await disabledCache.getAsync("key1");
      assertEquals(result, undefined);
    });
  });

  describe("TTL expiry", () => {
    it("get() should return undefined for expired entries", async () => {
      const shortTtlCache = new FileCache({ ttl: 1 });
      shortTtlCache.set("key1", "value1");
      await new Promise((r) => setTimeout(r, 10));
      assertEquals(shortTtlCache.get("key1"), undefined);
      shortTtlCache.clear();
    });

    it("has() should return false and clean up expired entry", async () => {
      const shortTtlCache = new FileCache({ ttl: 1 });
      shortTtlCache.set("key1", "value1");
      await new Promise((r) => setTimeout(r, 10));
      assertEquals(shortTtlCache.has("key1"), false);
      shortTtlCache.clear();
    });
  });

  describe("evictExpired", () => {
    it("should remove expired entries and return count", async () => {
      const shortTtlCache = new FileCache({ ttl: 1 });
      shortTtlCache.set("key1", "value1");
      shortTtlCache.set("key2", "value2");
      await new Promise((r) => setTimeout(r, 10));
      assertEquals(shortTtlCache.evictExpired(), 2);
      shortTtlCache.clear();
    });

    it("should return 0 when nothing expired", () => {
      cache.set("key1", "value1");
      assertEquals(cache.evictExpired(), 0);
    });
  });

  describe("eviction on size limit", () => {
    it("should evict oldest entries when maxSize is reached", () => {
      const smallCache = new FileCache({ maxSize: 2 });
      smallCache.set("key1", "v1");
      smallCache.set("key2", "v2");
      smallCache.set("key3", "v3");
      assertEquals(smallCache.has("key1"), false);
      assertEquals(smallCache.has("key3"), true);
      smallCache.clear();
    });

    it("evicts an empty-string key without looping", () => {
      const smallCache = new FileCache({ maxSize: 1 });
      smallCache.set("", "first");
      smallCache.set("next", "second");

      assertEquals(smallCache.has(""), false);
      assertEquals(smallCache.get("next"), "second");
    });
  });

  describe("eviction on memory limit", () => {
    it("should evict oldest entry when new entry would exceed maxMemory", () => {
      // estimateSize for strings: string.length * 2
      // "short" = 5 chars = 10 bytes, "medium-val" = 10 chars = 20 bytes
      const smallMemCache = new FileCache({ maxMemory: 25 });
      smallMemCache.set("key1", "short");
      assertEquals(smallMemCache.has("key1"), true);
      // Adding second entry (20 bytes) pushes total to 30 > 25, so key1 must be evicted
      smallMemCache.set("key2", "medium-val");
      assertEquals(smallMemCache.has("key1"), false);
      assertEquals(smallMemCache.has("key2"), true);
      smallMemCache.clear();
    });
  });

  describe("value too large for fallback cache", () => {
    it("should skip values larger than maxMemory", () => {
      const tinyCache = new FileCache({ maxMemory: 5 });
      tinyCache.set("key1", "this is a long string that exceeds 5 bytes");
      assertEquals(tinyCache.has("key1"), false);
      tinyCache.clear();
    });
  });

  describe("deleteByPrefix with no matches", () => {
    it("should return 0", () => {
      cache.set("key1", "value1");
      assertEquals(cache.deleteByPrefix("nonexistent:"), 0);
    });
  });

  describe("deleteByPrefixAndSuffix with no matches", () => {
    it("should return 0", () => {
      cache.set("key1", "value1");
      assertEquals(cache.deleteByPrefixAndSuffix("nonexistent:", "nope"), 0);
    });
  });

  describe("stats edge cases", () => {
    it("hitRate should be 0 with zero hits and misses", () => {
      const stats = cache.stats();
      assertEquals(stats.hitRate, 0);
      assertEquals(stats.hits, 0);
      assertEquals(stats.misses, 0);
    });

    it("should track memoryUsed correctly after set and delete", () => {
      cache.set("key1", "value1");
      const statsAfterSet = cache.stats();
      assertEquals(statsAfterSet.memoryUsed > 0, true);

      cache.delete("key1");
      const statsAfterDelete = cache.stats();
      assertEquals(statsAfterDelete.memoryUsed, 0);
    });

    it("replaces an existing entry without double-counting memory", () => {
      cache.set("key", "longer-value");
      cache.set("key", "x");

      assertEquals(cache.stats().size, 1);
      assertEquals(cache.stats().memoryUsed, 2);
    });
  });

  describe("clear resets counters", () => {
    it("should reset hits, misses, size, and memoryUsed", () => {
      cache.set("key1", "value1");
      cache.get("key1");
      cache.get("miss");
      cache.clear();

      const stats = cache.stats();
      assertEquals(stats.size, 0);
      assertEquals(stats.hits, 0);
      assertEquals(stats.misses, 0);
      assertEquals(stats.memoryUsed, 0);
    });
  });

  describe("async operations (fallback mode)", () => {
    it("getAsync() should return cached value", async () => {
      cache.set("key1", "value1");
      const result = await cache.getAsync<string>("key1");
      assertEquals(result, "value1");
    });

    it("getAsync() should return undefined for non-existent key", async () => {
      const result = await cache.getAsync("nonexistent");
      assertEquals(result, undefined);
    });

    it("setAsync() should store value retrievable by get()", async () => {
      await cache.setAsync("key1", "value1");
      assertEquals(cache.get("key1"), "value1");
    });

    it("deleteAsync() should delete an exact key", async () => {
      cache.set("key1", "value1");
      assertEquals(await cache.deleteAsync("key1"), true);
      assertEquals(cache.get("key1"), undefined);
      assertEquals(await cache.deleteAsync("missing"), false);
    });

    it("deleteByPrefixAsync() should delete matching entries", async () => {
      cache.set("p:key1", "v1");
      cache.set("p:key2", "v2");
      cache.set("other:key3", "v3");
      const count = await cache.deleteByPrefixAsync("p:");
      assertEquals(count, 2);
      assertEquals(cache.has("other:key3"), true);
    });

    it("deleteByPrefixAndSuffixAsync() should delete matching entries", async () => {
      cache.set("p:data:s", "v1");
      cache.set("p:other:s", "v2");
      cache.set("p:data:x", "v3");
      const count = await cache.deleteByPrefixAndSuffixAsync("p:", "s");
      assertEquals(count, 2);
      assertEquals(cache.has("p:data:x"), true);
    });
  });
});

describe("Distributed cache functions", () => {
  describe("initializeFileCacheBackend", () => {
    it("should export initializeFileCacheBackend function", () => {
      assertExists(initializeFileCacheBackend);
      assertEquals(typeof initializeFileCacheBackend, "function");
    });

    it("should return boolean", async () => {
      assertEquals(typeof (await initializeFileCacheBackend()), "boolean");
    });

    it("retries an auto-selected memory backend after the retry interval", async () => {
      const mutableBackends = CacheBackends as {
        file: () => Promise<CacheBackend>;
      };
      const originalFactory = mutableBackends.file;
      const originalDateNow = Date.now;
      let now = originalDateNow();
      let calls = 0;
      Date.now = () => now;
      mutableBackends.file = () => {
        calls++;
        return Promise.resolve(
          calls === 1 ? new MemoryCacheBackend() : createDistributedBackend(),
        );
      };

      try {
        const fresh = await importFreshFileCacheModule("memory-retry");
        assertEquals(await fresh.initializeFileCacheBackend(), false);
        assertEquals(await fresh.initializeFileCacheBackend(), false);
        assertEquals(calls, 1);

        now += 30_001;
        assertEquals(await fresh.initializeFileCacheBackend(), true);
        assertEquals(calls, 2);
      } finally {
        mutableBackends.file = originalFactory;
        Date.now = originalDateNow;
      }
    });

    it("shares one backend construction across concurrent initialization", async () => {
      const mutableBackends = CacheBackends as {
        file: () => Promise<CacheBackend>;
      };
      const originalFactory = mutableBackends.file;
      let calls = 0;
      let resolveBackend!: (backend: CacheBackend) => void;
      const pendingBackend = new Promise<CacheBackend>((resolve) => {
        resolveBackend = resolve;
      });
      mutableBackends.file = () => {
        calls++;
        return pendingBackend;
      };

      try {
        const fresh = await importFreshFileCacheModule("concurrent-init");
        const first = fresh.initializeFileCacheBackend();
        const second = fresh.initializeFileCacheBackend();
        assertEquals(calls, 1);

        resolveBackend(createDistributedBackend());
        assertEquals(await Promise.all([first, second]), [true, true]);
        assertEquals(calls, 1);
      } finally {
        mutableBackends.file = originalFactory;
      }
    });
  });

  describe("isFileCacheDistributedEnabled", () => {
    it("should export isFileCacheDistributedEnabled function", () => {
      assertExists(isFileCacheDistributedEnabled);
      assertEquals(typeof isFileCacheDistributedEnabled, "function");
    });

    it("should return boolean", () => {
      assertEquals(typeof isFileCacheDistributedEnabled(), "boolean");
    });
  });
});
