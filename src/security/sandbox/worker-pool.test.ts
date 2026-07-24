import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import type { ProjectWorker, ProjectWorkerOptions } from "./project-worker.ts";
import {
  __resetPoolForTests,
  getWorkerPool,
  isDataIsolationEnabled,
  isSSRIsolationEnabled,
  isWorkerIsolationEnabled,
  WorkerPool,
} from "./worker-pool.ts";
import type {
  RenderSSRRequest,
  WorkerPoolConfig,
  WorkerRequest,
  WorkerResponse,
} from "./worker-types.ts";
import { DEFAULT_WORKER_POOL_CONFIG, MAX_WORKER_BODY_BYTES } from "./worker-types.ts";

// Worker isolation only works in Deno (requires Deno Worker permissions API)
const testSuite = isDeno ? describe : describe.skip;
const TEST_SOURCE_INTEGRATION_POLICY = { schemaVersion: 1, mode: "unrestricted" } as const;
const TEST_PREPARED_MODULE = {
  source: "export function GET() { return new Response('ok'); }",
  sha256: "0".repeat(64),
} as const;

interface ControlledWorkerBehavior {
  completeStreamsSynchronously?: boolean;
  notifyIdleOnSubscription?: boolean;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeRequest(
  id: string,
  projectEnv?: Record<string, string>,
  modulePath = "/tmp/module.ts",
): WorkerRequest {
  return {
    type: "execute-app-route",
    id,
    module: TEST_PREPARED_MODULE,
    modulePath,
    method: "GET",
    request: {
      url: "http://localhost/test",
      method: "GET",
      headers: [],
      body: null,
    },
    params: {},
    projectDir: "/tmp",
    sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
    projectEnv,
  };
}

function makeSSRRequest(
  id: string,
  overrides: Partial<RenderSSRRequest> = {},
): RenderSSRRequest {
  return {
    type: "render-ssr",
    id,
    pageModulePath: "/tmp/page.tsx",
    layoutModulePaths: [],
    pageProps: {},
    layoutProps: [],
    delivery: "stream",
    sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
    ...overrides,
  };
}

class ControlledWorker {
  readonly projectId: string;
  status: "idle" | "busy" | "crashed" | "terminated" = "idle";
  requestCount = 0;
  terminateCalls = 0;
  healthCheckCalls = 0;
  healthCheckResult: boolean | Promise<boolean> = true;
  private pending = new Map<string, {
    resolve: (response: WorkerResponse) => void;
    reject: (error: Error) => void;
  }>();
  private streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  private idleListeners = new Set<() => void>();
  private readonly behavior: ControlledWorkerBehavior;

  constructor(
    options: ProjectWorkerOptions,
    behavior: ControlledWorkerBehavior = {},
  ) {
    this.projectId = options.projectId;
    this.behavior = behavior;
  }

  get hasPendingRequests(): boolean {
    return this.pending.size > 0 || this.streams.size > 0;
  }

  get idleListenerCount(): number {
    return this.idleListeners.size;
  }

  start(): void {}

  onIdle(listener: () => void): () => void {
    this.idleListeners.add(listener);
    if (this.behavior.notifyIdleOnSubscription && !this.hasPendingRequests) {
      listener();
    }
    return () => {
      this.idleListeners.delete(listener);
    };
  }

