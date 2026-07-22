import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { CacheBackend } from "#veryfront/cache/backend.ts";
import {
  __injectCachesForTests,
  destroyTransformCache,
  generateCacheKey,
  getCachedTransform,
  getCachedTransformAsync,
  getOrComputeTransform,
  setCachedTransform,
  setCachedTransformAsync,
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

    it("retains fallback entries larger than the default LRU byte limit", () => {
      __injectCachesForTests(null);
      __injectCachesForTests({ cacheBackend: null });
      destroyTransformCache();

      try {
        const largeTransform = "x".repeat(26 * 1024 * 1024);
        setCachedTransform("large-key", largeTransform, "large-hash");

        const result = getCachedTransform("large-key");
        assertEquals(result?.code.length, largeTransform.length);
        assertEquals(result?.hash, "large-hash");
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

    it("detaches an aborted caller without cancelling the shared transform", async () => {
      const controller = new AbortController();
      const abortedCallerPhases: string[] = [];
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

      const abortedCaller = getOrComputeTransform(
        "aborted-progress-key",
        async (reportProgress) => {
          computeCalls++;
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

      releaseCompute();
      const followerResult = await follower;

      assertEquals(computeCalls, 1);
      assertEquals(followerResult.code, "shared-after-abort");
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

      __injectCachesForTests({ cacheBackend: abortingCacheBackend });
      const alreadyAbortedCaller = getOrComputeTransform(
        "already-aborted-key",
        async () => "shared-after-already-aborted",
        300,
        undefined,
        controller.signal,
      );

      await assertRejects(() => alreadyAbortedCaller, Error, "caller already timed out");
      assertEquals(addAbortListenerCalls, 0);
      assertEquals(removeAbortListenerCalls, 0);

      resolveCacheGet(null);
      await new Promise((resolve) => setTimeout(resolve, 0));
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
  });
});
