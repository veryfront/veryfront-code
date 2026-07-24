import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { EnvironmentVariableCache, ProjectEnvCacheError } from "./cache.ts";

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
    assertEquals(Object.getPrototypeOf(result), null);
    assertEquals(Object.isFrozen(result), true);
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

  it("fails closed instead of returning expired data on fetch error", async () => {
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

  it("does not share cached or in-flight data across projects", async () => {
    const calls: string[] = [];
    const cache = new EnvironmentVariableCache(async (environmentId, _token, projectSlug) => {
      calls.push(`${projectSlug}:${environmentId}`);
      await delay(5);
      return { PROJECT: projectSlug };
    });

    const [first, second] = await Promise.all([
      cache.get("shared-env", "token-a", "project-a"),
      cache.get("shared-env", "token-b", "project-b"),
    ]);

    assertEquals(first, { PROJECT: "project-a" });
    assertEquals(second, { PROJECT: "project-b" });
    assertEquals(calls.sort(), ["project-a:shared-env", "project-b:shared-env"]);

    await cache.get("shared-env", "token-a", "project-a");
    await cache.get("shared-env", "token-b", "project-b");
    assertEquals(calls.length, 2);
  });

  it("does not authorize cached or in-flight data for a different token", async () => {
    const calls: string[] = [];
    const cache = new EnvironmentVariableCache(async (_environmentId, token) => {
      calls.push(token);
      await delay(5);
      return { TOKEN_SCOPE: token };
    });

    const [first, second] = await Promise.all([
      cache.get("shared-env", "token-a", "project"),
      cache.get("shared-env", "token-b", "project"),
    ]);

    assertEquals(first, { TOKEN_SCOPE: "token-a" });
    assertEquals(second, { TOKEN_SCOPE: "token-b" });
    assertEquals(calls.sort(), ["token-a", "token-b"]);

    await cache.get("shared-env", "token-a", "project");
    await cache.get("shared-env", "token-b", "project");
    assertEquals(calls.length, 2);
  });

  it("uses captured Map operations after shared prototypes are poisoned", async () => {
    const cache = new EnvironmentVariableCache(async () => ({ SAFE: "value" }));
    const previous = Object.getOwnPropertyDescriptor(Map.prototype, "get");
    let poisonCalls = 0;
    let result: Record<string, string> | undefined;
    let failure: unknown;

    Object.defineProperty(Map.prototype, "get", {
      configurable: true,
      writable: true,
      value() {
        poisonCalls += 1;
        throw new Error("ambient Map.prototype.get must not run");
      },
    });
    try {
      result = await cache.get("environment", "token", "project");
    } catch (error) {
      failure = error;
    } finally {
      if (previous) Object.defineProperty(Map.prototype, "get", previous);
    }

    if (failure) throw failure;
    assertEquals(result, { SAFE: "value" });
    assertEquals(poisonCalls, 0);
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

  it("invalidates an environment across projects without repopulating from stale work", async () => {
    let revision = 0;
    const started = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const cache = new EnvironmentVariableCache(async () => {
      revision++;
      if (revision === 1) {
        started.resolve();
        await resume.promise;
      }
      return { VALUE: `v${revision}` };
    });

    const pending = cache.get("env-1", "token", "project-a");
    await started.promise;
    cache.invalidate("env-1");
    resume.resolve();
    assertEquals(await pending, { VALUE: "v1" });

    assertEquals(
      await cache.get("env-1", "token", "project-a"),
      { VALUE: "v2" },
    );
  });

  it("does not suppress caching for unrelated in-flight work", async () => {
    let fetchCount = 0;
    const started = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const cache = new EnvironmentVariableCache(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        started.resolve();
        await resume.promise;
      }
      return { VALUE: `v${fetchCount}` };
    });

    const pending = cache.get("env-a", "token-a", "project-a");
    await started.promise;
    cache.invalidate("env-b", "project-b");
    resume.resolve();

    assertEquals(await pending, { VALUE: "v1" });
    assertEquals(await cache.get("env-a", "token-a", "project-a"), { VALUE: "v1" });
    assertEquals(fetchCount, 1);
  });

  it("aborts and releases a stalled fetch at the configured deadline", async () => {
    let aborted = false;
    const cache = new EnvironmentVariableCache(
      async (_environmentId, _token, _projectSlug, signal) =>
        await new Promise<Record<string, string>>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(signal.reason);
          }, { once: true });
        }),
      60_000,
      100,
      { fetchTimeoutMs: 20 },
    );

    const error = await assertRejects(
      () => cache.get("env", "token", "project"),
      ProjectEnvCacheError,
      "exceeded",
    ) as ProjectEnvCacheError;
    assertEquals(error.code, "fetch-timeout");
    assertEquals(error.retryable, true);
    assertEquals(aborted, true);
  });

  it("retains capacity for timed-out work until a non-cooperative fetcher settles", async () => {
    const resumeFirst = Promise.withResolvers<Record<string, string>>();
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(
      async () => {
        fetchCount += 1;
        if (fetchCount === 1) return await resumeFirst.promise;
        return { VALUE: `v${fetchCount}` };
      },
      60_000,
      100,
      {
        fetchTimeoutMs: 20,
        maxInflight: 1,
        maxInflightPerProject: 1,
      },
    );

    const timeoutError = await assertRejects(
      () => cache.get("env-a", "token-a", "project"),
      ProjectEnvCacheError,
    ) as ProjectEnvCacheError;
    assertEquals(timeoutError.code, "fetch-timeout");

    const capacityError = await assertRejects(
      () => cache.get("env-b", "token-b", "project"),
      ProjectEnvCacheError,
    ) as ProjectEnvCacheError;
    assertEquals(capacityError.code, "capacity-exceeded");
    assertEquals(fetchCount, 1);

    resumeFirst.resolve({ VALUE: "late" });
    await delay(0);

    assertEquals(
      await cache.get("env-b", "token-b", "project"),
      { VALUE: "v2" },
    );
  });

  it("bounds global and per-project in-flight work", async () => {
    const startedA = Promise.withResolvers<void>();
    const startedB = Promise.withResolvers<void>();
    const resumeA = Promise.withResolvers<void>();
    const resumeB = Promise.withResolvers<void>();
    const cache = new EnvironmentVariableCache(
      async (_environmentId, _token, projectSlug) => {
        if (projectSlug === "project-a") {
          startedA.resolve();
          await resumeA.promise;
        } else {
          startedB.resolve();
          await resumeB.promise;
        }
        return { PROJECT: projectSlug };
      },
      60_000,
      100,
      {
        fetchTimeoutMs: 1_000,
        maxInflight: 2,
        maxInflightPerProject: 1,
      },
    );

    const pendingA = cache.get("env-a", "token-a", "project-a");
    await startedA.promise;
    const projectError = await assertRejects(
      () => cache.get("env-b", "token-b", "project-a"),
      ProjectEnvCacheError,
    ) as ProjectEnvCacheError;
    assertEquals(projectError.code, "capacity-exceeded");

    const pendingB = cache.get("env-b", "token-b", "project-b");
    await startedB.promise;
    const globalError = await assertRejects(
      () => cache.get("env-c", "token-c", "project-c"),
      ProjectEnvCacheError,
    ) as ProjectEnvCacheError;
    assertEquals(globalError.code, "capacity-exceeded");

    resumeA.resolve();
    resumeB.resolve();
    assertEquals(await pendingA, { PROJECT: "project-a" });
    assertEquals(await pendingB, { PROJECT: "project-b" });
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

  it("rejects invalid constructor limits and cache identities", async () => {
    const fetcher = async () => ({});
    assertThrows(() => new EnvironmentVariableCache(fetcher, -1), RangeError);
    assertThrows(() => new EnvironmentVariableCache(fetcher, 1, 0), RangeError);
    assertThrows(
      () => new EnvironmentVariableCache(fetcher, 1, 1, { fetchTimeoutMs: 0 }),
      RangeError,
    );
    assertThrows(
      () =>
        new EnvironmentVariableCache(fetcher, 1, 1, {
          maxInflight: 1,
          maxInflightPerProject: 2,
        }),
      RangeError,
    );

    const cache = new EnvironmentVariableCache(fetcher);
    await assertRejects(
      () => cache.get("", "token", "project"),
      TypeError,
      "environmentId",
    );
    await assertRejects(
      () => cache.get("environment", "token", ""),
      TypeError,
      "projectSlug",
    );
    await assertRejects(
      () => cache.get("environment", "", "project"),
      TypeError,
      "token",
    );
  });
});
