/**
 * Worker Isolation Performance Benchmarks
 *
 * Measures hot-path performance of the worker isolation system:
 * - Worker pool: creation, lookup, recycling
 * - Worker permissions: permission building with cached execPath
 * - Worker lifecycle: health checks, request execution
 * - Request serialization: body size guard, Content-Length fast path
 *
 * Run: deno bench --allow-all --unstable-worker-options src/security/sandbox/worker-isolation.bench.ts
 *
 * @module security/sandbox/worker-isolation.bench
 */

import { WorkerPool } from "./worker-pool.ts";
import { buildWorkerPermissions } from "./worker-permissions.ts";
import { ProjectWorker } from "./project-worker.ts";
import { MAX_WORKER_BODY_BYTES } from "./worker-types.ts";
import type { WorkerPermissions } from "./worker-permissions.ts";

// ---------------------------------------------------------------------------
// Worker Permissions Benchmarks
// ---------------------------------------------------------------------------

Deno.bench({
  name: "buildWorkerPermissions — with read paths",
  group: "permissions",
  baseline: true,
  fn() {
    buildWorkerPermissions(["/tmp/project-a", "/tmp/cache"]);
  },
});

Deno.bench({
  name: "buildWorkerPermissions — empty read paths",
  group: "permissions",
  fn() {
    buildWorkerPermissions([]);
  },
});

// ---------------------------------------------------------------------------
// Worker Pool — Lookup Benchmarks
// ---------------------------------------------------------------------------

const lookupPool = new WorkerPool({
  maxPoolSize: 50,
  idleTimeoutMs: 300_000,
  requestTimeoutMs: 30_000,
  healthCheckIntervalMs: 300_000,
  maxRequestsPerWorker: 100_000,
  maxWorkerAgeMs: 600_000,
});

// Pre-create workers for lookup benchmarks
lookupPool.getOrCreateWorker("bench-project-1", ["/tmp"]);
lookupPool.getOrCreateWorker("bench-project-2", ["/tmp"]);
lookupPool.getOrCreateWorker("bench-project-3", ["/tmp"]);

Deno.bench({
  name: "WorkerPool.getOrCreateWorker — cache hit (existing worker)",
  group: "pool-lookup",
  baseline: true,
  fn() {
    lookupPool.getOrCreateWorker("bench-project-1", ["/tmp"]);
  },
});

Deno.bench({
  name: "WorkerPool.getOrCreateWorker — cache hit (3rd project)",
  group: "pool-lookup",
  fn() {
    lookupPool.getOrCreateWorker("bench-project-3", ["/tmp"]);
  },
});

Deno.bench({
  name: "WorkerPool.getStats — 3 workers",
  group: "pool-stats",
  baseline: true,
  fn() {
    lookupPool.getStats();
  },
});

Deno.bench({
  name: "WorkerPool.getMetrics — 3 workers",
  group: "pool-stats",
  fn() {
    lookupPool.getMetrics();
  },
});

// ---------------------------------------------------------------------------
// Worker Pool — Creation Benchmarks
// ---------------------------------------------------------------------------

Deno.bench({
  name: "WorkerPool.getOrCreateWorker — new worker creation",
  group: "pool-create",
  baseline: true,
  fn() {
    const pool = new WorkerPool({
      maxPoolSize: 5,
      idleTimeoutMs: 300_000,
      requestTimeoutMs: 30_000,
      healthCheckIntervalMs: 300_000,
      maxRequestsPerWorker: 100_000,
    });
    pool.getOrCreateWorker("bench-create", ["/tmp"]);
    pool.shutdown();
  },
});

// ---------------------------------------------------------------------------
// Worker Health Check Benchmarks
// ---------------------------------------------------------------------------

const TEST_PERMISSIONS: WorkerPermissions = {
  read: true,
  write: false,
  net: false,
  env: false,
  run: false,
  ffi: false,
  sys: false,
};

Deno.bench({
  name: "ProjectWorker.isHealthy — ping/pong round-trip",
  group: "health-check",
  baseline: true,
  async fn() {
    const worker = new ProjectWorker({
      projectId: "bench-health",
      permissions: TEST_PERMISSIONS,
      requestTimeoutMs: 5_000,
    });
    worker.start();
    await worker.isHealthy(5_000);
    worker.terminate();
  },
});

