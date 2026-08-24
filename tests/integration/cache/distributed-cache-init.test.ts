/**
 * Backend resolution for the distributed cache initializers.
 *
 * `initializeDistributedCaches` picks its backend from the process
 * environment: a hosted API cache wins, then a configured Redis, then a
 * persistent local disk cache, and a plain memory runtime short-circuits
 * before any initializer runs. Those cases read and mutate real process env,
 * so they live here rather than in the colocated unit file. The hermetic
 * assertions about the initializer fan-out stay in
 * `src/cache/distributed-cache-init.test.ts`.
 */

import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { initializeDistributedCaches } from "#veryfront/cache/distributed-cache-init.ts";

type DistributedCacheInitializers = Parameters<typeof initializeDistributedCaches>[0];

/** Env that makes every backend probe resolve from the values under test. */
const NEUTRAL_CACHE_ENV = {
  NODE_ENV: "",
  VERYFRONT_ENV: "",
  DENO_ENV: "",
  PROXY_MODE: "",
  REDIS_URL: "",
  VERYFRONT_API_BASE_URL: "",
  VF_CACHE_BACKEND: "",
  VF_DISK_CACHE_DIR: "",
} as const;

function createCountingInitializers(): {
  calls: Record<keyof DistributedCacheInitializers, number>;
  initializers: DistributedCacheInitializers;
} {
  const calls: Record<keyof DistributedCacheInitializers, number> = {
    transformCache: 0,
    ssrModuleCache: 0,
    fileCache: 0,
    projectCSSCache: 0,
    httpModuleCache: 0,
  };
  const track = (name: keyof DistributedCacheInitializers) => () => {
    calls[name] += 1;
    return Promise.resolve(true);
  };

  return {
    calls,
    initializers: {
      transformCache: track("transformCache"),
      ssrModuleCache: track("ssrModuleCache"),
      fileCache: track("fileCache"),
      projectCSSCache: track("projectCSSCache"),
      httpModuleCache: track("httpModuleCache"),
    },
  };
}

describe("distributed cache init backend resolution", () => {
  it("resolves the api backend when the hosted cache is available", async () => {
    await withEnv(
      {
        ...NEUTRAL_CACHE_ENV,
        VERYFRONT_API_BASE_URL: "https://api.example.com",
        NODE_ENV: "production",
      },
      async () => {
        const status = await initializeDistributedCaches(createCountingInitializers().initializers);

        assertEquals(status.backend, "api", "an available API cache wins");
      },
    );
  });

  it("resolves the redis backend when only redis is configured", async () => {
    await withEnv(
      { ...NEUTRAL_CACHE_ENV, REDIS_URL: "redis://localhost:6379" },
      async () => {
        const status = await initializeDistributedCaches(createCountingInitializers().initializers);

        assertEquals(
          status.backend,
          "redis",
          "a configured Redis wins when no API cache is available",
        );
      },
    );
  });

  it("runs the initializers for a persistent local cache", async () => {
    await withEnv({ ...NEUTRAL_CACHE_ENV, VF_CACHE_BACKEND: "disk" }, async () => {
      const { calls, initializers } = createCountingInitializers();

      const status = await initializeDistributedCaches(initializers);

      assertEquals(
        status.backend,
        "disk",
        "a persistent local cache must still run the initializers",
      );
      assertEquals(calls, {
        transformCache: 1,
        ssrModuleCache: 1,
        fileCache: 1,
        projectCSSCache: 1,
        httpModuleCache: 1,
      }, "every injected initializer must run exactly once for a persistent backend");
    });
  });

  it("short-circuits a memory backend", async () => {
    await withEnv({ ...NEUTRAL_CACHE_ENV, VF_CACHE_BACKEND: "memory" }, async () => {
      const { calls, initializers } = createCountingInitializers();

      const status = await initializeDistributedCaches(initializers);

      assertEquals(status, {
        backend: "memory",
        transformCache: false,
        ssrModuleCache: false,
        fileCache: false,
        projectCSSCache: false,
        httpModuleCache: false,
      }, "a memory backend short-circuits before any initializer");
      assertEquals(calls, {
        transformCache: 0,
        ssrModuleCache: 0,
        fileCache: 0,
        projectCSSCache: 0,
        httpModuleCache: 0,
      }, "no initializer may run without a cache that outlives the process");
    });
  });
});
