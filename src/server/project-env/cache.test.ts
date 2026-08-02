import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { EnvironmentVariableCache, type ProjectEnvironmentScope } from "./cache.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
