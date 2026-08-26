/**
 * Worker Pool Manager
 *
 * Manages a bounded pool of per-project Deno Workers for tenant-isolated code
 * execution. Idle workers may be evicted using LRU ordering; active workers are
 * never terminated to admit different work. When every slot is active, new
 * admissions fail explicitly with SERVICE_OVERLOADED.
 *
 * Deno Workers share the host process. Retiring a worker is useful lifecycle
 * hygiene, but it is not a hard memory-containment boundary for retained ESM
 * state or arbitrary top-level allocations. Hard limits require a separate
 * process or container with an enforced memory limit.
 *
 * @module security/sandbox/worker-pool
 */

import { serverLogger } from "#veryfront/utils";
import { getHeapStats } from "#veryfront/utils/memory/index.ts";
import { getHostEnv, unrefTimer } from "#veryfront/platform/compat/process.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SECURITY_VIOLATION, SERVICE_OVERLOADED } from "#veryfront/errors";
import { basename, dirname, resolve as resolvePath } from "#veryfront/compat/path";
import { fromFileUrl, toFileUrl } from "#veryfront/compat/path";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";
import { isHostProjectExecutionOverrideConfigured } from "#veryfront/security/host-execution-policy.ts";
import { resolve as resolveExtensionContract } from "#veryfront/extensions/contracts.ts";
import {
  IsolatedSsrRendererProviderName,
  snapshotIsolatedSsrRendererProvider,
} from "#veryfront/extensions/rendering/index.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { ProjectWorker, type ProjectWorkerOptions } from "./project-worker.ts";
import {
  isInternalEgressOverrideEnabled,
  WORKER_INTERNAL_EGRESS_OVERRIDE_ENV,
} from "./worker-egress-guard.ts";
import { isWorkerGenerationInScope } from "./worker-generation.ts";
import { buildWorkerPermissions } from "./worker-permissions.ts";
import {
  isIsolatedApiPreparationSupported,
  ISOLATED_API_PREPARATION_UNSUPPORTED_REASON,
} from "./isolation-capability.ts";
import type {
  RenderSSRRequest,
  WorkerPoolConfig,
  WorkerRequest,
  WorkerResponse,
} from "./worker-types.ts";
import { DEFAULT_WORKER_POOL_CONFIG } from "./worker-types.ts";

const logger = serverLogger.component("worker-pool");
const apply = Reflect.apply;
const stringToLowerCase = String.prototype.toLowerCase;
const stringTrim = String.prototype.trim;
const numberFromString = Number;
const numberIsSafeInteger = Number.isSafeInteger;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const SERIALIZED_WORKER_REQUEST_CAPACITY = 1;
const HOST_HEAP_EVICTION_THRESHOLD_PERCENT = 70;
const HOST_HEAP_EVICTION_FRACTION = 0.25;
const WORKER_POOL_CONFIG_KEYS = new Set([
  "maxPoolSize",
  "idleTimeoutMs",
  "requestTimeoutMs",
  "healthCheckIntervalMs",
  "maxRequestsPerWorker",
  "maxWorkerAgeMs",
  "allowInternalEgress",
]);
const nativeRealPathSync = typeof Deno !== "undefined" &&
    typeof Deno.realPathSync === "function"
  ? Deno.realPathSync.bind(Deno)
  : undefined;

interface PoolEntry {
  worker: ProjectWorker;
  lastAccessedAt: number;
  createdAt: number;
  readPaths: string[];
  rendererModuleUrl: string | null;
  activeRequests: number;
  retirementRequested: boolean;
  retirementReason?: string;
  releaseIdleListener: () => void;
  shutdown: Promise<void> | null;
  healthCheckInFlight: boolean;
  preparedModuleCapacityReached: boolean;
  retired: Promise<void>;
  resolveRetired: () => void;
  retirementSettled: boolean;
}

type ResolvedWorkerPoolConfig = Required<WorkerPoolConfig>;

/** @internal Construction seam for deterministic lifecycle tests. */
export interface WorkerPoolDependencies {
  /**
   * Test/integration seam for constructing the managed worker. Production uses
   * ProjectWorker directly.
   */
  createWorker?: (options: ProjectWorkerOptions) => ProjectWorker;
  /** Test seam for deterministic host-memory pressure behavior. */
  getHeapUsedPercent?: () => number;
  /** Test seam for the extension contract resolved only on SSR admission. */
  resolveIsolatedSsrRendererProvider?: () => unknown;
}

interface IsolatedSsrRendererAdmission {
  readonly moduleUrl: string;
  readonly readPaths: readonly string[];
}

function canonicalizePath(path: string): string {
  const resolved = resolvePath(path);
  if (!nativeRealPathSync) return resolved;

  const unresolvedSegments: string[] = [];
  let candidate = resolved;

  while (true) {
    try {
      const physicalAncestor = nativeRealPathSync(candidate);
      return resolvePath(physicalAncestor, ...unresolvedSegments);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    const rawParent = dirname(candidate);
    const parent = /^[A-Za-z]:$/.test(rawParent) && /^[A-Za-z]:\//.test(candidate)
      ? `${rawParent}/`
      : rawParent;
    if (parent === candidate) return resolved;

    const segment = basename(candidate);
    if (!segment || segment === "." || segment === "..") return resolved;
    unresolvedSegments.unshift(segment);
    candidate = parent;
  }
}

function getHostEnvBoolean(key: string, fallback = false): boolean {
  const value = getHostEnv(key);
  if (value === undefined) return fallback;

  const trimmed = apply(stringTrim, value, []);
  const normalized = apply(stringToLowerCase, trimmed, []);
  switch (normalized) {
    case "1":
    case "true":
    case "yes":
      return true;
    case "0":
    case "false":
    case "no":
      return false;
    default:
      throw new TypeError(
        `${key} must be one of 1, 0, true, false, yes, or no`,
      );
  }
}

function getHostEnvInteger(
  key: string,
  fallback: number,
  maximum = MAX_SAFE_INTEGER,
): number {
  const value = getHostEnv(key);
  if (value === undefined) return fallback;

  const parsed = numberFromString(value);
  if (
    !numberIsSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > maximum
  ) {
    throw new RangeError(
      `${key} must be a positive safe integer no greater than ${maximum}`,
    );
  }
  return parsed;
}

function requirePositivePoolInteger(
  name: string,
  value: unknown,
  maximum = MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !numberIsSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new TypeError(
      `Worker pool ${name} must be a positive safe integer no greater than ${maximum}`,
    );
  }
  return value;
}

