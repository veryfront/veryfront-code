import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { EnvironmentVariableCache } from "./cache.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("project-env/cache", () => {
  it("returns fresh data on first call", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async () => {
      fetchCount++;
      return { API_KEY: "secret" };
    });

    const result = await cache.get("env-1", "token", "my-project");
    assertEquals(result, { API_KEY: "secret" });
    assertEquals(fetchCount, 1);
  });

  it("returns cached data within TTL", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async () => {
      fetchCount++;
      return { API_KEY: "secret" };
    }, 10_000);

    await cache.get("env-1", "token", "my-project");
    await cache.get("env-1", "token", "my-project");
    assertEquals(fetchCount, 1);
  });

  it("fetches again after TTL expires", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async () => {
      fetchCount++;
      return { API_KEY: `v${fetchCount}` };
    }, 50); // 50ms TTL

    const first = await cache.get("env-1", "token", "my-project");
    assertEquals(first, { API_KEY: "v1" });

    await delay(60);

    const second = await cache.get("env-1", "token", "my-project");
    assertEquals(second, { API_KEY: "v2" });
    assertEquals(fetchCount, 2);
  });

  it("deduplicates concurrent fetches", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async () => {
      fetchCount++;
      await delay(20);
      return { API_KEY: "secret" };
    });

    const [r1, r2, r3] = await Promise.all([
      cache.get("env-1", "token", "my-project"),
      cache.get("env-1", "token", "my-project"),
      cache.get("env-1", "token", "my-project"),
    ]);

    assertEquals(r1, { API_KEY: "secret" });
    assertEquals(r2, { API_KEY: "secret" });
    assertEquals(r3, { API_KEY: "secret" });
    assertEquals(fetchCount, 1);
  });

  it("returns stale data on fetch error", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async () => {
      fetchCount++;
      if (fetchCount === 1) return { API_KEY: "stale" };
      throw new Error("Network error");
    }, 50); // 50ms TTL

    // First call succeeds
    const first = await cache.get("env-1", "token", "my-project");
    assertEquals(first, { API_KEY: "stale" });

    // Wait for TTL to expire
    await delay(60);

    // Second call fails but returns stale
    const second = await cache.get("env-1", "token", "my-project");
    assertEquals(second, { API_KEY: "stale" });
  });

  it("returns empty object on fetch error with no stale data", async () => {
    const cache = new EnvironmentVariableCache(async () => {
      throw new Error("Network error");
    });

    const result = await cache.get("env-1", "token", "my-project");
    assertEquals(result, {});
  });

  it("invalidate clears specific entry", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async () => {
      fetchCount++;
      return { API_KEY: `v${fetchCount}` };
    });

    await cache.get("env-1", "token", "my-project");
    cache.invalidate("env-1");
    const result = await cache.get("env-1", "token", "my-project");
    assertEquals(result, { API_KEY: "v2" });
    assertEquals(fetchCount, 2);
  });

  it("invalidate with no arg clears all entries", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async () => {
      fetchCount++;
      return { API_KEY: `v${fetchCount}` };
    });

    await cache.get("env-1", "token", "my-project");
    await cache.get("env-2", "token", "my-project");
    assertEquals(fetchCount, 2);

    cache.invalidate();

    await cache.get("env-1", "token", "my-project");
    await cache.get("env-2", "token", "my-project");
    assertEquals(fetchCount, 4);
  });

  it("evicts oldest entries when maxEntries exceeded", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(
      async () => {
        fetchCount++;
        return { KEY: `v${fetchCount}` };
      },
      60_000,
      3, // maxEntries = 3
    );

    await cache.get("env-1", "token", "p");
    await cache.get("env-2", "token", "p");
    await cache.get("env-3", "token", "p");
    assertEquals(fetchCount, 3);

    // Adding a 4th should evict env-1
    await cache.get("env-4", "token", "p");
    assertEquals(fetchCount, 4);

    // env-1 was evicted, so it should re-fetch
    await cache.get("env-1", "token", "p");
    assertEquals(fetchCount, 5);

    // env-3 should still be cached
    await cache.get("env-3", "token", "p");
    assertEquals(fetchCount, 5);
  });
});
