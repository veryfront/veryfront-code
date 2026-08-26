import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import { HOST_PROJECT_EXECUTION_OVERRIDE_ENV } from "#veryfront/security/host-execution-policy.ts";
import { __setCompiledBinaryForTests } from "./isolation-capability.ts";
import type { ProjectWorker, ProjectWorkerOptions } from "./project-worker.ts";
import {
  __resetPoolForTests,
  getWorkerPool,
  isDataIsolationEnabled,
  isSSRIsolationEnabled,
  isWorkerIsolationEnabled,
  WorkerPool,
  type WorkerPoolDependencies,
} from "./worker-pool.ts";
import type {
  ExecuteAppRouteRequest,
  RenderSSRRequest,
  WorkerPoolConfig,
  WorkerRequest,
  WorkerResponse,
} from "./worker-types.ts";
import { DEFAULT_WORKER_POOL_CONFIG, MAX_WORKER_BODY_BYTES } from "./worker-types.ts";
import { WORKER_INTERNAL_EGRESS_OVERRIDE_ENV } from "./worker-egress-guard.ts";
import { resolveWorkerGeneration, snapshotWorkerGenerationIdentity } from "./worker-generation.ts";
import { fromFileUrl, join } from "#veryfront/compat/path";

// Worker isolation only works in Deno (requires Deno Worker permissions API)
const testSuite = isDeno ? describe : describe.skip;
const TEST_SOURCE_INTEGRATION_POLICY = { schemaVersion: 1, mode: "unrestricted" } as const;
const TEST_PREPARED_MODULE = {
  source: "export function GET() { return new Response('ok'); }",
  sha256: "0".repeat(64),
} as const;
const TEST_ISOLATED_SSR_RENDERER_PROVIDER = Object.freeze({
  moduleUrl: new URL(
    "../../../extensions/ext-react-ssr/src/worker-renderer.ts",
    import.meta.url,
  ).href,
  readRootUrls: Object.freeze([
    new URL("../../../extensions/ext-react-ssr/src/", import.meta.url).href,
  ]),
});

interface ControlledWorkerBehavior {
  completeStreamsSynchronously?: boolean;
  notifyIdleOnSubscription?: boolean;
  shutdownCompletion?: Promise<void>;
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
    applicationIdentity: null,
  };
}

/**
 * Narrow a request the pool forwarded to its app-route member.
 *
 * `ControlledWorker.requests` is typed as the whole `WorkerRequest` union, so
 * `projectDir` / `projectEnv` are only reachable once the discriminant is
 * pinned. Failing here is itself part of the contract: the pool must hand the
 * worker the exact request shape it was given.
 */
