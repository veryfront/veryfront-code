import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  FileCache,
  initializeFileCacheBackend,
  isFileCacheDistributedEnabled,
} from "./file-cache.ts";
import { CacheBackends, type CacheReadOptions } from "#veryfront/cache/backend.ts";
import { getCacheStats } from "#veryfront/utils/memory/index.ts";
import { runWithCacheBatching } from "#veryfront/cache/request-cache-batcher.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import type { ResolvedCacheAuthority } from "#veryfront/cache/request-authority.ts";
import type { FileCacheOptions } from "./types.ts";
import { runtime } from "#veryfront/platform/adapters/registry.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import {
  IMMUTABLE_L1_MAX_TTL_MS,
  IMMUTABLE_L1_TTL_ENV_VAR,
} from "#veryfront/cache/immutable-l1.ts";
import { FakeTime } from "#std/testing/time";

/** `file:release:<projectSlug>:<releaseId>:<path>`, immutable by construction. */
const IMMUTABLE_RELEASE_KEY = "file:release:proj-a:rel-1:/app/page.tsx";
/** The per-release prefix a publish poke invalidates. */
const IMMUTABLE_RELEASE_PREFIX = "file:release:proj-a:rel-1:";
/** The path segment of IMMUTABLE_RELEASE_KEY, for the prefix+suffix entry points. */
const IMMUTABLE_RELEASE_SUFFIX = "/app/page.tsx";
/** Branch-scoped keys are the mutable ones and must always reach the backend. */
const BRANCH_KEY = "file:branch:proj-a:main:/app/page.tsx";
/** Neither release- nor branch-scoped, so the process-local tier must refuse it. */
const ENVIRONMENT_KEY = "file:env:proj-a:production:rel-1:/app/page.tsx";

/** Advances the elapsed-time clock with FakeTime while restoring it afterward. */
function followFakeTimeWithPerformanceNow(): Disposable {
  const originalPerformanceNow = performance.now;
  const elapsedOrigin = originalPerformanceNow.call(performance);
  const wallClockOrigin = Date.now();
  performance.now = () => elapsedOrigin + Date.now() - wallClockOrigin;
  return {
    [Symbol.dispose](): void {
      performance.now = originalPerformanceNow;
    },
  };
}

/**
 * The FileCache surface these tests drive, spelled structurally. A
 * query-qualified copy of the module re-declares the class's private fields,
 * which makes its `FileCache` nominally distinct from the canonical import,
 * so `typeof FileCache` would refuse every such module at the type level.
 */
type FileCacheLike = Pick<
  FileCache,
  | "getAsync"
  | "set"
  | "setAsync"
  | "delete"
  | "deleteAsync"
  | "deleteByPrefix"
  | "deleteByPrefixAsync"
  | "deleteByPrefixAndSuffix"
  | "deleteByPrefixAndSuffixAsync"
  | "clear"
>;

interface DistributedFileCacheModule {
  FileCache: new (options?: FileCacheOptions) => FileCacheLike;
  initializeFileCacheBackend: () => Promise<boolean>;
}

interface CountingBackendHarness {
  cache: FileCacheLike;
  backendGets: () => number;
  resetBackendGets: () => void;
  /** Drop a key from the fake backend without going through the cache. */
  removeFromBackend: (key: string) => void;
  /** Hold every backend read open until `releaseReads()`, to order a race. */
  holdReads: () => void;
  /** Resolves once a held read has captured its value and blocked. */
  readStarted: () => Promise<void>;
  releaseReads: () => void;
  /** Hold every backend delete open until `releaseMutations()`, to order a race. */
  holdMutations: () => void;
  /** Resolves once a held delete has started and blocked, before mutating. */
  mutationStarted: () => Promise<void>;
  releaseMutations: () => void;
  /** Hold every backend write open until `releaseWrites()`, to order a race. */
  holdWrites: () => void;
  /** Resolves once a held write has blocked, BEFORE it applies to the backend. */
  writeStarted: () => Promise<void>;
  releaseWrites: () => void;
}

/**
 * How the fake backend presents itself. The default mirrors a Redis backend,
 * which authorizes by process-held credentials and so exposes no per-request
 * authority. `type: "api"` is the credential-gated shape: `cacheAuthority()`
 * reports the token and project the backend's own reads would use, and the
 * process-local tier must scope entries on exactly that.
 */
interface DistributedBackendShape {
  backendType?: "redis" | "api";
  /**
   * Supplies the backend's OWN authority, as `ApiCacheBackend` does. Read fresh
   * on every call so a test can revoke or swap the credential between requests.
   */
  cacheAuthority?: () => ResolvedCacheAuthority;
}

/**
 * Wire a counting distributed backend into a query-qualified file-cache module,
 * so the fake backend and the module-scoped process-local tier both stay
 * private to one test.
 */
