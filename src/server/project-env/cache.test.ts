import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
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

  it("isolates cached values by project and credential", async () => {
    const calls: Array<{ environmentId: string; projectSlug: string; token: string }> = [];
    const cache = new EnvironmentVariableCache(
      async (environmentId, token, projectSlug) => {
        calls.push({ environmentId, projectSlug, token });
        return { VALUE: `${projectSlug}:${token}` };
      },
    );

    assertEquals(
      await cache.get("shared-env", "<TOKEN_A>", "project-a"),
      { VALUE: "project-a:<TOKEN_A>" },
    );
    assertEquals(
      await cache.get("shared-env", "<TOKEN_A>", "project-b"),
      { VALUE: "project-b:<TOKEN_A>" },
    );
    assertEquals(
      await cache.get("shared-env", "<TOKEN_B>", "project-a"),
      { VALUE: "project-a:<TOKEN_B>" },
    );
    await cache.get("shared-env", "<TOKEN_A>", "project-a");

    assertEquals(calls.length, 3);
  });

  it("isolates values by explicit release scope", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async () => ({
      VALUE: `release-${++fetchCount}`,
    }));

    const first = await cache.get("env-1", "<TOKEN>", "project", {
      scope: "release-1",
    });
    const second = await cache.get("env-1", "<TOKEN>", "project", {
      scope: "release-2",
    });
    const firstAgain = await cache.get("env-1", "<TOKEN>", "project", {
      scope: "release-1",
    });

    assertEquals(first, { VALUE: "release-1" });
    assertEquals(second, { VALUE: "release-2" });
    assertEquals(firstAgain, { VALUE: "release-1" });
    assertEquals(fetchCount, 2);
  });

  it("fails closed instead of returning stale data on fetch error", async () => {
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

    await assertRejects(
      () => cache.get("env-1", "token", "my-project"),
      Error,
      "Network error",
    );
  });

  it("fails closed on fetch error with no cached data", async () => {
    const cache = new EnvironmentVariableCache(async () => {
      throw new Error("Network error");
    });

    await assertRejects(
      () => cache.get("env-1", "token", "my-project"),
      Error,
      "Network error",
    );
  });

  it("does not allow callers to mutate cached secret values", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async () => {
      fetchCount++;
      return { API_KEY: "original" };
    });

    const first = await cache.get("env-1", "token", "my-project");
    first.API_KEY = "mutated";

    assertEquals(await cache.get("env-1", "token", "my-project"), {
      API_KEY: "original",
    });
    assertEquals(fetchCount, 1);
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

  it("does not let an invalidated in-flight fetch repopulate the cache", async () => {
    let fetchCount = 0;
    let resolveFirst: ((vars: Record<string, string>) => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const cache = new EnvironmentVariableCache(async () => {
      fetchCount++;
      if (fetchCount === 1) {
        markFirstStarted?.();
        return await new Promise<Record<string, string>>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return { API_KEY: "fresh" };
    });

    const firstRequest = cache.get("env-1", "token", "project");
    await firstStarted;
    cache.invalidate("env-1", { projectSlug: "project" });

    assertEquals(await cache.get("env-1", "token", "project"), { API_KEY: "fresh" });
    resolveFirst?.({ API_KEY: "invalidated" });
    assertEquals(await firstRequest, { API_KEY: "invalidated" });
    assertEquals(await cache.get("env-1", "token", "project"), { API_KEY: "fresh" });
    assertEquals(fetchCount, 2);
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

  it("refreshed entries move to end of eviction order (LRU)", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(
      async () => {
        fetchCount++;
        return { KEY: `v${fetchCount}` };
      },
      50, // 50ms TTL
      3,
    );

    // Fill cache: env-1, env-2, env-3
    await cache.get("env-1", "token", "p");
    await cache.get("env-2", "token", "p");
    await cache.get("env-3", "token", "p");
    assertEquals(fetchCount, 3);

    // Wait for TTL to expire, then refresh env-1 (moves it to end)
    await delay(60);
    await cache.get("env-1", "token", "p");
    assertEquals(fetchCount, 4);

    // Add env-4 — should evict env-2 (oldest), NOT env-1 (just refreshed)
    await cache.get("env-4", "token", "p");
    assertEquals(fetchCount, 5);

    // env-1 should still be cached (was refreshed, moved to end)
    await cache.get("env-1", "token", "p");
    assertEquals(fetchCount, 5);

    // env-2 should have been evicted
    await cache.get("env-2", "token", "p");
    assertEquals(fetchCount, 6);
  });

  it("fresh cache hits update the LRU eviction order", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(
      async (_environmentId, _token, projectSlug) => {
        fetchCount++;
        return { PROJECT: projectSlug };
      },
      60_000,
      2,
    );

    await cache.get("env", "token", "project-a");
    await cache.get("env", "token", "project-b");
    await cache.get("env", "token", "project-a");
    await cache.get("env", "token", "project-c");
    await cache.get("env", "token", "project-a");
    await cache.get("env", "token", "project-b");

    assertEquals(fetchCount, 4);
  });
});
