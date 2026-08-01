import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import {
  buildRevisionedCacheKey,
  type CacheBackend,
  type CacheRevisionMutation,
  type CacheRevisionSnapshot,
  type RevisionedCacheBackend,
} from "#veryfront/cache/backend.ts";
import { CACHE_DIR_TOKEN } from "#veryfront/cache/paths.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { getCacheStats } from "#veryfront/utils/memory/index.ts";
import * as transformCacheModule from "./transform-cache.ts";
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

interface WishedForTransformObservation {
  readonly entry?: { readonly code: string };
  readonly permit: unknown;
}

function observeCachedTransformForWrite(
  key: string,
  ttlSeconds?: number,
): Promise<WishedForTransformObservation> {
  const operation = (transformCacheModule as unknown as {
    observeCachedTransformForWrite?: (
      key: string,
      ttlSeconds?: number,
    ) => Promise<WishedForTransformObservation>;
  }).observeCachedTransformForWrite;
  assertEquals(typeof operation, "function");
  return operation!(key, ttlSeconds);
}

function publishCachedTransformWithPermit(
  permit: unknown,
  code: string,
  hash: string,
  bundleManifestId?: string,
  dependencyResolutionObservations?: ReadonlyArray<{
    packageName: string;
    declaration: string | null;
  }>,
): Promise<boolean> {
  const operation = (transformCacheModule as unknown as {
    publishCachedTransformWithPermit?: (
      permit: unknown,
      code: string,
      hash: string,
      bundleManifestId?: string,
      dependencyResolutionObservations?: ReadonlyArray<{
        packageName: string;
        declaration: string | null;
      }>,
    ) => Promise<boolean>;
  }).publishCachedTransformWithPermit;
  assertEquals(typeof operation, "function");
  return operation!(
    permit,
    code,
    hash,
    bundleManifestId,
    dependencyResolutionObservations,
  );
}

class RecordingBackend implements CacheBackend {
  readonly values = new Map<string, string>();
  readonly deleted: string[] = [];
  readonly ordinaryCalls: string[] = [];

  constructor(readonly type: CacheBackend["type"] = "memory") {}

  get(key: string): Promise<string | null> {
    this.ordinaryCalls.push(`get:${key}`);
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.ordinaryCalls.push(`set:${key}`);
    this.values.set(key, value);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.ordinaryCalls.push(`del:${key}`);
    this.deleted.push(key);
    this.values.delete(key);
    return Promise.resolve();
  }
}

interface RecordedExchange {
  key: string;
  expectedRevision: string;
  mutation: CacheRevisionMutation;
}

class RevisionedRecordingBackend implements RevisionedCacheBackend {
  readonly type: CacheBackend["type"];
  readonly ordinaryCalls: string[] = [];
  readonly observations: string[] = [];
  readonly exchanges: RecordedExchange[] = [];
  readonly records = new Map<string, CacheRevisionSnapshot>();
  nextRevision = 1;
  getWithRevisionHook?: (key: string) => Promise<CacheRevisionSnapshot>;
  compareExchangeHook?: (
    key: string,
    expectedRevision: string,
    mutation: CacheRevisionMutation,
  ) => Promise<boolean>;

  constructor(type: CacheBackend["type"] = "distributed") {
    this.type = type;
  }

  get(key: string): Promise<string | null> {
    this.ordinaryCalls.push(`get:${key}`);
    return Promise.resolve(null);
  }

  set(key: string): Promise<void> {
    this.ordinaryCalls.push(`set:${key}`);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.ordinaryCalls.push(`del:${key}`);
    return Promise.resolve();
  }

  getWithRevision(key: string): Promise<CacheRevisionSnapshot> {
    this.observations.push(key);
    if (this.getWithRevisionHook) return this.getWithRevisionHook(key);
    const snapshot = this.records.get(key) ?? { value: null, revision: "0" };
    return Promise.resolve({ ...snapshot });
  }

