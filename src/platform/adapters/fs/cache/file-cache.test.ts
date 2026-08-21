import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  FileCache,
  initializeFileCacheBackend,
  isFileCacheDistributedEnabled,
} from "./file-cache.ts";
import { CacheBackends } from "#veryfront/cache/backend.ts";
import { runWithCacheBatching } from "#veryfront/cache/request-cache-batcher.ts";

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
  describe("process-local cache for immutable keys", () => {
    // Each case takes a query-qualified import so it owns its module-scoped
    // backend AND its module-scoped L1, and cannot leak into sibling tests.
    async function withCountingBackend(
      tag: string,
      run: (mod: typeof import("./file-cache.ts"), reads: () => number) => Promise<void>,
    ): Promise<void> {
      const mod = await import(`./file-cache.ts?${tag}`);
      const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
      assertExists(descriptor);
      let reads = 0;
      Object.defineProperty(CacheBackends, "file", {
        ...descriptor,
        value: () =>
          Promise.resolve({
            type: "redis",
            size: 0,
            get: () => {
              reads += 1;
              return Promise.resolve(JSON.stringify({ value: "content", timestamp: Date.now() }));
            },
            set: () => Promise.resolve(),
            del: () => Promise.resolve(false),
            clear: () => Promise.resolve(),
          } as never),
      });
      try {
        assertEquals(await mod.initializeFileCacheBackend(), true);
      } finally {
        Object.defineProperty(CacheBackends, "file", descriptor);
      }
      try {
        await run(mod, () => reads);
      } finally {
        mod.clearImmutableFileCacheL1();
      }
    }

    it("reads an immutable key from the backend once across separate requests", async () => {
      await withCountingBackend("l1-immutable-hit", async (mod, reads) => {
        const cache = new mod.FileCache();
        const key = "file:release:acme:rel_123:/app/page.tsx";

        await runWithCacheBatching(async () => {
          assertEquals(await cache.getAsync(key), "content");
        });
        assertEquals(reads(), 1);

        // A second request would otherwise pay another HTTP round trip: the
        // per-request batcher cache does not survive the request.
        await runWithCacheBatching(async () => {
          assertEquals(await cache.getAsync(key), "content");
        });
        assertEquals(reads(), 1, "the second request must be served locally");
      });
    });

    it("still reads a branch key from the backend on every request", async () => {
      await withCountingBackend("l1-branch-miss", async (mod, reads) => {
        const cache = new mod.FileCache();
        const key = "file:branch:acme:main:/app/page.tsx";

        await runWithCacheBatching(async () => {
          await cache.getAsync(key);
        });
        await runWithCacheBatching(async () => {
          await cache.getAsync(key);
        });

        // Branch content changes on save and the key does not encode a release,
        // so it must never be held locally.
        assertEquals(reads(), 2);
      });
    });

    it("lets an explicit write supersede the process-local copy", async () => {
      await withCountingBackend("l1-write-supersedes", async (mod, reads) => {
        const cache = new mod.FileCache();
        const key = "file:env:acme:production+rel_123:/app/page.tsx";

        await runWithCacheBatching(async () => {
          await cache.getAsync(key);
        });
        assertEquals(reads(), 1);

        await runWithCacheBatching(async () => {
          await cache.setAsync(key, "rewritten");
        });

        await runWithCacheBatching(async () => {
          await cache.getAsync(key);
        });
        assertEquals(reads(), 2, "the write must drop the local copy");
      });
    });

    it("drops the process-local entry on delete, deleteAsync and clear", async () => {
      await withCountingBackend("l1-key-invalidation", async (mod, reads) => {
        const cache = new mod.FileCache();
        const key = "file:release:acme:rel_123:/app/page.tsx";
        const read = (): Promise<void> =>
          runWithCacheBatching(async () => {
            await cache.getAsync(key);
          });

        await read();
        await read();
        assertEquals(reads(), 1, "precondition: the entry is held across requests");

        cache.delete(key);
        await read();
        assertEquals(reads(), 2, "delete must drop the process-local entry");
        await read();
        assertEquals(reads(), 2);

        await cache.deleteAsync(key);
        await read();
        assertEquals(reads(), 3, "deleteAsync must drop the process-local entry");
        await read();
        assertEquals(reads(), 3);

        cache.clear();
        await read();
        assertEquals(reads(), 4, "clear must drop the process-local entry");
      });
    });

    it("does not use process-local entries for API reads without verified authority", async () => {
      const mod = await import("./file-cache.ts?l1-api-auth-scope");
      const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
      assertExists(descriptor);
      let reads = 0;
      Object.defineProperty(CacheBackends, "file", {
        ...descriptor,
        value: () =>
          Promise.resolve({
            type: "api",
            size: 0,
            get: () => {
              reads += 1;
              return Promise.resolve(JSON.stringify({ value: "content", timestamp: Date.now() }));
            },
            set: () => Promise.resolve(),
            del: () => Promise.resolve(false),
            clear: () => Promise.resolve(),
          } as never),
      });
      try {
        assertEquals(await mod.initializeFileCacheBackend(), true);
      } finally {
        Object.defineProperty(CacheBackends, "file", descriptor);
      }

      try {
        const cache = new mod.FileCache();
        const key = "file:release:acme:rel_123:/app/page.tsx";
        await runWithCacheBatching(async () => {
          assertEquals(await cache.getAsync(key), "content");
        });
        await runWithCacheBatching(async () => {
          assertEquals(await cache.getAsync(key), "content");
        });
        assertEquals(reads, 2, "unverified API reads must not populate process-local L1");
      } finally {
        mod.clearImmutableFileCacheL1();
      }
    });

    it("does not admit request-local values after a failed backend write", async () => {
      const mod = await import("./file-cache.ts?l1-failed-write-not-admitted");
      const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
      assertExists(descriptor);
      const persisted = JSON.stringify({ value: "persisted", timestamp: Date.now() });
      let reads = 0;
      Object.defineProperty(CacheBackends, "file", {
        ...descriptor,
        value: () =>
          Promise.resolve({
            type: "redis",
            size: 0,
            get: () => {
              reads += 1;
              return Promise.resolve(persisted);
            },
            set: () => Promise.reject(new Error("write failed")),
            del: () => Promise.resolve(false),
            clear: () => Promise.resolve(),
          } as never),
      });
      try {
        assertEquals(await mod.initializeFileCacheBackend(), true);
      } finally {
        Object.defineProperty(CacheBackends, "file", descriptor);
      }

      try {
        const cache = new mod.FileCache();
        const key = "file:release:acme:rel_123:/app/page.tsx";
        await runWithCacheBatching(async () => {
          await cache.setAsync(key, "request-only");
          assertEquals(await cache.getAsync(key), "request-only");
        });
        await runWithCacheBatching(async () => {
          assertEquals(await cache.getAsync(key), "persisted");
        });
        assertEquals(reads, 1, "a failed write's request cache must not enter process-local L1");
      } finally {
        mod.clearImmutableFileCacheL1();
      }
    });

    it("does not admit backend reads invalidated while in flight", async () => {
      const mod = await import("./file-cache.ts?l1-pending-invalidation");
      const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
      assertExists(descriptor);
      let reads = 0;
      let releaseRead: (() => void) | undefined;
      const readReleased = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      let markReadStarted: (() => void) | undefined;
      const readStarted = new Promise<void>((resolve) => {
        markReadStarted = resolve;
      });
      Object.defineProperty(CacheBackends, "file", {
        ...descriptor,
        value: () =>
          Promise.resolve({
            type: "redis",
            size: 0,
            get: async () => {
              reads += 1;
              markReadStarted?.();
              await readReleased;
              return JSON.stringify({ value: "content", timestamp: Date.now() });
            },
            set: () => Promise.resolve(),
            del: () => Promise.resolve(false),
            clear: () => Promise.resolve(),
          } as never),
      });
      try {
        assertEquals(await mod.initializeFileCacheBackend(), true);
      } finally {
        Object.defineProperty(CacheBackends, "file", descriptor);
      }

      try {
        const cache = new mod.FileCache();
        const key = "file:release:acme:rel_123:/app/page.tsx";
        await runWithCacheBatching(async () => {
          const pending = cache.getAsync(key);
          await readStarted;
          await cache.deleteAsync(key);
          releaseRead?.();
          await pending;
        });

        await runWithCacheBatching(async () => {
          await cache.getAsync(key);
        });
        assertEquals(reads, 2, "the invalidated in-flight read must not repopulate L1");
      } finally {
        mod.clearImmutableFileCacheL1();
      }
    });

    it("does not admit backend reads cleared while in flight", async () => {
      const mod = await import("./file-cache.ts?l1-pending-clear");
      const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
      assertExists(descriptor);
      let reads = 0;
      let releaseRead: (() => void) | undefined;
      const readReleased = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      let markReadStarted: (() => void) | undefined;
      const readStarted = new Promise<void>((resolve) => {
        markReadStarted = resolve;
      });
      Object.defineProperty(CacheBackends, "file", {
        ...descriptor,
        value: () =>
          Promise.resolve({
            type: "redis",
            size: 0,
            get: async () => {
              reads += 1;
              markReadStarted?.();
              await readReleased;
              return JSON.stringify({ value: "content", timestamp: Date.now() });
            },
            set: () => Promise.resolve(),
            del: () => Promise.resolve(false),
            clear: () => Promise.resolve(),
          } as never),
      });
      try {
        assertEquals(await mod.initializeFileCacheBackend(), true);
      } finally {
        Object.defineProperty(CacheBackends, "file", descriptor);
      }

      try {
        const cache = new mod.FileCache();
        const key = "file:release:acme:rel_123:/app/page.tsx";
        await runWithCacheBatching(async () => {
          const pending = cache.getAsync(key);
          await readStarted;
          cache.clear();
          releaseRead?.();
          await pending;
        });

        await runWithCacheBatching(async () => {
          await cache.getAsync(key);
        });
        assertEquals(reads, 2, "a cleared in-flight read must not repopulate L1");
      } finally {
        mod.clearImmutableFileCacheL1();
      }
    });

    it("enforces the process-local entry limit by estimated retained bytes", async () => {
      const mod = await import("./file-cache.ts?l1-entry-byte-limit");
      const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
      assertExists(descriptor);
      const raw = JSON.stringify({ value: "😀".repeat(140_000), timestamp: Date.now() });
      assertEquals(raw.length <= 512 * 1024, true, "precondition: code-unit count fits");
      // estimateSize charges two bytes per UTF-16 code unit, the same accounting
      // the fallback cache uses.
      assertEquals(raw.length * 2 > 512 * 1024, true);
      let reads = 0;
      Object.defineProperty(CacheBackends, "file", {
        ...descriptor,
        value: () =>
          Promise.resolve({
            type: "redis",
            size: 0,
            get: () => {
              reads += 1;
              return Promise.resolve(raw);
            },
            set: () => Promise.resolve(),
            del: () => Promise.resolve(false),
            clear: () => Promise.resolve(),
          } as never),
      });
      try {
        assertEquals(await mod.initializeFileCacheBackend(), true);
      } finally {
        Object.defineProperty(CacheBackends, "file", descriptor);
      }

      try {
        const cache = new mod.FileCache();
        const key = "file:release:acme:rel_123:/app/page.tsx";
        await runWithCacheBatching(async () => {
          assertEquals(await cache.getAsync(key), "😀".repeat(140_000));
        });
        await runWithCacheBatching(async () => {
          assertEquals(await cache.getAsync(key), "😀".repeat(140_000));
        });
        assertEquals(reads, 2, "oversized entries must not be retained locally");
      } finally {
        mod.clearImmutableFileCacheL1();
      }
    });

    it("drops process-local entries on prefix and suffix invalidation", async () => {
      await withCountingBackend("l1-prefix-suffix-invalidation", async (mod, reads) => {
        const cache = new mod.FileCache();
        const first = "file:release:acme:rel_123:/app/page.tsx";
        const second = "file:release:acme:rel_123:/app/layout.tsx";

        await runWithCacheBatching(async () => {
          await cache.getAsync(first);
          await cache.getAsync(second);
        });
        assertEquals(reads(), 2);

        cache.deleteByPrefix("file:release:acme:rel_123:");
        await runWithCacheBatching(async () => {
          await cache.getAsync(first);
          await cache.getAsync(second);
        });
        assertEquals(reads(), 4, "prefix invalidation must drop both L1 entries");

        await cache.deleteByPrefixAndSuffixAsync("file:release:acme:rel_123:", "/app/page.tsx");
        await runWithCacheBatching(async () => {
          await cache.getAsync(first);
          await cache.getAsync(second);
        });
        assertEquals(reads(), 5, "suffix invalidation must drop only the matching L1 entry");
      });
    });

    // The api backend is what production selects for SSR renders, so reuse has
    // to be proven there and not only on a redis stub.
    async function withApiBackend(
      tag: string,
      resolveAuthorityScope: () => string | null,
      run: (mod: typeof import("./file-cache.ts"), reads: () => number) => Promise<void>,
    ): Promise<void> {
      const mod = await import(`./file-cache.ts?${tag}`);
      const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
      assertExists(descriptor);
      let reads = 0;
      Object.defineProperty(CacheBackends, "file", {
        ...descriptor,
        value: () =>
          Promise.resolve({
            type: "api",
            size: 0,
            get: () => {
              reads += 1;
              return Promise.resolve(JSON.stringify({ value: "content", timestamp: Date.now() }));
            },
            set: () => Promise.resolve(),
            del: () => Promise.resolve(false),
            clear: () => Promise.resolve(),
            resolveAuthorityScope,
          } as never),
      });
      try {
        assertEquals(await mod.initializeFileCacheBackend(), true);
      } finally {
        Object.defineProperty(CacheBackends, "file", descriptor);
      }
      try {
        await run(mod, () => reads);
      } finally {
        mod.clearImmutableFileCacheL1();
      }
    }

    it("serves a second api-backed request from the process-local store", async () => {
      await withApiBackend(
        "l1-api-reuse",
        () => "api:https://api.example:tok-a:proj-a",
        async (mod, reads) => {
          const cache = new mod.FileCache();
          const key = "file:release:acme:rel_123:/app/page.tsx";

          await runWithCacheBatching(async () => {
            assertEquals(await cache.getAsync(key), "content");
          });
          assertEquals(reads(), 1);

          await runWithCacheBatching(async () => {
            assertEquals(await cache.getAsync(key), "content");
          });
          assertEquals(reads(), 1, "the second api-backed request must be served locally");
        },
      );
    });

    // Issue veryfront-issue-inbox#602 acceptance criterion 4: a read taken
    // outside a request scope bypasses the batcher, so before this store it
    // paid a round trip every time.
    it("serves a read taken outside any request scope from the process-local store", async () => {
      await withApiBackend(
        "l1-no-request-scope",
        () => "api:https://api.example:tok-a:proj-a",
        async (mod, reads) => {
          const cache = new mod.FileCache();
          const key = "file:release:acme:rel_123:/app/page.tsx";

          // No runWithCacheBatching wrapper: this is the bypass at
          // request-cache-batcher.ts, where there is no batch to join.
          assertEquals(await cache.getAsync(key), "content");
          assertEquals(reads(), 1);

          assertEquals(await cache.getAsync(key), "content");
          assertEquals(await cache.getAsync(key), "content");
          assertEquals(reads(), 1, "an out-of-scope repeat read must not reach the backend");

          // A request-scoped read shares the same entry rather than re-reading.
          await runWithCacheBatching(async () => {
            assertEquals(await cache.getAsync(key), "content");
          });
          assertEquals(reads(), 1, "and the entry is shared with request-scoped reads");
        },
      );
    });

    // Issue veryfront-issue-inbox#602 acceptance criterion 2: pin the backend
    // call count for a known module graph. Counts round trips, not keys, so a
    // batched flush counts once however many keys it carries.
    it("issues no backend call for a module graph a previous render already read", async () => {
      const mod = await import("./file-cache.ts?l1-module-graph");
      const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
      assertExists(descriptor);
      let calls = 0;
      const value = (key: string) => JSON.stringify({ value: `source of ${key}`, timestamp: 0 });
      Object.defineProperty(CacheBackends, "file", {
        ...descriptor,
        value: () =>
          Promise.resolve({
            type: "api",
            size: 0,
            get: (key: string) => {
              calls += 1;
              return Promise.resolve(value(key));
            },
            getBatch: (keys: string[]) => {
              calls += 1;
              return Promise.resolve(new Map(keys.map((key) => [key, value(key)])));
            },
            set: () => Promise.resolve(),
            del: () => Promise.resolve(false),
            clear: () => Promise.resolve(),
            delByPattern: () => Promise.resolve(0),
            resolveAuthorityScope: () => "api:https://api.example:tok-a:proj-a",
          } as never),
      });
      try {
        assertEquals(await mod.initializeFileCacheBackend(), true);
      } finally {
        Object.defineProperty(CacheBackends, "file", descriptor);
      }

      try {
        const cache = new mod.FileCache();
        // A module graph the renderer walks depth first, awaiting each import
        // before it discovers the next. That walk is what degenerates the
        // request batcher into one round trip per file.
        const graph = (release: string) =>
          Array.from(
            { length: 150 },
            (_unused, index) => `file:release:acme:${release}:/app/module-${index}.tsx`,
          );
        const render = async (release: string): Promise<void> => {
          await runWithCacheBatching(async () => {
            for (const key of graph(release)) {
              assertEquals(await cache.getAsync(key), `source of ${key}`);
            }
          });
        };

        await render("rel_1");
        const cold = calls;
        assertEquals(
          cold,
          150,
          "precondition: the cold render is still one round trip per file, which is the batcher half of #602",
        );

        await render("rel_1");
        assertEquals(calls - cold, 0, "a warm render of the same graph must issue no backend call");

        await render("rel_1");
        assertEquals(calls - cold, 0, "and must keep issuing none on every later render");

        // Activating a release produces a different key per file, so the next
        // render reads the new release rather than serving the old one.
        const beforeActivation = calls;
        await render("rel_2");
        assertEquals(
          calls - beforeActivation,
          150,
          "a new release must not be served from the previous release's entries",
        );
        await render("rel_2");
        assertEquals(calls - beforeActivation, 150, "and the new release warms the same way");
      } finally {
        mod.clearImmutableFileCacheL1();
      }
    });

    it("never shares a process-local entry between two resolved authorities", async () => {
      const scopes = [
        "api:https://api.example:tok-a:proj-a",
        "api:https://api.example:tok-b:proj-b",
        "api:https://api.example:tok-a:proj-a",
      ];
      let call = 0;
      await withApiBackend("l1-api-authority-isolation", () => {
        const scope = scopes[Math.min(call, scopes.length - 1)] ?? null;
        call += 1;
        return scope;
      }, async (mod, reads) => {
        const cache = new mod.FileCache();
        const key = "file:release:acme:rel_123:/app/page.tsx";

        await runWithCacheBatching(async () => {
          await cache.getAsync(key);
        });
        await runWithCacheBatching(async () => {
          await cache.getAsync(key);
        });
        assertEquals(reads(), 2, "a second authority must not read the first authority's entry");

        await runWithCacheBatching(async () => {
          await cache.getAsync(key);
        });
        assertEquals(reads(), 2, "the first authority must still be served its own entry");
      });
    });

    it("disables the process-local store when the authority cannot be resolved", async () => {
      await withApiBackend("l1-api-authority-unresolved", () => null, async (mod, reads) => {
        const cache = new mod.FileCache();
        const key = "file:release:acme:rel_123:/app/page.tsx";

        await runWithCacheBatching(async () => {
          await cache.getAsync(key);
        });
        await runWithCacheBatching(async () => {
          await cache.getAsync(key);
        });
        assertEquals(reads(), 2, "an unresolvable authority must not fall back to a shared scope");
      });
    });

    it("evicts the oldest entry once the store passes its total byte bound", async () => {
      const mod = await import("./file-cache.ts?l1-total-byte-bound");
      const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
      assertExists(descriptor);
      // One 512 KiB entry, shared by every key, so the accounting reaches the
      // 64 MiB bound after 128 entries while the test retains one copy.
      const filler = "a".repeat(262_118);
      const raw = `{"value":"${filler}","timestamp":0}`;
      assertEquals(raw.length * 2, 512 * 1024, "precondition: each entry is exactly 512 KiB");
      let reads = 0;
      Object.defineProperty(CacheBackends, "file", {
        ...descriptor,
        value: () =>
          Promise.resolve({
            type: "redis",
            size: 0,
            get: () => {
              reads += 1;
              return Promise.resolve(raw);
            },
            set: () => Promise.resolve(),
            del: () => Promise.resolve(false),
            clear: () => Promise.resolve(),
          } as never),
      });
      try {
        assertEquals(await mod.initializeFileCacheBackend(), true);
      } finally {
        Object.defineProperty(CacheBackends, "file", descriptor);
      }

      try {
        const cache = new mod.FileCache();
        const keyAt = (index: number) => `file:release:acme:rel_123:/app/page-${index}.tsx`;

        // 128 entries fill the bound exactly, so nothing is evicted yet.
        for (let index = 0; index < 128; index++) {
          await runWithCacheBatching(async () => {
            await cache.getAsync(keyAt(index));
          });
        }
        assertEquals(reads, 128);

        await runWithCacheBatching(async () => {
          await cache.getAsync(keyAt(0));
        });
        assertEquals(reads, 128, "the whole working set must still be held");

        // One more entry passes the bound and evicts the least recently used.
        await runWithCacheBatching(async () => {
          await cache.getAsync(keyAt(128));
        });
        assertEquals(reads, 129);

        await runWithCacheBatching(async () => {
          await cache.getAsync(keyAt(1));
        });
        assertEquals(reads, 130, "the byte bound must evict rather than grow without limit");
      } finally {
        mod.clearImmutableFileCacheL1();
      }
    });

    it("does not admit a read that overlaps an unresolved prefix invalidation", async () => {
      const mod = await import("./file-cache.ts?l1-invalidation-window");
      const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
      assertExists(descriptor);
      let stored: string | null = JSON.stringify({ value: "old", timestamp: Date.now() });
      let releaseDelete: (() => void) | undefined;
      const deleteReleased = new Promise<void>((resolve) => {
        releaseDelete = resolve;
      });
      Object.defineProperty(CacheBackends, "file", {
        ...descriptor,
        value: () =>
          Promise.resolve({
            type: "redis",
            size: 0,
            get: () => Promise.resolve(stored),
            set: () => Promise.resolve(),
            del: () => Promise.resolve(false),
            clear: () => Promise.resolve(),
            delByPattern: async () => {
              await deleteReleased;
              stored = null;
              return 1;
            },
          } as never),
      });
      try {
        assertEquals(await mod.initializeFileCacheBackend(), true);
      } finally {
        Object.defineProperty(CacheBackends, "file", descriptor);
      }

      try {
        const cache = new mod.FileCache();
        const key = "file:release:acme:rel_123:/app/page.tsx";

        await runWithCacheBatching(async () => {
          assertEquals(await cache.getAsync(key), "old");
        });

        // The invalidation drops L1 synchronously, then waits on the backend.
        const invalidation = cache.deleteByPrefixAsync("file:release:");
        await runWithCacheBatching(async () => {
          await cache.getAsync(key);
        });

        releaseDelete?.();
        await invalidation;

        await runWithCacheBatching(async () => {
          assertEquals(
            await cache.getAsync(key),
            undefined,
            "a read taken inside the invalidation window must not pin the pre-delete value",
          );
        });
      } finally {
        mod.clearImmutableFileCacheL1();
      }
    });

    it("releases the in-flight mutation record when a backend delete rejects", async () => {
      const mod = await import("./file-cache.ts?l1-mutation-registry-leak");
      const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
      assertExists(descriptor);
      Object.defineProperty(CacheBackends, "file", {
        ...descriptor,
        value: () =>
          Promise.resolve({
            type: "redis",
            size: 0,
            get: () => Promise.resolve(JSON.stringify({ value: "content", timestamp: Date.now() })),
            set: () => Promise.resolve(),
            del: () => Promise.resolve(false),
            clear: () => Promise.resolve(),
            delByPattern: () => Promise.reject(new Error("backend invalidation failed")),
          } as never),
      });
      try {
        assertEquals(await mod.initializeFileCacheBackend(), true);
      } finally {
        Object.defineProperty(CacheBackends, "file", descriptor);
      }

      try {
        const cache = new mod.FileCache();
        await assertRejects(() => cache.deleteByPrefixAsync("file:release:"));
        assertEquals(
          mod.immutableFileCacheL1InFlightMutationCount(),
          0,
          "a rejected mutation must not block admission forever",
        );
      } finally {
        mod.clearImmutableFileCacheL1();
      }
    });
  });

  describe("initializeFileCacheBackend", () => {
    it("should export initializeFileCacheBackend function", () => {
      assertExists(initializeFileCacheBackend);
      assertEquals(typeof initializeFileCacheBackend, "function");
    });

    it("skips non-serializable synchronous writes to a distributed backend", async () => {
      // A query-qualified import gives this regression its own module-scoped
      // backend state, so the fake distributed backend cannot leak into other
      // file-cache tests in the same Deno process.
      const distributedModule = await import(
        "./file-cache.ts?distributed-serialization-regression"
      );
      const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
      assertExists(descriptor);
      let backendWrites = 0;
      Object.defineProperty(CacheBackends, "file", {
        ...descriptor,
        value: () =>
          Promise.resolve({
            type: "redis",
            size: 0,
            get: () => Promise.resolve(null),
            set: () => {
              backendWrites += 1;
              return Promise.resolve();
            },
            del: () => Promise.resolve(false),
            clear: () => Promise.resolve(),
          } as never),
      });

      try {
        assertEquals(await distributedModule.initializeFileCacheBackend(), true);
      } finally {
        Object.defineProperty(CacheBackends, "file", descriptor);
      }

      const distributedCache = new distributedModule.FileCache();
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      distributedCache.set("cyclic", circular);
      assertEquals(backendWrites, 0);

      // Positive control: a serializable entry must reach the fake backend,
      // proving the harness is live and the zero-write assertion above is not
      // vacuously passing because the backend was never wired up.
      distributedCache.set("serializable", { ok: true });
      assertEquals(backendWrites, 1);
    });

    it("deleteAsync() invalidates the request-scoped value in distributed mode", async () => {
      const distributedModule = await import(
        "./file-cache.ts?distributed-request-cache-invalidation-regression"
      );
      const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
      assertExists(descriptor);
      const values = new Map<string, string>();
      Object.defineProperty(CacheBackends, "file", {
        ...descriptor,
        value: () =>
          Promise.resolve({
            type: "redis",
            size: 0,
            get: (key: string) => Promise.resolve(values.get(key) ?? null),
            set: (key: string, value: string) => {
              values.set(key, value);
              return Promise.resolve();
            },
            del: (key: string) => {
              values.delete(key);
              return Promise.resolve();
            },
            clear: () => Promise.resolve(),
          } as never),
      });

      try {
        assertEquals(await distributedModule.initializeFileCacheBackend(), true);
      } finally {
        Object.defineProperty(CacheBackends, "file", descriptor);
      }

      const distributedCache = new distributedModule.FileCache();
      await runWithCacheBatching(async () => {
        await distributedCache.setAsync("listing", "stale");
        assertEquals(await distributedCache.getAsync("listing"), "stale");

        await distributedCache.deleteAsync("listing");

        assertEquals(
          await distributedCache.getAsync("listing"),
          undefined,
          "the current request must not retain the deleted distributed value",
        );
      });
    });

    it("deleteAsync() prevents a pending distributed read from restoring stale data", async () => {
      const distributedModule = await import(
        "./file-cache.ts?distributed-pending-read-invalidation-regression"
      );
      const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
      assertExists(descriptor);
      const values = new Map<string, string>();
      let delayReads = false;
      let markReadStarted: (() => void) | undefined;
      const readStarted = new Promise<void>((resolve) => {
        markReadStarted = resolve;
      });
      let releaseRead: (() => void) | undefined;
      const readReleased = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      Object.defineProperty(CacheBackends, "file", {
        ...descriptor,
        value: () =>
          Promise.resolve({
            type: "redis",
            size: 0,
            get: async (key: string) => {
              const captured = values.get(key) ?? null;
              if (delayReads) {
                markReadStarted?.();
                await readReleased;
              }
              return captured;
            },
            set: (key: string, value: string) => {
              values.set(key, value);
              return Promise.resolve();
            },
            del: (key: string) => {
              values.delete(key);
              return Promise.resolve();
            },
            clear: () => Promise.resolve(),
          } as never),
      });

      try {
        assertEquals(await distributedModule.initializeFileCacheBackend(), true);
      } finally {
        Object.defineProperty(CacheBackends, "file", descriptor);
      }

      const distributedCache = new distributedModule.FileCache();
      await distributedCache.setAsync("listing", "stale");
      delayReads = true;

      await runWithCacheBatching(async () => {
        const pendingRead = distributedCache.getAsync("listing");
        await readStarted;

        await distributedCache.deleteAsync("listing");
        releaseRead?.();

        assertEquals(
          await pendingRead,
          undefined,
          "a read invalidated while pending must not return its captured value",
        );
        assertEquals(
          await distributedCache.getAsync("listing"),
          undefined,
          "the pending read must not restore its stale value for later reads",
        );
      });
    });

    it("should return boolean", async () => {
      assertEquals(typeof (await initializeFileCacheBackend()), "boolean");
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