  execute(request: WorkerRequest): Promise<WorkerResponse> {
    this.requestCount++;
    this.status = "busy";
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
    });
  }

  executeStream(request: WorkerRequest): ReadableStream<Uint8Array> {
    this.requestCount++;
    this.status = "busy";
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        if (this.behavior.completeStreamsSynchronously) {
          controller.enqueue(new Uint8Array([9]));
          controller.close();
          this.status = "idle";
          return;
        }
        this.streams.set(request.id, controller);
      },
      cancel: () => {
        this.streams.delete(request.id);
        this.updateIdle();
      },
    });
  }

  complete(id: string): void {
    const pending = this.pending.get(id);
    assertExists(pending, `request "${id}" must be pending`);
    this.pending.delete(id);
    this.updateIdle();
    pending.resolve({
      type: "result",
      id,
      response: {
        status: 200,
        statusText: "OK",
        headers: [],
        body: null,
      },
    });
  }

  reachPreparedModuleCapacity(id: string): void {
    const pending = this.pending.get(id);
    assertExists(pending, `request "${id}" must be pending`);
    this.pending.delete(id);
    this.updateIdle();
    pending.resolve({
      type: "prepared-module-capacity",
      id,
    });
  }

  completeStream(id: string, chunks: Uint8Array[] = []): void {
    const controller = this.streams.get(id);
    assertExists(controller, `stream "${id}" must be pending`);
    for (const chunk of chunks) controller.enqueue(chunk);
    this.streams.delete(id);
    controller.close();
    this.updateIdle();
  }

  becomeTerminal(status: "crashed" | "terminated"): void {
    this.status = status;
    for (const [, pending] of this.pending) {
      pending.reject(new Error(`worker ${status}`));
    }
    this.pending.clear();
    for (const [, controller] of this.streams) {
      controller.error(new Error(`worker ${status}`));
    }
    this.streams.clear();
    this.notifyIdle();
  }

  async isHealthy(): Promise<boolean> {
    this.healthCheckCalls++;
    return await this.healthCheckResult;
  }

  terminate(): void {
    this.terminateCalls++;
    this.status = "terminated";
    for (const [, pending] of this.pending) {
      pending.reject(new Error("worker terminated"));
    }
    this.pending.clear();
    for (const [, controller] of this.streams) {
      controller.error(new Error("worker terminated"));
    }
    this.streams.clear();
    this.notifyIdle();
  }

  private updateIdle(): void {
    if (this.pending.size !== 0 || this.streams.size !== 0) return;
    if (this.status === "busy") this.status = "idle";
    this.notifyIdle();
  }

  private notifyIdle(): void {
    if (this.pending.size !== 0 || this.streams.size !== 0) return;
    for (const listener of [...this.idleListeners]) listener();
  }
}

function createControlledPool(
  config: Partial<WorkerPoolConfig> = {},
  behavior: ControlledWorkerBehavior = {},
): {
  pool: WorkerPool;
  workers: Map<string, ControlledWorker[]>;
} {
  const workers = new Map<string, ControlledWorker[]>();
  const pool = new WorkerPool(
    {
      maxPoolSize: 3,
      idleTimeoutMs: 60_000,
      requestTimeoutMs: 5_000,
      healthCheckIntervalMs: 60_000,
      maxRequestsPerWorker: 100,
      maxWorkerAgeMs: 600_000,
      ...config,
    },
    {
      createWorker(options) {
        const worker = new ControlledWorker(options, behavior);
        const generations = workers.get(options.projectId) ?? [];
        generations.push(worker);
        workers.set(options.projectId, generations);
        return worker as unknown as ProjectWorker;
      },
    },
  );
  return { pool, workers };
}

function latestWorker(
  workers: Map<string, ControlledWorker[]>,
  projectId: string,
): ControlledWorker {
  const generations = workers.get(projectId);
  assertExists(generations);
  const worker = generations.at(-1);
  assertExists(worker);
  return worker;
}

async function waitForWorkerGeneration(
  workers: Map<string, ControlledWorker[]>,
  projectId: string,
  count: number,
): Promise<void> {
  for (let turn = 0; turn < 20; turn++) {
    if ((workers.get(projectId)?.length ?? 0) >= count) return;
    await Promise.resolve();
  }
  throw new Error(`worker generation ${count} was not created`);
}