// ---------------------------------------------------------------------------
// Request Body Serialization Benchmarks
// ---------------------------------------------------------------------------

Deno.bench({
  name: "Request body serialization — no body (GET)",
  group: "body-serialization",
  baseline: true,
  async fn() {
    const request = new Request("http://localhost/api/test", { method: "GET" });
    if (request.body) {
      await request.arrayBuffer();
    }
  },
});

Deno.bench({
  name: "Request body serialization — small JSON body",
  group: "body-serialization",
  async fn() {
    const body = JSON.stringify({ data: "hello", count: 42 });
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    });
    const buf = new Uint8Array(await request.arrayBuffer());
    if (buf.byteLength > MAX_WORKER_BODY_BYTES) {
      throw new Error("too large");
    }
  },
});

Deno.bench({
  name: "Request body serialization — 1 MB body",
  group: "body-serialization",
  async fn() {
    const body = new Uint8Array(1 * 1024 * 1024);
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body,
    });
    const buf = new Uint8Array(await request.arrayBuffer());
    if (buf.byteLength > MAX_WORKER_BODY_BYTES) {
      throw new Error("too large");
    }
  },
});

// ---------------------------------------------------------------------------
// Content-Length Fast Path Benchmarks
// ---------------------------------------------------------------------------

Deno.bench({
  name: "Content-Length check — within limit",
  group: "content-length",
  baseline: true,
  fn() {
    const contentLength = "1024";
    const bytes = parseInt(contentLength, 10);
    if (bytes > MAX_WORKER_BODY_BYTES) {
      throw new Error("too large");
    }
  },
});

Deno.bench({
  name: "Content-Length check — over limit (rejected)",
  group: "content-length",
  fn() {
    const contentLength = String(20 * 1024 * 1024);
    const bytes = parseInt(contentLength, 10);
    if (bytes > MAX_WORKER_BODY_BYTES) {
      // rejected — fast path avoids buffering
    }
  },
});

Deno.bench({
  name: "Content-Length check — no header present",
  group: "content-length",
  fn() {
    const contentLength: string | null = null;
    if (contentLength) {
      parseInt(contentLength, 10);
    }
    // No header — skip fast path
  },
});

// ---------------------------------------------------------------------------
// Worker Pool — Execute Round-Trip (ping via worker)
// ---------------------------------------------------------------------------

const executePool = new WorkerPool({
  maxPoolSize: 5,
  idleTimeoutMs: 300_000,
  requestTimeoutMs: 10_000,
  healthCheckIntervalMs: 300_000,
  maxRequestsPerWorker: 100_000,
  maxWorkerAgeMs: 600_000,
});

// Pre-warm the worker
const warmWorker = executePool.getOrCreateWorker("bench-execute", ["/tmp"]);
await warmWorker.isHealthy(5_000);

Deno.bench({
  name: "WorkerPool — health check round-trip (pre-warmed worker)",
  group: "execute",
  baseline: true,
  async fn() {
    const worker = executePool.getOrCreateWorker("bench-execute", ["/tmp"]);
    await worker.isHealthy(5_000);
  },
});

// ---------------------------------------------------------------------------
// Worker Pool — LRU Eviction
// ---------------------------------------------------------------------------

Deno.bench({
  name: "WorkerPool — eviction under capacity (no-op check)",
  group: "eviction",
  baseline: true,
  fn() {
    // Pool with 50 capacity and 3 workers — evictIfNeeded is a no-op
    lookupPool.getOrCreateWorker("bench-project-1", ["/tmp"]);
  },
});

// ---------------------------------------------------------------------------
// TextEncoder Singleton vs Per-Call
// ---------------------------------------------------------------------------

const singletonEncoder = new TextEncoder();
const testString = JSON.stringify({ error: "Method not allowed" });

Deno.bench({
  name: "TextEncoder — singleton (module-level)",
  group: "text-encoder",
  baseline: true,
  fn() {
    singletonEncoder.encode(testString);
  },
});

Deno.bench({
  name: "TextEncoder — new instance per call",
  group: "text-encoder",
  fn() {
    new TextEncoder().encode(testString);
  },
});

// ---------------------------------------------------------------------------
// Cleanup — global teardown registered via unload
// ---------------------------------------------------------------------------

globalThis.addEventListener("unload", () => {
  lookupPool.shutdown();
  executePool.shutdown();
});