  compareExchange(
    key: string,
    expectedRevision: string,
    mutation: CacheRevisionMutation,
  ): Promise<boolean> {
    this.exchanges.push({ key, expectedRevision, mutation });
    if (this.compareExchangeHook) {
      return this.compareExchangeHook(key, expectedRevision, mutation);
    }
    return Promise.resolve(this.applyExchange(key, expectedRevision, mutation));
  }

  applyExchange(
    key: string,
    expectedRevision: string,
    mutation: CacheRevisionMutation,
  ): boolean {
    const current = this.records.get(key) ?? { value: null, revision: "0" };
    if (current.revision !== expectedRevision) return false;
    const revision = String(this.nextRevision++);
    this.records.set(key, {
      value: mutation.kind === "set" ? mutation.value : null,
      revision,
    });
    return true;
  }

  replace(key: string, value: string | null): void {
    this.records.set(key, { value, revision: String(this.nextRevision++) });
  }
}

describe("transforms/esm/transform-cache", () => {
  describe("generateCacheKey", () => {
    it("generates a string key", () => {
      const key = generateCacheKey("app/page.tsx", "abc123");
      assertEquals(typeof key, "string");
      assertEquals(key.length > 0, true);
    });

    it("separates file paths without exposing unsafe raw path characters", () => {
      const first = generateCacheKey("app/page.tsx", "abc123");
      const second = generateCacheKey("app/other.tsx", "abc123");

      assertEquals(first !== second, true);
      assertEquals(first.includes("app/page.tsx"), false);
      assertEquals(/^[a-zA-Z0-9_:.-]+$/.test(first), true);
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

    it("rejects transforms larger than the bounded payload limit", () => {
      __injectCachesForTests(null);
      __injectCachesForTests({ cacheBackend: null });
      destroyTransformCache();

      try {
        const largeTransform = "x".repeat(32 * 1024 * 1024 + 1);
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
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: null });
    });

    afterEach(() => {
      destroyTransformCache();
      __injectCachesForTests(null);
    });

    it("returns undefined for a local-only miss", async () => {
      assertEquals(await getCachedTransformAsync("nonexistent-async"), undefined);
    });

    it("stores and retrieves a local-only transform asynchronously", async () => {
      await setCachedTransformAsync("async-key", "const y = 2;", "hash2");
      assertEquals((await getCachedTransformAsync("async-key"))?.code, "const y = 2;");
    });

    it("stores bundleManifestId in the bounded local cache", async () => {
      await setCachedTransformAsync(
        "manifest-key",
        "const x = 1;",
        "hash1",
        300,
        "manifest-abc",
      );
      assertEquals(
        (await getCachedTransformAsync("manifest-key"))?.bundleManifestId,
        "manifest-abc",
      );
    });

    it("uses only one reserved revision observation and CAS for shared publication", async () => {
      const backend = new RevisionedRecordingBackend();
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });

      await setCachedTransformAsync(
        "atomic-key",
        "export const value = 1;",
        "source-hash",
      );

      const reservedKey = buildRevisionedCacheKey("atomic-key");
      assertEquals(backend.ordinaryCalls, []);
      assertEquals(backend.observations, [reservedKey]);
      assertEquals(backend.exchanges.length, 1);
      assertEquals(backend.exchanges[0]?.key, reservedKey);
      assertEquals(backend.exchanges[0]?.expectedRevision, "0");
      const mutation = backend.exchanges[0]?.mutation;
      if (mutation?.kind !== "set") throw new Error("Expected one atomic set");
      const payload = JSON.parse(mutation.value);
      assertEquals(payload.formatVersion, 2);
      assertEquals(payload.code, "export const value = 1;");
      assertEquals(payload.codeHash.length, 64);
      assertEquals(typeof mutation.expiresAtMs, "number");
    });

    it("an independent stale writer cannot overwrite a replacement", async () => {
      const backend = new RevisionedRecordingBackend();
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });
      const observation = await observeCachedTransformForWrite("stale-writer-key", 300);
      const reservedKey = buildRevisionedCacheKey("stale-writer-key");

      backend.replace(reservedKey, "replacement-record");
      const published = await publishCachedTransformWithPermit(
        observation.permit,
        "export const stale = true;",
        "stale-hash",
      );

      assertEquals(published, false);
      assertEquals(backend.records.get(reservedKey)?.value, "replacement-record");
      assertEquals(backend.observations, [reservedKey]);
      assertEquals(backend.exchanges.length, 1);
    });

    it("a replacement progresses while an older exchange never settles", async () => {
      const backend = new RevisionedRecordingBackend();
      const firstExchangeStarted = Promise.withResolvers<void>();
      const neverSettles = new Promise<boolean>(() => {});
      let exchangeCalls = 0;
      backend.compareExchangeHook = (key, revision, mutation) => {
        exchangeCalls++;
        if (exchangeCalls === 1) {
          firstExchangeStarted.resolve();
          return neverSettles;
        }
        return Promise.resolve(backend.applyExchange(key, revision, mutation));
      };
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });

      void setCachedTransformAsync(
        "progress-key",
        "export const oldValue = true;",
        "old-hash",
      );
      await firstExchangeStarted.promise;

      await setCachedTransformAsync(
        "progress-key",
        "export const replacement = true;",
        "replacement-hash",
      );

      const stored = backend.records.get(buildRevisionedCacheKey("progress-key"))?.value;
      assertEquals(JSON.parse(stored ?? "null").code, "export const replacement = true;");
      assertEquals(exchangeCalls, 2);
    });

    it("same-byte ABA invalidates the stale publication permit", async () => {
      const backend = new RevisionedRecordingBackend();
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });
      const observation = await observeCachedTransformForWrite("same-byte-aba", 300);
      const reservedKey = buildRevisionedCacheKey("same-byte-aba");

      assertEquals(
        backend.applyExchange(reservedKey, "0", {
          kind: "set",
          value: "same",
          expiresAtMs: Date.now() + 60_000,
        }),
        true,
      );
      assertEquals(
        backend.applyExchange(reservedKey, "1", {
          kind: "set",
          value: "same",
          expiresAtMs: Date.now() + 60_000,
        }),
        true,
      );

      assertEquals(
        await publishCachedTransformWithPermit(
          observation.permit,
          "export const stale = true;",
          "stale-hash",
        ),
        false,
      );
      assertEquals(backend.records.get(reservedKey), { value: "same", revision: "2" });
    });

    it("absent-delete ABA invalidates the stale publication permit", async () => {
      const backend = new RevisionedRecordingBackend();
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });
      const observation = await observeCachedTransformForWrite("absent-delete-aba", 300);
      const reservedKey = buildRevisionedCacheKey("absent-delete-aba");

      assertEquals(backend.applyExchange(reservedKey, "0", { kind: "delete" }), true);
      assertEquals(
        await publishCachedTransformWithPermit(
          observation.permit,
          "export const stale = true;",
          "stale-hash",
        ),
        false,
      );
      assertEquals(backend.records.get(reservedKey), { value: null, revision: "1" });
    });

    it("conditional invalid-entry cleanup preserves a concurrent replacement", async () => {
      const backend = new RevisionedRecordingBackend();
      const reservedKey = buildRevisionedCacheKey("invalid-cleanup-key");
      backend.replace(reservedKey, "{invalid-json");
      backend.compareExchangeHook = (key, revision, mutation) => {
        backend.replace(key, "concurrent-replacement");
        return Promise.resolve(backend.applyExchange(key, revision, mutation));
      };
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });

      assertEquals(await getCachedTransformAsync("invalid-cleanup-key"), undefined);
      assertEquals(backend.records.get(reservedKey)?.value, "concurrent-replacement");
      assertEquals(backend.exchanges[0]?.mutation, { kind: "delete" });
      assertEquals(backend.ordinaryCalls, []);
    });

    it("preserves the pre-observation absolute deadline through slow serialization", async () => {
      const backend = new RevisionedRecordingBackend();
      const observationStarted = Promise.withResolvers<void>();
      const releaseObservation = Promise.withResolvers<void>();
      backend.getWithRevisionHook = async () => {
        observationStarted.resolve();
        await releaseObservation.promise;
        return { value: null, revision: "0" };
      };
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });

      const originalNow = Date.now;
      let now = 1_900_000_000_000;
      Date.now = () => now;
      try {
        const pending = setCachedTransformAsync(
          "absolute-deadline-key",
          "export const value = true;",
          "source-hash",
          10,
        );
        await observationStarted.promise;
        now += 8_000;
        releaseObservation.resolve();
        await pending;

        const mutation = backend.exchanges[0]?.mutation;
        if (mutation?.kind !== "set") throw new Error("Expected one atomic set");
        assertEquals(mutation.expiresAtMs, 1_900_000_010_000);
      } finally {
        Date.now = originalNow;
      }
    });

    it("synchronous TTL-zero is local-only and performs zero backend calls", () => {
      const backend = new RevisionedRecordingBackend();
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });
      setCachedTransform("sync-delete-key", "export const oldValue = true;", "old-hash");

      setCachedTransform("sync-delete-key", "", "", 0);

      assertEquals(getCachedTransform("sync-delete-key"), undefined);
      assertEquals(backend.ordinaryCalls, []);
      assertEquals(backend.observations, []);
      assertEquals(backend.exchanges, []);
    });

    it("bounds 1,001 permanently unsettled permits without blocking replacement", async () => {
      const backend = new RevisionedRecordingBackend();
      let observations = 0;
      backend.getWithRevisionHook = () => {
        observations++;
        if (observations <= 1_001) {
          return new Promise<CacheRevisionSnapshot>(() => {});
        }
        return Promise.resolve({ value: null, revision: "0" });
      };
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });

      for (let index = 0; index < 1_001; index++) {
        void observeCachedTransformForWrite("unsettled-permit-" + index, 300);
      }
      const replacement = await observeCachedTransformForWrite(
        "replacement-after-capacity",
        300,
      );
      assertEquals(
        await publishCachedTransformWithPermit(
          replacement.permit,
          "export const replacement = true;",
          "replacement-hash",
        ),
        true,
      );
      assertEquals(observations, 1_002);
      assertEquals(backend.exchanges.length, 1);
    });

    it("incapable API and distributed backends are local-only with zero calls", async () => {
      for (const type of ["api", "distributed"] as const) {
        destroyTransformCache();
        const backend = new RecordingBackend(type);
        __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });

        await setCachedTransformAsync(
          "incapable-" + type,
          "export const local = true;",
          "local-hash",
        );
        assertEquals(
          (await getCachedTransformAsync("incapable-" + type))?.code,
          "export const local = true;",
        );
        assertEquals(backend.ordinaryCalls, []);
        const stats = getCacheStats().find((entry) => entry.name === "transform-cache");
        assertEquals(
          String(stats?.backend).endsWith(
            "local-only:atomic-revision-unavailable",
          ),
          true,
        );
      }
    });

    it("rejects malformed revision snapshots and non-boolean exchanges", async () => {
      const malformedSnapshot = new RevisionedRecordingBackend();
      malformedSnapshot.getWithRevisionHook = () => Promise.resolve({ value: null, revision: "" });
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: malformedSnapshot });

      await assertRejects(
        () => getCachedTransformAsync("malformed-snapshot-key"),
        TypeError,
        "Cache revision",
      );

      const malformedExchange = new RevisionedRecordingBackend();
      malformedExchange.compareExchangeHook = () =>
        Promise.resolve("accepted" as unknown as boolean);
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: malformedExchange });

      await assertRejects(
        () =>
          setCachedTransformAsync(
            "malformed-exchange-key",
            "export const value = true;",
            "source-hash",
          ),
        TypeError,
        "Cache compare-exchange result must be boolean",
      );
    });

    it("keeps the local result usable when atomic publication rejects", async () => {
      const backend = new RevisionedRecordingBackend();
      backend.compareExchangeHook = () => Promise.reject(new Error("atomic store unavailable"));
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });

      await assertRejects(
        () =>
          setCachedTransformAsync(
            "rejected-publication-key",
            "export const localResult = true;",
            "source-hash",
          ),
        Error,
        "atomic store unavailable",
      );

      assertEquals(
        getCachedTransform("rejected-publication-key")?.code,
        "export const localResult = true;",
      );
    });

    it("carries dependency observations through revisioned persistence", async () => {
      const backend = new RevisionedRecordingBackend();
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });
      const observations = [{ packageName: "zod", declaration: "^4" }];

      await setCachedTransformAsync(
        "dependency-observation-key",
        "const x = 1;",
        "hash1",
        300,
        undefined,
        observations,
      );

      const mutation = backend.exchanges[0]?.mutation;
      if (mutation?.kind !== "set") throw new Error("Expected one atomic set");
      assertEquals(
        JSON.parse(mutation.value).dependencyResolutionObservations,
        observations,
      );

      destroyTransformCache();
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });
      assertEquals(
        (await getCachedTransformAsync("dependency-observation-key"))
          ?.dependencyResolutionObservations,
        observations,
      );
      assertEquals(backend.ordinaryCalls, []);
    });

    it("conditionally deletes shared entries for asynchronous TTL-zero writes", async () => {
      const backend = new RevisionedRecordingBackend();
      const reservedKey = buildRevisionedCacheKey("async-delete-key");
      backend.replace(reservedKey, "old-record");
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });

      await setCachedTransformAsync("async-delete-key", "", "", 0);

      assertEquals(backend.observations, [reservedKey]);
      assertEquals(backend.exchanges[0]?.mutation, { kind: "delete" });
      assertEquals(backend.records.get(reservedKey)?.value, null);
      assertEquals(backend.ordinaryCalls, []);
    });

    it("keeps disk backends process-local without ordinary backend calls", async () => {
      const backend = new RecordingBackend("disk");
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });
      const code = 'export const marker = "__VF_CACHE_DIR__";';

      await setCachedTransformAsync("disk-key", code, "source-hash");

      assertEquals((await getCachedTransformAsync("disk-key"))?.code, code);
      assertEquals(backend.ordinaryCalls, []);
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

    it("getOrCompute observes before computation and performs no post-compute read", async () => {
      const backend = new RevisionedRecordingBackend();
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });
      let observedBeforeCompute = false;

      const result = await getOrComputeTransform(
        "observe-before-compute-key",
        async () => {
          observedBeforeCompute = backend.observations.length === 1;
          return "export const computed = true;";
        },
        300,
        undefined,
        undefined,
        undefined,
        () => [{ packageName: "zod", declaration: "^4" }],
      );

      assertEquals(observedBeforeCompute, true);
      assertEquals(result.cacheHit, false);
      assertEquals(backend.observations, [
        buildRevisionedCacheKey("observe-before-compute-key"),
      ]);
      assertEquals(backend.exchanges.length, 1);
      const mutation = backend.exchanges[0]?.mutation;
      if (mutation?.kind !== "set") throw new Error("Expected one atomic set");
      assertEquals(JSON.parse(mutation.value).dependencyResolutionObservations, [
        { packageName: "zod", declaration: "^4" },
      ]);
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

    it("recomputes when cached-entry validation reports canonical not-found", async () => {
      await getOrComputeTransform("validator-error-key", async () => "stale-value");
      const missingError = Object.assign(new Error("framework bundle missing"), {
        code: "ENOENT",
      });

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
          throw missingError;
        },
      );

      assertEquals(result, { code: "fresh-value", cacheHit: false });
      assertEquals(computeCalls, 1);
    });

    for (
      const [label, failure] of [
        ["a plain ENOENT-shaped rejection", Object.freeze({ code: "ENOENT" })],
        [
          "a native Error with a plain ENOENT-shaped cause",
          new Error("wrapped transform validation failure", {
            cause: Object.freeze({ code: "ENOENT" }),
          }),
        ],
      ] as const
    ) {
      it(`propagates ${label} from cached-entry validation without recomputing`, async () => {
        const key = "validator-untrusted-missing-shape-key";
        await getOrComputeTransform(key, async () => "stale-value");
        let computeCalls = 0;

        const error = await assertRejects(() =>
          getOrComputeTransform(
            key,
            async () => {
              computeCalls++;
              return "fresh-value";
            },
            300,
            undefined,
            undefined,
            () => {
              throw failure;
            },
          )
        );

        assertStrictEquals(error, failure);
        assertEquals(computeCalls, 0);
        let postFailureComputeCalls = 0;
        const cached = await getOrComputeTransform(key, async () => {
          postFailureComputeCalls++;
          return "unexpected-value";
        });
        assertEquals(cached.code, "stale-value");
        assertEquals(cached.cacheHit, true);
        assertEquals(postFailureComputeCalls, 0);
      });
    }

    it("propagates operational cached-entry validation failures without recomputing", async () => {
      await getOrComputeTransform("validator-io-error-key", async () => "stale-value");
      const ioError = Object.assign(new Error("framework cache device failed"), {
        code: "EIO",
      });

      let computeCalls = 0;
      const error = await assertRejects(
        () =>
          getOrComputeTransform(
            "validator-io-error-key",
            async () => {
              computeCalls++;
              return "fresh-value";
            },
            300,
            undefined,
            undefined,
            () => {
              throw ioError;
            },
          ),
        Error,
        "framework cache device failed",
      );

      assertStrictEquals(error, ioError);
      assertEquals(computeCalls, 0);
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

    it("recomputes a detokenized distributed framework reference with its observed revision", async () => {
      const key = "distributed-framework-recompute-key";
      const frameworkPath = getCacheBaseDir() +
        "/veryfront-mdx-esm/framework/vfmod-vf-framework-missing.mjs";
      const staleCode = 'import helper from "file://' + frameworkPath + '";';
      const backend = new RevisionedRecordingBackend();
      __injectCachesForTests({ localFallback: new Map(), cacheBackend: backend });

      await setCachedTransformAsync(key, staleCode, "stale-hash");
      const reservedKey = buildRevisionedCacheKey(key);
      const portableEntry = backend.records.get(reservedKey)?.value;
      assertEquals(portableEntry?.includes(CACHE_DIR_TOKEN), true);
      assertEquals(portableEntry?.includes(frameworkPath), false);

      let computeCalls = 0;
      let validationCalls = 0;
      const result = await getOrComputeTransform(
        key,
        async () => {
          computeCalls++;
          return "export const recomputed = true;";
        },
        300,
        undefined,
        undefined,
        (entry) => {
          validationCalls++;
          assertEquals(entry.code.includes(frameworkPath), true);
          assertEquals(entry.code.includes(CACHE_DIR_TOKEN), false);
          return false;
        },
      );

      assertEquals(result.code, "export const recomputed = true;");
      assertEquals(validationCalls, 1);
      assertEquals(computeCalls, 1);
      assertEquals(backend.observations, [reservedKey, reservedKey]);
      assertEquals(backend.exchanges.length, 2);
      assertEquals(
        JSON.parse(backend.records.get(reservedKey)?.value ?? "null").code,
        "export const recomputed = true;",
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
      const originalAddEventListener = controller.signal.addEventListener.bind(
        controller.signal,
      );
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

      controller.abort(new Error("caller already timed out"));
      let computeCalls = 0;
      await assertRejects(
        () =>
          getOrComputeTransform(
            "already-aborted-key",
            async () => {
              computeCalls++;
              return "unreachable";
            },
            300,
            undefined,
            controller.signal,
          ),
        Error,
        "caller already timed out",
      );

      assertEquals(computeCalls, 0);
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