function requireNonNegativePoolInteger(
  name: string,
  value: unknown,
  maximum = MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !numberIsSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new TypeError(
      `Worker pool ${name} must be a non-negative safe integer no greater than ${maximum}`,
    );
  }
  return value;
}

function valueOrDefault<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

function snapshotWorkerPoolConfig(
  value: unknown,
): Readonly<Partial<WorkerPoolConfig>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Worker pool config must be a plain object");
  }

  let prototype: object | null;
  let keys: Array<string | symbol>;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError("Worker pool config could not be inspected safely");
  }
  if (prototype !== null && prototype !== Object.prototype) {
    throw new TypeError("Worker pool config must be a plain object");
  }

  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string" || !WORKER_POOL_CONFIG_KEYS.has(key)) {
      throw new TypeError(
        `Worker pool config contains an unsupported ${
          typeof key === "string" ? `option: ${key}` : "symbol"
        }`,
      );
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new TypeError(`Worker pool config.${key} could not be inspected safely`);
    }
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`Worker pool config.${key} must be an own data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot) as Readonly<Partial<WorkerPoolConfig>>;
}

function requirePoolBoolean(name: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`Worker pool ${name} must be a boolean`);
  }
  return value;
}

function normalizeReadPaths(paths: Iterable<string | undefined>): string[] {
  const unique = new Set<string>();
  for (const path of paths) {
    if (!path) continue;
    const trimmed = path.trim();
    if (!trimmed) continue;
    unique.add(canonicalizePath(trimmed));
  }

  const canonicalRoots = [...unique].sort((left, right) => {
    if (left.length !== right.length) return left.length - right.length;
    return left < right ? -1 : left > right ? 1 : 0;
  });

  return canonicalRoots.filter((candidate, index) => {
    for (let rootIndex = 0; rootIndex < index; rootIndex++) {
      const root = canonicalRoots[rootIndex];
      if (root && isWithinDirectory(root, candidate)) return false;
    }
    return true;
  });
}

function sameOrderedPaths(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((path, index) => path === right[index]);
}

function captureIsolatedSsrRendererAdmission(value: unknown): IsolatedSsrRendererAdmission {
  const provider = snapshotIsolatedSsrRendererProvider(value);
  let modulePath: string;
  let readPaths: string[];
  try {
    modulePath = canonicalizePath(fromFileUrl(provider.moduleUrl));
    readPaths = normalizeReadPaths(
      provider.readRootUrls.map((rootUrl) => fromFileUrl(rootUrl)),
    );
  } catch (cause) {
    throw new TypeError("Isolated SSR renderer provider contains an invalid local path", {
      cause,
    });
  }

  for (const readPath of readPaths) {
    if (dirname(readPath) === readPath) {
      throw new TypeError("Isolated SSR renderer read roots must not grant filesystem-root access");
    }
    let metadata: Deno.FileInfo;
    try {
      metadata = Deno.statSync(readPath);
    } catch (cause) {
      throw new TypeError("Isolated SSR renderer read root is unavailable", { cause });
    }
    if (!metadata.isDirectory) {
      throw new TypeError("Isolated SSR renderer read roots must be directories");
    }
  }

  let moduleMetadata: Deno.FileInfo;
  try {
    moduleMetadata = Deno.statSync(modulePath);
  } catch (cause) {
    throw new TypeError("Isolated SSR renderer module is unavailable", { cause });
  }
  if (!moduleMetadata.isFile) {
    throw new TypeError("Isolated SSR renderer moduleUrl must identify a file");
  }
  if (!readPaths.some((readPath) => isWithinDirectory(readPath, modulePath))) {
    throw new TypeError("Isolated SSR renderer moduleUrl is outside its declared read roots");
  }

  return Object.freeze({
    moduleUrl: toFileUrl(modulePath).href,
    readPaths: Object.freeze(readPaths),
  });
}

function isPreparedApiRequest(request: WorkerRequest): boolean {
  return request.type === "execute-app-route" ||
    request.type === "execute-pages-route" ||
    request.type === "inspect-api-route-methods";
}

export class WorkerPool {
  private pool = new Map<string, PoolEntry>();
  private workerShutdowns = new Set<Promise<void>>();
  private readonly config: ResolvedWorkerPoolConfig;
  private readonly createWorker: (options: ProjectWorkerOptions) => ProjectWorker;
  private readonly getHeapUsedPercent: () => number;
  private readonly resolveIsolatedSsrRendererProvider: () => unknown;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  private cleanupInterval: ReturnType<typeof setInterval> | undefined;
  private healthCheckInterval: ReturnType<typeof setInterval> | undefined;

  constructor(
    config: Partial<WorkerPoolConfig> = {},
    dependencies: WorkerPoolDependencies = {},
  ) {
    const input = snapshotWorkerPoolConfig(config);
    this.config = {
      maxPoolSize: requirePositivePoolInteger(
        "maxPoolSize",
        valueOrDefault(
          input.maxPoolSize,
          DEFAULT_WORKER_POOL_CONFIG.maxPoolSize,
        ),
      ),
      idleTimeoutMs: requireNonNegativePoolInteger(
        "idleTimeoutMs",
        valueOrDefault(
          input.idleTimeoutMs,
          DEFAULT_WORKER_POOL_CONFIG.idleTimeoutMs,
        ),
        MAX_TIMER_DELAY_MS,
      ),
      requestTimeoutMs: requirePositivePoolInteger(
        "requestTimeoutMs",
        valueOrDefault(
          input.requestTimeoutMs,
          DEFAULT_WORKER_POOL_CONFIG.requestTimeoutMs,
        ),
        MAX_TIMER_DELAY_MS,
      ),
      healthCheckIntervalMs: requirePositivePoolInteger(
        "healthCheckIntervalMs",
        valueOrDefault(
          input.healthCheckIntervalMs,
          DEFAULT_WORKER_POOL_CONFIG.healthCheckIntervalMs,
        ),
        MAX_TIMER_DELAY_MS,
      ),
      maxRequestsPerWorker: requirePositivePoolInteger(
        "maxRequestsPerWorker",
        valueOrDefault(
          input.maxRequestsPerWorker,
          DEFAULT_WORKER_POOL_CONFIG.maxRequestsPerWorker,
        ),
      ),
      maxWorkerAgeMs: requireNonNegativePoolInteger(
        "maxWorkerAgeMs",
        valueOrDefault(
          input.maxWorkerAgeMs,
          DEFAULT_WORKER_POOL_CONFIG.maxWorkerAgeMs,
        ),
        MAX_TIMER_DELAY_MS,
      ),
      allowInternalEgress: requirePoolBoolean(
        "allowInternalEgress",
        valueOrDefault(
          input.allowInternalEgress,
          DEFAULT_WORKER_POOL_CONFIG.allowInternalEgress,
        ),
      ),
    };
    this.createWorker = dependencies.createWorker ?? ((options) => new ProjectWorker(options));
    this.getHeapUsedPercent = dependencies.getHeapUsedPercent ??
      (() => getHeapStats().heapUsedPercent);
    this.resolveIsolatedSsrRendererProvider = dependencies.resolveIsolatedSsrRendererProvider ??
      (() => resolveExtensionContract(IsolatedSsrRendererProviderName));
    this.startCleanup();
    this.startHealthChecks();
  }

  /**
   * Get or create a worker for the given project.
   *
   * This is a low-level lookup without an admission lease. Production request
   * paths should use `execute` or `executeStream` so acquisition and work
   * registration are atomic with respect to eviction.
   */
  getOrCreateWorker(
    projectId: string,
    readPaths: string[],
  ): ProjectWorker {
    return this.getOrCreateWorkerForAdmission(projectId, readPaths);
  }

  private getOrCreateWorkerForAdmission(
    projectId: string,
    readPaths: string[],
    renderer?: IsolatedSsrRendererAdmission,
  ): ProjectWorker {
    if (this.shuttingDown) {
      throw this.createOverloadError("Worker pool is shutting down");
    }

    const normalizedReadPaths = normalizeReadPaths(readPaths);
    const rendererModuleUrl = renderer?.moduleUrl ?? null;
    const existing = this.pool.get(projectId);
    if (existing) {
      const readPathsChanged = !sameOrderedPaths(existing.readPaths, normalizedReadPaths);
      const rendererChanged = existing.rendererModuleUrl !== rendererModuleUrl;

      if (this.isTerminal(existing)) {
        this.requestRetirement(projectId, existing, "terminal");
      } else if (readPathsChanged || rendererChanged) {
        this.requestRetirement(projectId, existing, "read_paths_changed");
        if (this.pool.get(projectId) === existing) {
          throw this.createOverloadError(
            "Worker is finishing active requests before applying changed permissions",
          );
        }
      } else if (existing.retirementRequested) {
        this.tryFinalizeRetirement(projectId, existing);
        if (this.pool.get(projectId) === existing) {
          throw this.createOverloadError(
            "Worker is retiring and cannot accept new requests",
          );
        }
      } else if (this.shouldRecycle(existing)) {
        this.requestRetirement(projectId, existing, this.recycleReason(existing));
        if (this.pool.get(projectId) === existing) {
          throw this.createOverloadError(
            "Worker reached its lifecycle limit and is finishing active requests",
          );
        }
      } else {
        existing.lastAccessedAt = Date.now();
        return existing.worker;
      }
    }

    this.ensureCapacityForAdmission();

    const permissions = buildWorkerPermissions(normalizedReadPaths);
    const worker = this.createWorker({
      projectId,
      permissions,
      requestTimeoutMs: this.config.requestTimeoutMs,
      allowInternalEgress: this.config.allowInternalEgress,
      isolatedSsrRendererModuleUrl: rendererModuleUrl ?? undefined,
    });

    worker.start();

    const now = Date.now();
    let resolveRetired!: () => void;
    const retired = new Promise<void>((resolve) => {
      resolveRetired = resolve;
    });
    const entry: PoolEntry = {
      worker,
      lastAccessedAt: now,
      createdAt: now,
      readPaths: normalizedReadPaths,
      rendererModuleUrl,
      activeRequests: 0,
      retirementRequested: false,
      releaseIdleListener: () => {},
      shutdown: null,
      healthCheckInFlight: false,
      preparedModuleCapacityReached: false,
      retired,
      resolveRetired,
      retirementSettled: false,
    };
    entry.releaseIdleListener = worker.onIdle(() => {
      this.handleWorkerIdle(projectId, entry);
    });
    this.pool.set(projectId, entry);

    logger.debug("Worker created", {
      poolSize: this.pool.size,
    });

    return worker;
  }

  /**
   * Execute a request in a project worker. Convenience method that
   * combines getOrCreateWorker + execute.
   */
  execute(
    projectId: string,
    readPaths: string[],
    request: WorkerRequest,
  ): Promise<WorkerResponse> {
    try {
      this.validateRequestModulePaths(readPaths, request);
    } catch (error) {
      return Promise.reject(error);
    }

    return withSpan(
      "workerPool.execute",
      async () => {
        const renderer = request.type === "render-ssr"
          ? captureIsolatedSsrRendererAdmission(
            this.resolveIsolatedSsrRendererProvider(),
          )
          : undefined;
        const admittedReadPaths = renderer ? [...readPaths, ...renderer.readPaths] : readPaths;
        const canRetryCapacity = isPreparedApiRequest(request);
        let capacityRolloverConsumed = false;

        while (true) {
          const retiringEntry = this.pool.get(projectId);
          if (
            canRetryCapacity &&
            retiringEntry?.preparedModuleCapacityReached
          ) {
            if (capacityRolloverConsumed) {
              throw this.createOverloadError(
                "Prepared API module capacity was reached again after worker rollover",
              );
            }
            capacityRolloverConsumed = true;
            await retiringEntry.retired;
          }

          let entry: PoolEntry;
          try {
            entry = this.admitRequest(projectId, admittedReadPaths, renderer);
          } catch (error) {
            const current = this.pool.get(projectId);
            if (
              canRetryCapacity &&
              !capacityRolloverConsumed &&
              current?.preparedModuleCapacityReached
            ) {
              capacityRolloverConsumed = true;
              await current.retired;
              continue;
            }
            throw error;
          }

          let response: WorkerResponse;
          try {
            response = await entry.worker.execute(request);
            if (response.type === "prepared-module-capacity") {
              this.markPreparedModuleCapacityReached(projectId, entry);
            }
          } finally {
            this.completeRequest(projectId, entry);
          }

          if (response.type !== "prepared-module-capacity") return response;

          if (!canRetryCapacity) {
            throw this.createOverloadError(
              "Worker returned an invalid prepared-module capacity signal",
            );
          }
          if (capacityRolloverConsumed) {
            throw this.createOverloadError(
              "Prepared API module capacity was reached again after worker rollover",
            );
          }

          capacityRolloverConsumed = true;
          await entry.retired;
        }
      },
      { "workerPool.requestType": request.type },
    );
  }

  /**
   * Atomically admit and execute a streaming request.
   *
   * The pool admission is held until the worker protocol completes, or until
   * the consumer cancels or encounters an error. Already-buffered chunks remain
   * readable independently after protocol completion releases the admission.
   * This closes the get-or-create/execute gap for streaming callers.
   */
  executeStream(
    projectId: string,
    readPaths: string[],
    request: RenderSSRRequest,
  ): ReadableStream<Uint8Array> {
    this.validateRequestModulePaths(readPaths, request);
    const renderer = captureIsolatedSsrRendererAdmission(
      this.resolveIsolatedSsrRendererProvider(),
    );
    const entry = this.admitRequest(
      projectId,
      [...readPaths, ...renderer.readPaths],
      renderer,
    );

    let source: ReadableStream<Uint8Array>;
    try {
      source = entry.worker.executeStream(request);
    } catch (error) {
      this.completeRequest(projectId, entry);
      throw error;
    }

    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = source.getReader();
    } catch (error) {
      this.completeRequest(projectId, entry);
      throw error;
    }

    let admissionReleased = false;
    let readerReleased = false;
    let releaseIdleListener = () => {};

    const releaseAdmission = () => {
      if (admissionReleased) return;
      admissionReleased = true;
      releaseIdleListener();
      this.completeRequest(projectId, entry);
    };
    const releaseReader = () => {
      if (readerReleased) return;
      readerReleased = true;
      try {
        reader.releaseLock();
      } catch {
        // A pending read holds the lock until it settles. Admission release is
        // independent and still occurs from the worker-idle signal.
      }
    };

    try {
      const unsubscribe = entry.worker.onIdle(releaseAdmission);
      releaseIdleListener = unsubscribe;

      // A custom source may finish synchronously before listener registration.
      // Also clean up correctly if an onIdle implementation invokes the
      // callback synchronously while it is being registered.
      if (admissionReleased) {
        unsubscribe();
      } else if (!entry.worker.hasPendingRequests) {
        releaseAdmission();
      }
    } catch (error) {
      void reader.cancel(error).catch(() => {});
      releaseAdmission();
      releaseReader();
      throw error;
    }

    try {
      return new ReadableStream<Uint8Array>({
        pull: async (controller) => {
          try {
            const result = await reader.read();
            if (result.done) {
              releaseAdmission();
              releaseReader();
              controller.close();
              return;
            }
            controller.enqueue(result.value);
          } catch (error) {
            releaseAdmission();
            releaseReader();
            controller.error(error);
          }
        },
        cancel: async (reason) => {
          try {
            await reader.cancel(reason);
          } finally {
            releaseAdmission();
            releaseReader();
          }
        },
      });
    } catch (error) {
      void reader.cancel(error).catch(() => {});
      releaseAdmission();
      releaseReader();
      throw error;
    }
  }

  /**
   * Evict a specific project's worker.
   */
  evictWorker(projectId: string): void {
    const entry = this.pool.get(projectId);
    if (!entry) return;

    this.requestRetirement(projectId, entry, "explicit");
  }

  /**
   * Retire every worker belonging to one logical execution scope.
   *
   * Generation ownership is matched using the complete versioned, framed
   * identity, never a raw scope prefix. Busy generations finish their current
   * requests before eviction.
   */
  evictWorkerScope(scopeId: string): void {
    if (!scopeId) return;

    for (const [projectId, entry] of [...this.pool.entries()]) {
      if (
        projectId !== scopeId &&
        !isWorkerGenerationInScope(projectId, scopeId)
      ) {
        continue;
      }
      if (this.pool.get(projectId) !== entry) continue;
      this.requestRetirement(projectId, entry, "scope_eviction");
    }
  }

  /** Get pool statistics for monitoring. */
  getStats(): {
    poolSize: number;
    maxPoolSize: number;
    workers: Record<string, {
      status: string;
      requestCount: number;
      hasPending: boolean;
      activeRequests: number;
      retiring: boolean;
      idleMs: number;
      ageMs: number;
    }>;
  } {
    const workers: Record<string, {
      status: string;
      requestCount: number;
      hasPending: boolean;
      activeRequests: number;
      retiring: boolean;
      idleMs: number;
      ageMs: number;
    }> = {};
    const now = Date.now();

    for (const [id, entry] of this.pool) {
      workers[id] = {
        status: entry.worker.status,
        requestCount: entry.worker.requestCount,
        hasPending: entry.worker.hasPendingRequests,
        activeRequests: entry.activeRequests,
        retiring: entry.retirementRequested,
        idleMs: now - entry.lastAccessedAt,
        ageMs: now - entry.createdAt,
      };
    }

    return {
      poolSize: this.pool.size,
      maxPoolSize: this.config.maxPoolSize,
      workers,
    };
  }

  /**
   * Get aggregate metrics suitable for Prometheus exposition.
   */
  getMetrics(): {
    /** Current number of active workers */
    workerPoolSize: number;
    /** Configured maximum worker count */
    workerPoolCapacity: number;
    /** Total requests processed across all workers */
    totalRequestsProcessed: number;
    /** Number of workers with pending requests (busy) */
    busyWorkers: number;
    /** Number of crashed workers (cleaned up at next health check) */
    crashedWorkers: number;
  } {
    let totalRequests = 0;
    let busy = 0;
    let crashed = 0;

    for (const [, entry] of this.pool) {
      totalRequests += entry.worker.requestCount;
      if (entry.worker.hasPendingRequests) busy++;
      if (entry.worker.status === "crashed") crashed++;
    }

    return {
      workerPoolSize: this.pool.size,
      workerPoolCapacity: this.config.maxPoolSize,
      totalRequestsProcessed: totalRequests,
      busyWorkers: busy,
      crashedWorkers: crashed,
    };
  }

  /**
   * Shutdown the pool and wait for every managed worker to become quiescent.
   * Concurrent calls share one completion promise.
   */
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;

    const completion = Promise.withResolvers<void>();
    this.shutdownPromise = completion.promise;
    this.shuttingDown = true;

    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    this.cleanupInterval = undefined;
    this.healthCheckInterval = undefined;

    const entries = [...this.pool.values()];
    this.pool.clear();
    for (const entry of entries) {
      entry.releaseIdleListener();
      const shutdown = this.terminateEntry(entry);
      void shutdown.then(() => this.settleRetirement(entry));
    }

    void this.drainWorkerShutdowns().then(() => {
      for (const entry of entries) this.settleRetirement(entry);
      logger.debug("Worker pool shut down");
      completion.resolve();
    });
    return completion.promise;
  }

  // -----------------------------------------------------------------------
  // Private — Cleanup & Eviction
  // -----------------------------------------------------------------------

  private startCleanup(): void {
    // Run idle eviction every 30 seconds
    this.cleanupInterval = setInterval(() => {
      this.evictIdleWorkers();
    }, 30_000);

    unrefTimer(this.cleanupInterval);
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      void this.checkHealth();
    }, this.config.healthCheckIntervalMs);

    unrefTimer(this.healthCheckInterval);
  }

  private evictIdleWorkers(): void {
    const now = Date.now();

    for (const [projectId, entry] of [...this.pool.entries()]) {
      if (this.pool.get(projectId) !== entry) continue;

      if (entry.retirementRequested) {
        this.tryFinalizeRetirement(projectId, entry);
        continue;
      }

      const idleTime = now - entry.lastAccessedAt;

      if (idleTime > this.config.idleTimeoutMs && !this.isBusy(entry)) {
        this.requestRetirement(projectId, entry, "idle_timeout");
      }
    }
  }

  private ensureCapacityForAdmission(): void {
    if (this.pool.size < this.config.maxPoolSize) return;

    let lruId: string | undefined;
    let lruEntry: PoolEntry | undefined;
    let lruTime = Infinity;

    for (const [projectId, entry] of this.pool) {
      if (
        (this.isTerminal(entry) || !this.isBusy(entry)) &&
        entry.lastAccessedAt < lruTime
      ) {
        lruTime = entry.lastAccessedAt;
        lruId = projectId;
        lruEntry = entry;
      }
    }

    if (lruId && lruEntry) {
      this.requestRetirement(lruId, lruEntry, "capacity_lru");
    }

    if (this.pool.size >= this.config.maxPoolSize) {
      throw this.createOverloadError(
        `Worker pool capacity reached (${this.pool.size}/${this.config.maxPoolSize}); all workers are busy or retiring`,
      );
    }
  }

  private validateRequestModulePaths(readPaths: string[], request: WorkerRequest): void {
    const modulePaths: string[] = [];
    if ("modulePath" in request && request.modulePath) {
      modulePaths.push(request.modulePath);
    }
    if (request.type === "render-ssr") {
      modulePaths.push(request.pageModulePath, ...request.layoutModulePaths);
    }
    if (modulePaths.length === 0) return;

    let normalizedReadPaths: string[] = [];
    try {
      normalizedReadPaths = normalizeReadPaths(readPaths);
    } catch {
      // Every module fails closed if its permission roots cannot be resolved.
    }

    for (const requestedPath of modulePaths) {
      let modulePath = requestedPath;
      let isAllowed = false;
      try {
        modulePath = canonicalizePath(requestedPath);
        isAllowed = requestedPath.length > 0 &&
          normalizedReadPaths.some((readPath) => isWithinDirectory(readPath, modulePath));
      } catch {
        // Canonicalization failures fail closed through the same public error.
      }

      if (isAllowed) continue;

      logger.warn("Worker module path rejected by read boundary", {
        requestType: request.type,
      });
      throw SECURITY_VIOLATION.create({
        detail: "Worker module path is outside the allowed project boundary",
      });
    }
  }

  private admitRequest(
    projectId: string,
    readPaths: string[],
    renderer?: IsolatedSsrRendererAdmission,
  ): PoolEntry {
    const worker = this.getOrCreateWorkerForAdmission(projectId, readPaths, renderer);
    const entry = this.pool.get(projectId);
    if (!entry || entry.worker !== worker || entry.retirementRequested) {
      throw this.createOverloadError(
        "Worker changed while the request was being admitted",
      );
    }
    if (entry.activeRequests >= SERIALIZED_WORKER_REQUEST_CAPACITY) {
      throw this.createOverloadError(
        `Worker active request capacity reached (${entry.activeRequests}/${SERIALIZED_WORKER_REQUEST_CAPACITY})`,
      );
    }

    entry.activeRequests++;
    entry.lastAccessedAt = Date.now();
    return entry;
  }

  private shouldRecycle(entry: PoolEntry): boolean {
    return entry.worker.requestCount >= this.config.maxRequestsPerWorker ||
      Date.now() - entry.createdAt >= this.config.maxWorkerAgeMs;
  }

  private recycleReason(entry: PoolEntry): string {
    return entry.worker.requestCount >= this.config.maxRequestsPerWorker
      ? "request_count_limit"
      : "worker_age_limit";
  }

  private isTerminal(entry: PoolEntry): boolean {
    return entry.worker.status === "crashed" || entry.worker.status === "terminated";
  }

  private isBusy(entry: PoolEntry): boolean {
    return entry.activeRequests > 0 ||
      entry.worker.hasPendingRequests ||
      entry.healthCheckInFlight;
  }

  private completeRequest(projectId: string, entry: PoolEntry): void {
    if (entry.activeRequests > 0) entry.activeRequests--;
    if (this.pool.get(projectId) !== entry) return;

    if (this.isTerminal(entry)) {
      this.requestRetirement(projectId, entry, "terminal");
      return;
    }

    if (entry.retirementRequested) {
      this.tryFinalizeRetirement(projectId, entry);
    }
  }

  private markPreparedModuleCapacityReached(
    projectId: string,
    entry: PoolEntry,
  ): void {
    entry.preparedModuleCapacityReached = true;
    this.requestRetirement(
      projectId,
      entry,
      "prepared_module_capacity",
    );
  }

  private requestRetirement(projectId: string, entry: PoolEntry, reason: string): void {
    if (this.pool.get(projectId) !== entry) return;

    if (!entry.retirementRequested) {
      entry.retirementRequested = true;
      entry.retirementReason = reason;
      logger.debug("Worker retirement requested", {
        reason,
        pending: this.isBusy(entry),
      });
    }

    this.tryFinalizeRetirement(projectId, entry);
  }

  private tryFinalizeRetirement(projectId: string, entry: PoolEntry): boolean {
    if (this.pool.get(projectId) !== entry) return true;
    if (!this.isTerminal(entry) && this.isBusy(entry)) return false;

    if (this.pool.get(projectId) !== entry) return true;

    this.pool.delete(projectId);
    entry.releaseIdleListener();
    const shutdown = this.terminateEntry(entry);
    void shutdown.then(() => {
      this.settleRetirement(entry);
      logger.debug("Worker retired", {
        reason: entry.retirementReason ?? "unspecified",
        poolSize: this.pool.size,
      });
    });
    return true;
  }

  private settleRetirement(entry: PoolEntry): void {
    if (entry.retirementSettled) return;
    entry.retirementSettled = true;
    entry.resolveRetired();
  }

  private handleWorkerIdle(projectId: string, entry: PoolEntry): void {
    if (this.pool.get(projectId) !== entry) return;
    if (this.isTerminal(entry)) {
      this.requestRetirement(projectId, entry, "terminal");
      return;
    }
    if (entry.retirementRequested) {
      this.tryFinalizeRetirement(projectId, entry);
    }
  }

  private terminateEntry(entry: PoolEntry): Promise<void> {
    if (entry.shutdown) return entry.shutdown;

    let workerShutdown: Promise<void>;
    try {
      workerShutdown = Promise.resolve(entry.worker.shutdown());
    } catch (error) {
      logger.debug("Worker termination failed", { error });
      workerShutdown = Promise.resolve();
    }

    const normalized = workerShutdown.catch((error) => {
      logger.debug("Worker termination failed", { error });
    });
    const tracked = normalized.finally(() => this.workerShutdowns.delete(tracked));
    entry.shutdown = tracked;
    this.workerShutdowns.add(tracked);
    return tracked;
  }

  private async drainWorkerShutdowns(): Promise<void> {
    while (this.workerShutdowns.size > 0) {
      await Promise.all([...this.workerShutdowns]);
    }
  }

  private createOverloadError(detail: string) {
    return SERVICE_OVERLOADED.create({ detail });
  }

  private async checkHealth(): Promise<void> {
    for (const [projectId, entry] of [...this.pool.entries()]) {
      if (this.pool.get(projectId) !== entry) continue;

      if (this.isTerminal(entry)) {
        this.requestRetirement(projectId, entry, "terminal");
        continue;
      }

      if (entry.retirementRequested) {
        this.tryFinalizeRetirement(projectId, entry);
        continue;
      }

      // A ping shares the worker protocol and pending-request map. Do not add a
      // health request while application work is already in flight.
      if (this.isBusy(entry) || entry.healthCheckInFlight) continue;

      entry.healthCheckInFlight = true;
      let healthy = false;
      try {
        healthy = await entry.worker.isHealthy();
      } catch {
        healthy = false;
      } finally {
        entry.healthCheckInFlight = false;
      }

      // The await above may span eviction and re-creation of this project key.
      // Never let an old health result act on a newer worker generation.
      if (this.pool.get(projectId) !== entry) continue;

      if (entry.retirementRequested) {
        this.tryFinalizeRetirement(projectId, entry);
        continue;
      }

      if (!healthy) {
        logger.warn("Worker failed health check");
        this.requestRetirement(projectId, entry, "health_check_failed");
      }
    }

    // Evict oldest workers when under memory pressure
    this.evictUnderMemoryPressure();
  }

  /**
   * Best-effort idle-worker retirement under host-process heap pressure.
   *
   * This can drop pool references but cannot guarantee that retained ESM state
   * or top-level allocations are reclaimed. It is operational pressure relief,
   * not a per-worker memory limit.
   */
  private evictUnderMemoryPressure(): void {
    try {
      const heapUsedPercent = this.getHeapUsedPercent();
      if (!Number.isFinite(heapUsedPercent) || heapUsedPercent < 0) return;
      if (heapUsedPercent < HOST_HEAP_EVICTION_THRESHOLD_PERCENT) return;

      // Sort workers by last access time (oldest first)
      const entries = [...this.pool.entries()]
        .filter(([, entry]) => !this.isBusy(entry))
        .sort(([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt);

      const toEvict = Math.max(
        1,
        Math.ceil(entries.length * HOST_HEAP_EVICTION_FRACTION),
      );
      for (let i = 0; i < toEvict && i < entries.length; i++) {
        const [projectId, entry] = entries[i]!;
        if (this.pool.get(projectId) !== entry) continue;

        this.requestRetirement(projectId, entry, "host_memory_pressure");
        logger.debug("Retired worker due to host memory pressure", {
          heapUsedPercent,
          poolSize: this.pool.size,
        });
      }
    } catch (error) {
      logger.debug("Host heap statistics unavailable for worker eviction", {
        error,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton & Feature Flag
// ---------------------------------------------------------------------------

// Cache feature flag results to avoid env lookups on every request
let _flagsResolved = false;
let _apiIsolation = false;
let _dataIsolation = false;
let _ssrIsolation = false;
let _posture: IsolationPosture | null = null;

/** What one isolation surface was asked for versus what it resolved to. */
export interface IsolationSurfacePosture {
  /** The operator set both the master switch and this surface's flag. */
  requested: boolean;
  /** The resolved gate this surface's callers actually consult. */
  effective: boolean;
}

/**
 * The resolved isolation configuration, as an operator would need to read it.
 *
 * `requested` and `effective` are separate fields so posture remains explicit
 * if a runtime capability changes. The deprecated host-execution override never
 * makes requested API isolation ineffective: unsupported runtimes keep the gate
 * enabled and fail closed. `inForce` answers whether any surface is isolated.
 */
export interface IsolationPosture {
  /** WORKER_ISOLATION_ENABLED. On its own it enables no surface. */
  master: boolean;
  api: IsolationSurfacePosture;
  data: IsolationSurfacePosture;
  ssr: IsolationSurfacePosture;
  /**
   * Whether this runtime can prepare isolated API route source at all
   * (security/sandbox/isolation-capability.ts). When false with
   * `api.effective` true, API routes fail closed rather than execute.
   */
  apiPreparationSupported: boolean;
  /**
   * Always false here: this posture reports the sandbox worker isolation surfaces and
   * does not resolve the host-execution grant, which is decided per request from
   * host-owned context in security/project-locality.ts. A shared runtime CAN execute
   * tenant code when an operator grants it (veryfront-issue-inbox#848), so do not read
   * this field as evidence that it does not. `hostExecutionOverrideConfigured` below
   * reports whether the grant is present.
   */
  hostExecutionGranted: false;
  /** Whether the VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION grant is present. */
  hostExecutionOverrideConfigured: boolean;
  /** True when at least one surface actually resolved to isolated execution. */
  inForce: boolean;
}

/**
 * Resolve the host-owned isolation flags once per process.
 *
 * A build that cannot honour `WORKER_ISOLATION_API` must fail closed. The
 * deprecated host-execution override does not alter an API-specific posture.
 */
function resolveFlags(): void {
  if (_flagsResolved) return;
  // Isolation is host-owned security policy. Project env overlays must never
  // enable or disable it for the framework process.
  const master = getHostEnvBoolean("WORKER_ISOLATION_ENABLED", false);
  const apiFlag = getHostEnvBoolean("WORKER_ISOLATION_API", false);
  const dataFlag = getHostEnvBoolean("WORKER_ISOLATION_DATA", false);
  const ssrFlag = getHostEnvBoolean("WORKER_ISOLATION_SSR", false);
  const apiRequested = master && apiFlag;
  _dataIsolation = master && dataFlag;
  _ssrIsolation = master && ssrFlag;

  const preparationSupported = isIsolatedApiPreparationSupported();
  const hostExecutionOverrideConfigured = isHostProjectExecutionOverrideConfigured();
  _apiIsolation = apiRequested;
  _flagsResolved = true;

  const effectiveSurfaces = [_apiIsolation, _dataIsolation, _ssrIsolation]
    .filter(Boolean).length;
  _posture = {
    master,
    api: { requested: apiRequested, effective: _apiIsolation },
    data: { requested: _dataIsolation, effective: _dataIsolation },
    ssr: { requested: _ssrIsolation, effective: _ssrIsolation },
    apiPreparationSupported: preparationSupported,
    hostExecutionGranted: false,
    hostExecutionOverrideConfigured,
    inForce: effectiveSurfaces > 0,
  };

  // A capability configured on that quietly resolves to off reads as safe to
  // anyone auditing the environment, so say so once at resolution. The master
  // switch is a gate, not a surface: on its own it isolates nothing, and a
  // surface flag without it is inert in the other direction.
  if (master && effectiveSurfaces === 0) {
    logger.warn(
      "WORKER_ISOLATION_ENABLED is set but no isolation surface is in force; the master switch enables nothing on its own",
      {
        effectiveSurfaces,
        requiredFlags: ["WORKER_ISOLATION_API", "WORKER_ISOLATION_DATA", "WORKER_ISOLATION_SSR"],
        workerIsolationApi: apiFlag,
        workerIsolationData: dataFlag,
        workerIsolationSsr: ssrFlag,
      },
    );
  } else if (!master && (apiFlag || dataFlag || ssrFlag)) {
    logger.warn(
      "Worker isolation surface flags are set but WORKER_ISOLATION_ENABLED is not; every surface resolves to off",
      {
        effectiveSurfaces,
        workerIsolationApi: apiFlag,
        workerIsolationData: dataFlag,
        workerIsolationSsr: ssrFlag,
      },
    );
  } else {
    // Resolution is operator-relevant only once something is actually
    // configured. A project that asked for no isolation has nothing to act on,
    // and this line would otherwise be the only output a successful dev request
    // produces, so keep the default posture at DEBUG.
    const report = effectiveSurfaces > 0 ? logger.info : logger.debug;
    report.call(logger, "Worker isolation posture resolved", {
      master,
      effectiveSurfaces,
      workerIsolationApi: _apiIsolation,
      workerIsolationData: _dataIsolation,
      workerIsolationSsr: _ssrIsolation,
      apiPreparationSupported: preparationSupported,
    });
  }

  if (apiRequested && !preparationSupported) {
    logger.error(
      "WORKER_ISOLATION_API cannot be honoured by this runtime; project API routes will fail closed",
      {
        flag: "WORKER_ISOLATION_API",
        requested: true,
        effective: true,
        reason: ISOLATED_API_PREPARATION_UNSUPPORTED_REASON,
      },
    );
  }
}

/**
 * The resolved isolation configuration, for the startup log.
 *
 * The boolean accessors below each answer for one surface and cannot tell an
 * operator that the configuration as a whole resolved to nothing. Resolves the
 * flags on first call, exactly as those accessors do.
 *
 * Do not publish this snapshot on an unauthenticated response such as
 * `/_health`: it tells an anonymous caller which realm tenant code runs in.
 */
export function getIsolationPosture(): IsolationPosture {
  resolveFlags();
  // resolveFlags always assigns _posture; the fallback keeps the type honest.
  return _posture ?? {
    master: false,
    api: { requested: false, effective: false },
    data: { requested: false, effective: false },
    ssr: { requested: false, effective: false },
    apiPreparationSupported: isIsolatedApiPreparationSupported(),
    hostExecutionGranted: false,
    hostExecutionOverrideConfigured: false,
    inForce: false,
  };
}

/**
 * Whether worker isolation is enabled for API routes.
 *
 * Requires both WORKER_ISOLATION_ENABLED=1 and WORKER_ISOLATION_API=1. The
 * master switch alone enables no surface; see `getIsolationPosture`.
 */
export function isWorkerIsolationEnabled(): boolean {
  resolveFlags();
  return _apiIsolation;
}

/**
 * The one place that decides which realm a project API route executes in.
 *
 * `routing/api/handler.ts` and both sites in `routing/api/route-executor.ts`
 * used to recompute this independently, which is why patching only the handler
 * moved the failure instead of removing it.
 */
export function isHostRealmApiExecution(allowHostProjectCodeExecution: boolean): boolean {
  return allowHostProjectCodeExecution === true && !isWorkerIsolationEnabled();
}

/**
 * Whether worker isolation is enabled for data fetchers (getServerData).
 * Controlled by WORKER_ISOLATION_DATA=1 (requires WORKER_ISOLATION_ENABLED=1).
 */
export function isDataIsolationEnabled(): boolean {
  resolveFlags();
  return _dataIsolation;
}

/**
 * Whether worker isolation is enabled for SSR rendering.
 * Controlled by WORKER_ISOLATION_SSR=1 (requires WORKER_ISOLATION_ENABLED=1).
 */
export function isSSRIsolationEnabled(): boolean {
  resolveFlags();
  return _ssrIsolation;
}

/** Lazy singleton — created on first use when isolation is enabled */
let _pool: WorkerPool | null = null;

export function getWorkerPool(): WorkerPool {
  if (!_pool) {
    _pool = new WorkerPool({
      // Pool limits are framework-owned configuration, not tenant input.
      maxPoolSize: getHostEnvInteger(
        "WORKER_MAX_POOL_SIZE",
        DEFAULT_WORKER_POOL_CONFIG.maxPoolSize,
      ),
      idleTimeoutMs: getHostEnvInteger(
        "WORKER_IDLE_TIMEOUT_MS",
        DEFAULT_WORKER_POOL_CONFIG.idleTimeoutMs,
        MAX_TIMER_DELAY_MS,
      ),
      requestTimeoutMs: getHostEnvInteger(
        "WORKER_REQUEST_TIMEOUT_MS",
        DEFAULT_WORKER_POOL_CONFIG.requestTimeoutMs,
        MAX_TIMER_DELAY_MS,
      ),
      maxRequestsPerWorker: getHostEnvInteger(
        "WORKER_MAX_REQUESTS_PER_WORKER",
        DEFAULT_WORKER_POOL_CONFIG.maxRequestsPerWorker,
      ),
      maxWorkerAgeMs: getHostEnvInteger(
        "WORKER_MAX_AGE_MS",
        DEFAULT_WORKER_POOL_CONFIG.maxWorkerAgeMs,
        MAX_TIMER_DELAY_MS,
      ),
      allowInternalEgress: isInternalEgressOverrideEnabled(
        getHostEnv(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV),
      ),
    });
  }
  return _pool;
}

/**
 * Retire an existing worker scope without constructing the lazy singleton.
 *
 * Rendering/data owners call this when their source-generation cache is
 * invalidated or disposed. Active requests finish before retirement.
 */
export function evictWorkerScopeIfPresent(scopeId: string): void {
  _pool?.evictWorkerScope(scopeId);
}

/**
 * Reset the singleton and cached flags — for testing only.
 *
 * Callers must await the returned promise before changing worker-related host
 * configuration or starting another test so the detached pool is quiescent.
 */
export function __resetPoolForTests(): Promise<void> {
  const pool = _pool;
  _pool = null;
  _flagsResolved = false;
  _apiIsolation = false;
  _dataIsolation = false;
  _ssrIsolation = false;
  _posture = null;
  return pool?.shutdown() ?? Promise.resolve();
}
