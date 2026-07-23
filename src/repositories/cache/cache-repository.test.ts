import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type CacheBackend, MemoryCacheBackend } from "#veryfront/cache/backend.ts";
import {
  createMultiTierCacheRepository,
  MemoryCacheRepository,
  MultiTierCacheRepository,
} from "./cache-repository.ts";
import type { RepositoryContext } from "../types.ts";

// NOTE: basic MemoryCacheRepository behaviour (get/set, delete, deleteByPrefix,
// stats/hitRate, has-expiry, buildScopedKey, memory factory) is already covered
// by ../repositories.test.ts. This adjacent suite intentionally covers only the
// gaps: MemoryCacheRepository TTL pruning + LRU eviction, and the entire
// MultiTierCacheRepository (previously untested).
const CTX: RepositoryContext = {
  projectId: "proj",
  environment: "production",
  versionId: "v1",
};

describe("repositories/cache/cache-repository", () => {
  describe("MemoryCacheRepository — TTL & eviction (untested paths)", () => {
    it("get() treats an expired entry as a miss and prunes it", async () => {
      const cache = new MemoryCacheRepository<string>({ context: CTX });
      await cache.set("k", "v", 0.001);
      await new Promise((resolve) => setTimeout(resolve, 5));
      assertEquals(await cache.get("k"), null);
      // Expired entry is removed from the store.
      assertEquals(cache.size, 0);
      const stats = cache.getStats();
      assertEquals(stats.gets, 1);
      assertEquals(stats.misses, 1);
      assertEquals(stats.hits, 0);
    });

    it("evicts the oldest entry once maxEntries is exceeded", async () => {
      const cache = new MemoryCacheRepository<string>({ context: CTX, maxEntries: 2 });
      await cache.set("a", "1");
      await cache.set("b", "2");
      await cache.set("c", "3"); // evicts "a" (oldest)

      assertEquals(cache.size, 2);
      assertEquals(await cache.get("a"), null);
      assertEquals(await cache.get("b"), "2");
      assertEquals(await cache.get("c"), "3");
    });

    it("refreshes a key's recency when it is read", async () => {
      const cache = new MemoryCacheRepository<string>({ context: CTX, maxEntries: 2 });
      await cache.set("a", "1");
      await cache.set("b", "2");
      assertEquals(await cache.get("a"), "1");

      await cache.set("c", "3");

      assertEquals(await cache.get("a"), "1");
      assertEquals(await cache.get("b"), null);
      assertEquals(await cache.get("c"), "3");
    });

    it("re-setting an existing key does not trigger eviction", async () => {
      const cache = new MemoryCacheRepository<string>({ context: CTX, maxEntries: 2 });
      await cache.set("a", "1");
      await cache.set("b", "2");
      await cache.set("a", "1-updated"); // already present → no eviction

      assertEquals(cache.size, 2);
      assertEquals(await cache.get("a"), "1-updated");
      assertEquals(await cache.get("b"), "2");
    });

    it("prunes expired entries before evicting a live LRU entry", async () => {
      const cache = new MemoryCacheRepository<string>({ context: CTX, maxEntries: 2 });
      await cache.set("live", "1", 60);
      await cache.set("expired", "2", 0.001);
      await new Promise((resolve) => setTimeout(resolve, 5));

      await cache.set("new", "3", 60);

      assertEquals(await cache.get("live"), "1");
      assertEquals(await cache.get("expired"), null);
      assertEquals(await cache.get("new"), "3");
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

    it("rejects invalid capacity and TTL values", async () => {
      for (const maxEntries of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
        let threw = false;
        try {
          new MemoryCacheRepository<string>({ context: CTX, maxEntries });
        } catch {
          threw = true;
        }
        assertEquals(threw, true);
      }

      const cache = new MemoryCacheRepository<string>({ context: CTX });
      for (const ttl of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        let threw = false;
        try {
          await cache.set("key", "value", ttl);
        } catch {
          threw = true;
        }
        assertEquals(threw, true);
      }
      assertEquals(cache.getStats().sets, 0);
    });
  });

  describe("MultiTierCacheRepository (previously untested)", () => {
    function makeRepo() {
      const backend = new MemoryCacheBackend();
      const repo = new MultiTierCacheRepository({ context: CTX, backend, defaultTtlSeconds: 300 });
      return { backend, repo };
    }

    const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    it("set writes through to the backend under the scoped key, get reads it back", async () => {
      const { backend, repo } = makeRepo();
      await repo.set("page", "html");

      assertEquals(await repo.get("page"), "html");
      // Stored under the project-scoped key in the distributed backend.
      assertEquals(await backend.get("proj:production:v1:page"), "html");
    });

    it("get returns null for a missing key", async () => {
      const { repo } = makeRepo();
      assertEquals(await repo.get("nope"), null);
    });

    it("preserves the L3 entry's remaining TTL when backfilling L1", async () => {
      const { backend, repo } = makeRepo();
      await backend.set("proj:production:v1:short", "value", 0.05);

      assertEquals(await repo.get("short"), "value");
      await new Promise((resolve) => setTimeout(resolve, 80));

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

    it("does not expose malformed backend values as cache hits", async () => {
      const backend = {
        type: "api" as const,
        get: () => Promise.resolve(undefined),
        set: () => Promise.resolve(),
        del: () => Promise.resolve(),
      };
      const repo = new MultiTierCacheRepository({
        context: CTX,
        backend: backend as unknown as CacheBackend,
      });

      assertEquals(await repo.get("key"), null);
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
      // deleteByPrefix operates on the L3 backend via delByPattern, so seed the
      // backend directly and assert backend state — the cleanest unit of the
      // method's contract.
      await backend.set("proj:production:v1:pages/a", "1");
      await backend.set("proj:production:v1:pages/b", "2");
      await backend.set("proj:production:v1:assets/c", "3");

      const deleted = await repo.deleteByPrefix("pages/");
      assertEquals(deleted, 2);
      assertEquals(await backend.get("proj:production:v1:pages/a"), null);
      assertEquals(await backend.get("proj:production:v1:pages/b"), null);
      // Non-matching key is left intact.
      assertEquals(await backend.get("proj:production:v1:assets/c"), "3");
    });

    it("deleteByPrefix fails when the authoritative backend cannot delete a prefix", async () => {
      // Backend without delByPattern (the method is optional on CacheBackend).
      // get always returns null, so any post-delete hit can only come from L1.
      const backend = {
        type: "memory" as const,
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        del: () => Promise.resolve(),
      };
      const repo = new MultiTierCacheRepository({ context: CTX, backend });
      await repo.set("pages/a", "1");
      assertEquals(await repo.get("pages/a"), "1"); // served from L1

      let threw = false;
      try {
        await repo.deleteByPrefix("pages/");
      } catch {
        threw = true;
      }
      assertEquals(threw, true);
    });

    it("rejects wildcard injection in literal prefixes", async () => {
      const { backend, repo } = makeRepo();
      await repo.set("pages/a", "1");
      await repo.set("private/b", "2");

      for (const prefix of ["pages*", "pages?", "pages[ab]", "pages\\*"]) {
        let threw = false;
        try {
          await repo.deleteByPrefix(prefix);
        } catch {
          threw = true;
        }
        assertEquals(threw, true);
      }

      assertEquals(await backend.get("proj:production:v1:pages/a"), "1");
      assertEquals(await backend.get("proj:production:v1:private/b"), "2");
    });

    it("rejects an invalid authoritative deletion count", async () => {
      const backend = {
        type: "memory" as const,
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        del: () => Promise.resolve(),
        delByPattern: () => Promise.resolve(-1),
      };
      const repo = new MultiTierCacheRepository({ context: CTX, backend });

      let threw = false;
      try {
        await repo.deleteByPrefix("pages/");
      } catch {
        threw = true;
      }
      assertEquals(threw, true);
      assertEquals(repo.getStats().deletes, 0);
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

    it("blocks new reads until an in-flight prefix deletion is authoritative", async () => {
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
      const racingRead = repo.get("pages/a").finally(() => {
        readSettled = true;
      });
      await nextTurn();
      assertEquals(readSettled, false);

      release();
      await deletePromise;

      assertEquals(await racingRead, null);
    });

    it("waits for a delayed backfill before completing prefix deletion", async () => {
      let value: string | null = "old";
      let releaseTtl!: () => void;
      let markTtlStarted!: () => void;
      const ttlGate = new Promise<void>((resolve) => (releaseTtl = resolve));
      const ttlStarted = new Promise<void>((resolve) => (markTtlStarted = resolve));
      const backend = {
        type: "memory" as const,
        get: () => Promise.resolve(value),
        getRemainingTtlSeconds: async () => {
          markTtlStarted();
          await ttlGate;
          return 300;
        },
        set: (_key: string, next: string) => {
          value = next;
          return Promise.resolve();
        },
        del: () => {
          value = null;
          return Promise.resolve();
        },
        delByPattern: () => {
          value = null;
          return Promise.resolve(1);
        },
      };
      const repo = new MultiTierCacheRepository({ context: CTX, backend });

      const read = repo.get("pages/a");
      await ttlStarted;
      const deletion = repo.deleteByPrefix("pages/");
      releaseTtl();

      assertEquals(await read, "old");
      assertEquals(await deletion, 1);
      assertEquals(await repo.get("pages/a"), null);
    });

    it("clear removes only this scope's keys from the backend", async () => {
      const { backend, repo } = makeRepo();
      // Seed both an in-scope key and an out-of-scope key directly.
      await backend.set("proj:production:v1:k", "v");
      await backend.set("other:env:ver:k", "keep");

      await repo.clear();
      assertEquals(await backend.get("proj:production:v1:k"), null);
      // A key outside this repo's scope is untouched.
      assertEquals(await backend.get("other:env:ver:k"), "keep");
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