function appRouteRequest(request: WorkerRequest | undefined): ExecuteAppRouteRequest {
  if (request?.type !== "execute-app-route") {
    throw new Error(
      `the pool must forward the execute-app-route request it was given; received ${
        request?.type ?? "no request"
      }`,
    );
  }
  return request;
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
  readonly allowInternalEgress: boolean | undefined;
  readonly permissions: ProjectWorkerOptions["permissions"];
  readonly isolatedSsrRendererModuleUrl: string | undefined;
  status: "idle" | "busy" | "crashed" | "terminated" = "idle";
  readonly requests: WorkerRequest[] = [];
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
  private shutdownPromise: Promise<void> | null = null;

  constructor(
    options: ProjectWorkerOptions,
    behavior: ControlledWorkerBehavior = {},
  ) {
    this.projectId = options.projectId;
    this.allowInternalEgress = options.allowInternalEgress;
    this.permissions = options.permissions;
    this.isolatedSsrRendererModuleUrl = options.isolatedSsrRendererModuleUrl;
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
    this.requests.push(request);
    this.requestCount++;
    this.status = "busy";
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
    });
  }

  executeStream(request: WorkerRequest): ReadableStream<Uint8Array> {
    this.requests.push(request);
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

  reject(id: string, error: Error): void {
    const pending = this.pending.get(id);
    assertExists(pending, `request "${id}" must be pending`);
    this.pending.delete(id);
    this.updateIdle();
    pending.reject(error);
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
    void this.shutdown();
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.behavior.shutdownCompletion ?? Promise.resolve();
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
    return this.shutdownPromise;
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
  dependencies: Pick<
    WorkerPoolDependencies,
    "getHeapUsedPercent" | "resolveIsolatedSsrRendererProvider"
  > = {},
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
      resolveIsolatedSsrRendererProvider: () => TEST_ISOLATED_SSR_RENDERER_PROVIDER,
      ...dependencies,
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

  afterEach(async () => {
    await pool.shutdown();
  });

  it("creates a worker for a new project", () => {
    const worker = pool.getOrCreateWorker("project-a", []);
    assertExists(worker);
    assertEquals(worker.projectId, "project-a");

    const stats = pool.getStats();
    assertEquals(stats.poolSize, 1);
  });

  it("passes the resolved internal-egress decision to every worker", async () => {
    const controlled = createControlledPool(
      { allowInternalEgress: true } as Partial<WorkerPoolConfig>,
    );
    await pool.shutdown();
    pool = controlled.pool;

    const worker = pool.getOrCreateWorker("internal-egress-project", []);
    assertEquals(
      (worker as unknown as ControlledWorker).allowInternalEgress,
      true,
    );
  });

  it("blocks internal egress for workers when the host decision is off", async () => {
    const blocked = createControlledPool(
      { allowInternalEgress: false } as Partial<WorkerPoolConfig>,
    );
    await pool.shutdown();
    pool = blocked.pool;

    const blockedWorker = pool.getOrCreateWorker("blocked-egress-project", []);
    assertEquals(
      (blockedWorker as unknown as ControlledWorker).allowInternalEgress,
      false,
      "a worker must inherit a blocked internal-egress decision from the pool config",
    );

    const defaulted = createControlledPool();
    await pool.shutdown();
    pool = defaulted.pool;

    const defaultedWorker = pool.getOrCreateWorker("default-egress-project", []);
    assertEquals(
      (defaultedWorker as unknown as ControlledWorker).allowInternalEgress,
      false,
      "an omitted internal-egress decision must normalize to blocked",
    );
  });

  it("does not resolve the isolated SSR provider for API admission", async () => {
    let resolverCalls = 0;
    const controlled = createControlledPool({}, {}, {
      resolveIsolatedSsrRendererProvider: () => {
        resolverCalls++;
        throw new Error("API admission must not resolve the SSR extension");
      },
    });
    await pool.shutdown();
    pool = controlled.pool;

    const pending = pool.execute("api-only", ["/tmp"], makeRequest("api-request"));
    const worker = latestWorker(controlled.workers, "api-only");
    worker.complete("api-request");
    assertEquals((await pending).type, "result");
    assertEquals(resolverCalls, 0);
    assertEquals(worker.isolatedSsrRendererModuleUrl, undefined);
  });

  it("rejects malformed isolated SSR provider accessors without executing them", async () => {
    let getterCalls = 0;
    const malformedProvider = Object.defineProperties({}, {
      moduleUrl: {
        enumerable: true,
        get() {
          getterCalls++;
          return TEST_ISOLATED_SSR_RENDERER_PROVIDER.moduleUrl;
        },
      },
      readRootUrls: {
        enumerable: true,
        value: TEST_ISOLATED_SSR_RENDERER_PROVIDER.readRootUrls,
      },
    });
    const controlled = createControlledPool({}, {}, {
      resolveIsolatedSsrRendererProvider: () => malformedProvider,
    });
    await pool.shutdown();
    pool = controlled.pool;

    assertThrows(
      () => pool.executeStream("ssr-malformed", ["/tmp"], makeSSRRequest("ssr-request")),
      TypeError,
      "moduleUrl must be a data property",
    );
    assertEquals(getterCalls, 0);
    assertEquals(pool.getStats().poolSize, 0);
  });

  it("adds canonical extension read roots and module URL only to SSR workers", async () => {
    const controlled = createControlledPool();
    await pool.shutdown();
    pool = controlled.pool;
    const projectRoot = Deno.makeTempDirSync({
      prefix: "vf-worker-permissions-project-",
    });

    try {
      const stream = pool.executeStream(
        "ssr-permissions",
        [projectRoot],
        makeSSRRequest("ssr-permissions-request", {
          pageModulePath: join(projectRoot, "page.tsx"),
        }),
      );
      const worker = latestWorker(controlled.workers, "ssr-permissions");
      const readPermissions = worker.permissions.read;
      assert(Array.isArray(readPermissions));
      assert(
        TEST_ISOLATED_SSR_RENDERER_PROVIDER.readRootUrls.every((rootUrl) =>
          readPermissions.includes(Deno.realPathSync(fromFileUrl(rootUrl)))
        ),
      );
      assertEquals(
        worker.isolatedSsrRendererModuleUrl,
        TEST_ISOLATED_SSR_RENDERER_PROVIDER.moduleUrl,
      );

      worker.completeStream("ssr-permissions-request");
      await new Response(stream).arrayBuffer();
    } finally {
      Deno.removeSync(projectRoot, { recursive: true });
    }
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

  it("shutdown is single-flight and waits for every worker to quiesce", async () => {
    const gate = deferred<void>();
    const controlled = createControlledPool({}, { shutdownCompletion: gate.promise });
    await pool.shutdown();
    pool = controlled.pool;
    pool.getOrCreateWorker("project-a", []);
    pool.getOrCreateWorker("project-b", []);

    const first = pool.shutdown();
    const second = pool.shutdown();
    assert(first === second);
    assertEquals(pool.getStats().poolSize, 0);
    assertEquals(latestWorker(controlled.workers, "project-a").terminateCalls, 1);
    assertEquals(latestWorker(controlled.workers, "project-b").terminateCalls, 1);

    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await Promise.resolve();
    assertEquals(settled, false);

    gate.resolve();
    await first;
    assertEquals(settled, true);
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
          applicationIdentity: null,
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

testSuite("WorkerPool - worker request forwarding", () => {
  let pool: WorkerPool;

  afterEach(async () => {
    await pool?.shutdown();
  });

  it("execute-app-route request includes projectDir", async () => {
    const controlled = createControlledPool();
    pool = controlled.pool;

    const pending = pool.execute("test-proj", ["/tmp"], makeRequest("dir-1"));
    const worker = latestWorker(controlled.workers, "test-proj");
    worker.complete("dir-1");
    await pending;

    assertEquals(
      appRouteRequest(worker.requests[0]).projectDir,
      "/tmp",
      "the pool must forward projectDir to the worker request",
    );
  });

  it("execute-app-route request accepts projectEnv", async () => {
    const controlled = createControlledPool();
    pool = controlled.pool;

    const pending = pool.execute(
      "test-proj",
      ["/tmp"],
      makeRequest("env-1", { TENANT: "a" }),
    );
    const worker = latestWorker(controlled.workers, "test-proj");
    worker.complete("env-1");
    await pending;

    assertEquals(
      appRouteRequest(worker.requests[0]).projectEnv,
      { TENANT: "a" },
      "the pool must forward projectEnv to the worker request",
    );
  });
});

testSuite("WorkerPool - bounded admission and retirement", () => {
  let pool: WorkerPool;

  afterEach(async () => {
    await pool?.shutdown();
  });

  it("rejects same-worker requests at the active ceiling and admits after settlement", async () => {
    const controlled = createControlledPool();
    pool = controlled.pool;

    const first = pool.execute("scope-a", ["/tmp"], makeRequest("a-1"));
    const workerA = latestWorker(controlled.workers, "scope-a");

    const overload = await assertRejects(
      () => pool.execute("scope-a", ["/tmp"], makeRequest("a-2")),
      VeryfrontError,
      "active request capacity reached",
    );
    assert(overload instanceof VeryfrontError);
    assertEquals(overload.slug, "service-overloaded");
    assertEquals(workerA.requestCount, 1);
    assertEquals(pool.getStats().workers["scope-a"]?.activeRequests, 1);

    workerA.complete("a-1");
    await first;

    const second = pool.execute("scope-a", ["/tmp"], makeRequest("a-2"));
    assertEquals(workerA.requestCount, 2);
    assertEquals(pool.getStats().workers["scope-a"]?.activeRequests, 1);

    workerA.complete("a-2");
    await second;
    assertEquals(pool.getStats().workers["scope-a"]?.activeRequests, 0);
  });

  it("releases same-worker capacity after the worker request rejects", async () => {
    const controlled = createControlledPool();
    pool = controlled.pool;

    const failed = pool.execute("scope-a", ["/tmp"], makeRequest("a-1"));
    const workerA = latestWorker(controlled.workers, "scope-a");
    await assertRejects(
      () => pool.execute("scope-a", ["/tmp"], makeRequest("a-2")),
      VeryfrontError,
      "active request capacity reached",
    );

    workerA.reject("a-1", new Error("worker request failed"));
    await assertRejects(() => failed, Error, "worker request failed");

    const retry = pool.execute("scope-a", ["/tmp"], makeRequest("a-2"));
    workerA.complete("a-2");
    assertEquals((await retry).type, "result");
    assertEquals(pool.getStats().workers["scope-a"]?.activeRequests, 0);
  });

  it("holds the active ceiling for streams until worker protocol settlement", async () => {
    const controlled = createControlledPool();
    pool = controlled.pool;

    const stream = pool.executeStream("scope-a", ["/tmp"], makeSSRRequest("stream-a"));
    const workerA = latestWorker(controlled.workers, "scope-a");

    assertThrows(
      () => pool.executeStream("scope-a", ["/tmp"], makeSSRRequest("stream-b")),
      VeryfrontError,
      "active request capacity reached",
    );

    workerA.completeStream("stream-a", [new Uint8Array([4, 2])]);
    assertEquals(pool.getStats().workers["scope-a"]?.activeRequests, 0);

    const admitted = pool.executeStream(
      "scope-a",
      ["/tmp"],
      makeSSRRequest("stream-b"),
    );
    assertEquals(latestWorker(controlled.workers, "scope-a"), workerA);
    workerA.completeStream("stream-b");
    await new Response(admitted).arrayBuffer();
    assertEquals(
      new Uint8Array(await new Response(stream).arrayBuffer()),
      new Uint8Array([4, 2]),
    );
  });

  it("replaces an idle SSR-capable generation before API admission", async () => {
    let rendererResolverCalls = 0;
    const controlled = createControlledPool({}, {}, {
      resolveIsolatedSsrRendererProvider: () => {
        rendererResolverCalls++;
        return TEST_ISOLATED_SSR_RENDERER_PROVIDER;
      },
    });
    pool = controlled.pool;

    const stream = pool.executeStream("scope-a", ["/tmp"], makeSSRRequest("stream-a"));
    const rendererWorker = latestWorker(controlled.workers, "scope-a");
    rendererWorker.completeStream("stream-a");
    await new Response(stream).arrayBuffer();

    const api = pool.execute("scope-a", ["/tmp"], makeRequest("api-a"));
    const apiWorker = latestWorker(controlled.workers, "scope-a");
    assert(apiWorker !== rendererWorker);
    assertEquals(rendererWorker.terminateCalls, 1);
    assertEquals(apiWorker.isolatedSsrRendererModuleUrl, undefined);
    assertEquals(rendererResolverCalls, 1);
    apiWorker.complete("api-a");
    await api;
  });

  it("validates every direct pool resource and timer boundary", () => {
    const invalidConfigs: Array<Partial<WorkerPoolConfig>> = [
      { maxPoolSize: 0 },
      { idleTimeoutMs: -1 },
      { requestTimeoutMs: 0 },
      { healthCheckIntervalMs: 0 },
      { maxRequestsPerWorker: 0 },
      { maxWorkerAgeMs: -1 },
    ];

    for (const config of invalidConfigs) {
      assertThrows(
        () => new WorkerPool(config),
        TypeError,
        "Worker pool",
      );
    }
  });

  it("rejects unknown, inherited, and accessor-backed pool options", () => {
    let getterCalls = 0;
    const accessorConfig = {} as Record<string, unknown>;
    Object.defineProperty(accessorConfig, "maxPoolSize", {
      enumerable: true,
      get() {
        getterCalls++;
        return 1;
      },
    });

    assertThrows(
      () => new WorkerPool({ unknown: true } as never),
      TypeError,
      "unsupported option",
    );
    assertThrows(
      () => new WorkerPool(Object.create({ maxPoolSize: 1 })),
      TypeError,
      "plain object",
    );
    assertThrows(
      () => new WorkerPool(accessorConfig as Partial<WorkerPoolConfig>),
      TypeError,
      "own data property",
    );
    assertEquals(getterCalls, 0);
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

  it("keeps project env changes request-owned without replacing the worker", async () => {
    const controlled = createControlledPool({ maxPoolSize: 1 });
    pool = controlled.pool;

    const active = pool.execute(
      "scope-a",
      ["/tmp"],
      makeRequest("a-1", { PROJECT_SECRET_A: "one" }),
    );
    const workerA = latestWorker(controlled.workers, "scope-a");

    workerA.complete("a-1");
    await active;

    const second = pool.execute(
      "scope-a",
      ["/tmp"],
      makeRequest("a-2", { PROJECT_SECRET_B: "two" }),
    );
    assertEquals(latestWorker(controlled.workers, "scope-a"), workerA);
    assertEquals(pool.getStats().workers["scope-a"]?.retiring, false);
    workerA.complete("a-2");
    await second;
    assertEquals(workerA.terminateCalls, 0);
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

  it("does not include tenant identifiers or module paths in boundary logs", async () => {
    const projectId = "tenant-private-identifier-97";
    const modulePath = "/tmp/private-module-name-53/route.ts";
    const originalWarn = console.warn;
    let output = "";
    console.warn = (...args: unknown[]) => {
      output += args.map(String).join(" ");
    };

    try {
      const controlled = createControlledPool();
      pool = controlled.pool;
      await assertRejects(
        () =>
          pool.execute(
            projectId,
            ["/tmp/allowed-project"],
            makeRequest("redacted-log", undefined, modulePath),
          ),
        VeryfrontError,
        "outside the allowed project boundary",
      );
    } finally {
      console.warn = originalWarn;
    }

    assertEquals(output.includes(projectId), false);
    assertEquals(output.includes(modulePath), false);
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

    assertInstanceOf(error, VeryfrontError);
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

  it("retries one serialized prepared request after capacity rollover", async () => {
    const controlled = createControlledPool({ maxPoolSize: 1 });
    pool = controlled.pool;

    const execution = pool.execute("scope-a", ["/tmp"], makeRequest("a-1"));
    const workerA = latestWorker(controlled.workers, "scope-a");

    workerA.reachPreparedModuleCapacity("a-1");

    await waitForWorkerGeneration(controlled.workers, "scope-a", 2);
    const workerB = latestWorker(controlled.workers, "scope-a");
    assert(workerB !== workerA);
    assertEquals(workerA.terminateCalls, 1);

    workerB.complete("a-1");
    assertEquals((await execution).type, "result");
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

  it("retires a live worker that fails its health ping", async () => {
    const controlled = createControlledPool();
    pool = controlled.pool;

    pool.getOrCreateWorker("scope-a", []);
    const workerA = latestWorker(controlled.workers, "scope-a");
    workerA.healthCheckResult = false;

    await runHealthCheck(pool);

    assertEquals(workerA.healthCheckCalls, 1, "an idle worker must be pinged");
    assertEquals(
      workerA.terminateCalls,
      1,
      "a worker that fails its health ping must be terminated",
    );
    assertEquals(
      pool.getStats().workers["scope-a"],
      undefined,
      "a worker that failed its health ping must not stay in the pool",
    );

    pool.getOrCreateWorker("scope-b", []);
    const workerB = latestWorker(controlled.workers, "scope-b");
    workerB.healthCheckResult = Promise.reject(new Error("health ping transport failed"));
    await runHealthCheck(pool);

    assertEquals(
      workerB.terminateCalls,
      1,
      "a health ping that throws must retire the worker as well",
    );
    assertEquals(
      pool.getStats().workers["scope-b"],
      undefined,
      "a worker whose health ping threw must not stay in the pool",
    );
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

  it("evicts an exact API scope and only its framed generation keys", async () => {
    const controlled = createControlledPool({ maxPoolSize: 8 });
    pool = controlled.pool;
    const scope = "scope-a";
    const nestedScope = `${scope}:generation:nested`;
    const busyGeneration = (await resolveWorkerGeneration(
      "api",
      snapshotWorkerGenerationIdentity(scope, "release-busy"),
    )).workerId;
    const idleGeneration = (await resolveWorkerGeneration(
      "api",
      snapshotWorkerGenerationIdentity(scope, "release-idle"),
    )).workerId;
    const nestedGeneration = (await resolveWorkerGeneration(
      "api",
      snapshotWorkerGenerationIdentity(nestedScope, "release-nested"),
    )).workerId;
    const unrelatedGeneration = (await resolveWorkerGeneration(
      "api",
      snapshotWorkerGenerationIdentity("scope-a-other", "release-other"),
    )).workerId;
    const malformedGeneration = `${scope}:generation:${"z".repeat(64)}`;

    pool.getOrCreateWorker(scope, []);
    pool.getOrCreateWorker(idleGeneration, []);
    pool.getOrCreateWorker(nestedGeneration, []);
    pool.getOrCreateWorker(unrelatedGeneration, []);
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
    assertExists(duringRetirement.workers[nestedGeneration]);
    assertExists(duringRetirement.workers[unrelatedGeneration]);
    assertExists(duringRetirement.workers[malformedGeneration]);
    assertEquals(busyWorker.terminateCalls, 0);

    busyWorker.complete("generation-1");
    await active;
    assertEquals(busyWorker.terminateCalls, 1);
    assertEquals(pool.getStats().workers[busyGeneration], undefined);
  });

  it("does not interpret unframed worker keys as generation identities", () => {
    const controlled = createControlledPool({ maxPoolSize: 4 });
    pool = controlled.pool;
    const scope = "api:scope";
    const nestedScope = `${scope}:generation:nested`;
    const generation = `${scope}:generation:${"a".repeat(64)}`;
    const nestedGeneration = `${nestedScope}:generation:${"b".repeat(64)}`;

    pool.getOrCreateWorker(generation, []);
    pool.getOrCreateWorker(nestedGeneration, []);

    pool.evictWorkerScope(scope);

    assertExists(pool.getStats().workers[generation]);
    assertExists(pool.getStats().workers[nestedGeneration]);
  });

  it("replaces crashed and timed-out terminal generations without stale cleanup", () => {
    const controlled = createControlledPool();
    pool = controlled.pool;

    const crashed = pool.getOrCreateWorker("scope-crash", []);
    const crashedControl = latestWorker(controlled.workers, "scope-crash");
    crashedControl.becomeTerminal("crashed");
    const afterCrash = pool.getOrCreateWorker("scope-crash", []);
    assert(afterCrash !== crashed);
    assertEquals(crashedControl.terminateCalls, 1);

    const timedOut = pool.getOrCreateWorker("scope-timeout", []);
    const timedOutControl = latestWorker(controlled.workers, "scope-timeout");
    timedOutControl.becomeTerminal("terminated");
    const afterTimeout = pool.getOrCreateWorker("scope-timeout", []);
    assert(afterTimeout !== timedOut);
    assertEquals(timedOutControl.terminateCalls, 1);
  });

  it("retires only idle workers when real host heap pressure is high", async () => {
    const controlled = createControlledPool(
      { maxPoolSize: 5 },
      {},
      { getHeapUsedPercent: () => 75 },
    );
    pool = controlled.pool;

    // The busy worker is created first so it is also the least recently used,
    // which is exactly the entry the eviction sort would reach for first.
    const active = pool.execute("scope-busy", ["/tmp"], makeRequest("busy-1"));
    const busyWorker = latestWorker(controlled.workers, "scope-busy");
    for (const scope of ["scope-a", "scope-b", "scope-c", "scope-d"]) {
      pool.getOrCreateWorker(scope, ["/tmp"]);
    }

    await runHealthCheck(pool);

    assertEquals(
      busyWorker.terminateCalls,
      0,
      "host heap pressure must never terminate a worker with an in-flight tenant request",
    );
    assertEquals(
      pool.getStats().workers["scope-busy"]?.retiring,
      false,
      "the busy least-recently-used worker must not be marked retiring under heap pressure",
    );
    assertEquals(
      pool.getStats().poolSize,
      4,
      "only one of the four idle workers may be retired",
    );
    const terminated = [...controlled.workers.values()]
      .flat()
      .filter((worker) => worker.terminateCalls === 1);
    assertEquals(terminated.length, 1, "only idle workers may be retired");

    busyWorker.complete("busy-1");
    await active;
  });
});

describe("MAX_WORKER_BODY_BYTES", () => {
  it("is exported as 10 MB", () => {
    assertEquals(MAX_WORKER_BODY_BYTES, 10 * 1024 * 1024);
  });
});

describe("worker pool defaults", () => {
  it("publishes an immutable host policy", () => {
    assertEquals(Object.isFrozen(DEFAULT_WORKER_POOL_CONFIG), true);
    assertThrows(
      () => {
        (DEFAULT_WORKER_POOL_CONFIG as { maxPoolSize: number }).maxPoolSize = 1;
      },
      TypeError,
    );
    assertEquals(DEFAULT_WORKER_POOL_CONFIG.maxPoolSize, 20);
  });
});

describe("worker pool test reset", () => {
  afterEach(async () => {
    await __resetPoolForTests();
  });

  it("does not resolve before the detached singleton is quiescent", async () => {
    await __resetPoolForTests();
    const singleton = getWorkerPool();
    const shutdown = singleton.shutdown.bind(singleton);
    const gate = deferred<void>();
    let shutdownCalls = 0;

    singleton.shutdown = async () => {
      shutdownCalls++;
      await gate.promise;
      await shutdown();
    };

    const reset = __resetPoolForTests();
    let settled = false;
    void reset.then(() => {
      settled = true;
    });

    try {
      await Promise.resolve();
      assertEquals(shutdownCalls, 1);
      assertEquals(settled, false);
    } finally {
      gate.resolve();
      await reset;
    }
    assertEquals(settled, true);
  });
});

describe("Feature flag caching", () => {
  afterEach(async () => {
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
    try {
      Deno.env.delete(HOST_PROJECT_EXECUTION_OVERRIDE_ENV);
    } catch { /* ok */ }
    __setCompiledBinaryForTests(undefined);
    await __resetPoolForTests();
  });

  describe("when the runtime cannot prepare an isolated API module", () => {
    it("keeps WORKER_ISOLATION_API set under a broad host-execution grant", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      Deno.env.set(HOST_PROJECT_EXECUTION_OVERRIDE_ENV, "1");
      __setCompiledBinaryForTests(true);
      await __resetPoolForTests();

      assertEquals(isWorkerIsolationEnabled(), true);
    });

    it("keeps WORKER_ISOLATION_API set when host execution is not granted", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __setCompiledBinaryForTests(true);
      await __resetPoolForTests();

      // Fails closed; must never become host-realm execution.
      assertEquals(isWorkerIsolationEnabled(), true);
    });

    it("does not downgrade when the runtime can prepare an isolated module", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      Deno.env.set(HOST_PROJECT_EXECUTION_OVERRIDE_ENV, "1");
      __setCompiledBinaryForTests(false);
      await __resetPoolForTests();

      assertEquals(isWorkerIsolationEnabled(), true);
    });

    it("keeps API and data isolation, which use different transports", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      Deno.env.set(HOST_PROJECT_EXECUTION_OVERRIDE_ENV, "1");
      __setCompiledBinaryForTests(true);
      await __resetPoolForTests();

      assertEquals(isWorkerIsolationEnabled(), true);
      assertEquals(isDataIsolationEnabled(), true);
    });

    it("does not enable API isolation that was never requested", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set(HOST_PROJECT_EXECUTION_OVERRIDE_ENV, "1");
      __setCompiledBinaryForTests(true);
      await __resetPoolForTests();

      assertEquals(isWorkerIsolationEnabled(), false);
    });
  });

  it("returns false when master switch is off", async () => {
    await __resetPoolForTests();
    assertEquals(isWorkerIsolationEnabled(), false);
    assertEquals(isDataIsolationEnabled(), false);
    assertEquals(isSSRIsolationEnabled(), false);
  });

  it("returns true for API isolation when both flags set", async () => {
    await __resetPoolForTests();
    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    Deno.env.set("WORKER_ISOLATION_API", "1");
    assertEquals(isWorkerIsolationEnabled(), true);
  });

  it("returns true for data isolation when both flags set", async () => {
    await __resetPoolForTests();
    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    Deno.env.set("WORKER_ISOLATION_DATA", "1");
    assertEquals(isDataIsolationEnabled(), true);
  });

  it("returns true for SSR isolation when both flags set", async () => {
    await __resetPoolForTests();
    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    Deno.env.set("WORKER_ISOLATION_SSR", "1");
    assertEquals(isSSRIsolationEnabled(), true);
  });

  it("caches flag results across calls", async () => {
    await __resetPoolForTests();
    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    Deno.env.set("WORKER_ISOLATION_API", "1");
    assertEquals(isWorkerIsolationEnabled(), true);

    // Changing env after first read should not change cached result
    Deno.env.delete("WORKER_ISOLATION_API");
    assertEquals(isWorkerIsolationEnabled(), true);
  });

  it("ignores malicious project overlays for host isolation policy", async () => {
    await __resetPoolForTests();
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

    await __resetPoolForTests();
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

  it("ignores project overlays and applies host pool limits", async () => {
    await __resetPoolForTests();
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
  });

  it("snapshots the host internal-egress decision when the singleton resolves", async () => {
    await __resetPoolForTests();
    Deno.env.set(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV, "1");
    try {
      const first = getWorkerPool();
      const firstConfig = (first as unknown as {
        config: WorkerPoolConfig & { allowInternalEgress?: boolean };
      }).config;
      assertEquals(firstConfig.allowInternalEgress, true);

      Deno.env.set(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV, "0");
      assertEquals(getWorkerPool(), first);
      assertEquals(firstConfig.allowInternalEgress, true);

      await __resetPoolForTests();
      const second = getWorkerPool();
      const secondConfig = (second as unknown as {
        config: WorkerPoolConfig & { allowInternalEgress?: boolean };
      }).config;
      assertEquals(secondConfig.allowInternalEgress, false);
    } finally {
      await __resetPoolForTests();
      Deno.env.delete(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV);
    }
  });

  it("fails closed for invalid host pool limits", async () => {
    for (
      const [name, value] of [
        ["WORKER_MAX_POOL_SIZE", "0"],
        ["WORKER_REQUEST_TIMEOUT_MS", "Infinity"],
      ] as const
    ) {
      await __resetPoolForTests();
      Deno.env.set(name, value);
      try {
        assertThrows(
          () => getWorkerPool(),
          RangeError,
          `${name} must be a positive safe integer`,
        );
      } finally {
        Deno.env.delete(name);
      }
    }
  });

  it("fails closed for invalid host isolation flags", async () => {
    await __resetPoolForTests();
    Deno.env.set("WORKER_ISOLATION_ENABLED", "treu");

    assertThrows(
      () => isWorkerIsolationEnabled(),
      TypeError,
      "WORKER_ISOLATION_ENABLED must be one of",
    );
  });

  it("__resetPoolForTests clears cached flags", async () => {
    await __resetPoolForTests();
    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    Deno.env.set("WORKER_ISOLATION_API", "1");
    assertEquals(isWorkerIsolationEnabled(), true);

    await __resetPoolForTests();
    try {
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
    } catch { /* ok */ }
    try {
      Deno.env.delete("WORKER_ISOLATION_API");
    } catch { /* ok */ }
    assertEquals(isWorkerIsolationEnabled(), false);
  });
});