async function useCountingDistributedBackend(
  distributedModule: DistributedFileCacheModule,
  cacheOptions: FileCacheOptions = {},
  shape: DistributedBackendShape = {},
): Promise<CountingBackendHarness> {
  const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
  assertExists(descriptor);
  const values = new Map<string, string>();
  let gets = 0;
  let holding = false;
  let markReadStarted: (() => void) | undefined;
  let started = new Promise<void>((resolve) => {
    markReadStarted = resolve;
  });
  let doRelease: (() => void) | undefined;
  let released = new Promise<void>((resolve) => {
    doRelease = resolve;
  });
  let holdingMutations = false;
  let markMutationStarted: (() => void) | undefined;
  let mutationStarted = new Promise<void>((resolve) => {
    markMutationStarted = resolve;
  });
  let doReleaseMutations: (() => void) | undefined;
  let mutationsReleased = new Promise<void>((resolve) => {
    doReleaseMutations = resolve;
  });
  // Blocks BEFORE the mutation applies, so a read racing a held deletion sees
  // the value the backend still holds, exactly as an in-flight network delete
  // would leave it.
  const gateMutation = async (): Promise<void> => {
    if (!holdingMutations) return;
    markMutationStarted?.();
    await mutationsReleased;
  };
  let holdingWrites = false;
  let markWriteStarted: (() => void) | undefined;
  let writeStarted = new Promise<void>((resolve) => {
    markWriteStarted = resolve;
  });
  let doReleaseWrites: (() => void) | undefined;
  let writesReleased = new Promise<void>((resolve) => {
    doReleaseWrites = resolve;
  });
  // Blocks BEFORE the write applies, so a held write leaves the backend holding
  // the value it had, exactly as an in-flight or hung network write would. That
  // is what makes an unconfirmed value observable as unconfirmed.
  const gateWrite = async (): Promise<void> => {
    if (!holdingWrites) return;
    markWriteStarted?.();
    await writesReleased;
  };
  Object.defineProperty(CacheBackends, "file", {
    ...descriptor,
    value: () =>
      Promise.resolve({
        type: shape.backendType ?? "redis",
        size: 0,
        // Present only when the shape supplies one, so the default backend keeps
        // the `cacheAuthority === undefined` shape a Redis backend really has.
        ...(shape.cacheAuthority ? { cacheAuthority: shape.cacheAuthority } : {}),
        get: async (key: string, options?: CacheReadOptions) => {
          gets += 1;
          // Captured before blocking, so a held read carries the value the
          // backend held when it started rather than a later one.
          const captured = values.get(key) ?? null;
          if (holding) {
            markReadStarted?.();
            await released;
          }
          // Reported when the read completes, mirroring `ApiCacheBackend`'s
          // fallback path: a batch that fails re-resolves its authority for
          // the individual reads it retries with, so the authority that
          // performed the read is the one in force at this point, not the one
          // in force when the read was initiated.
          if (shape.cacheAuthority) options?.onAuthority?.(shape.cacheAuthority());
          return captured;
        },
        set: async (key: string, value: string) => {
          await gateWrite();
          values.set(key, value);
        },
        del: async (key: string) => {
          await gateMutation();
          return values.delete(key);
        },
        clear: () => Promise.resolve(),
        delByPattern: async (pattern: string) => {
          await gateMutation();
          const prefix = pattern.replace(/\*.*$/, "");
          let deleted = 0;
          for (const key of [...values.keys()]) {
            if (!key.startsWith(prefix)) continue;
            values.delete(key);
            deleted += 1;
          }
          return deleted;
        },
      } as never),
  });

  try {
    assertEquals(await distributedModule.initializeFileCacheBackend(), true);
  } finally {
    Object.defineProperty(CacheBackends, "file", descriptor);
  }

  return {
    cache: new distributedModule.FileCache(cacheOptions),
    backendGets: () => gets,
    resetBackendGets: (): void => {
      gets = 0;
    },
    removeFromBackend: (key: string): void => {
      values.delete(key);
    },
    holdReads: (): void => {
      holding = true;
      started = new Promise<void>((resolve) => {
        markReadStarted = resolve;
      });
      released = new Promise<void>((resolve) => {
        doRelease = resolve;
      });
    },
    readStarted: () => started,
    releaseReads: (): void => {
      holding = false;
      doRelease?.();
    },
    holdMutations: (): void => {
      holdingMutations = true;
      mutationStarted = new Promise<void>((resolve) => {
        markMutationStarted = resolve;
      });
      mutationsReleased = new Promise<void>((resolve) => {
        doReleaseMutations = resolve;
      });
    },
    mutationStarted: () => mutationStarted,
    releaseMutations: (): void => {
      holdingMutations = false;
      doReleaseMutations?.();
    },
    holdWrites: (): void => {
      holdingWrites = true;
      writeStarted = new Promise<void>((resolve) => {
        markWriteStarted = resolve;
      });
      writesReleased = new Promise<void>((resolve) => {
        doReleaseWrites = resolve;
      });
    },
    writeStarted: () => writeStarted,
    releaseWrites: (): void => {
      holdingWrites = false;
      doReleaseWrites?.();
    },
  };
}

