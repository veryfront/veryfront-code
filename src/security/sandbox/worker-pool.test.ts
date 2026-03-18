import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { WorkerPool } from "./worker-pool.ts";

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
});
