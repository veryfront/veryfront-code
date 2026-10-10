import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryCacheBackend } from "#veryfront/cache/backend.ts";
import { MultiTierCacheRepository } from "#veryfront/repositories/cache/cache-repository.ts";
import type { RepositoryContext } from "#veryfront/repositories/types.ts";

const CTX: RepositoryContext = {
  projectId: "proj",
  environment: "production",
  versionId: "v1",
};

// The clock override mutates process-wide state, so this regression belongs
// at the integration boundary rather than in the hermetic unit suite.
describe("cache repository backfill expiry", () => {
  function makeRepo() {
    const backend = new MemoryCacheBackend();
    const repo = new MultiTierCacheRepository({ context: CTX, backend, defaultTtlSeconds: 300 });
    return { backend, repo };
  }

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it("preserves the L3 entry's remaining TTL when backfilling L1", async () => {
    const originalDateNow = Date.now;
    let now = originalDateNow();
    Date.now = () => now;
    try {
      const { backend, repo } = makeRepo();
      const key = "proj:production:v1:short";
      await backend.set(key, "value", 0.05);

      // Backfill after part of the source lifetime has elapsed.
      now += 20;
      assertEquals(await repo.get("short"), "value");
      await flush();
      await backend.del(key);

      // With L3 removed, this hit proves L1 was backfilled.
      now += 29;
      assertEquals(await repo.get("short"), "value");
      // L1 expires at the original source deadline, not 50 ms after backfill.
      now += 2;
      assertEquals(await repo.get("short"), null);
    } finally {
      Date.now = originalDateNow;
    }
  });
});
