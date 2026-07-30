import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import {
  CacheManager,
  dataCacheKeyMatches,
  snapshotDataCacheScope,
} from "./data-fetching-cache.ts";
import type { CacheEntry, DataContext } from "./types.ts";
import { DATA_FETCHING_TTL_MS } from "#veryfront/utils/constants/cache.ts";
import {
  MAX_DATA_CACHE_KEY_CHARACTERS,
  MAX_DATA_INVALIDATION_PATTERN_CHARACTERS,
  MAX_DATA_MODULE_PATH_CHARACTERS,
  MAX_DATA_SCOPE_VERSION_CHARACTERS,
} from "./data-limits.ts";

function withProductionContext<T>(fn: () => T): T {
  return runWithCacheKeyContext(
    { projectId: "test-project", mode: "production", versionId: "rel_123" },
    fn,
  );
}

function createContext(
  url: string,
  params: Record<string, string | string[]> = {},
): DataContext {
  return {
    params,
    query: new URLSearchParams(),
    request: new Request(url),
    url: new URL(url),
  };
}

function createEntry<TProps extends Record<string, unknown>>(
  props: TProps,
  overrides: Partial<CacheEntry<TProps>> = {},
): CacheEntry<TProps> {
  return {
    data: { props },
    timestamp: Date.now(),
    ...overrides,
  };
}

function getEntryProps<T>(entry: CacheEntry): T {
  assertExists(entry.data.props);
  return entry.data.props as T;
}

function createScopedKey(
  cache: CacheManager,
  projectId: string,
  route: string,
  versionId = "rel-1",
): string {
  const key = cache.createCacheKey(
    createContext(`https://example.test/${route}`),
    "page",
    { projectId, mode: "production", versionId },
  );
  assertExists(key);
  return key;
}

function estimateWeightedEntry(entry: CacheEntry): number {
  const props = getEntryProps<{ bytes: number }>(entry);
  return props.bytes;
}

function nestRetainedValue(value: unknown, levels = 12): unknown {
  let nested = value;
  for (let level = 0; level < levels; level++) {
    nested = { child: nested };
  }
  return nested;
}