/** One read of one key, inside its own request scope, for one project. */
function readInRequest(
  cache: FileCacheLike,
  projectId: string,
  key: string,
): Promise<string | undefined> {
  return runWithCacheKeyContext(
    { projectId, mode: "production", versionId: "rel-1" },
    () => runWithCacheBatching(() => cache.getAsync<string>(key)),
  );
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
  describe("initializeFileCacheBackend", () => {
    it("should export initializeFileCacheBackend function", () => {
      assertExists(initializeFileCacheBackend);
      assertEquals(typeof initializeFileCacheBackend, "function");
    });

    it("resolves immutable L1 settings after manual runtime initialization", async () => {
      await runtime.reset();
      const distributedModule = await import(
        "./file-cache.ts?runtime-adapter-l1-configuration-regression"
      );
      const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
      assertExists(descriptor);
      const serialized = JSON.stringify({ value: "held", timestamp: Date.now(), size: 4 });
      let backendGets = 0;
      Object.defineProperty(CacheBackends, "file", {
        ...descriptor,
        value: () =>
          Promise.resolve({
            type: "redis",
            size: 1,
            get: () => {
              backendGets += 1;
              return Promise.resolve(serialized);
            },
            set: () => Promise.resolve(),
            del: () => Promise.resolve(false),
            clear: () => Promise.resolve(),
          } as never),
      });

      const adapter = createMockAdapter();
      adapter.env.set(IMMUTABLE_L1_TTL_ENV_VAR, "0");
      try {
        await runtime.set(adapter);
        assertEquals(await distributedModule.initializeFileCacheBackend(), true);
        const cache = new distributedModule.FileCache();
        const read = () =>
          runWithCacheKeyContext(
            { projectId: "proj-a", mode: "production", versionId: "rel-1" },
            () => runWithCacheBatching(() => cache.getAsync(IMMUTABLE_RELEASE_KEY)),
          );

        assertEquals(await read(), "held");
        assertEquals(await read(), "held");
        assertEquals(
          backendGets,
          2,
          "the runtime adapter's zero TTL must disable the process-local tier",
        );
      } finally {
        Object.defineProperty(CacheBackends, "file", descriptor);
        await runtime.reset();
      }
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

    it("forwards prefix invalidation to the distributed backend", async () => {
      const distributedModule = await import(
        "./file-cache.ts?distributed-prefix-invalidation-regression"
      );
      const descriptor = Object.getOwnPropertyDescriptor(CacheBackends, "file");
      assertExists(descriptor);
      const patterns: string[] = [];
      const pendingDeletions: Array<() => void> = [];
      // While gated, the backend deletion only settles when the test releases it,
      // so an *Async method that stopped awaiting it would resolve early.
      let gateDeletions = false;
      const flushMicrotasks = async (): Promise<void> => {
        for (let tick = 0; tick < 20; tick++) await Promise.resolve();
      };
      Object.defineProperty(CacheBackends, "file", {
        ...descriptor,
        value: () =>
          Promise.resolve({
            type: "redis",
            size: 0,
            get: () => Promise.resolve(null),
            set: () => Promise.resolve(),
            del: () => Promise.resolve(false),
            clear: () => Promise.resolve(),
            delByPattern: (pattern: string) => {
              patterns.push(pattern);
              if (!gateDeletions) return Promise.resolve(0);
              return new Promise<number>((resolve) => {
                pendingDeletions.push(() => resolve(0));
              });
            },
          } as never),
      });

      try {
        assertEquals(await distributedModule.initializeFileCacheBackend(), true);
      } finally {
        Object.defineProperty(CacheBackends, "file", descriptor);
      }

      const distributedCache = new distributedModule.FileCache();

      distributedCache.deleteByPrefix("file:release:p:r1:");
      // deleteByPrefix dispatches the backend deletion fire-and-forget.
      await Promise.resolve();
      assertEquals(
        patterns,
        ["file:release:p:r1:*"],
        "deleteByPrefix must forward a wildcard pattern to the distributed backend",
      );

      gateDeletions = true;
      let prefixAsyncSettled = false;
      const prefixAsync = distributedCache
        .deleteByPrefixAsync("file:release:p:r2:")
        .then((count) => {
          prefixAsyncSettled = true;
          return count;
        });
      await flushMicrotasks();
      assertEquals(
        patterns,
        ["file:release:p:r1:*", "file:release:p:r2:*"],
        "deleteByPrefixAsync must forward the same wildcard pattern to the backend",
      );
      assertEquals(
        prefixAsyncSettled,
        false,
        "deleteByPrefixAsync must stay pending until the backend deletion settles",
      );
      pendingDeletions.shift()?.();
      assertEquals(
        await prefixAsync,
        0,
        "deleteByPrefixAsync must resolve once the backend deletion settles",
      );

      gateDeletions = false;
      distributedCache.deleteByPrefixAndSuffix("file:release:p:r3:", "s");
      await Promise.resolve();
      assertEquals(
        patterns[2],
        "file:release:p:r3:*:s",
        "deleteByPrefixAndSuffix must forward a suffix-qualified pattern",
      );

      gateDeletions = true;
      let suffixAsyncSettled = false;
      const suffixAsync = distributedCache
        .deleteByPrefixAndSuffixAsync("file:release:p:r4:", "s")
        .then((count) => {
          suffixAsyncSettled = true;
          return count;
        });
      await flushMicrotasks();
      assertEquals(
        patterns[3],
        "file:release:p:r4:*:s",
        "deleteByPrefixAndSuffixAsync must forward a suffix-qualified pattern",
      );
      assertEquals(
        suffixAsyncSettled,
        false,
        "deleteByPrefixAndSuffixAsync must stay pending until the backend deletion settles",
      );
      pendingDeletions.shift()?.();
      assertEquals(
        await suffixAsync,
        0,
        "deleteByPrefixAndSuffixAsync must resolve once the backend deletion settles",
      );
      assertEquals(
        pendingDeletions.length,
        0,
        "every gated backend deletion must have been released",
      );
    });

    it("serves a warmed immutable release key without a second backend read", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-release-reuse");
      const harness = await useCountingDistributedBackend(distributedModule);

      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "page-source");
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "page-source",
        "the warming request must read the immutable value through the backend",
      );

      harness.resetBackendGets();
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "page-source",
        "a later request must still see the same immutable value",
      );
      assertEquals(
        harness.backendGets(),
        0,
        "a second request for the same immutable release key must not reach the backend",
      );
    });

    it("reads a branch-scoped key from the backend on every request", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-branch-scoped");
      const harness = await useCountingDistributedBackend(distributedModule);

      await harness.cache.setAsync(BRANCH_KEY, "draft-source");
      await readInRequest(harness.cache, "proj-a", BRANCH_KEY);

      harness.resetBackendGets();
      assertEquals(
        await readInRequest(harness.cache, "proj-a", BRANCH_KEY),
        "draft-source",
        "a branch-scoped read must still return the backend value",
      );
      assertEquals(
        harness.backendGets(),
        1,
        "a branch-scoped key must reach the backend on every request",
      );

      await readInRequest(harness.cache, "proj-a", BRANCH_KEY);
      assertEquals(
        harness.backendGets(),
        2,
        "a branch-scoped key must keep reaching the backend on every later request",
      );
    });

    it("stops serving an immutable release key once its process-local TTL expires", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-ttl-expiry");
      const harness = await useCountingDistributedBackend(distributedModule, {
        immutableL1Ttl: 1,
      });

      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "page-source");
      await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);

      harness.resetBackendGets();
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "page-source",
        "an expired entry must be refetched rather than dropped",
      );
      assertEquals(
        harness.backendGets(),
        1,
        "an entry older than the configured TTL must not be served from the process-local tier",
      );
    });

    it("treats a non-finite per-instance TTL as the process default, not as forever", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-nonfinite-ttl");
      // An Infinity lifetime must not stamp entries that never expire. The
      // constructor falls back to the finite process default, so the tier
      // stays live under a finite bound; the store itself refuses a
      // non-finite TTL outright (covered in immutable-l1.test.ts).
      const harness = await useCountingDistributedBackend(distributedModule, {
        immutableL1Ttl: Number.POSITIVE_INFINITY,
      });

      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "page-source");
      await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);

      harness.resetBackendGets();
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "page-source",
        "the tier must still serve under the substituted finite default",
      );
      assertEquals(
        harness.backendGets(),
        0,
        "a non-finite TTL must fall back to the finite process default rather than disable or unbound the tier",
      );
    });

    it("caps the process-local lifetime at the configured cache ttl", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-ttl-cap");
      // The public filesystem config exposes ttl and not immutableL1Ttl, so a
      // caller that tightened ttl below the tier's default has stated its
      // whole freshness bound there; the tier must not widen it.
      const harness = await useCountingDistributedBackend(distributedModule, { ttl: 1 });

      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "page-source");
      await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);

      harness.resetBackendGets();
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "page-source",
        "the value itself must still be readable through the backend",
      );
      assertEquals(
        harness.backendGets(),
        1,
        "a ttl below the tier default must bound the tier too, not only the backend entry",
      );
    });

    it("caps an explicit per-instance lifetime at the configured cache ttl", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-ttl-cap-explicit");
      // An immutableL1Ttl above ttl would serve values the backend cache has
      // already expired, so the cap applies to an explicit lifetime as well.
      const harness = await useCountingDistributedBackend(distributedModule, {
        ttl: 1,
        immutableL1Ttl: 3_600_000,
      });

      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "page-source");
      await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);

      harness.resetBackendGets();
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);
      assertEquals(
        harness.backendGets(),
        1,
        "an explicit tier lifetime above ttl must still be capped at ttl",
      );
    });

    it("clamps an explicit per-instance lifetime to the security maximum", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-instance-ttl-clamp");
      // Only the env resolver clamps to IMMUTABLE_L1_MAX_TTL_MS, so an internal
      // caller passing both ttl and immutableL1Ttl above it would otherwise buy
      // an hour of credential-revocation and publish-visibility lag. The fake
      // clock makes that hour observable: past the 60-second maximum the tier
      // must refetch, however far inside the configured hour the entry still is.
      const harness = await useCountingDistributedBackend(distributedModule, {
        ttl: 7_200_000,
        immutableL1Ttl: 3_600_000,
      });
      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "page-source");

      using time = new FakeTime();
      using _elapsedTime = followFakeTimeWithPerformanceNow();
      const warming = readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);
      await time.tickAsync(5);
      assertEquals(await warming, "page-source", "the warming read still returns the value");

      // Positive control: within the clamped lifetime the tier serves the
      // entry, so the refetch below is the clamp and not a disabled tier.
      harness.resetBackendGets();
      const withinBound = readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);
      await time.tickAsync(5);
      assertEquals(await withinBound, "page-source");
      assertEquals(
        harness.backendGets(),
        0,
        "within the clamped lifetime the tier must still serve the entry",
      );

      await time.tickAsync(IMMUTABLE_L1_MAX_TTL_MS + 1_000);
      harness.resetBackendGets();
      const pastBound = readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);
      await time.tickAsync(5);
      assertEquals(
        await pastBound,
        "page-source",
        "the value itself must still be readable through the backend",
      );
      assertEquals(
        harness.backendGets(),
        1,
        "a per-instance lifetime above the security maximum must be clamped to it",
      );
    });

    it("does not extend an aging backend entry by a fresh process-local lifetime", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-backend-remaining-ttl");
      const harness = await useCountingDistributedBackend(distributedModule, {
        ttl: 200,
        immutableL1Ttl: 200,
      });

      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "page-source");
      await new Promise<void>((resolve) => setTimeout(resolve, 160));
      await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);

      harness.resetBackendGets();
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "page-source",
        "the value itself remains available through the fake backend",
      );
      assertEquals(
        harness.backendGets(),
        1,
        "an L1 admission near backend expiry must not receive a fresh full lifetime",
      );
    });

    it("bounds admission by the writer's recorded backend lifetime, not the reader's ttl", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-writer-ttl");
      // Instances configure their TTLs independently, and the backend entry
      // expires on the TTL the WRITING instance stored it with. The writer
      // records that lifetime in the entry, so a reader configured with a
      // longer ttl must not admit the value for longer than the backend
      // entry has left.
      const harness = await useCountingDistributedBackend(distributedModule);
      const writer = new distributedModule.FileCache({ ttl: 1_000 });
      await writer.setAsync(IMMUTABLE_RELEASE_KEY, "page-source");

      using time = new FakeTime();
      using _elapsedTime = followFakeTimeWithPerformanceNow();
      // Warm the tier through the default reader (60s ttl) half way into the
      // backend entry's one-second lifetime.
      await time.tickAsync(500);
      const warming = readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);
      await time.tickAsync(5);
      assertEquals(await warming, "page-source", "the warming read still returns the value");

      // Past the writer's backend expiry the tier must refetch, even though
      // the reader's own ttl and the tier lifetime both have plenty left.
      await time.tickAsync(800);
      harness.resetBackendGets();
      const pastWriterExpiry = readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);
      await time.tickAsync(5);
      assertEquals(
        await pastWriterExpiry,
        "page-source",
        "the value itself must still be readable through the fake backend",
      );
      assertEquals(
        harness.backendGets(),
        1,
        "admission must be bounded by the writer's recorded backend lifetime, not this reader's ttl",
      );
    });

    it("reports the process-local tier to the memory profiler", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-profiler");
      const harness = await useCountingDistributedBackend(distributedModule);

      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "page-source");
      await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);

      const stats = getCacheStats().find((cache) => cache.name === "file-cache-immutable-l1");
      assertExists(
        stats,
        "the tier must register with the memory profiler under its own name, or the memory it retains is unattributable",
      );
      assertEquals(
        stats.entries,
        1,
        "the registration must report the tier's own entry count, not the backend's",
      );
      assertEquals(
        (stats.estimatedSizeBytes ?? 0) > 0,
        true,
        "the registration must report the bytes the tier retains",
      );
      assertEquals(
        (stats.maxEntries ?? 0) > 0,
        true,
        "the registration must report the tier's entry ceiling",
      );
    });

    it("does not serve an entry whose backend read outlived the tier's lifetime", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-slow-read");
      // A revocation or a publish can land while the backend read is still in
      // flight, so a read pending past the whole TTL must not stamp a fresh
      // lifetime when its stale response finally arrives.
      const harness = await useCountingDistributedBackend(distributedModule, {
        immutableL1Ttl: 20,
      });
      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "page-source");

      harness.holdReads();
      const pending = readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);
      await harness.readStarted();
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      harness.releaseReads();
      assertEquals(
        await pending,
        "page-source",
        "the slow read itself must still return the backend value",
      );

      harness.resetBackendGets();
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "page-source",
        "a later request must still read the value",
      );
      assertEquals(
        harness.backendGets(),
        1,
        "a read that consumed the whole TTL in flight must not be admitted at completion",
      );
    });

    it("does not serve a shorter-TTL instance an entry past its own bound", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-per-instance-ttl");
      const harness = await useCountingDistributedBackend(distributedModule);
      const shortTtlCache = new distributedModule.FileCache({ immutableL1Ttl: 1 });

      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "page-source");
      await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);
      await new Promise<void>((resolve) => setTimeout(resolve, 25));

      // The admitting instance's own lifetime still covers the entry.
      harness.resetBackendGets();
      await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);
      assertEquals(
        harness.backendGets(),
        0,
        "the admitting instance must still be served within its own lifetime",
      );

      // The store is process-global, so both instances share the entry; the
      // shorter lifetime must be enforced at lookup, not only at admission.
      harness.resetBackendGets();
      assertEquals(
        await readInRequest(shortTtlCache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "page-source",
        "the shorter-TTL instance still reads the value, through the backend",
      );
      assertEquals(
        harness.backendGets(),
        1,
        "an instance with a 1ms lifetime must not be served an entry another instance admitted 25ms ago",
      );
    });

    it("drops a value admitted while its backend deletion was in flight", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-delete-race");
      const harness = await useCountingDistributedBackend(distributedModule);
      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "stale");

      harness.holdMutations();
      const deletion = harness.cache.deleteAsync(IMMUTABLE_RELEASE_KEY);
      await harness.mutationStarted();

      // Starts after the pre-mutation drop, so it carries a fresh generation
      // token, while the backend still holds the value the deletion is about
      // to remove; without a post-settle drop this admission would outlive
      // the deletion.
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "stale",
        "positive control: a read racing the deletion sees the pre-deletion value",
      );

      harness.releaseMutations();
      await deletion;

      harness.resetBackendGets();
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        undefined,
        "the value admitted during the deletion must not survive it",
      );
      assertEquals(
        harness.backendGets(),
        1,
        "the later request must reach the backend rather than a reinstated entry",
      );
    });

    it("drops a value admitted while a backend prefix invalidation was in flight", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-prefix-race");
      const harness = await useCountingDistributedBackend(distributedModule);
      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "stale");

      harness.holdMutations();
      const invalidation = harness.cache.deleteByPrefixAsync(IMMUTABLE_RELEASE_PREFIX);
      await harness.mutationStarted();

      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "stale",
        "positive control: a read racing the invalidation sees the pre-invalidation value",
      );

      harness.releaseMutations();
      await invalidation;

      harness.resetBackendGets();
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        undefined,
        "the value admitted during the prefix invalidation must not survive it",
      );
      assertEquals(
        harness.backendGets(),
        1,
        "the later request must reach the backend rather than a reinstated entry",
      );
    });

    it("keeps one project from reading another project's process-local entry", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-project-isolation");
      const harness = await useCountingDistributedBackend(distributedModule);

      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "page-source");
      await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);

      harness.resetBackendGets();
      await readInRequest(harness.cache, "proj-b", IMMUTABLE_RELEASE_KEY);
      assertEquals(
        harness.backendGets(),
        1,
        "the same cache key under a different projectRef must not hit the first project's entry",
      );

      harness.resetBackendGets();
      await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);
      assertEquals(
        harness.backendGets(),
        0,
        "the first project's entry must survive, so the miss above was scope and not eviction",
      );
    });

    it("refuses a key shape that is neither release nor branch scoped", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-unrecognized-shape");
      const harness = await useCountingDistributedBackend(distributedModule);

      await harness.cache.setAsync(ENVIRONMENT_KEY, "env-source");
      await readInRequest(harness.cache, "proj-a", ENVIRONMENT_KEY);

      harness.resetBackendGets();
      assertEquals(
        await readInRequest(harness.cache, "proj-a", ENVIRONMENT_KEY),
        "env-source",
        "an unadmitted key must still return the backend value",
      );
      assertEquals(
        harness.backendGets(),
        1,
        "a key shape outside the admission predicate must not be admitted to the process-local tier",
      );
    });

    it("does not admit a value this request wrote optimistically", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-optimistic-write");
      const harness = await useCountingDistributedBackend(distributedModule);

      // setAsync publishes into the request-scoped cache before the backend
      // confirms it, so the read that follows in the same request is answering
      // from this request's own unconfirmed write.
      await runWithCacheKeyContext(
        { projectId: "proj-a", mode: "production", versionId: "rel-1" },
        () =>
          runWithCacheBatching(async () => {
            await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "optimistic");
            assertEquals(
              await harness.cache.getAsync<string>(IMMUTABLE_RELEASE_KEY),
              "optimistic",
              "the writing request must still see its own write",
            );
          }),
      );

      harness.resetBackendGets();
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "optimistic",
        "a later request must still read the value",
      );
      assertEquals(
        harness.backendGets(),
        1,
        "an unconfirmed optimistic write must not be promoted into the process-local tier",
      );
    });

    it("keeps one credential from reading another credential's process-local entry", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-credential-isolation");
      // Only the backend's credential changes between requests. The ambient
      // project stays fixed, so a miss can only be credential separation.
      let backendToken = "token-a";
      const harness = await useCountingDistributedBackend(distributedModule, {}, {
        backendType: "api",
        cacheAuthority: (): ResolvedCacheAuthority => ({
          token: backendToken,
          projectRef: "proj-a",
          tokenSource: "explicit-endpoint",
        }),
      });

      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "page-source");
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "page-source",
        "the warming request must read the immutable value through the api backend",
      );

      harness.resetBackendGets();
      backendToken = "token-b";
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "page-source",
        "the second credential must still be served, but only through the backend",
      );
      assertEquals(
        harness.backendGets(),
        1,
        "the same key under a different credential must not hit the first credential's entry",
      );

      // Positive control: without this, a miss above would be indistinguishable
      // from the first entry having simply been evicted.
      harness.resetBackendGets();
      backendToken = "token-a";
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "page-source",
        "the first credential must still read the entry it warmed",
      );
      assertEquals(
        harness.backendGets(),
        0,
        "the first credential's entry must survive, so the miss above was scope and not eviction",
      );
    });

    it("disables the process-local tier when the backend read has no credential", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-credential-absent");
      const harness = await useCountingDistributedBackend(distributedModule, {}, {
        backendType: "api",
        cacheAuthority: (): ResolvedCacheAuthority => ({
          token: null,
          projectRef: "proj-a",
          tokenSource: "none",
        }),
      });

      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "page-source");
      await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);

      harness.resetBackendGets();
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "page-source",
        "a credential-less read must still return whatever the backend returns",
      );
      assertEquals(
        harness.backendGets(),
        1,
        "a read the api backend gates on a credential must not be answered from process memory instead",
      );
    });

    it("scopes entries on the backend's own authority rather than the ambient one", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-backend-authority");
      // A backend constructed with an explicit endpoint credential reads under
      // THAT credential and project for every request, whatever ambient context
      // the request carries. Only one tenancy is ever read here, so entries may
      // be shared across these requests; scoping them on the ambient project
      // instead would be scoping them on something the read never used.
      const harness = await useCountingDistributedBackend(distributedModule, {}, {
        backendType: "api",
        cacheAuthority: (): ResolvedCacheAuthority => ({
          token: "endpoint-token",
          projectRef: "endpoint-project",
          tokenSource: "explicit-endpoint",
        }),
      });

      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "page-source");
      await readInRequest(harness.cache, "ambient-proj-a", IMMUTABLE_RELEASE_KEY);

      harness.resetBackendGets();
      assertEquals(
        await readInRequest(harness.cache, "ambient-proj-b", IMMUTABLE_RELEASE_KEY),
        "page-source",
        "the entry admitted under the backend's own authority must still be readable",
      );
      assertEquals(
        harness.backendGets(),
        0,
        "the scope must follow the backend's own authority, so a different ambient project cannot change it",
      );
    });

    it("binds admission to the authority that performed the backend read", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-read-authority");
      // The scope a read looks up under is snapshotted BEFORE the backend is
      // awaited, but a batched read that fails over to individual gets
      // re-resolves its credential mid-flight. Holding the read makes that
      // window wide enough to switch the credential inside it: the value is
      // fetched under token-b while the snapshot named token-a, and it must
      // be held under the credential that fetched it.
      let backendToken = "token-a";
      const harness = await useCountingDistributedBackend(distributedModule, {}, {
        backendType: "api",
        cacheAuthority: (): ResolvedCacheAuthority => ({
          token: backendToken,
          projectRef: "proj-a",
          tokenSource: "explicit-endpoint",
        }),
      });
      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "page-source");

      harness.holdReads();
      const warming = readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);
      await harness.readStarted();
      backendToken = "token-b";
      harness.releaseReads();
      assertEquals(
        await warming,
        "page-source",
        "the mid-switch read itself still returns the backend value",
      );

      // The entry belongs to the credential that performed the read...
      harness.resetBackendGets();
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "page-source",
        "the reading credential must still see the value",
      );
      assertEquals(
        harness.backendGets(),
        0,
        "the entry must be held under the credential the backend read was performed under",
      );

      // ...and is never served under the credential the pre-read snapshot
      // named, which did not fetch it.
      backendToken = "token-a";
      harness.resetBackendGets();
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "page-source",
        "the snapshot credential still reads the value, through the backend",
      );
      assertEquals(
        harness.backendGets(),
        1,
        "a value fetched under another credential must not be served under the snapshot's credential",
      );
    });

    it("does not admit a value written mid-read that the backend never confirmed", async () => {
      const distributedModule = await import("./file-cache.ts?issue-602-l1-midread-write");
      const harness = await useCountingDistributedBackend(distributedModule);

      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "backend-bytes");

      // getAsync decides whether it may use the process-local tier BEFORE it
      // awaits the backend, so a write that lands mid-read leaves that decision
      // true. What the read then receives is this request's own optimistic
      // value, by way of getCachedWithBatching's mutation-version divergence
      // path. The write's generation bump is the only barrier left.
      harness.holdWrites();
      const { pendingWrite } = await runWithCacheKeyContext(
        { projectId: "proj-a", mode: "production", versionId: "rel-1" },
        () =>
          runWithCacheBatching(async () => {
            harness.holdReads();
            const readPromise = harness.cache.getAsync<string>(IMMUTABLE_RELEASE_KEY);
            await harness.readStarted();

            // Deliberately not awaited: the backend write stays open, which is
            // a slow or hung write racing a concurrent read of the same key.
            const write = harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "never-persisted");
            await harness.writeStarted();

            harness.releaseReads();
            assertEquals(
              await readPromise,
              "never-persisted",
              "the writing request itself must still see its own newer write",
            );
            // Wrapped so awaiting the request does not await the held write.
            return { pendingWrite: write };
          }),
      );

      // Still before the write settles, so the compensating drop in setAsync's
      // `finally` cannot be what makes this pass.
      harness.resetBackendGets();
      assertEquals(
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY),
        "backend-bytes",
        "a later request must see what the backend holds, not the unconfirmed write",
      );
      assertEquals(
        harness.backendGets(),
        1,
        "a value the backend never confirmed must not reach a later request from the process-local tier",
      );

      harness.releaseWrites();
      await pendingWrite;
    });

    it("should return boolean", async () => {
      assertEquals(typeof (await initializeFileCacheBackend()), "boolean");
    });
  });

  describe("process-local tier invalidation", () => {
    /**
     * Every way a FileCache is told an entry is gone. Each must reach the
     * process-local tier, or a warmed entry outlives its own invalidation for
     * the whole TTL.
     */
    const entryPoints: Array<{
      name: string;
      tag: string;
      invalidate: (cache: FileCacheLike) => void | Promise<void>;
    }> = [
      {
        name: "set()",
        tag: "set",
        invalidate: (cache) => cache.set(IMMUTABLE_RELEASE_KEY, "rewritten"),
      },
      {
        name: "setAsync()",
        tag: "set-async",
        invalidate: (cache) => cache.setAsync(IMMUTABLE_RELEASE_KEY, "rewritten"),
      },
      {
        name: "delete()",
        tag: "delete",
        invalidate: (cache): void => {
          cache.delete(IMMUTABLE_RELEASE_KEY);
        },
      },
      {
        name: "deleteAsync()",
        tag: "delete-async",
        invalidate: (cache) => cache.deleteAsync(IMMUTABLE_RELEASE_KEY),
      },
      {
        name: "deleteByPrefix()",
        tag: "delete-by-prefix",
        invalidate: (cache): void => {
          cache.deleteByPrefix(IMMUTABLE_RELEASE_PREFIX);
        },
      },
      {
        name: "deleteByPrefixAsync()",
        tag: "delete-by-prefix-async",
        invalidate: (cache) => cache.deleteByPrefixAsync(IMMUTABLE_RELEASE_PREFIX),
      },
      {
        name: "deleteByPrefixAndSuffix()",
        tag: "delete-by-prefix-and-suffix",
        invalidate: (cache): void => {
          cache.deleteByPrefixAndSuffix(IMMUTABLE_RELEASE_PREFIX, IMMUTABLE_RELEASE_SUFFIX);
        },
      },
      {
        name: "deleteByPrefixAndSuffixAsync()",
        tag: "delete-by-prefix-and-suffix-async",
        invalidate: (cache) =>
          cache.deleteByPrefixAndSuffixAsync(IMMUTABLE_RELEASE_PREFIX, IMMUTABLE_RELEASE_SUFFIX),
      },
      {
        name: "clear()",
        tag: "clear",
        invalidate: (cache): void => cache.clear(),
      },
    ];

    for (const entryPoint of entryPoints) {
      it(`${entryPoint.name} forces the next request back to the backend`, async () => {
        const distributedModule = await import(`./file-cache.ts?issue-602-inv-${entryPoint.tag}`);
        const harness = await useCountingDistributedBackend(distributedModule);

        await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "published");
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);

        // Positive control: without it a broken warm path would make the
        // assertion below pass for the wrong reason.
        harness.resetBackendGets();
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);
        assertEquals(
          harness.backendGets(),
          0,
          "the entry must be warm in the process-local tier before it is invalidated",
        );

        await entryPoint.invalidate(harness.cache);

        harness.resetBackendGets();
        await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);
        assertEquals(
          harness.backendGets(),
          1,
          `${entryPoint.name} must drop the process-local entry, not only the backend one`,
        );
      });
    }
  });

  describe("reinstate-after-invalidation race", () => {
    /**
     * `getCachedWithBatching` hands a read that starts now the promise of a
     * read that started earlier. A read starting AFTER an invalidation
     * therefore receives a PRE-invalidation value while carrying a
     * post-invalidation generation token, and must not be admitted on it.
     */
    async function runRaceProbe(
      tag: string,
      invalidate: (cache: FileCacheLike) => void | Promise<void>,
    ): Promise<{ value: string | undefined; backendGets: number }> {
      const distributedModule = await import(`./file-cache.ts?issue-602-race-${tag}`);
      const harness = await useCountingDistributedBackend(distributedModule);
      await harness.cache.setAsync(IMMUTABLE_RELEASE_KEY, "stale");

      harness.holdReads();
      await runWithCacheKeyContext(
        { projectId: "proj-a", mode: "production", versionId: "rel-1" },
        () =>
          runWithCacheBatching(async () => {
            const first = harness.cache.getAsync<string>(IMMUTABLE_RELEASE_KEY);
            await harness.readStarted();

            await invalidate(harness.cache);
            harness.removeFromBackend(IMMUTABLE_RELEASE_KEY);

            // Starts after the invalidation, so it takes a post-bump token, and
            // joins the pending read that started before it.
            const second = harness.cache.getAsync<string>(IMMUTABLE_RELEASE_KEY);
            harness.releaseReads();
            await first;
            await second;
          }),
      );

      harness.resetBackendGets();
      const value = await readInRequest(harness.cache, "proj-a", IMMUTABLE_RELEASE_KEY);
      return { value, backendGets: harness.backendGets() };
    }

    it("does not reinstate a value deleted while a read was in flight", async () => {
      const probe = await runRaceProbe("delete", (cache) => {
        cache.delete(IMMUTABLE_RELEASE_KEY);
      });

      assertEquals(
        probe.value,
        undefined,
        "a key deleted mid-read must not be served from the process-local tier afterwards",
      );
      assertEquals(
        probe.backendGets,
        1,
        "the later request must reach the backend rather than a reinstated entry",
      );
    });

    it("does not reinstate a value whose prefix was invalidated mid-read", async () => {
      const probe = await runRaceProbe("prefix", (cache) => {
        cache.deleteByPrefix(IMMUTABLE_RELEASE_PREFIX);
      });

      assertEquals(
        probe.value,
        undefined,
        "a prefix invalidated mid-read must not leave a reinstated entry behind",
      );
      assertEquals(
        probe.backendGets,
        1,
        "the later request must reach the backend rather than a reinstated entry",
      );
    });

    it("does not reinstate a value cleared mid-read", async () => {
      const probe = await runRaceProbe("clear", (cache) => cache.clear());

      assertEquals(
        probe.value,
        undefined,
        "a clear during a read must not leave a reinstated entry behind",
      );
      assertEquals(
        probe.backendGets,
        1,
        "the later request must reach the backend rather than a reinstated entry",
      );
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
