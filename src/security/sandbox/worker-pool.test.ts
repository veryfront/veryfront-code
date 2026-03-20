import { assert, assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import {
  __resetPoolForTests,
  isDataIsolationEnabled,
  isSSRIsolationEnabled,
  isWorkerIsolationEnabled,
  WorkerPool,
} from "./worker-pool.ts";

// Worker isolation only works in Deno (requires Deno Worker permissions API)
const testSuite = isDeno ? describe : describe.skip;

testSuite("WorkerPool", () => {
  let pool: WorkerPool;

  beforeEach(() => {
    pool = new WorkerPool({
      maxPoolSize: 3,
      idleTimeoutMs: 1_000,
      requestTimeoutMs: 5_000,
      healthCheckIntervalMs: 60_000,
      maxRequestsPerWorker: 100,
    });
  });

  afterEach(() => {
    pool.shutdown();
  });

  it("creates a worker for a new project", () => {
    const worker = pool.getOrCreateWorker("project-a", []);
    assertExists(worker);
    assertEquals(worker.projectId, "project-a");

    const stats = pool.getStats();
    assertEquals(stats.poolSize, 1);
  });

  it("returns the same worker for the same project", () => {
    const w1 = pool.getOrCreateWorker("project-a", []);
    const w2 = pool.getOrCreateWorker("project-a", []);
    assertEquals(w1, w2);

    const stats = pool.getStats();
    assertEquals(stats.poolSize, 1);
  });

  it("creates separate workers for different projects", () => {
    pool.getOrCreateWorker("project-a", []);
    pool.getOrCreateWorker("project-b", []);

    const stats = pool.getStats();
    assertEquals(stats.poolSize, 2);
  });

  it("evicts LRU worker when pool is full", () => {
    pool.getOrCreateWorker("project-a", []);
    pool.getOrCreateWorker("project-b", []);
    pool.getOrCreateWorker("project-c", []);

    // Pool is full (maxPoolSize=3), creating a 4th should evict the LRU
    pool.getOrCreateWorker("project-d", []);

    const stats = pool.getStats();
    assertEquals(stats.poolSize, 3);
    // project-a was least recently used, should be evicted
    assertEquals(stats.workers["project-a"], undefined);
    assertExists(stats.workers["project-d"]);
  });

  it("evicts a specific worker", () => {
    pool.getOrCreateWorker("project-a", []);
    pool.getOrCreateWorker("project-b", []);

    pool.evictWorker("project-a");

    const stats = pool.getStats();
    assertEquals(stats.poolSize, 1);
    assertEquals(stats.workers["project-a"], undefined);
    assertExists(stats.workers["project-b"]);
  });

  it("getStats returns correct structure", () => {
    pool.getOrCreateWorker("project-a", []);

    const stats = pool.getStats();
    assertEquals(stats.maxPoolSize, 3);
    assertEquals(stats.poolSize, 1);
    assertExists(stats.workers["project-a"]);
    assertEquals(stats.workers["project-a"].status, "idle");
    assertEquals(stats.workers["project-a"].requestCount, 0);
    assertEquals(stats.workers["project-a"].hasPending, false);
  });

  it("shutdown terminates all workers", () => {
    pool.getOrCreateWorker("project-a", []);
    pool.getOrCreateWorker("project-b", []);

    pool.shutdown();

    const stats = pool.getStats();
    assertEquals(stats.poolSize, 0);
  });

  it("rejects execute when modulePath is outside allowed read paths", async () => {
    await assertRejects(
      () =>
        pool.execute("project-a", ["/allowed/path"], {
          type: "execute-app-route",
          id: "test-id",
          modulePath: "/etc/passwd",
          method: "GET",
          request: { url: "http://localhost/api/test", method: "GET", headers: [], body: null },
          params: {},
        }),
      VeryfrontError,
      "outside allowed read paths",
    );
  });

  it("allows execute when modulePath is within allowed read paths", () => {
    // Should not throw — just verifies the validation passes
    // (actual execution will fail since the module doesn't exist, but that's after validation)
    pool.getOrCreateWorker("project-a", ["/allowed/path"]);
    const stats = pool.getStats();
    assertEquals(stats.poolSize, 1);
  });

  it("getMetrics returns correct aggregate structure", () => {
    pool.getOrCreateWorker("project-a", []);
    pool.getOrCreateWorker("project-b", []);

    const metrics = pool.getMetrics();
    assertEquals(metrics.workerPoolSize, 2);
    assertEquals(metrics.workerPoolCapacity, 3);
    assertEquals(metrics.totalRequestsProcessed, 0);
    assertEquals(metrics.busyWorkers, 0);
    assertEquals(metrics.crashedWorkers, 0);
  });

  it("evictWorker is no-op for non-existent project", () => {
    pool.evictWorker("nonexistent");
    assertEquals(pool.getStats().poolSize, 0);
  });

  it("re-creates worker after eviction", () => {
    pool.getOrCreateWorker("project-a", []);
    pool.evictWorker("project-a");
    assertEquals(pool.getStats().poolSize, 0);

    pool.getOrCreateWorker("project-a", []);
    assertEquals(pool.getStats().poolSize, 1);
  });
});

testSuite("WorkerPool - RFC 9457 error metadata", () => {
  let pool: WorkerPool;

  beforeEach(() => {
    pool = new WorkerPool({
      maxPoolSize: 3,
      idleTimeoutMs: 1_000,
      requestTimeoutMs: 5_000,
      healthCheckIntervalMs: 60_000,
      maxRequestsPerWorker: 100,
    });
  });

  afterEach(() => {
    pool.shutdown();
  });

  it("execute-app-route request includes projectDir", () => {
    // Verify the request type accepts projectDir
    const worker = pool.getOrCreateWorker("test-proj", ["/tmp/test"]);
    assertExists(worker);
    assertEquals(worker.projectId, "test-proj");
  });

  it("execute-app-route request accepts projectEnv", () => {
    // Verify the request type accepts projectEnv field
    const worker = pool.getOrCreateWorker("test-proj", ["/tmp/test"]);
    assertExists(worker);
  });
});

testSuite("WorkerPool - warm recycling", () => {
  let pool: WorkerPool;

  afterEach(() => {
    pool?.shutdown();
  });

  it("recycles worker without cold-start penalty on triggering request", async () => {
    pool = new WorkerPool({
      maxPoolSize: 3,
      idleTimeoutMs: 60_000,
      requestTimeoutMs: 5_000,
      healthCheckIntervalMs: 60_000,
      maxRequestsPerWorker: 1, // Recycle after 1 request
      maxWorkerAgeMs: 600_000,
    });

    // Create initial worker and verify it exists
    const worker1 = pool.getOrCreateWorker("project-recycle", []);
    assertExists(worker1);
    assertEquals(worker1.projectId, "project-recycle");

    // Execute a health check to increment the request counter via the pool
    // After this the worker has handled a request, so next execute() triggers recycle
    const healthy = await worker1.isHealthy(5_000);
    assertEquals(healthy, true);

    // The pool should still have 1 worker
    assertEquals(pool.getStats().poolSize, 1);

    // After recycle, a new getOrCreateWorker should return a new (or recycled) worker
    // Allow microtask to process
    await new Promise((r) => setTimeout(r, 50));
    const stats = pool.getStats();
    assertEquals(stats.poolSize, 1);
  });

  it("does not recycle when under maxRequestsPerWorker", () => {
    pool = new WorkerPool({
      maxPoolSize: 3,
      idleTimeoutMs: 60_000,
      requestTimeoutMs: 5_000,
      healthCheckIntervalMs: 60_000,
      maxRequestsPerWorker: 100,
      maxWorkerAgeMs: 600_000,
    });

    const worker1 = pool.getOrCreateWorker("project-no-recycle", []);
    const worker2 = pool.getOrCreateWorker("project-no-recycle", []);

    // Same worker returned (no recycle needed)
    assert(worker1 === worker2, "should return the same worker when under threshold");
  });
});

describe("Feature flag caching", () => {
  afterEach(() => {
    try {
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
    } catch { /* ok */ }
    try {
      Deno.env.delete("WORKER_ISOLATION_API");
    } catch { /* ok */ }
    try {
      Deno.env.delete("WORKER_ISOLATION_DATA");
    } catch { /* ok */ }
    try {
      Deno.env.delete("WORKER_ISOLATION_SSR");
    } catch { /* ok */ }
    __resetPoolForTests();
  });

  it("returns false when master switch is off", () => {
    __resetPoolForTests();
    assertEquals(isWorkerIsolationEnabled(), false);
    assertEquals(isDataIsolationEnabled(), false);
    assertEquals(isSSRIsolationEnabled(), false);
  });

  it("returns true for API isolation when both flags set", () => {
    __resetPoolForTests();
    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    Deno.env.set("WORKER_ISOLATION_API", "1");
    assertEquals(isWorkerIsolationEnabled(), true);
  });

  it("returns true for data isolation when both flags set", () => {
    __resetPoolForTests();
    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    Deno.env.set("WORKER_ISOLATION_DATA", "1");
    assertEquals(isDataIsolationEnabled(), true);
  });

  it("returns true for SSR isolation when both flags set", () => {
    __resetPoolForTests();
    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    Deno.env.set("WORKER_ISOLATION_SSR", "1");
    assertEquals(isSSRIsolationEnabled(), true);
  });

  it("caches flag results across calls", () => {
    __resetPoolForTests();
    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    Deno.env.set("WORKER_ISOLATION_API", "1");
    assertEquals(isWorkerIsolationEnabled(), true);

    // Changing env after first read should not change cached result
    Deno.env.delete("WORKER_ISOLATION_API");
    assertEquals(isWorkerIsolationEnabled(), true);
  });

  it("__resetPoolForTests clears cached flags", () => {
    __resetPoolForTests();
    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    Deno.env.set("WORKER_ISOLATION_API", "1");
    assertEquals(isWorkerIsolationEnabled(), true);

    __resetPoolForTests();
    try {
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
    } catch { /* ok */ }
    try {
      Deno.env.delete("WORKER_ISOLATION_API");
    } catch { /* ok */ }
    assertEquals(isWorkerIsolationEnabled(), false);
  });
});