describe("CacheManager", () => {
  describe("scope snapshots", () => {
    it("returns a validated frozen copy of plain own data fields", () => {
      const source = {
        projectId: "project-a",
        mode: "production" as const,
        versionId: "rel-1",
      };

      const snapshot = snapshotDataCacheScope(source);

      assertEquals(snapshot, {
        projectId: "project-a",
        mode: "production",
        versionId: "rel-1",
      });
      assertEquals(Object.isFrozen(snapshot), true);
      assertEquals(Reflect.set(snapshot, "projectId", "project-b"), false);
      source.projectId = "project-b";
      assertEquals(snapshot.projectId, "project-a");
    });

    it("rejects malformed scopes", () => {
      assertThrows(
        () =>
          snapshotDataCacheScope({
            projectId: "",
            mode: "production",
            versionId: "rel-1",
          }),
        TypeError,
        "projectId",
      );
      assertThrows(
        () =>
          snapshotDataCacheScope({
            projectId: "project",
            mode: "invalid",
            versionId: "rel-1",
          } as unknown as {
            projectId: string;
            mode: "production";
            versionId: string;
          }),
        TypeError,
        "mode",
      );
      let accessorReads = 0;
      const accessorScope = Object.defineProperties({}, {
        projectId: {
          enumerable: true,
          get() {
            accessorReads++;
            return "project";
          },
        },
        mode: { enumerable: true, value: "production" },
        versionId: { enumerable: true, value: "rel-1" },
      });
      assertThrows(
        () => snapshotDataCacheScope(accessorScope),
        TypeError,
        "own enumerable data property",
      );
      assertEquals(accessorReads, 0);
      assertThrows(
        () =>
          snapshotDataCacheScope({
            projectId: "project",
            mode: "production",
            versionId: "v".repeat(MAX_DATA_SCOPE_VERSION_CHARACTERS + 1),
          }),
        TypeError,
        "versionId",
      );
    });

    it("uses exact scope identity for key creation and invalidation", () => {
      const cache = new CacheManager();
      const context = createContext("https://example.test/scope-snapshot");
      const projectAScope = {
        projectId: "project-a",
        mode: "production" as const,
        versionId: "rel-1",
      };
      const projectA = cache.createCacheKey(
        context,
        "page",
        projectAScope,
      );
      const projectASecondRoute = cache.createCacheKey(
        createContext("https://example.test/scope-snapshot-two"),
        "page",
        {
          projectId: "project-a",
          mode: "production",
          versionId: "rel-1",
        },
      );
      const projectB = cache.createCacheKey(context, "page", {
        projectId: "project-b",
        mode: "production",
        versionId: "rel-1",
      });
      assertExists(projectA);
      assertExists(projectASecondRoute);
      assertExists(projectB);
      cache.set(projectA, createEntry({ project: "a-one" }));
      cache.set(projectASecondRoute, createEntry({ project: "a-two" }));
      cache.set(projectB, createEntry({ project: "b" }));

      cache.clearScope(projectAScope);

      assertEquals(cache.get(projectA), null);
      assertEquals(cache.get(projectASecondRoute), null);
      assertExists(cache.get(projectB));
    });
  });

  describe("constructor", () => {
    it("should create a new instance", () => {
      assertExists(new CacheManager());
    });

    it("requires project quotas to be positive and bounded by global limits", () => {
      assertThrows(
        () =>
          new CacheManager({
            maxEntries: 2,
            maxEntriesPerProject: 3,
          }),
        RangeError,
        "must not exceed",
      );
      assertThrows(
        () =>
          new CacheManager({
            maxSizeBytes: 10,
            maxSizeBytesPerProject: 0,
          }),
        RangeError,
        "positive safe integer",
      );
    });
  });

  describe("get/set", () => {
    it("should return null for non-existent key", () => {
      const cache = new CacheManager();
      assertEquals(cache.get("non-existent"), null);
    });

    it("should store and retrieve cache entry", () => {
      const cache = new CacheManager();
      const entry = createEntry({ title: "Test" }, { revalidate: 60 });

      cache.set("test-key", entry);
      const result = cache.get("test-key");

      assertExists(result);
      const props = getEntryProps<{ title: string }>(result);
      assertEquals(props.title, "Test");
      assertEquals(result.revalidate, 60);
    });

    it("should overwrite existing entry", () => {
      const cache = new CacheManager();
      const entry1 = createEntry({ value: 1 }, { revalidate: 60 });
      const entry2 = createEntry({ value: 2 }, { revalidate: 120 });

      cache.set("key", entry1);
      cache.set("key", entry2);

      const result = cache.get("key");
      assertExists(result);
      assertEquals(getEntryProps<{ value: number }>(result).value, 2);
      assertEquals(result.revalidate, 120);
    });

    it("should replace only the exact cache generation", () => {
      const cache = new CacheManager();
      const first = createEntry({ version: 1 });
      const second = createEntry({ version: 2 });
      const third = createEntry({ version: 3 });

      cache.set("key", first);
      assertEquals(cache.replaceIfCurrent("key", first, second), true);
      assertStrictEquals(cache.get("key"), second);

      assertEquals(cache.replaceIfCurrent("key", first, third), false);
      assertStrictEquals(cache.get("key"), second);

      cache.delete("key");
      assertEquals(cache.replaceIfCurrent("key", second, third), false);
      assertEquals(cache.replaceIfCurrent("key", null, third), true);
      assertStrictEquals(cache.get("key"), third);
    });

    it("should expire entries lazily even when periodic cleanup is disabled", () => {
      let now = 1_000_000;
      const cache = new CacheManager({ now: () => now });
      cache.set("key", createEntry({ version: 1 }));
      assertExists(cache.get("key"));

      now += DATA_FETCHING_TTL_MS;
      assertEquals(cache.get("key"), null);
    });
  });

  describe("per-project fairness", () => {
    it("evicts one project's oldest entry before a noisy release can evict peers", () => {
      const cache = new CacheManager({
        maxEntries: 4,
        maxSizeBytes: 10_000,
        maxEntriesPerProject: 2,
        maxSizeBytesPerProject: 10_000,
      });
      const peerOne = createScopedKey(cache, "peer", "one");
      const peerTwo = createScopedKey(cache, "peer", "two");
      const projectReleaseOne = createScopedKey(
        cache,
        "noisy",
        "release-one",
        "rel-1",
      );
      const projectReleaseTwo = createScopedKey(
        cache,
        "noisy",
        "release-two",
        "rel-2",
      );
      const projectReleaseThree = createScopedKey(
        cache,
        "noisy",
        "release-three",
        "rel-3",
      );

      cache.set(peerOne, createEntry({ value: "peer-one" }));
      cache.set(peerTwo, createEntry({ value: "peer-two" }));
      cache.set(projectReleaseOne, createEntry({ value: "release-one" }));
      cache.set(projectReleaseTwo, createEntry({ value: "release-two" }));
      assertExists(cache.get(projectReleaseOne));

      cache.set(projectReleaseThree, createEntry({ value: "release-three" }));

      assertExists(cache.get(peerOne));
      assertExists(cache.get(peerTwo));
      assertExists(cache.get(projectReleaseOne));
      assertEquals(cache.get(projectReleaseTwo), null);
      assertExists(cache.get(projectReleaseThree));
    });

    it("enforces a project byte ceiling before the global byte ceiling", () => {
      const cache = new CacheManager({
        maxEntries: 10,
        maxSizeBytes: 21,
        maxEntriesPerProject: 10,
        maxSizeBytesPerProject: 12,
        estimateSizeOf: estimateWeightedEntry,
      });
      const peer = createScopedKey(cache, "peer", "peer");
      const noisyOne = createScopedKey(cache, "noisy", "one");
      const noisyTwo = createScopedKey(cache, "noisy", "two");
      const noisyThree = createScopedKey(cache, "noisy", "three");

      cache.set(peer, createEntry({ bytes: 10 }));
      cache.set(noisyOne, createEntry({ bytes: 6 }));
      cache.set(noisyTwo, createEntry({ bytes: 4 }));
      cache.set(noisyThree, createEntry({ bytes: 7 }));

      assertExists(cache.get(peer));
      assertEquals(cache.get(noisyOne), null);
      assertExists(cache.get(noisyTwo));
      assertExists(cache.get(noisyThree));
    });

    it("keeps project accounting exact when a replacement triggers global eviction", () => {
      const cache = new CacheManager({
        maxEntries: 10,
        maxSizeBytes: 20,
        maxEntriesPerProject: 3,
        maxSizeBytesPerProject: 15,
        estimateSizeOf: estimateWeightedEntry,
      });
      const first = createScopedKey(cache, "project", "first");
      const replacement = createScopedKey(cache, "project", "replacement");
      const peer = createScopedKey(cache, "peer", "peer");
      const third = createScopedKey(cache, "project", "third");

      cache.set(first, createEntry({ bytes: 5 }));
      cache.set(replacement, createEntry({ bytes: 5, version: 1 }));
      cache.set(peer, createEntry({ bytes: 10 }));
      cache.set(replacement, createEntry({ bytes: 10, version: 2 }));

      assertEquals(cache.get(first), null);
      assertExists(cache.get(peer));
      assertEquals(
        getEntryProps<{ version: number }>(cache.get(replacement)!).version,
        2,
      );

      cache.set(third, createEntry({ bytes: 5 }));

      assertEquals(cache.get(peer), null);
      assertExists(cache.get(replacement));
      assertExists(cache.get(third));
    });

    it("accounts for replacement growth and shrinkage exactly", () => {
      const cache = new CacheManager({
        maxEntries: 10,
        maxSizeBytes: 50,
        maxEntriesPerProject: 10,
        maxSizeBytesPerProject: 10,
        estimateSizeOf: estimateWeightedEntry,
      });
      const first = createScopedKey(cache, "project", "first");
      const replacement = createScopedKey(cache, "project", "replacement");
      const third = createScopedKey(cache, "project", "third");

      cache.set(first, createEntry({ bytes: 4, version: 1 }));
      cache.set(replacement, createEntry({ bytes: 5, version: 1 }));
      cache.set(replacement, createEntry({ bytes: 7, version: 2 }));

      assertEquals(cache.get(first), null);
      assertEquals(
        getEntryProps<{ version: number }>(cache.get(replacement)!).version,
        2,
      );

      cache.set(replacement, createEntry({ bytes: 2, version: 3 }));
      cache.set(third, createEntry({ bytes: 8, version: 1 }));

      assertExists(cache.get(replacement));
      assertExists(cache.get(third));
    });

    it("keeps quota accounting exact across expiry, delete, and clear", () => {
      let now = 1_000_000;
      const cache = new CacheManager({
        maxEntries: 4,
        maxSizeBytes: 20,
        maxEntriesPerProject: 2,
        maxSizeBytesPerProject: 10,
        ttlMs: 10,
        estimateSizeOf: estimateWeightedEntry,
        now: () => now,
      });
      const first = createScopedKey(cache, "project", "first");
      const second = createScopedKey(cache, "project", "second");
      const third = createScopedKey(cache, "project", "third");
      const fourth = createScopedKey(cache, "project", "fourth");
      const fifth = createScopedKey(cache, "project", "fifth");
      const sixth = createScopedKey(cache, "project", "sixth");
      const seventh = createScopedKey(cache, "project", "seventh");

      cache.set(first, createEntry({ bytes: 5 }));
      cache.set(second, createEntry({ bytes: 5 }));
      now += 10;

      cache.set(third, createEntry({ bytes: 5 }));
      cache.set(fourth, createEntry({ bytes: 5 }));
      assertExists(cache.get(third));
      assertExists(cache.get(fourth));

      cache.delete(third);
      cache.set(fifth, createEntry({ bytes: 5 }));
      assertExists(cache.get(fourth));
      assertExists(cache.get(fifth));

      cache.clear();
      cache.set(sixth, createEntry({ bytes: 5 }));
      cache.set(seventh, createEntry({ bytes: 5 }));
      assertExists(cache.get(sixth));
      assertExists(cache.get(seventh));
    });

    it("does not evict healthy entries when estimation or quota validation fails", () => {
      const cache = new CacheManager({
        maxEntries: 3,
        maxSizeBytes: 100,
        maxEntriesPerProject: 2,
        maxSizeBytesPerProject: 50,
        estimateSizeOf: (entry) => {
          const props = getEntryProps<{ bytes: number; fail?: boolean }>(entry);
          if (props.fail) throw new Error("size estimation failed");
          return props.bytes;
        },
      });
      const peer = createScopedKey(cache, "peer", "peer");
      const first = createScopedKey(cache, "project", "first");
      const second = createScopedKey(cache, "project", "second");
      const rejected = createScopedKey(cache, "project", "rejected");

      cache.set(peer, createEntry({ bytes: 10 }));
      cache.set(first, createEntry({ bytes: 10 }));
      cache.set(second, createEntry({ bytes: 10 }));

      assertThrows(
        () => cache.set(rejected, createEntry({ bytes: 10, fail: true })),
        Error,
        "size estimation failed",
      );
      assertThrows(
        () => cache.set(rejected, createEntry({ bytes: 51 })),
        RangeError,
        "exceeds per-project byte limit",
      );
      const malformedKey = rejected.replace(
        /\|(\d+):4:page\|/,
        (_match, resourceLength: string) => `|${Number(resourceLength) + 1}:04:page|`,
      );
      assertThrows(
        () => cache.set(malformedKey, createEntry({ bytes: 10 })),
        TypeError,
        "Malformed or non-data project-scoped cache key",
      );

      assertExists(cache.get(peer));
      assertExists(cache.get(first));
      assertExists(cache.get(second));
      assertEquals(cache.get(rejected), null);
    });

    it("charges original cache-key memory to the project byte quota", () => {
      const cache = new CacheManager({
        maxEntries: 3,
        maxSizeBytes: 20_000,
        maxEntriesPerProject: 2,
        maxSizeBytesPerProject: 5_000,
      });
      const peer = createScopedKey(cache, "peer", "peer");
      const first = createScopedKey(cache, "project", "first");
      const second = createScopedKey(cache, "project", "second");
      const oversizedKey = createScopedKey(
        cache,
        "project",
        "x".repeat(3_000),
      );

      cache.set(peer, createEntry({ value: "peer" }));
      cache.set(first, createEntry({ value: "first" }));
      cache.set(second, createEntry({ value: "second" }));

      assertThrows(
        () => cache.set(oversizedKey, createEntry({ value: "oversized-key" })),
        RangeError,
        "exceeds per-project byte limit",
      );
      assertExists(cache.get(peer));
      assertExists(cache.get(first));
      assertExists(cache.get(second));
      assertEquals(cache.get(oversizedKey), null);
    });

    it("rejects a deeply nested typed array without evicting project or global peers", () => {
      const cache = new CacheManager({
        maxEntries: 3,
        maxSizeBytes: 2_048,
        maxEntriesPerProject: 2,
        maxSizeBytesPerProject: 1_024,
      });
      const peer = createScopedKey(cache, "peer", "peer");
      const healthy = createScopedKey(cache, "project", "healthy");
      const rejected = createScopedKey(cache, "project", "rejected");
      cache.set(peer, createEntry({ value: "peer" }));
      cache.set(healthy, createEntry({ value: "healthy" }));

      assertThrows(
        () =>
          cache.set(
            rejected,
            createEntry(nestRetainedValue(new Uint8Array(2 * 1024 * 1024)) as Record<
              string,
              unknown
            >),
          ),
        RangeError,
        "too complex to estimate safely",
      );

      assertExists(cache.get(peer));
      assertExists(cache.get(healthy));
      assertEquals(cache.get(rejected), null);
    });

    it("rejects a deeply nested string that would bypass the global byte limit", () => {
      const cache = new CacheManager({
        maxEntries: 2,
        maxSizeBytes: 1_024,
        maxEntriesPerProject: 2,
        maxSizeBytesPerProject: 1_024,
      });

      assertThrows(
        () =>
          cache.set(
            "deep-string",
            createEntry(nestRetainedValue("x".repeat(2 * 1024 * 1024)) as Record<
              string,
              unknown
            >),
          ),
        RangeError,
        "too complex to estimate safely",
      );
      assertEquals(cache.get("deep-string"), null);
    });

    it("fails closed when a retained object graph exhausts estimator depth", () => {
      const cache = new CacheManager({
        maxEntries: 2,
        maxSizeBytes: 1_024 * 1024,
        maxEntriesPerProject: 2,
        maxSizeBytesPerProject: 1_024 * 1024,
      });

      assertThrows(
        () =>
          cache.set(
            "deep-object",
            createEntry(nestRetainedValue({ leaf: true }) as Record<string, unknown>),
          ),
        RangeError,
        "too complex to estimate safely",
      );
      assertEquals(cache.get("deep-object"), null);
    });

    it("applies the depth limit to recognized backing-object chains", () => {
      const cache = new CacheManager({
        maxEntries: 2,
        maxSizeBytes: 1_024 * 1024,
        maxEntriesPerProject: 2,
        maxSizeBytesPerProject: 1_024 * 1024,
      });
      let nested: object = new ArrayBuffer(1);
      for (let depth = 0; depth < 12; depth++) {
        const parent = new ArrayBuffer(1);
        Object.defineProperty(parent, "child", { value: nested });
        nested = parent;
      }

      assertThrows(
        () => cache.set("deep-backing-chain", createEntry({ nested })),
        RangeError,
        "too complex to estimate safely",
      );
      assertEquals(cache.get("deep-backing-chain"), null);
    });

    it("fails closed without mutation when estimator node work is exhausted", () => {
      const cache = new CacheManager({
        maxEntries: 2,
        maxSizeBytes: 1_024 * 1024,
        maxEntriesPerProject: 2,
        maxSizeBytesPerProject: 1_024 * 1024,
      });
      const healthy = createEntry({ value: "healthy" });
      cache.set("healthy", healthy);
      const tooWide: Record<string, number> = {};
      for (let index = 0; index < 100_001; index++) {
        tooWide[`field-${index}`] = index;
      }

      assertThrows(
        () => cache.set("too-wide", createEntry({ tooWide })),
        RangeError,
        "too complex to estimate safely",
      );
      assertStrictEquals(cache.get("healthy"), healthy);
      assertEquals(cache.get("too-wide"), null);
    });

    it("charges an ArrayBufferView's complete retained backing storage", () => {
      const cache = new CacheManager({
        maxEntries: 2,
        maxSizeBytes: 1_024,
        maxEntriesPerProject: 2,
        maxSizeBytesPerProject: 1_024,
      });
      const backing = new ArrayBuffer(2 * 1024 * 1024);
      const oneByteView = new Uint8Array(backing, 0, 1);

      assertThrows(
        () => cache.set("view", createEntry({ oneByteView })),
        RangeError,
        "exceeds maxSizeBytes",
      );
      assertEquals(cache.get("view"), null);
    });

    it("does not double-charge typed-array indices after charging their backing store", () => {
      const cache = new CacheManager({
        maxEntries: 2,
        maxSizeBytes: 4_096,
        maxEntriesPerProject: 2,
        maxSizeBytesPerProject: 4_096,
      });
      const entry = createEntry({ value: new Uint8Array(500) });

      cache.set("typed-array", entry);

      assertStrictEquals(cache.get("typed-array"), entry);
    });

    it("charges custom own data retained by recognized backing values", () => {
      const cache = new CacheManager({
        maxEntries: 10,
        maxSizeBytes: 1_024,
        maxEntriesPerProject: 10,
        maxSizeBytesPerProject: 1_024,
      });
      const healthy = createEntry({ value: "healthy" });
      cache.set("healthy", healthy);
      const candidates: Array<readonly [string, object]> = [
        ["typed-array", new Uint8Array(1)],
        ["data-view", new DataView(new ArrayBuffer(1))],
        ["array-buffer", new ArrayBuffer(1)],
        ["blob", new Blob(["x"])],
      ];
      if (typeof SharedArrayBuffer === "function") {
        candidates.push(["shared-array-buffer", new SharedArrayBuffer(1)]);
      }
      const retained = "x".repeat(2 * 1024 * 1024);

      for (const [key, value] of candidates) {
        Object.defineProperty(value, "retained", {
          value: retained,
        });
        assertThrows(
          () => cache.set(key, createEntry({ value })),
          RangeError,
          "exceeds maxSizeBytes",
        );
        assertEquals(cache.get(key), null);
      }
      assertStrictEquals(cache.get("healthy"), healthy);
    });

    it("charges observable BigInt payload size", () => {
      const cache = new CacheManager({
        maxEntries: 2,
        maxSizeBytes: 1_024,
        maxEntriesPerProject: 2,
        maxSizeBytesPerProject: 1_024,
      });

      assertThrows(
        () => cache.set("bigint", createEntry({ value: 1n << 16_384n })),
        RangeError,
        "exceeds maxSizeBytes",
      );
      assertEquals(cache.get("bigint"), null);
    });

    it("charges observable Symbol descriptions", () => {
      const cache = new CacheManager({
        maxEntries: 2,
        maxSizeBytes: 1_024,
        maxEntriesPerProject: 2,
        maxSizeBytesPerProject: 1_024,
      });

      assertThrows(
        () => cache.set("symbol", createEntry({ value: Symbol("x".repeat(2_048)) })),
        RangeError,
        "exceeds maxSizeBytes",
      );
      assertEquals(cache.get("symbol"), null);
    });

    it("does not execute retained accessors while estimating an entry", () => {
      const cache = new CacheManager();
      let getterCalls = 0;
      const props: Record<string, unknown> = {};
      Object.defineProperty(props, "expensive", {
        enumerable: true,
        get() {
          getterCalls++;
          return new Uint8Array(2 * 1024 * 1024);
        },
      });

      cache.set("accessor", createEntry(props));

      assertEquals(getterCalls, 0);
      assertExists(cache.get("accessor"));
    });

    it("rejects retained proxies without executing reflection traps", () => {
      const cache = new CacheManager();
      let traps = 0;
      const proxy = new Proxy({ value: "private" }, {
        ownKeys(target) {
          traps++;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          traps++;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });

      assertThrows(
        () => cache.set("raw-proxy", createEntry(proxy)),
        RangeError,
        "too complex to estimate safely",
      );
      assertEquals(traps, 0);
      assertEquals(cache.get("raw-proxy"), null);
    });

    it("does not mutate expiry state before rejecting an oversized global write", () => {
      let now = 1_000;
      const cache = new CacheManager({
        maxEntries: 2,
        maxSizeBytes: 1_024,
        maxEntriesPerProject: 2,
        maxSizeBytesPerProject: 1_024,
        ttlMs: 10,
        now: () => now,
      });
      const healthy = createEntry({ value: "healthy" });
      cache.set("healthy", healthy);
      now += 10;

      assertThrows(
        () => cache.set("oversized", createEntry({ value: "x".repeat(2_048) })),
        RangeError,
        "exceeds maxSizeBytes",
      );

      now -= 10;
      assertStrictEquals(cache.get("healthy"), healthy);
      assertEquals(cache.get("oversized"), null);
    });

    it("charges observable own data retained by functions and accessors", () => {
      const cache = new CacheManager({
        maxEntries: 3,
        maxSizeBytes: 1_024,
        maxEntriesPerProject: 3,
        maxSizeBytesPerProject: 1_024,
      });
      const healthy = createEntry({ value: "healthy" });
      cache.set("healthy", healthy);
      const retained = "x".repeat(2 * 1024 * 1024);
      const retainedFunction = () => undefined;
      Object.defineProperty(retainedFunction, "retained", {
        value: retained,
      });
      const retainedGetter = () => undefined;
      Object.defineProperty(retainedGetter, "retained", {
        value: retained,
      });
      const accessorOwner: Record<string, unknown> = {};
      Object.defineProperty(accessorOwner, "value", { get: retainedGetter });

      assertThrows(
        () => cache.set("function", createEntry({ retainedFunction })),
        RangeError,
        "exceeds maxSizeBytes",
      );
      assertThrows(
        () => cache.set("accessor-function", createEntry(accessorOwner)),
        RangeError,
        "exceeds maxSizeBytes",
      );
      assertEquals(cache.get("function"), null);
      assertEquals(cache.get("accessor-function"), null);
      assertStrictEquals(cache.get("healthy"), healthy);
    });

    it("does not evict quota victims when clock preparation rejects a write", () => {
      let clockCalls = 0;
      let throwOnCall = Number.POSITIVE_INFINITY;
      const cache = new CacheManager({
        maxEntries: 3,
        maxSizeBytes: 30,
        maxEntriesPerProject: 2,
        maxSizeBytesPerProject: 20,
        estimateSizeOf: estimateWeightedEntry,
        now: () => {
          clockCalls++;
          if (clockCalls === throwOnCall) {
            throw new Error("clock preparation failed");
          }
          return 1_000_000 + clockCalls;
        },
      });
      const first = createScopedKey(cache, "project", "first");
      const second = createScopedKey(cache, "project", "second");
      const rejected = createScopedKey(cache, "project", "rejected");

      cache.set(first, createEntry({ bytes: 10 }));
      cache.set(second, createEntry({ bytes: 10 }));
      // The first read cleans expired entries; the second prepares the write.
      // No clock-dependent work may remain after selected eviction begins.
      throwOnCall = clockCalls + 2;

      assertThrows(
        () => cache.set(rejected, createEntry({ bytes: 10 })),
        Error,
        "clock preparation failed",
      );
      assertExists(cache.get(first));
      assertExists(cache.get(second));
      assertEquals(cache.get(rejected), null);
    });
  });

  describe("delete", () => {
    it("should delete existing entry", () => {
      const cache = new CacheManager();
      cache.set("key", createEntry({}));

      assertExists(cache.get("key"));

      cache.delete("key");
      assertEquals(cache.get("key"), null);
    });

    it("should not throw when deleting non-existent key", () => {
      const cache = new CacheManager();
      cache.delete("non-existent");
      assertEquals(cache.get("non-existent"), null);
    });
  });

  describe("clear", () => {
    it("should remove all entries", () => {
      const cache = new CacheManager();
      const entry = createEntry({});

      cache.set("key1", entry);
      cache.set("key2", entry);
      cache.set("key3", entry);

      cache.clear();

      assertEquals(cache.get("key1"), null);
      assertEquals(cache.get("key2"), null);
      assertEquals(cache.get("key3"), null);
    });
  });

  describe("clearPattern", () => {
    it("should clear entries matching pattern", () => {
      const cache = new CacheManager();
      const entry = createEntry({});

      cache.set("/blog/post-1", entry);
      cache.set("/blog/post-2", entry);
      cache.set("/about", entry);
      cache.set("/contact", entry);

      cache.clearPattern("/blog");

      assertEquals(cache.get("/blog/post-1"), null);
      assertEquals(cache.get("/blog/post-2"), null);
      assertExists(cache.get("/about"));
      assertExists(cache.get("/contact"));
    });

    it("should not affect non-matching entries", () => {
      const cache = new CacheManager();
      const entry = createEntry({});

      cache.set("/products/1", entry);
      cache.set("/products/2", entry);

      cache.clearPattern("/blog");

      assertExists(cache.get("/products/1"));
      assertExists(cache.get("/products/2"));
    });

    it("should handle partial matches", () => {
      const cache = new CacheManager();
      const entry = createEntry({});

      cache.set("/api/users", entry);
      cache.set("/api/posts", entry);
      cache.set("/dashboard", entry);

      cache.clearPattern("/api");

      assertEquals(cache.get("/api/users"), null);
      assertEquals(cache.get("/api/posts"), null);
      assertExists(cache.get("/dashboard"));
    });

    it("clears transport-safe framed keys by their raw route pattern", () => {
      const cache = new CacheManager();
      const context = createContext("http://localhost/blog/%25draft");
      const key = withProductionContext(() => cache.createCacheKey(context, "page"));
      assertExists(key);
      assertEquals(key.includes("/blog/%2525draft"), true);
      cache.set(key, createEntry({}));

      cache.clearPattern("/blog/%25");

      assertEquals(cache.get(key), null);
    });

    it("does not match serialization length or delimiter metadata", () => {
      const cache = new CacheManager();
      const alphaKey = withProductionContext(() =>
        cache.createCacheKey(createContext("http://localhost/alpha"), "page")
      );
      const betaKey = withProductionContext(() =>
        cache.createCacheKey(createContext("http://localhost/beta"), "page")
      );
      assertExists(alphaKey);
      assertExists(betaKey);
      cache.set(alphaKey, createEntry({ page: "alpha" }));
      cache.set(betaKey, createEntry({ page: "beta" }));

      for (const pattern of ["17", "4:page", "|"]) {
        cache.clearPattern(pattern);
        assertExists(cache.get(alphaKey));
        assertExists(cache.get(betaKey));
      }
    });

    it("clears only the exact project and release scope", () => {
      const cache = new CacheManager();
      const context = createContext("http://localhost/shared");
      const projectA = runWithCacheKeyContext(
        { projectId: "project-a", mode: "production", versionId: "rel-1" },
        () => cache.createCacheKey(context, "page"),
      );
      const projectB = runWithCacheKeyContext(
        { projectId: "project-b", mode: "production", versionId: "rel-1" },
        () => cache.createCacheKey(context, "page"),
      );
      const releaseA2 = runWithCacheKeyContext(
        { projectId: "project-a", mode: "production", versionId: "rel-2" },
        () => cache.createCacheKey(context, "page"),
      );
      assertExists(projectA);
      assertExists(projectB);
      assertExists(releaseA2);
      cache.set(projectA, createEntry({ scope: "a1" }));
      cache.set(projectB, createEntry({ scope: "b1" }));
      cache.set(releaseA2, createEntry({ scope: "a2" }));

      cache.clearScope({
        projectId: "project-a",
        mode: "production",
        versionId: "rel-1",
      });

      assertEquals(cache.get(projectA), null);
      assertExists(cache.get(projectB));
      assertExists(cache.get(releaseA2));
    });

    it("clears one exact route without matching a path prefix or query", () => {
      const cache = new CacheManager();
      const scope = {
        projectId: "route-project",
        mode: "production" as const,
        versionId: "rel-1",
      };
      const routeA = cache.createCacheKey(
        createContext("https://alpha.test/a?variant=1"),
        "page",
        scope,
      );
      const routeAOtherOrigin = cache.createCacheKey(
        createContext("https://beta.test/a?variant=2"),
        "layout",
        scope,
      );
      const routeATrailingSlash = cache.createCacheKey(
        createContext("https://gamma.test/a/"),
        "page",
        scope,
      );
      const routeAbout = cache.createCacheKey(
        createContext("https://alpha.test/about"),
        "page",
        scope,
      );
      assertExists(routeA);
      assertExists(routeAOtherOrigin);
      assertExists(routeATrailingSlash);
      assertExists(routeAbout);
      cache.set(routeA, createEntry({ route: "a-1" }));
      cache.set(routeAOtherOrigin, createEntry({ route: "a-2" }));
      cache.set(routeATrailingSlash, createEntry({ route: "a-3" }));
      cache.set(routeAbout, createEntry({ route: "about" }));

      cache.clearRoute(scope, "/a");

      assertEquals(cache.get(routeA), null);
      assertEquals(cache.get(routeAOtherOrigin), null);
      assertEquals(cache.get(routeATrailingSlash), null);
      assertExists(cache.get(routeAbout));
    });

    it("fails closed for non-canonical project-scope transport spellings", () => {
      const cache = new CacheManager();
      const key = cache.createCacheKey(
        createContext("https://example.test/path"),
        "page",
        {
          projectId: "A",
          mode: "production",
          versionId: "rel",
        },
      );
      assertExists(key);

      const nonSurrogateEscape = key.replace(
        "|1:A|10:production|",
        "|6:%u0041|10:production|",
      );
      const nonCanonicalLength = key.replace(
        "|1:A|10:production|",
        "|01:A|10:production|",
      );
      const nonCanonicalResourceLength = key.replace(
        /\|(\d+):4:page\|/,
        (_match, resourceLength: string) => `|${Number(resourceLength) + 1}:04:page|`,
      );

      assertEquals(
        dataCacheKeyMatches(nonSurrogateEscape, { projectId: "A" }),
        false,
      );
      assertEquals(
        dataCacheKeyMatches(nonCanonicalLength, { projectId: "A" }),
        false,
      );
      assertEquals(
        dataCacheKeyMatches(nonCanonicalResourceLength, { projectId: "A" }),
        false,
      );
    });

    it("clears an exact project across releases without prefix collisions", () => {
      const cache = new CacheManager();
      const context = createContext("https://example.test/shared");
      const projectA1 = cache.createCacheKey(context, "page", {
        projectId: "a",
        mode: "production",
        versionId: "rel-1",
      });
      const projectA2 = cache.createCacheKey(context, "page", {
        projectId: "a",
        mode: "production",
        versionId: "rel-2",
      });
      const projectAColonB = cache.createCacheKey(context, "page", {
        projectId: "a:b",
        mode: "production",
        versionId: "rel-1",
      });
      assertExists(projectA1);
      assertExists(projectA2);
      assertExists(projectAColonB);
      cache.set(projectA1, createEntry({ release: 1 }));
      cache.set(projectA2, createEntry({ release: 2 }));
      cache.set(projectAColonB, createEntry({ release: 3 }));

      cache.clearProject("a");

      assertEquals(cache.get(projectA1), null);
      assertEquals(cache.get(projectA2), null);
      assertExists(cache.get(projectAColonB));
    });

    it("deletes residents hidden at the TTL boundary and releases their quota", () => {
      let phase: "stable" | "boundary" = "stable";
      const cache = new CacheManager({
        maxEntries: 2,
        maxSizeBytes: 10_000,
        maxEntriesPerProject: 1,
        maxSizeBytesPerProject: 10_000,
        ttlMs: 10,
        now: () => phase === "stable" ? 1_000 : 1_010,
      });
      const expiredKey = createScopedKey(cache, "expired-project", "old");
      const replacementKey = createScopedKey(cache, "expired-project", "new");
      cache.set(expiredKey, createEntry({ version: "old" }));

      phase = "boundary";
      cache.clearProject("expired-project");
      phase = "stable";

      assertEquals(cache.get(expiredKey), null);
      cache.set(replacementKey, createEntry({ version: "new" }));
      assertExists(cache.get(replacementKey));
    });

    it("rejects malformed invalidation identities before mutating cached entries", () => {
      const cache = new CacheManager();
      const scope = {
        projectId: "validation-project",
        mode: "production" as const,
        versionId: "rel-1",
      };
      const key = cache.createCacheKey(
        createContext("https://example.test/validation"),
        "page",
        scope,
      );
      assertExists(key);
      const entry = createEntry({ version: "retained" });
      cache.set(key, entry);
      let coercionHooks = 0;
      const executable = {
        toString() {
          coercionHooks++;
          return "/validation";
        },
        trim() {
          coercionHooks++;
          return "/validation";
        },
      };

      for (
        const invalidate of [
          () => cache.clearPattern(0 as never),
          () => cache.clearScope(scope, executable as never),
          () => cache.clearProject(""),
          () => cache.clearProject("validation-project", executable as never),
          () => cache.clearRoute(scope, executable as never),
          () => cache.clearProjectRoute("validation-project", executable as never),
          () => cache.clearRouteAcrossScopes(executable as never),
        ]
      ) {
        assertThrows(invalidate, TypeError);
        assertStrictEquals(cache.get(key), entry);
      }
      assertEquals(coercionHooks, 0);
      assertThrows(
        () =>
          cache.clearPattern(
            "p".repeat(MAX_DATA_INVALIDATION_PATTERN_CHARACTERS + 1),
          ),
        RangeError,
        "pattern must not exceed",
      );
      assertThrows(
        () => cache.clearRouteAcrossScopes(`/${"é".repeat(1_000)}`),
        RangeError,
        "Normalized data cache pathname",
      );
      assertStrictEquals(cache.get(key), entry);
    });
  });

  describe("shouldRevalidate", () => {
    it("should return false when revalidate is false", () => {
      const cache = new CacheManager();
      const entry = createEntry({}, { revalidate: false });

      assertEquals(cache.shouldRevalidate(entry), false);
    });

    it("should return false when entry is fresh", () => {
      const cache = new CacheManager();
      const entry = createEntry({}, { revalidate: 60 });

      assertEquals(cache.shouldRevalidate(entry), false);
    });

    it("should return true when entry is stale", () => {
      const cache = new CacheManager();
      const entry = createEntry(
        {},
        { timestamp: Date.now() - 120 * 1000, revalidate: 60 },
      );

      assertEquals(cache.shouldRevalidate(entry), true);
    });

    it("should return false when revalidate is undefined", () => {
      const cache = new CacheManager();
      const entry = createEntry({}, { timestamp: Date.now() - 120 * 1000 });

      assertEquals(cache.shouldRevalidate(entry), false);
    });

    it("should handle edge case at exact revalidation time", () => {
      const cache = new CacheManager();
      const revalidateSeconds = 60;
      const entry = createEntry(
        {},
        {
          timestamp: Date.now() - revalidateSeconds * 1000 - 1,
          revalidate: revalidateSeconds,
        },
      );

      assertEquals(cache.shouldRevalidate(entry), true);
    });

    it("should defer a stale entry without replacing its cached data", () => {
      const cache = new CacheManager();
      const key = "stale-key";
      const staleAt = 100_000;
      cache.set(
        key,
        createEntry(
          { version: 1 },
          { timestamp: staleAt - 60_001, revalidate: 60 },
        ),
      );
      const stale = cache.get(key);
      assertExists(stale);
      assertEquals(cache.shouldRevalidate(stale, staleAt), true);

      cache.deferRevalidation(key, 30_000, staleAt);

      const deferred = cache.get(key);
      assertExists(deferred);
      assertStrictEquals(deferred, stale);
      assertEquals(getEntryProps<{ version: number }>(deferred).version, 1);
      assertEquals(cache.shouldRevalidate(deferred, staleAt + 30_000), false);
      assertEquals(cache.shouldRevalidate(deferred, staleAt + 30_001), true);
    });

    it("does not extend the absolute LRU lifetime when deferring a retry", () => {
      const insertedAt = 1_000_000;
      let now = insertedAt;
      const cache = new CacheManager({ now: () => now });
      const entry = createEntry(
        { version: 1 },
        { timestamp: insertedAt - 1, revalidate: 0 },
      );
      cache.set("stale-key", entry);

      now = insertedAt + DATA_FETCHING_TTL_MS - 1;
      assertEquals(
        cache.deferRevalidationIfCurrent("stale-key", entry, 30_000, now),
        true,
      );
      assertEquals(cache.shouldRevalidate(entry, now), false);

      now = insertedAt + DATA_FETCHING_TTL_MS;
      assertEquals(cache.get("stale-key"), null);
    });

    it("should not defer a replacement that superseded the expected entry", () => {
      const cache = new CacheManager();
      const key = "replacement-key";
      const staleAt = 100_000;
      const original = createEntry(
        { version: 1 },
        { timestamp: staleAt - 60_001, revalidate: 60 },
      );
      const replacement = createEntry(
        { version: 2 },
        { timestamp: staleAt - 60_001, revalidate: 60 },
      );
      cache.set(key, original);
      cache.set(key, replacement);

      assertEquals(
        cache.deferRevalidationIfCurrent(key, original, 30_000, staleAt),
        false,
      );
      assertStrictEquals(cache.get(key), replacement);
      assertEquals(cache.shouldRevalidate(replacement, staleAt), true);
    });
  });

  describe("createCacheKey", () => {
    it("should return null when no context is set", () => {
      const cache = new CacheManager();
      const key = cache.createCacheKey(
        createContext("http://localhost/posts/123", { id: "123" }),
        "page",
      );

      assertEquals(key, null);
    });

    it("rejects non-string module identities instead of coercing cache aliases", () => {
      const manager = new CacheManager();
      const context = createContext("https://example.test/page");
      const scope = {
        projectId: "runtime-validation",
        mode: "production" as const,
        versionId: "rel-1",
      };

      assertThrows(
        () =>
          manager.createCacheKey(
            context,
            { length: 4, toString: () => "page" } as unknown as string,
            scope,
          ),
        TypeError,
        "modulePath must be a string",
      );
    });

    it("bounds module identities and the final framed cache key", () => {
      const cache = new CacheManager();
      const scope = {
        projectId: "bounded-key-project",
        mode: "production" as const,
        versionId: "rel-1",
      };
      assertThrows(
        () =>
          cache.createCacheKey(
            createContext("https://example.test/page"),
            "m".repeat(MAX_DATA_MODULE_PATH_CHARACTERS + 1),
            scope,
          ),
        RangeError,
        "modulePath must not exceed",
      );
      assertThrows(
        () =>
          cache.createCacheKey(
            createContext(
              `https://example.test/${"u".repeat(MAX_DATA_CACHE_KEY_CHARACTERS)}`,
            ),
            "page",
            scope,
          ),
        RangeError,
        "Data cache key must not exceed",
      );
      assertThrows(
        () => cache.set("k".repeat(MAX_DATA_CACHE_KEY_CHARACTERS + 1), createEntry({})),
        RangeError,
        "Data cache key must not exceed",
      );
    });

    it("rejects invalid route params before they can serialize to the same key", () => {
      const manager = new CacheManager();
      const scope = {
        projectId: "runtime-validation",
        mode: "production" as const,
        versionId: "rel-1",
      };
      const invalidContexts = [
        createContext("https://example.test/page", { id: null } as never),
        createContext("https://example.test/page", { id: Number.NaN } as never),
      ];

      for (const context of invalidContexts) {
        assertThrows(
          () => manager.createCacheKey(context, "/pages/[id].tsx", scope),
          TypeError,
          "plain record of string or dense string-array data properties",
        );
      }
    });

    it("does not execute Array.prototype serialization hooks or alias array params", () => {
      const manager = new CacheManager();
      const scope = {
        projectId: "runtime-validation",
        mode: "production" as const,
        versionId: "rel-1",
      };
      const previous = Reflect.getOwnPropertyDescriptor(Array.prototype, "toJSON");
      let hookCalls = 0;
      let first: string | null;
      let second: string | null;
      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        value() {
          hookCalls++;
          return ["aliased"];
        },
      });
      try {
        first = manager.createCacheKey(
          createContext("https://example.test/page", { slug: ["a"] }),
          "/pages/[...slug].tsx",
          scope,
        );
        second = manager.createCacheKey(
          createContext("https://example.test/page", { slug: ["b"] }),
          "/pages/[...slug].tsx",
          scope,
        );
      } finally {
        if (previous) {
          Object.defineProperty(Array.prototype, "toJSON", previous);
        } else {
          Reflect.deleteProperty(Array.prototype, "toJSON");
        }
      }

      assertEquals(hookCalls, 0);
      assertEquals(first === second, false);
    });

    it("should return null in preview mode", () => {
      const cache = new CacheManager();
      let paramsReads = 0;
      let urlReads = 0;
      const context = Object.defineProperties({}, {
        params: {
          get() {
            paramsReads++;
            throw new Error("disabled cache must not inspect params");
          },
        },
        url: {
          get() {
            urlReads++;
            throw new Error("disabled cache must not inspect url");
          },
        },
      }) as Pick<DataContext, "params" | "url">;

      const key = runWithCacheKeyContext(
        { projectId: "test", mode: "preview", versionId: "main" },
        () => cache.createCacheKey(context, "page"),
      );

      assertEquals(key, null);
      assertEquals({ paramsReads, urlReads }, { paramsReads: 0, urlReads: 0 });
    });

    it("returns null without a non-empty module identity in production", () => {
      const cache = new CacheManager();
      const context = createContext("https://example.test/no-module");

      assertEquals(withProductionContext(() => cache.createCacheKey(context)), null);
      assertEquals(withProductionContext(() => cache.createCacheKey(context, "")), null);
    });

    it("uses an explicit production scope without ambient request context", () => {
      const cache = new CacheManager();
      const key = cache.createCacheKey(
        createContext("https://example.test/scoped"),
        "page",
        {
          projectId: "explicit-project",
          mode: "production",
          versionId: "rel-explicit",
        },
      );

      assertExists(key);
      assertEquals(key.includes("explicit-project"), true);
      assertEquals(key.includes("rel-explicit"), true);
    });

    it("lets an explicit null scope disable an inherited production context", () => {
      const cache = new CacheManager();
      let paramsReads = 0;
      let urlReads = 0;
      const context = Object.defineProperties({}, {
        params: {
          get() {
            paramsReads++;
            throw new Error("disabled cache must not inspect params");
          },
        },
        url: {
          get() {
            urlReads++;
            throw new Error("disabled cache must not inspect url");
          },
        },
      }) as Pick<DataContext, "params" | "url">;
      const key = withProductionContext(() =>
        cache.createCacheKey(
          context,
          "page",
          null,
        )
      );

      assertEquals(key, null);
      assertEquals({ paramsReads, urlReads }, { paramsReads: 0, urlReads: 0 });
    });

    it("should create key from pathname and params in production mode", () => {
      const cache = new CacheManager();
      const context = createContext("http://localhost/posts/123", { id: "123" });

      const key = withProductionContext(() => cache.createCacheKey(context, "page"));

      assertEquals(
        key,
        "project-scoped:v2:17:veryfront:data:v3|12:test-project|10:production|7:rel_123|54:4:page|26:http://localhost/posts/123|14:p1:k2:ids3:123",
      );
    });

    it("should create key with empty params in production mode", () => {
      const cache = new CacheManager();
      const context = createContext("http://localhost/about", {});

      const key = withProductionContext(() => cache.createCacheKey(context, "page"));

      assertEquals(
        key,
        "project-scoped:v2:17:veryfront:data:v3|12:test-project|10:production|7:rel_123|38:4:page|22:http://localhost/about|3:p0:",
      );
    });

    it("should create unique keys for different params", () => {
      const cache = new CacheManager();
      const context1 = createContext("http://localhost/posts/1", { id: "1" });
      const context2 = createContext("http://localhost/posts/2", { id: "2" });

      const key1 = withProductionContext(() => cache.createCacheKey(context1, "page"));
      const key2 = withProductionContext(() => cache.createCacheKey(context2, "page"));

      assertExists(key1);
      assertExists(key2);
      assertEquals(key1 !== key2, true);
    });

    it("should not alias delimiter-bearing module paths and routes", () => {
      const cache = new CacheManager();
      const first = createContext("http://localhost/b::/c");
      const second = createContext("http://localhost/c");

      const firstKey = withProductionContext(() => cache.createCacheKey(first, "a"));
      const secondKey = withProductionContext(() => cache.createCacheKey(second, "a::/b"));

      assertExists(firstKey);
      assertExists(secondKey);
      assertEquals(firstKey === secondKey, false);
    });

    it("should preserve meaningful whitespace in module paths", () => {
      const cache = new CacheManager();
      const context = createContext("http://localhost/space");

      const plain = withProductionContext(() => cache.createCacheKey(context, "/app/page.ts"));
      const spaced = withProductionContext(() => cache.createCacheKey(context, "/app/page.ts "));

      assertExists(plain);
      assertExists(spaced);
      assertEquals(plain === spaced, false);
    });

    it("should canonicalize equivalent params with different insertion order", () => {
      const cache = new CacheManager();
      const first = createContext("http://localhost/posts/one", {
        category: "tech",
        slug: ["posts", "one"],
      });
      const second = createContext("http://localhost/posts/one", {
        slug: ["posts", "one"],
        category: "tech",
      });

      const firstKey = withProductionContext(() => cache.createCacheKey(first, "page"));
      const secondKey = withProductionContext(() => cache.createCacheKey(second, "page"));

      assertEquals(firstKey, secondKey);
    });

    it("should create unique keys for reordered query params", () => {
      const cache = new CacheManager();
      const context1 = createContext("http://localhost/search?b=2&a=1");
      const context2 = createContext("http://localhost/search?a=1&b=2");

      const key1 = withProductionContext(() => cache.createCacheKey(context1, "page"));
      const key2 = withProductionContext(() => cache.createCacheKey(context2, "page"));

      assertExists(key1);
      assertExists(key2);
      assertEquals(key1 !== key2, true);
    });

    it("should preserve duplicate query value order in cache keys", () => {
      const cache = new CacheManager();
      const context1 = createContext("http://localhost/search?tag=a&tag=b");
      const context2 = createContext("http://localhost/search?tag=b&tag=a");

      const key1 = withProductionContext(() => cache.createCacheKey(context1, "page"));
      const key2 = withProductionContext(() => cache.createCacheKey(context2, "page"));

      assertExists(key1);
      assertExists(key2);
      assertEquals(key1 !== key2, true);
    });

    it("should create unique keys for distinct query values", () => {
      const cache = new CacheManager();
      const context1 = createContext("http://localhost/search?q=alpha");
      const context2 = createContext("http://localhost/search?q=beta");

      const key1 = withProductionContext(() => cache.createCacheKey(context1, "page"));
      const key2 = withProductionContext(() => cache.createCacheKey(context2, "page"));

      assertExists(key1);
      assertExists(key2);
      assertEquals(key1 !== key2, true);
    });

    it("should create unique keys for distinct URL origins", () => {
      const cache = new CacheManager();
      const http = createContext("http://alpha.example.test/page");
      const https = createContext("https://alpha.example.test/page");
      const otherHost = createContext("http://beta.example.test/page");

      const httpKey = withProductionContext(() => cache.createCacheKey(http, "page"));
      const httpsKey = withProductionContext(() => cache.createCacheKey(https, "page"));
      const otherHostKey = withProductionContext(() => cache.createCacheKey(otherHost, "page"));

      assertExists(httpKey);
      assertExists(httpsKey);
      assertExists(otherHostKey);
      assertEquals(httpKey === httpsKey, false);
      assertEquals(httpKey === otherHostKey, false);
    });

    it("should include the URL search string in production cache keys", () => {
      const cache = new CacheManager();
      const context = createContext("http://localhost/search?b=2&a=1&a=3");

      const key = withProductionContext(() => cache.createCacheKey(context, "page"));

      assertExists(key);
      assertEquals(key.includes("/search?b=2&a=1&a=3|3:p0:"), true);
    });

    it("should handle array params (catch-all routes)", () => {
      const cache = new CacheManager();
      const context = createContext("http://localhost/docs/getting-started", {
        slug: ["docs", "getting-started"],
      });

      const key = withProductionContext(() => cache.createCacheKey(context, "page"));

      assertExists(key);
      assertEquals(key.includes("docs"), true);
      assertEquals(key.includes("getting-started"), true);
    });
  });
});
