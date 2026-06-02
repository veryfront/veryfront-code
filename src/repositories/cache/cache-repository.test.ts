import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryCacheBackend } from "#veryfront/cache/backend.ts";
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
      // Negative TTL → already expired on read.
      await cache.set("k", "v", -1);
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

    it("re-setting an existing key does not trigger eviction", async () => {
      const cache = new MemoryCacheRepository<string>({ context: CTX, maxEntries: 2 });
      await cache.set("a", "1");
      await cache.set("b", "2");
      await cache.set("a", "1-updated"); // already present → no eviction

      assertEquals(cache.size, 2);
      assertEquals(await cache.get("a"), "1-updated");
      assertEquals(await cache.get("b"), "2");
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

  describe("MultiTierCacheRepository (previously untested)", () => {
    function makeRepo() {
      const backend = new MemoryCacheBackend();
      const repo = new MultiTierCacheRepository({ context: CTX, backend, defaultTtlSeconds: 300 });
      return { backend, repo };
    }

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

    it("deleteByPrefix returns 0 when the backend has no delByPattern support", async () => {
      // Backend without delByPattern (the method is optional on CacheBackend).
      const backend = {
        type: "memory" as const,
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        del: () => Promise.resolve(),
      };
      const repo = new MultiTierCacheRepository({ context: CTX, backend });
      assertEquals(await repo.deleteByPrefix("pages/"), 0);
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
