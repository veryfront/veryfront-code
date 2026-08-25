import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import type { CacheBackend } from "#veryfront/cache/backend.ts";
import { CACHE_DIR_TOKEN } from "#veryfront/cache/paths.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import {
  __injectCachesForTests,
  destroyTransformCache,
  generateCacheKey,
  getCachedTransform,
  getCachedTransformAsync,
  getOrComputeTransform,
  setCachedTransform,
  setCachedTransformAsync,
  TRANSFORM_FLIGHT_STALE_EVICTION_MS,
} from "./transform-cache.ts";

describe("transforms/esm/transform-cache", () => {
  describe("generateCacheKey", () => {
    it("generates a string key", () => {
      const key = generateCacheKey("app/page.tsx", "abc123");
      assertEquals(typeof key, "string");
      assertEquals(key.length > 0, true);
    });

    it("includes file path info", () => {
      const key = generateCacheKey("app/page.tsx", "abc123");
      assertEquals(key.includes("app/page.tsx"), true);
    });

    it("produces different keys for different content hashes", () => {
      const key1 = generateCacheKey("app/page.tsx", "abc");
      const key2 = generateCacheKey("app/page.tsx", "def");
      assertEquals(key1 !== key2, true);
    });

    it("produces different keys for SSR vs browser", () => {
      const key1 = generateCacheKey("app/page.tsx", "abc", true);
      const key2 = generateCacheKey("app/page.tsx", "abc", false);
      assertEquals(key1 !== key2, true);
    });

    it("produces different keys for studioEmbed vs non-studioEmbed", () => {
      const key1 = generateCacheKey("app/page.tsx", "abc", false, true);
      const key2 = generateCacheKey("app/page.tsx", "abc", false, false);
      assertEquals(key1 !== key2, true);
    });

    it("includes depsHash when provided", () => {
      const key1 = generateCacheKey("app/page.tsx", "abc", false, false, { depsHash: "deps1" });
      const key2 = generateCacheKey("app/page.tsx", "abc", false, false, { depsHash: "deps2" });
      assertEquals(key1 !== key2, true);
    });

    it("includes configHash when provided", () => {
      const key1 = generateCacheKey("app/page.tsx", "abc", false, false, { configHash: "cfg1" });
      const key2 = generateCacheKey("app/page.tsx", "abc", false, false, { configHash: "cfg2" });
      assertEquals(key1 !== key2, true);
    });
  });

  describe("getCachedTransform / setCachedTransform", () => {
    beforeEach(() => {
      const testMap = new Map<string, { code: string; hash: string; timestamp: number }>();
      __injectCachesForTests({ localFallback: testMap, cacheBackend: null });
    });

    afterEach(() => {
      destroyTransformCache();
      __injectCachesForTests(null);
    });

    it("returns undefined for missing key", () => {
      assertEquals(getCachedTransform("nonexistent"), undefined);
    });

    it("stores and retrieves a transform", () => {
      setCachedTransform("test-key", "const x = 1;", "hash1");
      const result = getCachedTransform("test-key");
      assertEquals(result?.code, "const x = 1;");
      assertEquals(result?.hash, "hash1");
    });

    it("overwrites existing entry", () => {
      setCachedTransform("test-key", "const x = 1;", "hash1");
      setCachedTransform("test-key", "const x = 2;", "hash2");
      const result = getCachedTransform("test-key");
      assertEquals(result?.code, "const x = 2;");
      assertEquals(result?.hash, "hash2");
    });

    it("stores timestamp", () => {
      setCachedTransform("test-key", "const x = 1;", "hash1");
      const result = getCachedTransform("test-key");
      assertEquals(typeof result?.timestamp, "number");
      assertEquals(result!.timestamp > 0, true);
    });

    it("does not materialize and sort fallback entries during eviction", () => {
      __injectCachesForTests(null);
      __injectCachesForTests({ cacheBackend: null });
      destroyTransformCache();

      const originalArrayFrom = Array.from;
      let arrayFromCalls = 0;

      Object.defineProperty(Array, "from", {
        configurable: true,
        writable: true,
        value: function (...args: unknown[]) {
          arrayFromCalls++;
          return Reflect.apply(originalArrayFrom, Array, args);
        },
      });

      try {
        for (let i = 0; i < 501; i++) {
          setCachedTransform(`key-${i}`, `const value = ${i};`, `hash-${i}`);
        }

        assertEquals(arrayFromCalls, 0);
      } finally {
        Object.defineProperty(Array, "from", {
          configurable: true,
          writable: true,
          value: originalArrayFrom,
        });
        destroyTransformCache();
      }
    });

    it("evicts the least recently used fallback entry", () => {
      __injectCachesForTests(null);
      __injectCachesForTests({ cacheBackend: null });
      destroyTransformCache();

      try {
        for (let i = 0; i < 500; i++) {
          setCachedTransform(`key-${i}`, `const value = ${i};`, `hash-${i}`);
        }

        assertEquals(getCachedTransform("key-0")?.hash, "hash-0");
        setCachedTransform("key-500", "const value = 500;", "hash-500");

        assertEquals(getCachedTransform("key-0")?.hash, "hash-0");
        assertEquals(getCachedTransform("key-1"), undefined);
        assertEquals(getCachedTransform("key-500")?.hash, "hash-500");
      } finally {
        destroyTransformCache();
      }
    });

    it("does not retain fallback entries larger than the byte limit", () => {
      __injectCachesForTests(null);
      __injectCachesForTests({ cacheBackend: null });
      destroyTransformCache();

      try {
        const largeTransform = "x".repeat(26 * 1024 * 1024);
        setCachedTransform("large-key", largeTransform, "large-hash");

        assertEquals(getCachedTransform("large-key"), undefined);
      } finally {
        destroyTransformCache();
      }
    });

    it("rejects an oversized entry without flushing existing entries", () => {
      __injectCachesForTests(null);
      __injectCachesForTests({ cacheBackend: null });
      destroyTransformCache();

      try {
        setCachedTransform("small-key-1", "small-code-1", "small-hash-1");
        setCachedTransform("small-key-2", "small-code-2", "small-hash-2");

        const oversizedTransform = "x".repeat(26 * 1024 * 1024);
        setCachedTransform("oversized-key", oversizedTransform, "oversized-hash");

        assertEquals(getCachedTransform("oversized-key"), undefined);
        assertEquals(getCachedTransform("small-key-1")?.hash, "small-hash-1");
        assertEquals(getCachedTransform("small-key-2")?.hash, "small-hash-2");
      } finally {
        destroyTransformCache();
      }
    });

    it("evicts least recently used entries to stay within the byte limit", () => {
      __injectCachesForTests(null);
      __injectCachesForTests({ cacheBackend: null });
      destroyTransformCache();

      try {
        const largeTransform = "x".repeat(20 * 1024 * 1024);
        setCachedTransform("large-key-1", largeTransform, "large-hash-1");
        setCachedTransform("large-key-2", largeTransform, "large-hash-2");

        assertEquals(getCachedTransform("large-key-1"), undefined);
        assertEquals(getCachedTransform("large-key-2")?.hash, "large-hash-2");
      } finally {
        destroyTransformCache();
      }
    });

    it("counts the retained key string against the byte limit", () => {
      __injectCachesForTests(null);
      __injectCachesForTests({ cacheBackend: null });
      destroyTransformCache();

      try {
        const hugeKey = "k".repeat(26 * 1024 * 1024);
        setCachedTransform(hugeKey, "tiny-code", "tiny-hash");

        assertEquals(
          getCachedTransform(hugeKey),
          undefined,
          "an entry with a huge key must not be retained even when its code is tiny",
        );
      } finally {
        destroyTransformCache();
      }
    });
  });

  describe("default local fallback eviction", () => {
    beforeEach(() => {
      __injectCachesForTests(null);
      destroyTransformCache();
    });

    afterEach(() => {
      Array.prototype.sort = originalArraySort;
      destroyTransformCache();
      __injectCachesForTests(null);
    });

    const originalArraySort = Array.prototype.sort;

    it("evicts without sorting all fallback entries", () => {
      Array.prototype.sort = function sortShouldNotRun() {
        throw new Error("fallback eviction should not sort entries");
      } as typeof Array.prototype.sort;

      for (let index = 0; index <= 500; index++) {
        setCachedTransform(`key-${index}`, `const value = ${index};`, `hash-${index}`);
      }

      assertEquals(getCachedTransform("key-0"), undefined);
      assertEquals(getCachedTransform("key-1")?.code, "const value = 1;");
      assertEquals(getCachedTransform("key-500")?.code, "const value = 500;");
    });
  });

  describe("getCachedTransformAsync / setCachedTransformAsync", () => {
    beforeEach(() => {
      const testMap = new Map<string, { code: string; hash: string; timestamp: number }>();
      __injectCachesForTests({ localFallback: testMap, cacheBackend: null });
    });

    afterEach(() => {
      destroyTransformCache();
      __injectCachesForTests(null);
    });

    it("returns undefined for missing key", async () => {
      const result = await getCachedTransformAsync("nonexistent-async");
      assertEquals(result, undefined);
    });

    it("stores and retrieves a transform async", async () => {
      await setCachedTransformAsync("async-key", "const y = 2;", "hash2");
      const result = await getCachedTransformAsync("async-key");
      assertEquals(result?.code, "const y = 2;");
    });

    it("stores bundleManifestId when provided", async () => {
      await setCachedTransformAsync("manifest-key", "const x = 1;", "hash1", 300, "manifest-abc");
      const result = await getCachedTransformAsync("manifest-key");
      assertEquals(result?.bundleManifestId, "manifest-abc");
    });

    it("stores unresolved dependency observations for cache-hit replay", async () => {
      await setCachedTransformAsync(
        "dependency-observation-key",
        "const x = 1;",
        "hash1",
        300,
        undefined,
        [{ packageName: "zod", declaration: "^4" }],
      );

      const result = await getCachedTransformAsync("dependency-observation-key");
      assertEquals(result?.dependencyResolutionObservations, [
        { packageName: "zod", declaration: "^4" },
      ]);
    });

    it("counts dependency observation declarations against the byte limit", async () => {
      __injectCachesForTests(null);
      __injectCachesForTests({ cacheBackend: null });
      destroyTransformCache();

      try {
        await setCachedTransformAsync("small-meta-key", "small-code", "small-hash");

        // Tiny code, but ~52MB of retained dependency declarations.
        const hugeDeclaration = "d".repeat(13 * 1024 * 1024);
        await setCachedTransformAsync(
          "huge-observations-key",
          "tiny-code",
          "tiny-hash",
          300,
          undefined,
          [
            { packageName: "pkg-a", declaration: hugeDeclaration },
            { packageName: "pkg-b", declaration: hugeDeclaration },
          ],
        );

        assertEquals(
          await getCachedTransformAsync("huge-observations-key"),
          undefined,
          "an entry with oversized observation metadata must not be retained",
        );
        assertEquals(
          (await getCachedTransformAsync("small-meta-key"))?.hash,
          "small-hash",
          "rejecting an oversized entry must not flush existing entries",
        );
      } finally {
        destroyTransformCache();
      }
    });

    it("counts the bundle manifest id against the byte limit", async () => {
      __injectCachesForTests(null);
      __injectCachesForTests({ cacheBackend: null });
      destroyTransformCache();

      try {
        // Tiny code, but a ~52MB retained bundle manifest id.
        const hugeManifestId = "m".repeat(26 * 1024 * 1024);
        await setCachedTransformAsync(
          "huge-manifest-key",
          "tiny-code",
          "tiny-hash",
          300,
          hugeManifestId,
        );

        assertEquals(
          await getCachedTransformAsync("huge-manifest-key"),
          undefined,
          "an entry with an oversized bundle manifest id must not be retained",
        );
      } finally {
        destroyTransformCache();
      }
    });

    it("evicts least recently used entries when metadata exceeds the byte limit", async () => {
      __injectCachesForTests(null);
      __injectCachesForTests({ cacheBackend: null });
      destroyTransformCache();

      try {
        // Tiny code, but each entry retains ~20MB of observation metadata.
        const declaration = "d".repeat(10 * 1024 * 1024);
        for (let index = 1; index <= 3; index++) {
          await setCachedTransformAsync(
            `meta-key-${index}`,
            "tiny-code",
            `meta-hash-${index}`,
            300,
            undefined,
            [{ packageName: "pkg", declaration }],
          );
        }

        assertEquals(
          await getCachedTransformAsync("meta-key-1"),
          undefined,
          "metadata-heavy entries must evict the least recently used entry",
        );
        assertEquals((await getCachedTransformAsync("meta-key-2"))?.hash, "meta-hash-2");
        assertEquals((await getCachedTransformAsync("meta-key-3"))?.hash, "meta-hash-3");
      } finally {
        destroyTransformCache();
      }
    });

    it("discards a backend entry whose code is empty", async () => {
      const cacheBackend: CacheBackend = {
        type: "memory",
        get: () =>
          Promise.resolve(JSON.stringify({ code: "", hash: "hash-empty", timestamp: Date.now() })),
        set: () => Promise.resolve(),
        del: () => Promise.resolve(),
      };
      __injectCachesForTests({ cacheBackend });

      assertEquals(
        await getCachedTransformAsync("empty-code-key"),
        undefined,
        "an empty-code cache entry must be discarded instead of served for its whole TTL",
      );
    });

    it("falls back to the local cache when the distributed backend rejects", async () => {
      const cacheBackend: CacheBackend = {
        type: "redis",
        get: () => Promise.reject(new Error("redis down")),
        set: () => Promise.reject(new Error("redis down")),
        del: () => Promise.resolve(),
      };
      __injectCachesForTests({ cacheBackend });

      await setCachedTransformAsync("redis-down-key", "const x = 1;", "hash-x");

      assertEquals(
        (await getCachedTransformAsync("redis-down-key"))?.code,
        "const x = 1;",
        "a distributed-cache outage must degrade to the local fallback, not throw",
      );
    });
  });

  describe("getOrComputeTransform", () => {
    beforeEach(() => {
      const testMap = new Map<string, { code: string; hash: string; timestamp: number }>();
      __injectCachesForTests({ localFallback: testMap, cacheBackend: null });
    });

    afterEach(() => {
      destroyTransformCache();
      __injectCachesForTests(null);
    });

    it("computes on cache miss", async () => {
      let computed = false;
      const result = await getOrComputeTransform("miss-key", async () => {
        computed = true;
        return "computed-code";
      });
      assertEquals(computed, true);
      assertEquals(result.code, "computed-code");
      assertEquals(result.cacheHit, false);
    });

    it("returns cached value on hit", async () => {
      // First call populates cache
      await getOrComputeTransform("hit-key", async () => "first-value");

      // Second call should be a cache hit
      let computed = false;
      const result = await getOrComputeTransform("hit-key", async () => {
        computed = true;
        return "second-value";
      });
      assertEquals(computed, false);
      assertEquals(result.code, "first-value");
      assertEquals(result.cacheHit, true);
    });

    it("publishes and returns dependency observations across cache hits", async () => {
      const observations = [{ packageName: "zod", declaration: "^4" }];
      const first = await getOrComputeTransform(
        "observation-hit-key",
        async () => "first-value",
        300,
        undefined,
        undefined,
        undefined,
        () => observations,
      );
      assertEquals(first.dependencyResolutionObservations, observations);

      const second = await getOrComputeTransform(
        "observation-hit-key",
        async () => "unexpected-value",
      );
      assertEquals(second.cacheHit, true);
      assertEquals(second.dependencyResolutionObservations, observations);
    });

    it("recomputes when the cached entry validator rejects a cache hit", async () => {
      await getOrComputeTransform("invalid-hit-key", async () => "stale-value");

      let computeCalls = 0;
      let validationCalls = 0;
      const result = await getOrComputeTransform(
        "invalid-hit-key",
        async () => {
          computeCalls++;
          return "fresh-value";
        },
        300,
        undefined,
        undefined,
        (entry) => {
          validationCalls++;
          assertEquals(entry.code, "stale-value");
          assertEquals(entry.cacheHit, true);
          return false;
        },
      );

      assertEquals(result, { code: "fresh-value", cacheHit: false });
      assertEquals(computeCalls, 1);
      assertEquals(validationCalls, 1);

      const cached = await getOrComputeTransform(
        "invalid-hit-key",
        async () => "unexpected-value",
      );
      assertEquals(cached.code, "fresh-value");
      assertEquals(cached.cacheHit, true);
    });

    it("recomputes when cached-entry validation throws", async () => {
      await getOrComputeTransform("validator-error-key", async () => "stale-value");

      let computeCalls = 0;
      const result = await getOrComputeTransform(
        "validator-error-key",
        async () => {
          computeCalls++;
          return "fresh-value";
        },
        300,
        undefined,
        undefined,
        () => {
          throw new Error("stat failed");
        },
      );

      assertEquals(result, { code: "fresh-value", cacheHit: false });
      assertEquals(computeCalls, 1);
    });

    it("shares cached-entry validation and repair across concurrent callers", async () => {
      await getOrComputeTransform("invalid-shared-key", async () => "stale-shared-value");

      let computeCalls = 0;
      let validationCalls = 0;
      let releaseValidation!: () => void;
      let markValidationStarted!: () => void;
      const validationGate = new Promise<void>((resolve) => {
        releaseValidation = resolve;
      });
      const validationStarted = new Promise<void>((resolve) => {
        markValidationStarted = resolve;
      });

      const validateCachedEntry = async () => {
        validationCalls++;
        markValidationStarted();
        await validationGate;
        return false;
      };

      const first = getOrComputeTransform(
        "invalid-shared-key",
        async () => {
          computeCalls++;
          return "fresh-shared-value";
        },
        300,
        undefined,
        undefined,
        validateCachedEntry,
      );

      await validationStarted;

      const second = getOrComputeTransform(
        "invalid-shared-key",
        async () => {
          computeCalls++;
          return "unexpected-shared-value";
        },
        300,
        undefined,
        undefined,
        validateCachedEntry,
      );

      await Promise.resolve();
      assertEquals(validationCalls, 1);
      assertEquals(computeCalls, 0);

      releaseValidation();
      const [firstResult, secondResult] = await Promise.all([first, second]);

      assertEquals(firstResult, { code: "fresh-shared-value", cacheHit: false });
      assertEquals(secondResult, { code: "fresh-shared-value", cacheHit: false });
      assertEquals(validationCalls, 1);
      assertEquals(computeCalls, 1);
    });

    it("repairs a detokenized distributed framework reference once", async () => {
      const key = "distributed-framework-repair-key";
      const frameworkPath =
        `${getCacheBaseDir()}/veryfront-mdx-esm/framework/vfmod-vf-framework-missing.mjs`;
      const staleCode = `import helper from "file://${frameworkPath}";`;
      let storedValue: string | null = null;
      let setCalls = 0;
      const repairPublished = Promise.withResolvers<void>();
      const cacheBackend: CacheBackend = {
        type: "redis",
        get: () => Promise.resolve(storedValue),
        set: (_key, value) => {
          storedValue = value;
          setCalls++;
          if (setCalls === 2) repairPublished.resolve();
          return Promise.resolve();
        },
        del: () => Promise.resolve(),
      };
      __injectCachesForTests({ cacheBackend });

      await setCachedTransformAsync(key, staleCode, "stale-hash");
      const portableEntry = await cacheBackend.get(key);
      assertEquals(portableEntry?.includes(CACHE_DIR_TOKEN), true);
      assertEquals(portableEntry?.includes(frameworkPath), false);

      let computeCalls = 0;
      let validationCalls = 0;
      const validationStarted = Promise.withResolvers<void>();
      const releaseValidation = Promise.withResolvers<void>();
      const validateCachedEntry = async (entry: { code: string }) => {
        validationCalls++;
        assertEquals(entry.code.includes(frameworkPath), true);
        assertEquals(entry.code.includes(CACHE_DIR_TOKEN), false);
        validationStarted.resolve();
        await releaseValidation.promise;
        return false;
      };

      const first = getOrComputeTransform(
        key,
        async () => {
          computeCalls++;
          return "export const repaired = true;";
        },
        300,
        undefined,
        undefined,
        validateCachedEntry,
      );
      await validationStarted.promise;
      const second = getOrComputeTransform(
        key,
        async () => {
          computeCalls++;
          return "export const duplicate = true;";
        },
        300,
        undefined,
        undefined,
        validateCachedEntry,
      );

      releaseValidation.resolve();
      const [firstResult, secondResult] = await Promise.all([first, second]);
      await repairPublished.promise;

      assertEquals(firstResult.code, "export const repaired = true;");
      assertEquals(secondResult.code, "export const repaired = true;");
      assertEquals(validationCalls, 1);
      assertEquals(computeCalls, 1);
      assertEquals(
        (await getCachedTransformAsync(key))?.code,
        "export const repaired = true;",
      );
    });

    it("coalesces concurrent cold misses for the same key", async () => {
      let computeCalls = 0;
      let releaseCompute!: () => void;
      let markComputeStarted!: () => void;
      const computeGate = new Promise<void>((resolve) => {
        releaseCompute = resolve;
      });
      const computeStarted = new Promise<void>((resolve) => {
        markComputeStarted = resolve;
      });

      const first = getOrComputeTransform("cold-key", async () => {
        computeCalls++;
        markComputeStarted();
        await computeGate;
        return "shared-code";
      });

      await computeStarted;

      const second = getOrComputeTransform("cold-key", async () => {
        computeCalls++;
        return "unexpected-code";
      });

      await Promise.resolve();
      assertEquals(computeCalls, 1);

      releaseCompute();
      const [firstResult, secondResult] = await Promise.all([first, second]);

      assertEquals(firstResult, { code: "shared-code", cacheHit: false });
      assertEquals(secondResult, { code: "shared-code", cacheHit: false });
      assertEquals(computeCalls, 1);

      let laterComputed = false;
      const cachedResult = await getOrComputeTransform("cold-key", async () => {
        laterComputed = true;
        return "later-code";
      });

      assertEquals(laterComputed, false);
      assertEquals(cachedResult.code, "shared-code");
      assertEquals(cachedResult.cacheHit, true);
    });

    it("broadcasts leader progress to followers of the same cold transform", async () => {
      const leaderPhases: string[] = [];
      const followerPhases: string[] = [];
      let computeCalls = 0;
      let releaseCompute!: () => void;
      let markComputeStarted!: () => void;
      const computeGate = new Promise<void>((resolve) => {
        releaseCompute = resolve;
      });
      const computeStarted = new Promise<void>((resolve) => {
        markComputeStarted = resolve;
      });

      const first = getOrComputeTransform(
        "progress-key",
        async (reportProgress) => {
          computeCalls++;
          reportProgress?.({ phase: "leader:started" });
          markComputeStarted();
          await computeGate;
          reportProgress?.({ phase: "leader:finished" });
          return "shared-progress-code";
        },
        300,
        (event) => leaderPhases.push(event.phase),
      );

      await computeStarted;

      const second = getOrComputeTransform(
        "progress-key",
        async () => {
          computeCalls++;
          return "unexpected-code";
        },
        300,
        (event) => followerPhases.push(event.phase),
      );

      assertEquals(followerPhases.includes("leader:started"), true);
      releaseCompute();
      await Promise.all([first, second]);

      assertEquals(computeCalls, 1);
      assertEquals(leaderPhases.includes("leader:finished"), true);
      assertEquals(followerPhases.includes("leader:finished"), true);
    });

    it("replays early leader progress even when no leader listener was registered", async () => {
      const followerPhases: string[] = [];
      let computeCalls = 0;
      let releaseCompute!: () => void;
      let markComputeStarted!: () => void;
      const computeGate = new Promise<void>((resolve) => {
        releaseCompute = resolve;
      });
      const computeStarted = new Promise<void>((resolve) => {
        markComputeStarted = resolve;
      });

      const leader = getOrComputeTransform(
        "leader-only-progress-key",
        async (reportProgress) => {
          computeCalls++;
          reportProgress?.({ phase: "leader:started" });
          markComputeStarted();
          await computeGate;
          reportProgress?.({ phase: "leader:finished" });
          return "shared-progress-code";
        },
      );

      await computeStarted;

      const follower = getOrComputeTransform(
        "leader-only-progress-key",
        async () => {
          computeCalls++;
          return "unexpected-code";
        },
        300,
        (event) => followerPhases.push(event.phase),
      );

      assertEquals(followerPhases.includes("leader:started"), true);
      releaseCompute();
      await Promise.all([leader, follower]);

      assertEquals(computeCalls, 1);
      assertEquals(followerPhases.includes("leader:finished"), true);
    });

    it("keeps late progress from a reset flight isolated from its replacement", async () => {
      let releaseOld!: () => void;
      let markOldStarted!: () => void;
      const oldGate = new Promise<void>((resolve) => releaseOld = resolve);
      const oldStarted = new Promise<void>((resolve) => markOldStarted = resolve);
      const oldFlight = getOrComputeTransform("reset-progress-key", async (reportProgress) => {
        reportProgress?.({ phase: "old:started" });
        markOldStarted();
        await oldGate;
        reportProgress?.({ phase: "old:finished" });
        return "old-code";
      });

      await oldStarted;
      destroyTransformCache();

      let releaseReplacement!: () => void;
      let markReplacementStarted!: () => void;
      const replacementGate = new Promise<void>((resolve) => releaseReplacement = resolve);
      const replacementStarted = new Promise<void>((resolve) => markReplacementStarted = resolve);
      const replacement = getOrComputeTransform(
        "reset-progress-key",
        async (reportProgress) => {
          reportProgress?.({ phase: "replacement:started" });
          markReplacementStarted();
          await replacementGate;
          return "replacement-code";
        },
      );

      await replacementStarted;
      releaseOld();
      await oldFlight;

      const followerPhases: string[] = [];
      const follower = getOrComputeTransform(
        "reset-progress-key",
        async () => "unexpected-code",
        300,
        (event) => followerPhases.push(event.phase),
      );

      assertEquals(followerPhases, ["replacement:started"]);
      releaseReplacement();
      await Promise.all([replacement, follower]);
      assertEquals(followerPhases.includes("old:finished"), false);
    });

    it("isolates a throwing listener during late progress replay", async () => {
      let computeCalls = 0;
      let listenerCalls = 0;
      let releaseCompute!: () => void;
      let markComputeStarted!: () => void;
      const computeGate = new Promise<void>((resolve) => {
        releaseCompute = resolve;
      });
      const computeStarted = new Promise<void>((resolve) => {
        markComputeStarted = resolve;
      });

      const leader = getOrComputeTransform(
        "throwing-progress-listener-key",
        async (reportProgress) => {
          computeCalls++;
          reportProgress?.({ phase: "leader:started" });
          markComputeStarted();
          await computeGate;
          return "shared-code";
        },
        300,
        () => {},
      );

      await computeStarted;

      const follower = getOrComputeTransform(
        "throwing-progress-listener-key",
        async () => {
          computeCalls++;
          return "unexpected-code";
        },
        300,
        () => {
          listenerCalls++;
          throw new Error("listener failure");
        },
      );

      releaseCompute();
      const [, followerResult] = await Promise.all([leader, follower]);

      assertEquals(computeCalls, 1);
      assertEquals(listenerCalls > 0, true);
      assertEquals(followerResult.code, "shared-code");
    });

    it("cancels a shared transform after its last caller aborts", async () => {
      const controller = new AbortController();
      const computeStarted = Promise.withResolvers<void>();
      let sharedSignal: AbortSignal | undefined;

      const caller = getOrComputeTransform(
        "orphaned-transform-key",
        (_reportProgress, abortSignal) => {
          sharedSignal = abortSignal;
          computeStarted.resolve();
          return new Promise<string>((_resolve, reject) => {
            const onAbort = () => reject(abortSignal?.reason);
            abortSignal?.addEventListener("abort", onAbort, { once: true });
          });
        },
        300,
        undefined,
        controller.signal,
      );

      await computeStarted.promise;
      controller.abort(new Error("caller timed out"));
      await assertRejects(() => caller, Error, "caller timed out");

      assertEquals(sharedSignal?.aborted, true);
    });

    it("does not attach a new caller to an abandoned transform flight", async () => {
      const key = `abandoned-transform-${crypto.randomUUID()}`;
      const controller = new AbortController();
      const started = Promise.withResolvers<void>();
      const releaseOld = Promise.withResolvers<string>();
      const abortReason = new DOMException("render abandoned", "AbortError");
      let replacement: Promise<{ code: string; cacheHit: boolean }> | undefined;
      let replacementExecutions = 0;

      const abandoned = getOrComputeTransform(
        key,
        (_reportProgress, abortSignal) => {
          started.resolve();
          abortSignal?.addEventListener("abort", () => {
            replacement = getOrComputeTransform(key, () => {
              replacementExecutions++;
              return Promise.resolve("fresh transform");
            });
          }, { once: true });
          return releaseOld.promise;
        },
        300,
        undefined,
        controller.signal,
      );
      await started.promise;

      controller.abort(abortReason);
      assertEquals(await assertRejects(() => abandoned), abortReason);

      try {
        assertEquals(replacementExecutions, 1);
        assertEquals(await replacement!, { code: "fresh transform", cacheHit: false });
      } finally {
        releaseOld.resolve("stale transform");
        await Promise.resolve();
      }
    });

    it("detaches an aborted caller without cancelling the shared transform", async () => {
      const controller = new AbortController();
      const abortedCallerPhases: string[] = [];
      const followerPhases: string[] = [];
      let sharedSignal: AbortSignal | undefined;
      let computeCalls = 0;
      let releaseCompute!: () => void;
      let markComputeStarted!: () => void;
      const computeGate = new Promise<void>((resolve) => {
        releaseCompute = resolve;
      });
      const computeStarted = new Promise<void>((resolve) => {
        markComputeStarted = resolve;
      });

      const abortedCaller = getOrComputeTransform(
        "aborted-progress-key",
        async (reportProgress, abortSignal) => {
          computeCalls++;
          sharedSignal = abortSignal;
          reportProgress?.({ phase: "leader:started" });
          markComputeStarted();
          await computeGate;
          reportProgress?.({ phase: "leader:finished" });
          return "shared-after-abort";
        },
        300,
        (event) => abortedCallerPhases.push(event.phase),
        controller.signal,
      );

      await computeStarted;

      const follower = getOrComputeTransform(
        "aborted-progress-key",
        async () => {
          computeCalls++;
          return "unexpected-code";
        },
        300,
        (event) => followerPhases.push(event.phase),
      );

      controller.abort(new Error("caller timed out"));
      await assertRejects(() => abortedCaller, Error, "caller timed out");
      assertEquals(sharedSignal?.aborted, false);

      releaseCompute();
      const followerResult = await follower;

      assertEquals(computeCalls, 1);
      assertEquals(followerResult.code, "shared-after-abort");
      assertEquals(sharedSignal?.aborted, false);
      assertEquals(abortedCallerPhases.includes("leader:finished"), false);
      assertEquals(followerPhases.includes("leader:finished"), true);
    });

    it("does not retain an abort listener when the caller signal is aborted before registration", async () => {
      const controller = new AbortController();

      let addAbortListenerCalls = 0;
      let removeAbortListenerCalls = 0;
      const originalAddEventListener = controller.signal.addEventListener.bind(controller.signal);
      const originalRemoveEventListener = controller.signal.removeEventListener.bind(
        controller.signal,
      );

      controller.signal.addEventListener = function addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ): void {
        if (type === "abort") addAbortListenerCalls++;
        return originalAddEventListener(type, listener, options);
      };

      controller.signal.removeEventListener = function removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ): void {
        if (type === "abort") removeAbortListenerCalls++;
        return originalRemoveEventListener(type, listener, options);
      };

      let resolveCacheGet!: (value: string | null) => void;
      const cacheGet = new Promise<string | null>((resolve) => {
        resolveCacheGet = resolve;
      });

      const abortingCacheBackend: CacheBackend = {
        type: "memory",
        get() {
          controller.abort(new Error("caller already timed out"));
          return cacheGet;
        },
        set: () => Promise.resolve(),
        del: () => Promise.resolve(),
      };

      let markComputeFinished!: () => void;
      const computeFinished = new Promise<void>((resolve) => {
        markComputeFinished = resolve;
      });

      __injectCachesForTests({ cacheBackend: abortingCacheBackend });
      const alreadyAbortedCaller = getOrComputeTransform(
        "already-aborted-key",
        async () => {
          markComputeFinished();
          throw new Error("detached shared transform failed");
        },
        300,
        undefined,
        controller.signal,
      );

      await assertRejects(() => alreadyAbortedCaller, Error, "caller already timed out");
      assertEquals(addAbortListenerCalls, 0);
      assertEquals(removeAbortListenerCalls, 0);

      resolveCacheGet(null);
      await computeFinished;
      await Promise.resolve();
      assertEquals(addAbortListenerCalls, 0);
      assertEquals(removeAbortListenerCalls, 0);
    });

    it("cleans up a failed cold-miss flight so a later call can recompute", async () => {
      let computeCalls = 0;
      let releaseFailure!: () => void;
      let markComputeStarted!: () => void;
      const failureGate = new Promise<void>((resolve) => {
        releaseFailure = resolve;
      });
      const computeStarted = new Promise<void>((resolve) => {
        markComputeStarted = resolve;
      });

      const first = getOrComputeTransform("failing-key", async () => {
        computeCalls++;
        markComputeStarted();
        await failureGate;
        throw new Error("transform failed");
      });

      await computeStarted;

      const second = getOrComputeTransform("failing-key", async () => {
        computeCalls++;
        return "unexpected-code";
      });

      await Promise.resolve();
      assertEquals(computeCalls, 1);

      releaseFailure();
      await assertRejects(
        () => Promise.all([first, second]),
        Error,
        "transform failed",
      );
      assertEquals(computeCalls, 1);

      const recovered = await getOrComputeTransform("failing-key", async () => {
        computeCalls++;
        return "recovered-code";
      });

      assertEquals(recovered, { code: "recovered-code", cacheHit: false });
      assertEquals(computeCalls, 2);
    });

    it("allows recompute after a never-settling leader exceeds the stale window", async () => {
      using time = new FakeTime();
      const controller = new AbortController();
      let computeCalls = 0;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => markStarted = resolve);

      const abandonedCaller = getOrComputeTransform(
        "stalled-transform-key",
        async () => {
          computeCalls++;
          markStarted();
          return await new Promise<string>(() => {});
        },
        300,
        undefined,
        controller.signal,
      );

      await started;
      controller.abort(new Error("caller deadline"));
      await assertRejects(() => abandonedCaller, Error, "caller deadline");
      await time.tickAsync(TRANSFORM_FLIGHT_STALE_EVICTION_MS);

      const recovered = await getOrComputeTransform("stalled-transform-key", async () => {
        computeCalls++;
        return "recovered-code";
      });

      assertEquals(computeCalls, 2);
      assertEquals(recovered.code, "recovered-code");
    });

    it("does not let a late stale leader overwrite its replacement cache entry", async () => {
      using time = new FakeTime();
      let releaseStale!: () => void;
      let markStaleStarted!: () => void;
      const staleGate = new Promise<void>((resolve) => releaseStale = resolve);
      const staleStarted = new Promise<void>((resolve) => markStaleStarted = resolve);
      const stale = getOrComputeTransform("late-cache-write-key", async () => {
        markStaleStarted();
        await staleGate;
        return "stale-code";
      });

      await staleStarted;
      await time.tickAsync(TRANSFORM_FLIGHT_STALE_EVICTION_MS);
      const replacement = await getOrComputeTransform(
        "late-cache-write-key",
        async () => "replacement-code",
      );
      assertEquals(replacement.code, "replacement-code");

      releaseStale();
      await stale;
      await Promise.resolve();

      assertEquals(
        (await getCachedTransformAsync("late-cache-write-key"))?.code,
        "replacement-code",
      );
    });

    it("does not let a leader from a destroyed registry overwrite replacement cache", async () => {
      let releaseOldLeader!: () => void;
      let markOldLeaderStarted!: () => void;
      const oldLeaderGate = new Promise<void>((resolve) => releaseOldLeader = resolve);
      const oldLeaderStarted = new Promise<void>((resolve) => markOldLeaderStarted = resolve);
      const oldLeader = getOrComputeTransform("reset-cache-write-key", async () => {
        markOldLeaderStarted();
        await oldLeaderGate;
        return "old-code";
      });

      await oldLeaderStarted;
      destroyTransformCache();

      const replacement = await getOrComputeTransform(
        "reset-cache-write-key",
        async () => "replacement-code",
      );
      assertEquals(replacement.code, "replacement-code");

      releaseOldLeader();
      await oldLeader;
      await Promise.resolve();

      assertEquals(
        (await getCachedTransformAsync("reset-cache-write-key"))?.code,
        "replacement-code",
      );
    });

    it("serializes cache publication across a registry reset", async () => {
      const firstSetStarted = Promise.withResolvers<void>();
      const releaseFirstSet = Promise.withResolvers<void>();
      const secondSetStarted = Promise.withResolvers<void>();
      const releaseSecondSet = Promise.withResolvers<void>();
      const secondSetFinished = Promise.withResolvers<void>();
      let storedValue: string | null = null;
      let setCalls = 0;
      const cacheBackend: CacheBackend = {
        type: "memory",
        get: () => Promise.resolve(storedValue),
        async set(_key, value) {
          setCalls++;
          if (setCalls === 1) {
            firstSetStarted.resolve();
            await releaseFirstSet.promise;
          } else {
            secondSetStarted.resolve();
            await releaseSecondSet.promise;
          }
          storedValue = value;
          if (setCalls === 2) secondSetFinished.resolve();
        },
        del: () => Promise.resolve(),
      };
      __injectCachesForTests({ cacheBackend });

      const original = await getOrComputeTransform(
        "async-reset-cache-write-key",
        async () => "original-code",
      );
      assertEquals(original.code, "original-code");
      await firstSetStarted.promise;

      destroyTransformCache();
      const replacement = await getOrComputeTransform(
        "async-reset-cache-write-key",
        async () => "replacement-code",
      );
      assertEquals(replacement.code, "replacement-code");
      assertEquals(setCalls, 1);

      releaseFirstSet.resolve();
      await secondSetStarted.promise;
      releaseSecondSet.resolve();
      await secondSetFinished.promise;

      assertEquals(setCalls, 2);
      assertEquals(JSON.parse(storedValue ?? "null").code, "replacement-code");
    });

    it("preserves concurrent computes for different cold keys", async () => {
      let computeCalls = 0;
      let releaseFirst!: () => void;
      let releaseSecond!: () => void;
      let markFirstStarted!: () => void;
      let markSecondStarted!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const secondGate = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      const firstStarted = new Promise<void>((resolve) => {
        markFirstStarted = resolve;
      });
      const secondStarted = new Promise<void>((resolve) => {
        markSecondStarted = resolve;
      });

      const first = getOrComputeTransform("cold-key-a", async () => {
        computeCalls++;
        markFirstStarted();
        await firstGate;
        return "first-code";
      });

      const second = getOrComputeTransform("cold-key-b", async () => {
        computeCalls++;
        markSecondStarted();
        await secondGate;
        return "second-code";
      });

      await Promise.all([firstStarted, secondStarted]);
      assertEquals(computeCalls, 2);

      releaseFirst();
      releaseSecond();

      const [firstResult, secondResult] = await Promise.all([first, second]);
      assertEquals(firstResult, { code: "first-code", cacheHit: false });
      assertEquals(secondResult, { code: "second-code", cacheHit: false });
    });

    it("invalidates cache with unresolved _vf_modules imports", async () => {
      // Manually set a cache entry with unresolved _vf_modules
      await setCachedTransformAsync(
        "stale-key",
        'import { foo } from "_vf_modules/_veryfront/lib.js";',
        "hash1",
      );

      let computed = false;
      const result = await getOrComputeTransform("stale-key", async () => {
        computed = true;
        return "fresh-code";
      });
      assertEquals(computed, true);
      assertEquals(result.code, "fresh-code");
      assertEquals(result.cacheHit, false);
    });
  });

  describe("destroyTransformCache", () => {
    beforeEach(() => {
      const testMap = new Map<string, { code: string; hash: string; timestamp: number }>();
      __injectCachesForTests({ localFallback: testMap, cacheBackend: null });
    });

    afterEach(() => {
      __injectCachesForTests(null);
    });

    it("clears all entries", () => {
      setCachedTransform("k1", "code1", "h1");
      setCachedTransform("k2", "code2", "h2");
      destroyTransformCache();
      assertEquals(getCachedTransform("k1"), undefined);
      assertEquals(getCachedTransform("k2"), undefined);
    });

    it("aborts unsettled transform flights before resetting their registry", async () => {
      const started = Promise.withResolvers<void>();
      let finish!: (value: string) => void;
      let sharedSignal: AbortSignal | undefined;
      const pending = getOrComputeTransform(
        "unsettled-transform",
        (_reportProgress, abortSignal) => {
          sharedSignal = abortSignal;
          started.resolve();
          return new Promise<string>((resolve) => finish = resolve);
        },
      );
      await started.promise;

      try {
        destroyTransformCache();
        assertEquals(sharedSignal?.aborted, true);
        assertEquals(sharedSignal?.reason instanceof DOMException, true);
        assertEquals(sharedSignal?.reason.name, "AbortError");
      } finally {
        finish("stale transform");
        await pending;
      }
    });
  });
});
