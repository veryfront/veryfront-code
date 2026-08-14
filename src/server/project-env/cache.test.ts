import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  EnvironmentVariableCache,
  type ProjectEnvironmentScope,
  unwrapReplayedProjectEnvironmentFailure,
} from "./cache.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function scope(overrides: Partial<ProjectEnvironmentScope> = {}): ProjectEnvironmentScope {
  return {
    projectSlug: "project-a",
    projectId: "project-id-a",
    environmentId: "env-shared",
    token: "token-a",
    ...overrides,
  };
}

describe("project-env/cache", () => {
  it("fetches cold data for the complete canonical scope", async () => {
    let received: ProjectEnvironmentScope | undefined;
    const cache = new EnvironmentVariableCache(async (input) => {
      received = input;
      return { API_KEY: "secret" };
    });

    const input = scope();
    assertEquals(await cache.get(input), { API_KEY: "secret" });
    assertEquals(received, input);
  });

  it("snapshots scope and fetched values before retaining them", async () => {
    let received: ProjectEnvironmentScope | undefined;
    const cache = new EnvironmentVariableCache(async (input) => {
      received = input;
      return { API_KEY: "secret" };
    });
    const input = scope();

    const pending = cache.get(input);
    input.projectSlug = "mutated-project";
    input.token = "mutated-token";
    const result = await pending;

    assertEquals(received?.projectSlug, "project-a");
    assertEquals(received?.token, "token-a");
    assertEquals(Object.isFrozen(received), true);
    assertEquals(Object.isFrozen(result), true);
    assertEquals(Object.getPrototypeOf(result), null);
  });

  it("reuses warm data only for the identical scope and credential", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async () => {
      fetchCount++;
      return { API_KEY: `v${fetchCount}` };
    });

    assertEquals(await cache.get(scope()), { API_KEY: "v1" });
    assertEquals(await cache.get(scope()), { API_KEY: "v1" });
    assertEquals(fetchCount, 1);
  });

  it("does not share a warm environment ID across projects", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async (input) => {
      fetchCount++;
      return { OWNER: input.projectSlug };
    });

    const projectA = await cache.get(scope());
    const projectB = await cache.get(scope({
      projectSlug: "project-b",
      projectId: "project-id-b",
    }));

    assertEquals(projectA, { OWNER: "project-a" });
    assertEquals(projectB, { OWNER: "project-b" });
    assertEquals(fetchCount, 2);
  });

  it("does not share a warm project environment across credential principals", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async (input) => {
      fetchCount++;
      return { PRINCIPAL: input.token };
    });

    assertEquals(await cache.get(scope()), { PRINCIPAL: "token-a" });
    assertEquals(await cache.get(scope({ token: "token-b" })), {
      PRINCIPAL: "token-b",
    });
    assertEquals(fetchCount, 2);
  });

  it("deduplicates identical in-flight work without coalescing other tenants", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async (input) => {
      fetchCount++;
      await delay(20);
      return { OWNER: `${input.projectSlug}:${input.token}` };
    });

    const [a1, a2, b] = await Promise.all([
      cache.get(scope()),
      cache.get(scope()),
      cache.get(scope({
        projectSlug: "project-b",
        projectId: "project-id-b",
        token: "token-b",
      })),
    ]);

    assertEquals(a1, { OWNER: "project-a:token-a" });
    assertEquals(a2, a1);
    assertEquals(b, { OWNER: "project-b:token-b" });
    assertEquals(fetchCount, 2);
  });

  it("fails closed after TTL instead of serving stale secrets", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async () => {
      fetchCount++;
      if (fetchCount === 1) return { API_KEY: "now-stale" };
      throw new Error("credential revoked");
    }, 20);

    assertEquals(await cache.get(scope()), { API_KEY: "now-stale" });
    await delay(30);
    await assertRejects(() => cache.get(scope()), Error, "credential revoked");
  });

  it("fails closed on a cold fetch error", async () => {
    const cache = new EnvironmentVariableCache(() => Promise.reject(new Error("network error")));
    await assertRejects(() => cache.get(scope()), Error, "network error");
  });

  it("does not refetch a failed environment within the failure TTL", async () => {
    // Mirrors the production incident: a persistent upstream refusal must not
    // be refetched on every request (223 Sentry events from one misconfig).
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(() => {
      fetchCount++;
      return Promise.reject(new Error("Refusing masked environment variable response"));
    });

    const first = await assertRejects(
      () => cache.get(scope()),
      Error,
      "Refusing masked environment variable response",
    );
    // Await the first rejection before the second call so inflight
    // deduplication cannot mask missing negative caching.
    const second = await assertRejects(
      () => cache.get(scope()),
      Error,
      "Refusing masked environment variable response",
    );
    assertEquals(fetchCount, 1);
    assertEquals(second, first);
  });

  it("marks an opted-in failure replay without replacing the original failure", async () => {
    const failure = new Error("upstream refused the environment request");
    const cache = new EnvironmentVariableCache(
      () => Promise.reject(failure),
      60_000,
      100,
      { markFailureReplays: true },
    );

    const first = await assertRejects(() => cache.get(scope()));
    const second = await assertRejects(() => cache.get(scope()));

    assertEquals(first, failure);
    assertEquals(unwrapReplayedProjectEnvironmentFailure(first), {
      error: failure,
      replayed: false,
    });
    assertEquals(unwrapReplayedProjectEnvironmentFailure(second), {
      error: failure,
      replayed: true,
    });
  });

  it("retries the upstream once the failure TTL has elapsed", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(
      () => {
        fetchCount++;
        return Promise.reject(new Error(`refused ${fetchCount}`));
      },
      60_000,
      100,
      { failureTtlMs: 20 },
    );

    await assertRejects(() => cache.get(scope()), Error, "refused 1");
    await assertRejects(() => cache.get(scope()), Error, "refused 1");
    await delay(30);
    await assertRejects(() => cache.get(scope()), Error, "refused 2");
    assertEquals(fetchCount, 2);
  });

  it("clears a recorded failure once a fetch succeeds", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(
      () => {
        fetchCount++;
        if (fetchCount === 1) return Promise.reject(new Error("refused"));
        return Promise.resolve({ VALUE: "recovered" });
      },
      60_000,
      100,
      { failureTtlMs: 20 },
    );

    await assertRejects(() => cache.get(scope()), Error, "refused");
    await delay(30);
    assertEquals(await cache.get(scope()), { VALUE: "recovered" });
    assertEquals(await cache.get(scope()), { VALUE: "recovered" });
    assertEquals(fetchCount, 2);
  });

  it("does not record an invalidated fetch as a negative-cache failure", async () => {
    const oldFetch = deferred<Record<string, string>>();
    const started = deferred<void>();
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async () => {
      fetchCount++;
      if (fetchCount === 1) {
        started.resolve();
        return await oldFetch.promise;
      }
      return { VALUE: "fresh" };
    });

    const oldWaiter = cache.get(scope());
    await started.promise;
    cache.invalidate("env-shared");
    await assertRejects(
      () => oldWaiter,
      Error,
      "Project environment fetch was invalidated",
    );

    // The invalidation error must not be replayed to the newer epoch.
    assertEquals(await cache.get(scope()), { VALUE: "fresh" });
    oldFetch.reject(new Error("stale rejection"));
    await delay(0);
    assertEquals(await cache.get(scope()), { VALUE: "fresh" });
    assertEquals(fetchCount, 2);
  });

  it("does not leak another scope's stale value after a failed fetch", async () => {
    const cache = new EnvironmentVariableCache(async (input) => {
      if (input.projectSlug === "project-a") return { OWNER: "project-a" };
      throw new Error("project-b denied");
    }, 1);

    assertEquals(await cache.get(scope()), { OWNER: "project-a" });
    await delay(5);
    await assertRejects(
      () =>
        cache.get(scope({
          projectSlug: "project-b",
          projectId: "project-id-b",
          token: "token-b",
        })),
      Error,
      "project-b denied",
    );
  });

  it("invalidates every credential-scoped entry for an environment", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async () => ({ VALUE: `${++fetchCount}` }));

    await cache.get(scope());
    await cache.get(scope({ token: "token-b" }));
    cache.invalidate("env-shared");
    await cache.get(scope());
    await cache.get(scope({ token: "token-b" }));

    assertEquals(fetchCount, 4);
  });

  it("rejects invalidated in-flight work and never commits its old result", async () => {
    const oldFetch = deferred<Record<string, string>>();
    const started = deferred<void>();
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async () => {
      fetchCount++;
      if (fetchCount === 1) {
        started.resolve();
        return await oldFetch.promise;
      }
      return { VALUE: "fresh" };
    });

    const oldWaiter = cache.get(scope());
    await started.promise;
    cache.invalidate("env-shared");

    await assertRejects(
      () => oldWaiter,
      Error,
      "Project environment fetch was invalidated",
    );
    assertEquals(await cache.get(scope()), { VALUE: "fresh" });

    oldFetch.resolve({ VALUE: "stale" });
    await delay(0);
    assertEquals(await cache.get(scope()), { VALUE: "fresh" });
    assertEquals(fetchCount, 2);
  });

  it("rejects all in-flight work after global invalidation", async () => {
    const oldFetch = deferred<Record<string, string>>();
    const started = deferred<void>();
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(async () => {
      fetchCount++;
      if (fetchCount === 1) {
        started.resolve();
        return await oldFetch.promise;
      }
      return { VALUE: "fresh" };
    });

    const oldWaiter = cache.get(scope());
    await started.promise;
    cache.invalidate();

    await assertRejects(
      () => oldWaiter,
      Error,
      "Project environment fetch was invalidated",
    );
    assertEquals(await cache.get(scope()), { VALUE: "fresh" });

    oldFetch.resolve({ VALUE: "stale" });
    await delay(0);
    assertEquals(await cache.get(scope()), { VALUE: "fresh" });
    assertEquals(fetchCount, 2);
  });

  it("invalidating one environment leaves other in-flight work intact", async () => {
    const envAFetch = deferred<Record<string, string>>();
    const envBFetch = deferred<Record<string, string>>();
    let started = 0;
    const bothStarted = deferred<void>();
    const cache = new EnvironmentVariableCache(async (input) => {
      started++;
      if (started === 2) bothStarted.resolve();
      return await (input.environmentId === "env-a" ? envAFetch.promise : envBFetch.promise);
    });

    const envAWaiter = cache.get(scope({ environmentId: "env-a" }));
    const envBWaiter = cache.get(scope({ environmentId: "env-b" }));
    await bothStarted.promise;
    cache.invalidate("env-a");

    await assertRejects(
      () => envAWaiter,
      Error,
      "Project environment fetch was invalidated",
    );
    envBFetch.resolve({ VALUE: "env-b" });
    assertEquals(await envBWaiter, { VALUE: "env-b" });

    envAFetch.resolve({ VALUE: "old-env-a" });
    await delay(0);
    assertEquals(await cache.get(scope({ environmentId: "env-b" })), {
      VALUE: "env-b",
    });
  });

  it("clears timed-out in-flight capacity so a retry can succeed", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(
      async () => {
        fetchCount++;
        if (fetchCount === 1) return await new Promise<Record<string, string>>(() => {});
        return { VALUE: "recovered" };
      },
      60_000,
      100,
      // This test's subject is in-flight capacity cleanup, not retry pacing.
      { fetchTimeoutMs: 10, maxInflight: 1, failureTtlMs: 0 },
    );

    await assertRejects(
      () => cache.get(scope()),
      Error,
      "Project environment fetch timed out",
    );
    assertEquals(await cache.get(scope()), { VALUE: "recovered" });
    assertEquals(fetchCount, 2);
  });

  it("clears rejected in-flight work so a retry can succeed", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(
      async () => {
        fetchCount++;
        if (fetchCount === 1) throw new Error("temporary failure");
        return { VALUE: "recovered" };
        // failureTtlMs: 0 — this test's subject is in-flight capacity cleanup,
        // not retry pacing.
      },
      60_000,
      100,
      { failureTtlMs: 0 },
    );

    await assertRejects(() => cache.get(scope()), Error, "temporary failure");
    assertEquals(await cache.get(scope()), { VALUE: "recovered" });
    assertEquals(fetchCount, 2);
  });

  it("rejects excess global work without invoking the fetcher and recovers capacity", async () => {
    const firstFetch = deferred<Record<string, string>>();
    const firstFetchStarted = deferred<void>();
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(
      async (input) => {
        fetchCount++;
        if (input.projectSlug === "project-a") {
          firstFetchStarted.resolve();
          return await firstFetch.promise;
        }
        return { OWNER: input.projectSlug };
      },
      60_000,
      100,
      { maxInflight: 1, maxInflightPerProject: 1 },
    );

    const first = cache.get(scope());
    await firstFetchStarted.promise;
    const overload = await assertRejects(() =>
      cache.get(scope({
        projectSlug: "project-b",
        projectId: "project-id-b",
        token: "token-b",
      }))
    );
    assertEquals((overload as { slug?: string }).slug, "service-overloaded");
    assertEquals(fetchCount, 1);

    firstFetch.resolve({ OWNER: "project-a" });
    assertEquals(await first, { OWNER: "project-a" });
    assertEquals(
      await cache.get(scope({
        projectSlug: "project-b",
        projectId: "project-id-b",
        token: "token-b",
      })),
      { OWNER: "project-b" },
    );
    assertEquals(fetchCount, 2);
  });

  it("bounds distinct in-flight work per project while preserving exact deduplication", async () => {
    const firstFetch = deferred<Record<string, string>>();
    const firstFetchStarted = deferred<void>();
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(
      async () => {
        fetchCount++;
        firstFetchStarted.resolve();
        return await firstFetch.promise;
      },
      60_000,
      100,
      { maxInflight: 10, maxInflightPerProject: 1 },
    );

    const first = cache.get(scope());
    const deduplicated = cache.get(scope());
    await firstFetchStarted.promise;
    const overload = await assertRejects(() => cache.get(scope({ environmentId: "env-other" })));
    assertEquals((overload as { slug?: string }).slug, "service-overloaded");
    assertEquals(fetchCount, 1);

    firstFetch.resolve({ VALUE: "same" });
    assertEquals(await Promise.all([first, deduplicated]), [
      { VALUE: "same" },
      { VALUE: "same" },
    ]);
  });

  it("cleans the cache-owned deadline after a successful fetch", async () => {
    let fetchSignal: AbortSignal | undefined;
    const cache = new EnvironmentVariableCache(
      async (_input, signal) => {
        fetchSignal = signal;
        return { VALUE: "done" };
      },
      60_000,
      100,
      { fetchTimeoutMs: 10 },
    );

    assertEquals(await cache.get(scope()), { VALUE: "done" });
    await delay(20);
    assertEquals(fetchSignal?.aborted, false);
  });

  it("keeps the scoped cache bounded", async () => {
    let fetchCount = 0;
    const cache = new EnvironmentVariableCache(
      async () => ({ VALUE: `${++fetchCount}` }),
      60_000,
      2,
    );

    await cache.get(scope({ environmentId: "env-1" }));
    await cache.get(scope({ environmentId: "env-2" }));
    await cache.get(scope({ environmentId: "env-3" }));
    await cache.get(scope({ environmentId: "env-1" }));

    assertEquals(fetchCount, 4);
  });
});