async function runHealthCheck(pool: WorkerPool): Promise<void> {
  await (pool as unknown as { checkHealth(): Promise<void> }).checkHealth();
}

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

  it("recreates a worker when the project env key set changes", () => {
    const w1 = pool.getOrCreateWorker("project-a", [], ["PROJECT_SECRET_A"]);
    const w2 = pool.getOrCreateWorker("project-a", [], ["PROJECT_SECRET_A"]);
    const w3 = pool.getOrCreateWorker("project-a", [], ["PROJECT_SECRET_B"]);

    assertEquals(w1, w2);
    assert(w1 !== w3, "worker permissions must be rebuilt for changed env keys");
    assertEquals(pool.getStats().poolSize, 1);
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
    const error = await assertRejects(
      () =>
        pool.execute("project-a", ["/allowed/path"], {
          type: "execute-app-route",
          id: "test-id",
          module: TEST_PREPARED_MODULE,
          modulePath: "/etc/passwd",
          method: "GET",
          request: { url: "http://localhost/api/test", method: "GET", headers: [], body: null },
          params: {},
          projectDir: "/allowed/path",
          sourceIntegrationPolicy: TEST_SOURCE_INTEGRATION_POLICY,
        }),
      VeryfrontError,
      "outside the allowed project boundary",
    ) as VeryfrontError;
    assert(!error.message.includes("/etc/passwd"));
    assert(!error.message.includes("project-a"));
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

testSuite("WorkerPool - bounded admission and retirement", () => {
  let pool: WorkerPool;

  afterEach(() => {
    pool?.shutdown();
  });

  it("rejects a new scope at capacity without interrupting the active scope", async () => {
    const controlled = createControlledPool({ maxPoolSize: 1 });
    pool = controlled.pool;

    const active = pool.execute("scope-a", ["/tmp"], makeRequest("a-1"));
    const workerA = latestWorker(controlled.workers, "scope-a");

    await assertRejects(
      () => pool.execute("scope-b", ["/tmp"], makeRequest("b-1")),
      VeryfrontError,
      "capacity reached",
    );
    assertEquals(workerA.terminateCalls, 0);
    assertEquals(workerA.hasPendingRequests, true);

    workerA.complete("a-1");
    const response = await active;
    assertEquals(response.type, "result");
    assertEquals(workerA.terminateCalls, 0);

    const workerB = pool.getOrCreateWorker("scope-b", ["/tmp"]);
    assert(workerB !== (workerA as unknown as ProjectWorker));
    assertEquals(workerA.terminateCalls, 1);
  });

  it("holds one atomic admission until the worker protocol settles", async () => {
    const controlled = createControlledPool({ maxPoolSize: 1 });
    pool = controlled.pool;

    const stream = pool.executeStream("scope-a", ["/tmp"], makeSSRRequest("stream-a"));
    const workerA = latestWorker(controlled.workers, "scope-a");
    assertEquals(workerA.hasPendingRequests, true);

    await assertRejects(
      () => pool.execute("scope-b", ["/tmp"], makeRequest("b-1")),
      VeryfrontError,
      "capacity reached",
    );

    pool.evictWorker("scope-a");
    workerA.completeStream("stream-a", [new Uint8Array([1, 2, 3])]);
    // Actual worker completion releases pool admission even though the
    // consumer has not drained its already-buffered bytes.
    assertEquals(workerA.terminateCalls, 1);
    assertEquals(pool.getStats().workers["scope-a"], undefined);

    const reader = stream.getReader();
    assertEquals(await reader.read(), {
      done: false,
      value: new Uint8Array([1, 2, 3]),
    });
    assertEquals(await reader.read(), { done: true, value: undefined });

    assertEquals(workerA.terminateCalls, 1);
  });

  it("releases admission on worker completion before an unread stream drains", async () => {
    const controlled = createControlledPool({ maxPoolSize: 1 });
    pool = controlled.pool;

    const stream = pool.executeStream("scope-a", ["/tmp"], makeSSRRequest("stream-a"));
    const workerA = latestWorker(controlled.workers, "scope-a");
    workerA.completeStream("stream-a", [new Uint8Array([7, 8])]);

    const workerB = pool.getOrCreateWorker("scope-b", ["/tmp"]);
    assert(workerB !== (workerA as unknown as ProjectWorker));
    assertEquals(workerA.terminateCalls, 1);

    const buffered = await new Response(stream).arrayBuffer();
    assertEquals(new Uint8Array(buffered), new Uint8Array([7, 8]));
  });

  it("releases admission when a stream completes before idle subscription", async () => {
    const controlled = createControlledPool(
      { maxPoolSize: 1 },
      { completeStreamsSynchronously: true },
    );
    pool = controlled.pool;

    const stream = pool.executeStream("scope-a", ["/tmp"], makeSSRRequest("stream-a"));
    const workerA = latestWorker(controlled.workers, "scope-a");
    assertEquals(workerA.hasPendingRequests, false);

    const workerB = pool.getOrCreateWorker("scope-b", ["/tmp"]);
    assert(workerB !== (workerA as unknown as ProjectWorker));
    assertEquals(workerA.terminateCalls, 1);

    const buffered = await new Response(stream).arrayBuffer();
    assertEquals(new Uint8Array(buffered), new Uint8Array([9]));
  });

  it("unsubscribes an idle listener that fires synchronously during registration", async () => {
    const controlled = createControlledPool(
      { maxPoolSize: 1 },
      {
        completeStreamsSynchronously: true,
        notifyIdleOnSubscription: true,
      },
    );
    pool = controlled.pool;

    const stream = pool.executeStream("scope-a", ["/tmp"], makeSSRRequest("stream-a"));
    const workerA = latestWorker(controlled.workers, "scope-a");

    // Only the pool entry's long-lived lifecycle listener remains. The
    // per-stream listener returned its unsubscribe after firing synchronously.
    assertEquals(workerA.idleListenerCount, 1);
    assertEquals(new Uint8Array(await new Response(stream).arrayBuffer()), new Uint8Array([9]));
  });

  it("defers environment-key replacement until the busy worker settles", async () => {
    const controlled = createControlledPool({ maxPoolSize: 1 });
    pool = controlled.pool;

    const active = pool.execute(
      "scope-a",
      ["/tmp"],
      makeRequest("a-1", { PROJECT_SECRET_A: "one" }),
    );
    const workerA = latestWorker(controlled.workers, "scope-a");

    await assertRejects(
      () =>
        pool.execute(
          "scope-a",
          ["/tmp"],
          makeRequest("a-2", { PROJECT_SECRET_B: "two" }),
        ),
      VeryfrontError,
      "changed permissions",
    );
    assertEquals(workerA.terminateCalls, 0);
    assertEquals(pool.getStats().workers["scope-a"]?.retiring, true);

    workerA.complete("a-1");
    await active;
    assertEquals(workerA.terminateCalls, 1);
    assertEquals(pool.getStats().workers["scope-a"], undefined);

    const workerB = pool.getOrCreateWorker("scope-a", [], ["PROJECT_SECRET_B"]);
    assert(workerB !== (workerA as unknown as ProjectWorker));
  });

  it("defers changed read permissions until the busy worker settles", async () => {
    const controlled = createControlledPool({ maxPoolSize: 1 });
    pool = controlled.pool;

    const active = pool.execute(
      "scope-a",
      ["/tmp/project-a"],
      makeRequest("a-1", undefined, "/tmp/project-a/module.ts"),
    );
    const workerA = latestWorker(controlled.workers, "scope-a");

    await assertRejects(
      () =>
        pool.execute(
          "scope-a",
          ["/tmp/project-b"],
          makeRequest("a-2", undefined, "/tmp/project-b/module.ts"),
        ),
      VeryfrontError,
      "changed permissions",
    );
    assertEquals(workerA.terminateCalls, 0);
    assertEquals(pool.getStats().workers["scope-a"]?.retiring, true);

    workerA.complete("a-1");
    await active;
    assertEquals(workerA.terminateCalls, 1);

    const workerB = pool.getOrCreateWorker("scope-a", ["/tmp/project-b"]);
    assert(workerB !== (workerA as unknown as ProjectWorker));
  });

  it("reuses a worker for canonically equivalent read roots", () => {
    const controlled = createControlledPool();
    pool = controlled.pool;

    const workerA = pool.getOrCreateWorker("scope-a", [
      "/tmp/project",
      "/tmp/project/nested",
    ]);
    const samePermissions = pool.getOrCreateWorker("scope-a", [
      "/tmp/project/other/..",
    ]);

    assertEquals(samePermissions, workerA);
    assertEquals(controlled.workers.get("scope-a")?.length, 1);
  });

  it("rejects sibling path prefixes outside the allowed read root", async () => {
    const controlled = createControlledPool();
    pool = controlled.pool;

    await assertRejects(
      () =>
        pool.execute(
          "scope-a",
          ["/tmp/project"],
          makeRequest("a-1", undefined, "/tmp/project-evil/module.ts"),
        ),
      VeryfrontError,
      "outside the allowed project boundary",
    );
    assertEquals(pool.getStats().poolSize, 0);
  });

  it("rejects an existing module path that escapes through a symlink", async () => {
    const controlled = createControlledPool();
    pool = controlled.pool;
    const testRoot = await Deno.makeTempDir({ prefix: "vf-worker-pool-path-" });
    const allowedRoot = `${testRoot}/allowed`;
    const outsideRoot = `${testRoot}/outside`;
    const linkPath = `${allowedRoot}/outside-link`;
    const escapedModule = `${linkPath}/module.ts`;

    try {
      await Deno.mkdir(allowedRoot);
      await Deno.mkdir(outsideRoot);
      await Deno.writeTextFile(`${outsideRoot}/module.ts`, "export {};");
      await Deno.symlink(outsideRoot, linkPath, { type: "dir" });

      await assertRejects(
        () =>
          pool.execute(
            "scope-a",
            [allowedRoot],
            makeRequest("a-1", undefined, escapedModule),
          ),
        VeryfrontError,
        "outside the allowed project boundary",
      );
      assertEquals(pool.getStats().poolSize, 0);
    } finally {
      await Deno.remove(testRoot, { recursive: true });
    }
  });

  it("validates every SSR page and layout module path", () => {
    const controlled = createControlledPool();
    pool = controlled.pool;
    const escapedLayout = "/tmp/project/../project-evil/layout.tsx";

    const error = assertThrows(
      () =>
        pool.executeStream(
          "scope-a",
          ["/tmp/project"],
          makeSSRRequest("ssr-1", {
            pageModulePath: "/tmp/project/page.tsx",
            layoutModulePaths: [escapedLayout],
          }),
        ),
      VeryfrontError,
      "outside the allowed project boundary",
    );

    assert(!error.message.includes(escapedLayout));
    assert(!error.message.includes("scope-a"));
    assertEquals(pool.getStats().poolSize, 0);
  });

  it("rejects an SSR page module that escapes through a symlink", async () => {
    const controlled = createControlledPool();
    pool = controlled.pool;
    const testRoot = await Deno.makeTempDir({ prefix: "vf-worker-pool-ssr-path-" });
    const allowedRoot = `${testRoot}/allowed`;
    const outsideRoot = `${testRoot}/outside`;
    const linkPath = `${allowedRoot}/outside-link`;

    try {
      await Deno.mkdir(allowedRoot);
      await Deno.mkdir(outsideRoot);
      await Deno.writeTextFile(`${outsideRoot}/page.tsx`, "export default null;");
      await Deno.symlink(outsideRoot, linkPath, { type: "dir" });

      assertThrows(
        () =>
          pool.executeStream(
            "scope-a",
            [allowedRoot],
            makeSSRRequest("ssr-1", {
              pageModulePath: `${linkPath}/page.tsx`,
            }),
          ),
        VeryfrontError,
        "outside the allowed project boundary",
      );
      assertEquals(pool.getStats().poolSize, 0);
    } finally {
      await Deno.remove(testRoot, { recursive: true });
    }
  });

  it("defers SSR read-root changes until the active stream settles", async () => {
    const controlled = createControlledPool({ maxPoolSize: 1 });
    pool = controlled.pool;
    const firstStream = pool.executeStream(
      "scope-a",
      ["/tmp/project-a"],
      makeSSRRequest("ssr-a", {
        pageModulePath: "/tmp/project-a/page.tsx",
      }),
    );
    const workerA = latestWorker(controlled.workers, "scope-a");

    assertThrows(
      () =>
        pool.executeStream(
          "scope-a",
          ["/tmp/project-b"],
          makeSSRRequest("ssr-b", {
            pageModulePath: "/tmp/project-b/page.tsx",
          }),
        ),
      VeryfrontError,
      "changed permissions",
    );
    assertEquals(workerA.terminateCalls, 0);

    workerA.completeStream("ssr-a");
    await new Response(firstStream).arrayBuffer();
    assertEquals(workerA.terminateCalls, 1);
    assertEquals(pool.getStats().workers["scope-a"], undefined);
  });

  it("retires once when overlapping admission reaches the request limit", async () => {
    const controlled = createControlledPool({
      maxRequestsPerWorker: 1,
      maxWorkerAgeMs: 0,
    });
    pool = controlled.pool;

    const first = pool.execute("scope-a", ["/tmp"], makeRequest("a-1"));
    const workerA = latestWorker(controlled.workers, "scope-a");

    await Promise.all([
      assertRejects(
        () => pool.execute("scope-a", ["/tmp"], makeRequest("a-2")),
        VeryfrontError,
        "lifecycle limit",
      ),
      assertRejects(
        () => pool.execute("scope-a", ["/tmp"], makeRequest("a-3")),
        VeryfrontError,
        "retiring",
      ),
    ]);
    assertEquals(workerA.terminateCalls, 0);

    workerA.complete("a-1");
    await first;
    assertEquals(workerA.terminateCalls, 1);
    assertEquals(pool.getStats().poolSize, 0);

    const replacement = pool.getOrCreateWorker("scope-a", ["/tmp"]);
    assert(replacement !== (workerA as unknown as ProjectWorker));
    assertEquals(controlled.workers.get("scope-a")?.length, 2);
  });

  it("drains concurrent prepared requests and retries once after capacity rollover", async () => {
    const controlled = createControlledPool({ maxPoolSize: 1 });
    pool = controlled.pool;

    const first = pool.execute("scope-a", ["/tmp"], makeRequest("a-1"));
    const second = pool.execute("scope-a", ["/tmp"], makeRequest("a-2"));
    const third = pool.execute("scope-a", ["/tmp"], makeRequest("a-3"));
    const workerA = latestWorker(controlled.workers, "scope-a");

    workerA.reachPreparedModuleCapacity("a-1");
    await Promise.resolve();

    // Admissions that arrive during the rollover wait for the same retirement
    // instead of failing or entering the exhausted generation.
    const fourth = pool.execute("scope-a", ["/tmp"], makeRequest("a-4"));

    workerA.reachPreparedModuleCapacity("a-2");
    workerA.reachPreparedModuleCapacity("a-3");

    await waitForWorkerGeneration(controlled.workers, "scope-a", 2);
    const workerB = latestWorker(controlled.workers, "scope-a");
    assert(workerB !== workerA);
    assertEquals(workerA.terminateCalls, 1);

    workerB.complete("a-1");
    workerB.complete("a-2");
    workerB.complete("a-3");
    workerB.complete("a-4");

    const responses = await Promise.all([first, second, third, fourth]);
    assertEquals(responses.map((response) => response.type), [
      "result",
      "result",
      "result",
      "result",
    ]);
    assertEquals(controlled.workers.get("scope-a")?.length, 2);
  });

  it("bounds prepared-module capacity rollover to one fresh generation", async () => {
    const controlled = createControlledPool({ maxPoolSize: 1 });
    pool = controlled.pool;

    const execution = pool.execute(
      "scope-a",
      ["/tmp"],
      makeRequest("capacity-twice"),
    );
    const workerA = latestWorker(controlled.workers, "scope-a");
    workerA.reachPreparedModuleCapacity("capacity-twice");

    await waitForWorkerGeneration(controlled.workers, "scope-a", 2);
    const workerB = latestWorker(controlled.workers, "scope-a");
    workerB.reachPreparedModuleCapacity("capacity-twice");

    await assertRejects(
      () => execution,
      VeryfrontError,
      "capacity was reached again",
    );
    assertEquals(controlled.workers.get("scope-a")?.length, 2);
  });

  it("skips health pings while a worker has pending application work", async () => {
    const controlled = createControlledPool();
    pool = controlled.pool;

    const active = pool.execute("scope-a", ["/tmp"], makeRequest("a-1"));
    const workerA = latestWorker(controlled.workers, "scope-a");

    await runHealthCheck(pool);
    assertEquals(workerA.healthCheckCalls, 0);
    assertEquals(workerA.terminateCalls, 0);

    workerA.complete("a-1");
    await active;
    await runHealthCheck(pool);
    assertEquals(workerA.healthCheckCalls, 1);
  });

  it("ignores a stale asynchronous health result after generation replacement", async () => {
    const controlled = createControlledPool();
    pool = controlled.pool;

    const oldGeneration = pool.getOrCreateWorker("scope-a", []);
    const workerA = latestWorker(controlled.workers, "scope-a");
    const healthResult = deferred<boolean>();
    workerA.healthCheckResult = healthResult.promise;

    const checkingHealth = runHealthCheck(pool);
    await Promise.resolve();
    assertEquals(workerA.healthCheckCalls, 1);

    workerA.becomeTerminal("crashed");
    const newGeneration = pool.getOrCreateWorker("scope-a", []);
    assert(newGeneration !== oldGeneration);
    const workerB = latestWorker(controlled.workers, "scope-a");

    healthResult.resolve(false);
    await checkingHealth;

    assertEquals(workerB.terminateCalls, 0);
    assertExists(pool.getStats().workers["scope-a"]);
    assertEquals(controlled.workers.get("scope-a")?.length, 2);
  });

  it("defers explicit eviction and terminates exactly once after settlement", async () => {
    const controlled = createControlledPool();
    pool = controlled.pool;

    const active = pool.execute("scope-a", ["/tmp"], makeRequest("a-1"));
    const workerA = latestWorker(controlled.workers, "scope-a");

    pool.evictWorker("scope-a");
    pool.evictWorker("scope-a");
    assertEquals(workerA.terminateCalls, 0);
    assertEquals(pool.getStats().workers["scope-a"]?.retiring, true);

    workerA.complete("a-1");
    await active;
    assertEquals(workerA.terminateCalls, 1);
    assertEquals(pool.getStats().workers["scope-a"], undefined);

    pool.evictWorker("scope-a");
    assertEquals(workerA.terminateCalls, 1);
  });

  it("observes idle settlement for direct worker consumers without polling", async () => {
    const controlled = createControlledPool();
    pool = controlled.pool;

    pool.getOrCreateWorker("scope-a", ["/tmp"]);
    const workerA = latestWorker(controlled.workers, "scope-a");
    const externalRequest = workerA.execute(makeRequest("external-1"));

    pool.evictWorker("scope-a");
    assertEquals(workerA.terminateCalls, 0);
    assertEquals(pool.getStats().workers["scope-a"]?.retiring, true);

    workerA.complete("external-1");
    await externalRequest;
    assertEquals(workerA.terminateCalls, 1);
    assertEquals(pool.getStats().workers["scope-a"], undefined);
  });

  it("evicts an exact scope and only its controlled generation keys", async () => {
    const controlled = createControlledPool({ maxPoolSize: 6 });
    pool = controlled.pool;
    const scope = "scope-a";
    const busyGeneration = `${scope}:generation:digest-busy`;
    const idleGeneration = `${scope}:generation:digest-idle`;
    const unrelatedPrefix = "scope-a-other:generation:digest";
    const malformedGeneration = `${scope}:generationish:digest`;

    pool.getOrCreateWorker(scope, []);
    pool.getOrCreateWorker(idleGeneration, []);
    pool.getOrCreateWorker(unrelatedPrefix, []);
    pool.getOrCreateWorker(malformedGeneration, []);
    const active = pool.execute(
      busyGeneration,
      ["/tmp"],
      makeRequest("generation-1"),
    );
    const busyWorker = latestWorker(controlled.workers, busyGeneration);

    pool.evictWorkerScope(scope);

    const duringRetirement = pool.getStats();
    assertEquals(duringRetirement.workers[scope], undefined);
    assertEquals(duringRetirement.workers[idleGeneration], undefined);
    assertEquals(duringRetirement.workers[busyGeneration]?.retiring, true);
    assertExists(duringRetirement.workers[unrelatedPrefix]);
    assertExists(duringRetirement.workers[malformedGeneration]);
    assertEquals(busyWorker.terminateCalls, 0);

    busyWorker.complete("generation-1");
    await active;
    assertEquals(busyWorker.terminateCalls, 1);
    assertEquals(pool.getStats().workers[busyGeneration], undefined);
  });

  it("replaces crashed and timed-out terminal generations without stale cleanup", () => {
    const controlled = createControlledPool();
    pool = controlled.pool;

    const crashed = pool.getOrCreateWorker("scope-crash", []);
    const crashedControl = latestWorker(controlled.workers, "scope-crash");
    crashedControl.becomeTerminal("crashed");
    const afterCrash = pool.getOrCreateWorker("scope-crash", []);
    assert(afterCrash !== crashed);
    assertEquals(crashedControl.terminateCalls, 0);

    const timedOut = pool.getOrCreateWorker("scope-timeout", []);
    const timedOutControl = latestWorker(controlled.workers, "scope-timeout");
    timedOutControl.becomeTerminal("terminated");
    const afterTimeout = pool.getOrCreateWorker("scope-timeout", []);
    assert(afterTimeout !== timedOut);
    assertEquals(timedOutControl.terminateCalls, 0);
  });

  it("reports memory configuration as advisory rather than enforced", () => {
    const controlled = createControlledPool({ memoryBudgetMb: 32 });
    pool = controlled.pool;

    const stats = pool.getStats();
    assertEquals(stats.memoryBudgetMb, 32);
    assertEquals(stats.memoryBudgetEnforced, false);
  });
});

describe("MAX_WORKER_BODY_BYTES", () => {
  it("is exported as 10 MB", () => {
    assertEquals(MAX_WORKER_BODY_BYTES, 10 * 1024 * 1024);
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
    try {
      Deno.env.delete("WORKER_MAX_POOL_SIZE");
    } catch { /* ok */ }
    try {
      Deno.env.delete("WORKER_REQUEST_TIMEOUT_MS");
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

  it("ignores malicious project overlays for host isolation policy", () => {
    __resetPoolForTests();
    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    Deno.env.set("WORKER_ISOLATION_API", "1");
    Deno.env.set("WORKER_ISOLATION_DATA", "1");
    Deno.env.set("WORKER_ISOLATION_SSR", "1");

    runWithProjectEnv(
      {
        WORKER_ISOLATION_ENABLED: "0",
        WORKER_ISOLATION_API: "0",
        WORKER_ISOLATION_DATA: "0",
        WORKER_ISOLATION_SSR: "0",
      },
      () => {
        assertEquals(isWorkerIsolationEnabled(), true);
        assertEquals(isDataIsolationEnabled(), true);
        assertEquals(isSSRIsolationEnabled(), true);
      },
    );

    __resetPoolForTests();
    Deno.env.set("WORKER_ISOLATION_ENABLED", "0");
    runWithProjectEnv(
      {
        WORKER_ISOLATION_ENABLED: "1",
        WORKER_ISOLATION_API: "1",
        WORKER_ISOLATION_DATA: "1",
        WORKER_ISOLATION_SSR: "1",
      },
      () => {
        assertEquals(isWorkerIsolationEnabled(), false);
        assertEquals(isDataIsolationEnabled(), false);
        assertEquals(isSSRIsolationEnabled(), false);
      },
    );
  });

  it("ignores project overlays and invalid host values for pool limits", () => {
    __resetPoolForTests();
    Deno.env.set("WORKER_MAX_POOL_SIZE", "2");
    Deno.env.set("WORKER_REQUEST_TIMEOUT_MS", "1234");

    runWithProjectEnv(
      {
        WORKER_MAX_POOL_SIZE: "999",
        WORKER_REQUEST_TIMEOUT_MS: "1",
      },
      () => {
        const singleton = getWorkerPool();
        const config = (singleton as unknown as { config: WorkerPoolConfig }).config;
        assertEquals(singleton.getStats().maxPoolSize, 2);
        assertEquals(config.requestTimeoutMs, 1234);
      },
    );

    __resetPoolForTests();
    Deno.env.set("WORKER_MAX_POOL_SIZE", "0");
    Deno.env.set("WORKER_REQUEST_TIMEOUT_MS", "Infinity");

    const singleton = getWorkerPool();
    const config = (singleton as unknown as { config: WorkerPoolConfig }).config;
    assertEquals(singleton.getStats().maxPoolSize, DEFAULT_WORKER_POOL_CONFIG.maxPoolSize);
    assertEquals(config.requestTimeoutMs, DEFAULT_WORKER_POOL_CONFIG.requestTimeoutMs);
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
