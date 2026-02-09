import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { EnvironmentVariableCache } from "./environment-variable-cache.ts";
import type { EnvVarSource } from "./env-var-source.ts";

function createMockSource(
  data: Record<string, Record<string, string>> = {},
  delay = 0,
): { source: EnvVarSource; callCount: () => number } {
  let calls = 0;
  return {
    source: {
      async fetchByEnvironmentId(environmentId: string): Promise<Record<string, string>> {
        calls++;
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        const result = data[environmentId];
        if (!result) throw new Error(`No data for ${environmentId}`);
        return result;
      },
    },
    callCount: () => calls,
  };
}

describe("EnvironmentVariableCache", () => {
  it("returns vars from source on cache miss", async () => {
    const { source } = createMockSource({ "env-1": { KEY: "value" } });
    const cache = new EnvironmentVariableCache(source);

    const vars = await cache.get("env-1");
    assertEquals(vars, { KEY: "value" });
  });

  it("returns cached vars on cache hit", async () => {
    const { source, callCount } = createMockSource({ "env-1": { KEY: "value" } });
    const cache = new EnvironmentVariableCache(source);

    await cache.get("env-1");
    await cache.get("env-1");

    assertEquals(callCount(), 1);
  });

  it("refetches after TTL expires", async () => {
    const { source, callCount } = createMockSource({ "env-1": { KEY: "v1" } });
    const cache = new EnvironmentVariableCache(source, 10); // 10ms TTL

    await cache.get("env-1");
    assertEquals(callCount(), 1);

    await new Promise((r) => setTimeout(r, 20));

    await cache.get("env-1");
    assertEquals(callCount(), 2);
  });

  it("deduplicates concurrent fetches for the same environment", async () => {
    const { source, callCount } = createMockSource({ "env-1": { KEY: "value" } }, 20);
    const cache = new EnvironmentVariableCache(source);

    const [r1, r2, r3] = await Promise.all([
      cache.get("env-1"),
      cache.get("env-1"),
      cache.get("env-1"),
    ]);

    assertEquals(callCount(), 1);
    assertEquals(r1, { KEY: "value" });
    assertEquals(r2, { KEY: "value" });
    assertEquals(r3, { KEY: "value" });
  });

  it("does not deduplicate fetches for different environments", async () => {
    const { source, callCount } = createMockSource({
      "env-1": { A: "1" },
      "env-2": { B: "2" },
    }, 10);
    const cache = new EnvironmentVariableCache(source);

    const [r1, r2] = await Promise.all([
      cache.get("env-1"),
      cache.get("env-2"),
    ]);

    assertEquals(callCount(), 2);
    assertEquals(r1, { A: "1" });
    assertEquals(r2, { B: "2" });
  });

  it("returns stale data on fetch failure when cache exists", async () => {
    let shouldFail = false;
    const source: EnvVarSource = {
      async fetchByEnvironmentId(_id: string) {
        if (shouldFail) throw new Error("network error");
        return { KEY: "stale-value" };
      },
    };
    const cache = new EnvironmentVariableCache(source, 10);

    // Populate cache
    await cache.get("env-1");

    // Expire cache and make source fail
    await new Promise((r) => setTimeout(r, 20));
    shouldFail = true;

    const vars = await cache.get("env-1");
    assertEquals(vars, { KEY: "stale-value" });
  });

  it("throws on fetch failure when no cached data exists", async () => {
    const source: EnvVarSource = {
      fetchByEnvironmentId: () => Promise.reject(new Error("fail")),
    };
    const cache = new EnvironmentVariableCache(source);

    await assertRejects(
      () => cache.get("env-1"),
      Error,
      "fail",
    );
  });

  it("invalidate() removes a specific environment", async () => {
    const { source, callCount } = createMockSource({ "env-1": { KEY: "value" } });
    const cache = new EnvironmentVariableCache(source);

    await cache.get("env-1");
    assertEquals(callCount(), 1);

    cache.invalidate("env-1");

    await cache.get("env-1");
    assertEquals(callCount(), 2);
  });

  it("invalidate() without args clears all", async () => {
    const { source, callCount } = createMockSource({
      "env-1": { A: "1" },
      "env-2": { B: "2" },
    });
    const cache = new EnvironmentVariableCache(source);

    await cache.get("env-1");
    await cache.get("env-2");
    assertEquals(callCount(), 2);

    cache.invalidate();

    await cache.get("env-1");
    await cache.get("env-2");
    assertEquals(callCount(), 4);
  });
});
