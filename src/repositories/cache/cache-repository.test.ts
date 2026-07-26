import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryCacheBackend } from "#veryfront/cache/backend.ts";
import { FakeTime } from "#std/testing/time";
import {
  buildScopedKey,
  createMultiTierCacheRepository,
  MemoryCacheRepository,
  MultiTierCacheRepository,
} from "./cache-repository.ts";
import type { RepositoryContext } from "../types.ts";

// NOTE: basic MemoryCacheRepository behaviour (get/set, delete, deleteByPrefix,
// stats/hitRate, has-expiry, buildScopedKey, memory factory) is already covered
// by ../repositories.test.ts. This adjacent suite intentionally covers only the
// gaps: MemoryCacheRepository TTL pruning + LRU eviction, and the entire
// MultiTierCacheRepository.
const CTX: RepositoryContext = {
  projectId: "proj",
  environment: "production",
  versionId: "v1",
};

function scopedKey(key: string): string {
  return buildScopedKey(CTX, key);
}

describe("repositories/cache/cache-repository", () => {
  describe("MemoryCacheRepository - TTL and eviction", () => {
    it("does not store values whose TTL expires immediately", async () => {
      const cache = new MemoryCacheRepository<string>({ context: CTX });
      await cache.set("k", "v", -1);

      assertEquals(await cache.get("k"), null);
      assertEquals(cache.size, 0);
      const stats = cache.getStats();
      assertEquals(stats.gets, 1);
      assertEquals(stats.misses, 1);
      assertEquals(stats.hits, 0);
    });

    it("treats a read as recent use when choosing an eviction victim", async () => {
      const cache = new MemoryCacheRepository<string>({ context: CTX, maxEntries: 2 });
      await cache.set("a", "1");
      await cache.set("b", "2");
      assertEquals(await cache.get("a"), "1");
      await cache.set("c", "3");

      assertEquals(cache.size, 2);
      assertEquals(await cache.get("a"), "1");
      assertEquals(await cache.get("b"), null);
      assertEquals(await cache.get("c"), "3");
    });

    it("treats an update as recent use when choosing an eviction victim", async () => {
      const cache = new MemoryCacheRepository<string>({ context: CTX, maxEntries: 2 });
      await cache.set("a", "1");
      await cache.set("b", "2");
      await cache.set("a", "1-updated");
      await cache.set("c", "3");

      assertEquals(cache.size, 2);
      assertEquals(await cache.get("a"), "1-updated");
      assertEquals(await cache.get("b"), null);
      assertEquals(await cache.get("c"), "3");
    });

    it("purges expired entries before evicting a live entry", async () => {
      using time = new FakeTime();
      const cache = new MemoryCacheRepository<string>({ context: CTX, maxEntries: 2 });
      await cache.set("live", "1", 60);
      await cache.set("expired", "2", 1);
      time.tick(1_000);

      await cache.set("new", "3", 60);

      assertEquals(cache.size, 2);
      assertEquals(await cache.get("live"), "1");
      assertEquals(await cache.get("expired"), null);
      assertEquals(await cache.get("new"), "3");
    });

    it("expires at the exact TTL boundary", async () => {
      using time = new FakeTime();
      const cache = new MemoryCacheRepository<string>({ context: CTX });
      await cache.set("k", "v", 1);

      time.tick(1_000);

      assertEquals(await cache.get("k"), null);
      assertEquals(cache.size, 0);
    });

    it("rejects invalid TTL and capacity configuration", async () => {
      const cache = new MemoryCacheRepository<string>({ context: CTX });
      await assertRejects(() => cache.set("nan", "value", Number.NaN), RangeError);
      await assertRejects(() => cache.set("infinite", "value", Infinity), RangeError);

      for (const maxEntries of [0, -1, 1.5, Number.NaN, Infinity]) {
        assertThrows(
          () => new MemoryCacheRepository({ context: CTX, maxEntries }),
          RangeError,
        );
      }

      for (const defaultTtlSeconds of [0, -1, 1.5, Number.NaN, Infinity]) {
        assertThrows(
          () => new MemoryCacheRepository({ context: CTX, defaultTtlSeconds }),
          RangeError,
        );
      }

      assertThrows(
        () =>
          new MultiTierCacheRepository({
            context: CTX,
            backend: new MemoryCacheBackend(),
            name: " invalid-cache-name ",
          }),
        Error,
        "cache name",
      );
    });

    it("clear() empties the repository", async () => {
      const cache = new MemoryCacheRepository<string>({ context: CTX });
      await cache.set("a", "1");
      await cache.set("b", "2");
      await cache.clear();
      assertEquals(await cache.get("a"), null);
      assertEquals(await cache.get("b"), null);
      assertEquals(cache.size, 0);
    });
  });

  describe("MultiTierCacheRepository", () => {
    function makeRepo() {
      const backend = new MemoryCacheBackend();
      const repo = new MultiTierCacheRepository({ context: CTX, backend, defaultTtlSeconds: 300 });
      return { backend, repo };
    }

    it("keeps runtime cache-name validation aligned with its schema", () => {
      for (const name of ["", " padded", "bad\u0000name", "\uD800"]) {
        assertThrows(
          () =>
            new MultiTierCacheRepository({
              context: CTX,
              backend: new MemoryCacheBackend(),
              name,
            }),
          Error,
          "cache name",
        );
      }
    });

    it("set writes through to the backend under the scoped key, get reads it back", async () => {
      const { backend, repo } = makeRepo();
      await repo.set("page", "html");

      assertEquals(await repo.get("page"), "html");
      assertEquals(await backend.get(scopedKey("page")), "html");
    });

    it("get returns null for a missing key", async () => {
      const { repo } = makeRepo();
      assertEquals(await repo.get("nope"), null);
    });

    it("preserves the L3 entry's remaining TTL when backfilling L1", async () => {
      using time = new FakeTime();
      const { backend, repo } = makeRepo();
      await backend.set(scopedKey("short"), "value", 0.05);

      assertEquals(await repo.get("short"), "value");
      await time.tickAsync(0);
      await time.tickAsync(50);

      assertEquals(await repo.get("short"), null);
    });

    it("backfills L1 when the L3 backend cannot report its TTL", async () => {
      let backendGets = 0;
      const backend = {
        type: "api" as const,
        get: () => {
          backendGets++;
          return Promise.resolve("authoritative");
        },
        set: () => Promise.resolve(),
        del: () => Promise.resolve(),
      };
      const repo = new MultiTierCacheRepository({ context: CTX, backend });

      assertEquals(await repo.get("key"), "authoritative");

      assertEquals(await repo.get("key"), "authoritative");
      assertEquals(backendGets, 1);
    });

    it("has reflects presence", async () => {
      const { repo } = makeRepo();
      assertEquals(await repo.has("k"), false);
      await repo.set("k", "v");
      assertEquals(await repo.has("k"), true);
    });

    it("delete removes the entry and counts a local delete stat", async () => {
      const { repo } = makeRepo();
      await repo.set("k", "v");
      await repo.delete("k");
      assertEquals(await repo.get("k"), null);
      assertEquals(repo.getStats().deletes, 1);
    });

    it("deleteByPrefix removes matching scoped keys via the backend pattern", async () => {
      const { backend, repo } = makeRepo();
      await backend.set(scopedKey("pages/a"), "1");
      await backend.set(scopedKey("pages/b"), "2");
      await backend.set(scopedKey("assets/c"), "3");

      const deleted = await repo.deleteByPrefix("pages/");
      assertEquals(deleted, 2);
      assertEquals(await backend.get(scopedKey("pages/a")), null);
      assertEquals(await backend.get(scopedKey("pages/b")), null);
      assertEquals(await backend.get(scopedKey("assets/c")), "3");
    });

    it("fails closed when prefix deletion is unsupported by the backend", async () => {
      const backend = {
        type: "memory" as const,
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        del: () => Promise.resolve(),
      };
      const repo = new MultiTierCacheRepository({ context: CTX, backend });
      await repo.set("pages/a", "1");
      assertEquals(await repo.get("pages/a"), "1"); // served from L1

      await assertRejects(
        () => repo.deleteByPrefix("pages/"),
        Error,
        "does not support pattern deletion",
      );
      await assertRejects(
        () => repo.clear(),
        Error,
        "does not support pattern deletion",
      );
      assertEquals(await repo.get("pages/a"), "1");
    });

    it("rejects an invalid deletion count from a custom backend", async () => {
      const backend = {
        type: "api" as const,
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        del: () => Promise.resolve(),
        delByPattern: () => Promise.resolve(-1),
      };
      const repo = new MultiTierCacheRepository({ context: CTX, backend });

      await assertRejects(
        () => repo.deleteByPrefix("pages/"),
        Error,
        "invalid pattern-deletion count",
      );
    });

    it("treats wildcard characters in a caller prefix as literals", async () => {
      const { backend, repo } = makeRepo();
      await backend.set(scopedKey("pages/*/literal"), "delete");
      await backend.set(scopedKey("pages/other"), "keep");

      assertEquals(await repo.deleteByPrefix("pages/*"), 1);
      assertEquals(await backend.get(scopedKey("pages/*/literal")), null);
      assertEquals(await backend.get(scopedKey("pages/other")), "keep");
    });

    it("isolates contexts that collide under delimiter concatenation", async () => {
      const backend = new MemoryCacheBackend();
      const left = new MultiTierCacheRepository({
        context: {
          projectId: "a:preview:b",
          environment: "preview",
          versionId: "c",
        },
        backend,
      });
      const right = new MultiTierCacheRepository({
        context: {
          projectId: "a",
          environment: "preview",
          versionId: "b:preview:c",
        },
        backend,
      });

      assertNotEquals(buildScopedKey(left.context, "d"), buildScopedKey(right.context, "d"));
      await left.set("d", "left");
      assertEquals(await right.get("d"), null);
    });

    it("snapshots context so caller mutation cannot move its cache namespace", async () => {
      const context = { ...CTX };
      const repo = new MultiTierCacheRepository({
        context,
        backend: new MemoryCacheBackend(),
      });
      await repo.set("key", "value");

      context.projectId = "other";

      assertEquals(repo.context.projectId, "proj");
      assert(Object.isFrozen(repo.context));
      assertEquals(await repo.get("key"), "value");
    });

    it("deleteByPrefix invalidates L1 so a deleted key is not served stale", async () => {
      const { repo } = makeRepo();
      await repo.set("pages/a", "1");
      await repo.set("assets/b", "2");
      assertEquals(await repo.get("pages/a"), "1");

      await repo.deleteByPrefix("pages/");
      assertEquals(await repo.get("pages/a"), null); // gone from both tiers
      assertEquals(await repo.get("assets/b"), "2"); // non-matching key kept
    });

    it("clear invalidates L1 so cleared keys are not served stale", async () => {
      const { repo } = makeRepo();
      await repo.set("k", "v");
      assertEquals(await repo.get("k"), "v");

      await repo.clear();
      assertEquals(await repo.get("k"), null);
    });

    it("does not serve a read racing with prefix invalidation", async () => {
      const inner = new MemoryCacheBackend();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const backend = {
        type: "memory" as const,
        get: (k: string) => inner.get(k),
        set: (k: string, v: string, ttl?: number) => inner.set(k, v, ttl),
        del: (k: string) => inner.del(k),
        delByPattern: async (pattern: string) => {
          await gate; // hold the L3 delete open
          return inner.delByPattern(pattern);
        },
      };
      const repo = new MultiTierCacheRepository({ context: CTX, backend });
      await repo.set("pages/a", "1");

      const deletePromise = repo.deleteByPrefix("pages/");
      let readSettled = false;
      const readPromise = repo.get("pages/a").then((value) => {
        readSettled = true;
        return value;
      });
      await Promise.resolve();
      assertEquals(readSettled, false);

      release();
      await deletePromise;
      assertEquals(await readPromise, null);
    });

    it("clear removes only this scope's keys from the backend", async () => {
      const { backend, repo } = makeRepo();
      const otherContext: RepositoryContext = {
        projectId: "other",
        environment: "preview",
        versionId: "other-version",
      };
      await backend.set(scopedKey("k"), "v");
      await backend.set(buildScopedKey(otherContext, "k"), "keep");

      await repo.clear();
      assertEquals(await backend.get(scopedKey("k")), null);
      assertEquals(await backend.get(buildScopedKey(otherContext, "k")), "keep");
    });

    it("orders a racing set before clear so the value cannot be resurrected", async () => {
      const inner = new MemoryCacheBackend();
      let releaseSet!: () => void;
      let markSetStarted!: () => void;
      const setGate = new Promise<void>((resolve) => (releaseSet = resolve));
      const setStarted = new Promise<void>((resolve) => (markSetStarted = resolve));
      const backend = {
        type: "memory" as const,
        get: (key: string) => inner.get(key),
        set: async (key: string, value: string, ttl?: number) => {
          markSetStarted();
          await setGate;
          await inner.set(key, value, ttl);
        },
        del: (key: string) => inner.del(key),
        delByPattern: (pattern: string) => inner.delByPattern(pattern),
      };
      const repo = new MultiTierCacheRepository({ context: CTX, backend });

      const setPromise = repo.set("key", "value");
      await setStarted;
      const clearPromise = repo.clear();
      let clearSettled = false;
      void clearPromise.then(() => {
        clearSettled = true;
      });
      await Promise.resolve();
      assertEquals(clearSettled, false);

      releaseSet();
      await Promise.all([setPromise, clearPromise]);

      assertEquals(await repo.get("key"), null);
    });

    it("does not let a later set bypass a queued clear", async () => {
      const inner = new MemoryCacheBackend();
      let releaseFirstSet!: () => void;
      let markFirstSetStarted!: () => void;
      let setCalls = 0;
      const firstSetGate = new Promise<void>((resolve) => (releaseFirstSet = resolve));
      const firstSetStarted = new Promise<void>((resolve) => (markFirstSetStarted = resolve));
      const backend = {
        type: "memory" as const,
        get: (key: string) => inner.get(key),
        set: async (key: string, value: string, ttl?: number) => {
          setCalls++;
          if (setCalls === 1) {
            markFirstSetStarted();
            await firstSetGate;
          }
          await inner.set(key, value, ttl);
        },
        del: (key: string) => inner.del(key),
        delByPattern: (pattern: string) => inner.delByPattern(pattern),
      };
      const repo = new MultiTierCacheRepository({ context: CTX, backend });

      const staleSet = repo.set("key", "stale");
      await firstSetStarted;
      const clear = repo.clear();
      const freshSet = repo.set("key", "fresh");

      releaseFirstSet();
      await Promise.all([staleSet, clear, freshSet]);

      assertEquals(await repo.get("key"), "fresh");
    });

    it("allows independent point writes to run concurrently", async () => {
      const inner = new MemoryCacheBackend();
      let releaseSets!: () => void;
      let enteredSets = 0;
      let markBothEntered!: () => void;
      const setsGate = new Promise<void>((resolve) => (releaseSets = resolve));
      const bothEntered = new Promise<void>((resolve) => (markBothEntered = resolve));
      const backend = {
        type: "memory" as const,
        get: (key: string) => inner.get(key),
        set: async (key: string, value: string, ttl?: number) => {
          enteredSets++;
          if (enteredSets === 2) markBothEntered();
          await setsGate;
          await inner.set(key, value, ttl);
        },
        del: (key: string) => inner.del(key),
        delByPattern: (pattern: string) => inner.delByPattern(pattern),
      };
      const repo = new MultiTierCacheRepository({ context: CTX, backend });

      const first = repo.set("a", "1");
      const second = repo.set("b", "2");
      await bothEntered;
      releaseSets();
      await Promise.all([first, second]);

      assertEquals(await repo.get("a"), "1");
      assertEquals(await repo.get("b"), "2");
    });

    it("getStats surfaces multi-tier hit/miss accounting", async () => {
      const { repo } = makeRepo();
      await repo.set("k", "v");
      await repo.get("k"); // hit (from whichever tier; total still one hit)
      await repo.get("missing"); // miss

      const stats = repo.getStats();
      assertEquals(stats.sets, 1);
      assertEquals(stats.gets, 2);
      assertEquals(stats.hits, 1);
      assertEquals(stats.misses, 1);
    });
  });

  describe("factory functions", () => {
    // createMemoryCacheRepository is covered by ../repositories.test.ts.
    it("createMultiTierCacheRepository builds a working MultiTierCacheRepository", async () => {
      const repo = createMultiTierCacheRepository(CTX, new MemoryCacheBackend());
      await repo.set("k", "v");
      assertEquals(await repo.get("k"), "v");
    });
  });
});
