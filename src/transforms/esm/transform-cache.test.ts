import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
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
import type { CacheBackend } from "#veryfront/cache/backend.ts";

class RecordingBackend implements CacheBackend {
  readonly values = new Map<string, string>();
  readonly deleted: string[] = [];

  constructor(readonly type: CacheBackend["type"] = "memory") {}

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.deleted.push(key);
    this.values.delete(key);
    return Promise.resolve();
  }
}

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
      const testMap = new Map();
      __injectCachesForTests({ localFallback: testMap, cacheBackend: null });
    });

    afterEach(() => {
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

    it("rejects transforms larger than the bounded payload limit", () => {
      __injectCachesForTests(null);
      __injectCachesForTests({ cacheBackend: null });
      destroyTransformCache();

      try {
        const largeTransform = "x".repeat(16 * 1024 * 1024 + 1);
        assertThrows(
          () => setCachedTransform("large-key", largeTransform, "large-hash"),
          RangeError,
          "Transform code must contain",
        );
        assertEquals(getCachedTransform("large-key"), undefined);
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
      const testMap = new Map();
      __injectCachesForTests({ localFallback: testMap, cacheBackend: null });
    });

    afterEach(() => {
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

    it("stores versioned payloads with a SHA-256 integrity digest", async () => {
      const backend = new RecordingBackend("disk");
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });

      await setCachedTransformAsync("integrity-key", "export const value = 1;", "source-hash");
      const raw = backend.values.get("integrity-key");
      if (!raw) throw new Error("Expected a persisted transform entry");
      const payload = JSON.parse(raw);

      assertEquals(payload.formatVersion, 2);
      assertEquals(typeof payload.expiresAt, "number");
      assertEquals(payload.codeHash.length, 64);
    });

    it("deletes and rejects a tampered persisted payload", async () => {
      const backend = new RecordingBackend("disk");
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });
      await setCachedTransformAsync("tampered-key", "export const value = 1;", "source-hash");

      const payload = JSON.parse(backend.values.get("tampered-key")!);
      payload.code = "export const value = 2;";
      backend.values.set("tampered-key", JSON.stringify(payload));

      assertEquals(await getCachedTransformAsync("tampered-key"), undefined);
      assertEquals(backend.deleted, ["tampered-key"]);
    });

    it("rejects persisted payloads with unknown fields", async () => {
      const backend = new RecordingBackend("disk");
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });
      await setCachedTransformAsync("unknown-field-key", "export const value = 1;", "source-hash");

      const payload = JSON.parse(backend.values.get("unknown-field-key")!);
      payload.untrustedMetadata = "ignored-by-old-readers";
      backend.values.set("unknown-field-key", JSON.stringify(payload));

      assertEquals(await getCachedTransformAsync("unknown-field-key"), undefined);
      assertEquals(backend.deleted, ["unknown-field-key"]);
    });

    it("does not treat disk storage as a distributed tokenized backend", async () => {
      const backend = new RecordingBackend("disk");
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });
      const code = `export const marker = "__VF_CACHE_DIR__";`;

      await setCachedTransformAsync("disk-key", code, "source-hash");
      assertEquals((await getCachedTransformAsync("disk-key"))?.code, code);
    });

    it("expires local fallback entries using their logical deadline", async () => {
      let now = 1_900_000_000_000;
      const originalNow = Date.now;
      Date.now = () => now;
      try {
        await setCachedTransformAsync("expiring-key", "export const value = 1;", "hash", 1);
        assertEquals(
          (await getCachedTransformAsync("expiring-key"))?.code,
          "export const value = 1;",
        );
        now += 1_001;
        assertEquals(await getCachedTransformAsync("expiring-key"), undefined);
      } finally {
        Date.now = originalNow;
      }
    });

    it("treats a non-positive TTL as observable deletion", async () => {
      const backend = new RecordingBackend("memory");
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });
      await setCachedTransformAsync("delete-key", "export const oldValue = 1;", "old-hash");

      await setCachedTransformAsync("delete-key", "export const newValue = 2;", "new-hash", 0);

      assertEquals(backend.values.has("delete-key"), false);
      assertEquals(backend.deleted, ["delete-key"]);
    });

    it("does not validate an unused replacement payload when TTL requests deletion", async () => {
      const backend = new RecordingBackend("memory");
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });
      await setCachedTransformAsync("delete-invalid-key", "export const oldValue = 1;", "old-hash");

      await setCachedTransformAsync("delete-invalid-key", "", "", 0, "");

      assertEquals(backend.values.has("delete-invalid-key"), false);
      assertEquals(backend.deleted, ["delete-invalid-key"]);
    });

    it("rejects invalid TTLs instead of substituting a default", async () => {
      await assertRejects(
        () => setCachedTransformAsync("ttl-key", "export const value = 1;", "hash", NaN),
        RangeError,
        "Cache TTL must be a finite number",
      );
    });
  });

  describe("getOrComputeTransform", () => {
    beforeEach(() => {
      const testMap = new Map();
      __injectCachesForTests({ localFallback: testMap, cacheBackend: null });
    });

    afterEach(() => {
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

    it("singleflights concurrent computations for the same key", async () => {
      let computations = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const compute = async (): Promise<string> => {
        computations++;
        await gate;
        return "singleflight-code";
      };

      const first = getOrComputeTransform("singleflight-key", compute);
      const second = getOrComputeTransform("singleflight-key", compute);
      await Promise.resolve();
      release();
      const results = await Promise.all([first, second]);

      assertEquals(computations, 1);
      assertEquals(results[0].code, "singleflight-code");
      assertEquals(results[1].code, "singleflight-code");
    });

    it("does not retain a rejected singleflight", async () => {
      await assertRejects(
        () => getOrComputeTransform("retry-key", () => Promise.reject(new Error("failed"))),
        Error,
        "failed",
      );

      const result = await getOrComputeTransform("retry-key", () => Promise.resolve("recovered"));
      assertEquals(result.code, "recovered");
      assertEquals(result.cacheHit, false);
    });
  });

  describe("destroyTransformCache", () => {
    beforeEach(() => {
      const testMap = new Map();
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
