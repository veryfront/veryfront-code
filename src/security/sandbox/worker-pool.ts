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
import { getHostEnv, unrefTimer } from "#veryfront/platform/compat/process.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SECURITY_VIOLATION, SERVICE_OVERLOADED } from "#veryfront/errors";
import { sanitizeDiagnosticText } from "#veryfront/errors/safe-diagnostics.ts";
import { basename, dirname, resolve as resolvePath } from "#veryfront/compat/path";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";
import { ProjectWorker, type ProjectWorkerOptions } from "./project-worker.ts";
import { buildWorkerEnvAllowlist, buildWorkerPermissions } from "./worker-permissions.ts";
import type {
  RenderSSRRequest,
  WorkerPoolConfig,
  WorkerRequest,
  WorkerResponse,
} from "./worker-types.ts";
import { DEFAULT_WORKER_POOL_CONFIG } from "./worker-types.ts";

const logger = serverLogger.component("worker-pool");
const MAX_DIAGNOSTIC_PATH_LENGTH = 512;
const MAX_DIAGNOSTIC_PROJECT_ID_LENGTH = 128;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const apply = Reflect.apply;
const stringSlice = String.prototype.slice;
const stringToLowerCase = String.prototype.toLowerCase;
const stringTrim = String.prototype.trim;
const numberFromString = Number;
const numberIsSafeInteger = Number.isSafeInteger;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const nativeRealPathSync = typeof Deno !== "undefined" &&
    typeof Deno.realPathSync === "function"
  ? Deno.realPathSync.bind(Deno)
  : undefined;

interface PoolEntry {
  worker: ProjectWorker;
  lastAccessedAt: number;
  createdAt: number;
  projectEnvKeys: string[];
  readPaths: string[];
  activeRequests: number;
  retirementRequested: boolean;
  retirementReason?: string;
  releaseIdleListener: () => void;
  terminationStarted: boolean;
  healthCheckInFlight: boolean;
  preparedModuleCapacityReached: boolean;
  retired: Promise<void>;
  resolveRetired: () => void;
  retirementSettled: boolean;
}

/** @internal Construction seam for deterministic lifecycle tests. */
export interface WorkerPoolDependencies {
  /**
   * Test/integration seam for constructing the managed worker. Production uses
   * ProjectWorker directly.
   */
  createWorker?: (options: ProjectWorkerOptions) => ProjectWorker;
}

function extractProjectEnvKeys(request: WorkerRequest): string[] {
  if (!("projectEnv" in request) || !request.projectEnv) return [];
  return Object.keys(request.projectEnv);
}

function normalizeProjectEnvKeys(keys: Iterable<string | undefined>): string[] {
  const frameworkEnvKeyCount = buildWorkerEnvAllowlist([]).length;
  return buildWorkerEnvAllowlist(keys).slice(frameworkEnvKeyCount);
}

function sameEnvKeySet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((key) => rightSet.has(key));
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

function boundedDiagnostic(value: string, maxLength: number): string {
  return apply(stringSlice, value, [0, maxLength]);
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
      return fallback;
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
  return numberIsSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : fallback;
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

function isPreparedApiRequest(request: WorkerRequest): boolean {
  return request.type === "execute-app-route" ||
    request.type === "execute-pages-route" ||
    request.type === "inspect-api-route-methods";
}

export class WorkerPool {
  private pool = new Map<string, PoolEntry>();
  private readonly config: WorkerPoolConfig;
  private readonly createWorker: (options: ProjectWorkerOptions) => ProjectWorker;
  private shuttingDown = false;

  private cleanupInterval: ReturnType<typeof setInterval> | undefined;
  private healthCheckInterval: ReturnType<typeof setInterval> | undefined;

  constructor(
    config: Partial<WorkerPoolConfig> = {},
    dependencies: WorkerPoolDependencies = {},
  ) {
    this.config = { ...DEFAULT_WORKER_POOL_CONFIG, ...config };
    this.createWorker = dependencies.createWorker ?? ((options) => new ProjectWorker(options));
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
    projectEnvKeys: Iterable<string | undefined> = [],
  ): ProjectWorker {
    if (this.shuttingDown) {
      throw this.createOverloadError("Worker pool is shutting down");
    }

    const normalizedProjectEnvKeys = normalizeProjectEnvKeys(projectEnvKeys);
    const normalizedReadPaths = normalizeReadPaths(readPaths);
    const existing = this.pool.get(projectId);
    if (existing) {
      const envKeysChanged = !sameEnvKeySet(
        existing.projectEnvKeys,
        normalizedProjectEnvKeys,
      );
      const readPathsChanged = !sameOrderedPaths(existing.readPaths, normalizedReadPaths);

      if (this.isTerminal(existing)) {
        this.requestRetirement(projectId, existing, "terminal");
      } else if (envKeysChanged || readPathsChanged) {
        const reason = readPathsChanged ? "read_paths_changed" : "environment_keys_changed";
        this.requestRetirement(projectId, existing, reason);
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

    const permissions = buildWorkerPermissions(normalizedReadPaths, {
      projectEnvKeys: normalizedProjectEnvKeys,
    });
    const worker = this.createWorker({
      projectId,
      permissions,
      requestTimeoutMs: this.config.requestTimeoutMs,
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
      projectEnvKeys: normalizedProjectEnvKeys,
      readPaths: normalizedReadPaths,
      activeRequests: 0,
      retirementRequested: false,
      releaseIdleListener: () => {},
      terminationStarted: false,
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
      projectId,
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
      this.validateRequestModulePaths(projectId, readPaths, request);
    } catch (error) {
      return Promise.reject(error);
    }

    return withSpan(
      "workerPool.execute",
      async () => {
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
            entry = this.admitRequest(projectId, readPaths, request);
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
      { "workerPool.projectId": projectId },
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
    this.validateRequestModulePaths(projectId, readPaths, request);
    const entry = this.admitRequest(projectId, readPaths, request);

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
   * Generation keys are deliberately constrained to the exact protocol shape
   * `${scopeId}:generation:<digest>` so similarly prefixed scopes are not
   * affected. Busy generations finish their current requests before eviction.
   */
  evictWorkerScope(scopeId: string): void {
    if (!scopeId) return;

    const generationPrefix = `${scopeId}:generation:`;
    for (const [projectId, entry] of [...this.pool.entries()]) {
      if (projectId !== scopeId && !projectId.startsWith(generationPrefix)) continue;
      if (this.pool.get(projectId) !== entry) continue;
      this.requestRetirement(projectId, entry, "scope_eviction");
    }
  }

  /**
   * Get pool statistics for monitoring.
   *
   * `memoryBudgetMb` is retained for configuration compatibility only. It is
   * not an enforced per-worker limit; `memoryBudgetEnforced` makes that
   * operational constraint explicit to monitoring consumers.
   */
  getStats(): {
    poolSize: number;
    maxPoolSize: number;
    memoryBudgetMb: number;
    memoryBudgetEnforced: false;
    workers: Record<string, {
      status: string;
      requestCount: number;
      hasPending: boolean;
      retiring: boolean;
      idleMs: number;
      ageMs: number;
    }>;
  } {
    const workers: Record<string, {
      status: string;
      requestCount: number;
      hasPending: boolean;
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
        retiring: entry.retirementRequested,
        idleMs: now - entry.lastAccessedAt,
        ageMs: now - entry.createdAt,
      };
    }

    return {
      poolSize: this.pool.size,
      maxPoolSize: this.config.maxPoolSize,
      memoryBudgetMb: this.config.memoryBudgetMb,
      memoryBudgetEnforced: false,
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
   * Shutdown the pool. Terminates all workers and stops timers.
   */
  shutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    this.cleanupInterval = undefined;
    this.healthCheckInterval = undefined;

    for (const [, entry] of this.pool) {
      entry.releaseIdleListener();
      this.terminateEntry(entry);
      this.settleRetirement(entry);
    }

    this.pool.clear();
    logger.debug("Worker pool shut down");
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

  private validateRequestModulePaths(
    projectId: string,
    readPaths: string[],
    request: WorkerRequest,
  ): void {
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
        projectId: boundedDiagnostic(
          sanitizeDiagnosticText(projectId),
          MAX_DIAGNOSTIC_PROJECT_ID_LENGTH,
        ),
        modulePath: boundedDiagnostic(
          sanitizeDiagnosticText(modulePath),
          MAX_DIAGNOSTIC_PATH_LENGTH,
        ),
      });
      throw SECURITY_VIOLATION.create({
        detail: "Worker module path is outside the allowed project boundary",
      });
    }
  }

  private admitRequest(
    projectId: string,
    readPaths: string[],
    request: WorkerRequest,
  ): PoolEntry {
    const projectEnvKeys = extractProjectEnvKeys(request);
    const worker = this.getOrCreateWorker(projectId, readPaths, projectEnvKeys);
    const entry = this.pool.get(projectId);
    if (!entry || entry.worker !== worker || entry.retirementRequested) {
      throw this.createOverloadError(
        "Worker changed while the request was being admitted",
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
        projectId,
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
    this.terminateEntry(entry);
    this.settleRetirement(entry);

    logger.debug("Worker retired", {
      projectId,
      reason: entry.retirementReason ?? "unspecified",
      poolSize: this.pool.size,
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

  private terminateEntry(entry: PoolEntry): void {
    if (entry.terminationStarted) return;
    entry.terminationStarted = true;

    // Terminal ProjectWorkers have already closed their Worker, protocol port,
    // and egress broker. Avoid a second lifecycle call while still marking the
    // pool entry as fully disposed.
    if (this.isTerminal(entry)) return;

    try {
      entry.worker.terminate();
    } catch (error) {
      logger.debug("Worker termination failed", {
        projectId: entry.worker.projectId,
        error,
      });
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
        logger.warn("Worker failed health check", { projectId });
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
   * not enforcement of `memoryBudgetMb`.
   */
  private evictUnderMemoryPressure(): void {
    // Lazy import to avoid circular deps — this is only called during health checks
    try {
      // deno-lint-ignore no-explicit-any
      const { getHeapStats } = (globalThis as any).__veryfront_heap_stats ?? {};
      if (!getHeapStats) return;

      const { heapUsedPercent } = getHeapStats();
      if (heapUsedPercent < 70) return; // Only act above 70%

      // Sort workers by last access time (oldest first)
      const entries = [...this.pool.entries()]
        .filter(([, entry]) => !this.isBusy(entry))
        .sort(([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt);

      // Evict up to 25% of idle workers
      const toEvict = Math.max(1, Math.ceil(entries.length * 0.25));
      for (let i = 0; i < toEvict && i < entries.length; i++) {
        const [projectId, entry] = entries[i]!;
        if (this.pool.get(projectId) !== entry) continue;

        this.requestRetirement(projectId, entry, "host_memory_pressure");
        logger.debug("Retired worker due to host memory pressure", {
          projectId,
          heapUsedPercent,
          poolSize: this.pool.size,
        });
      }
    } catch {
      // getHeapStats may not be available in all environments
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

function resolveFlags(): void {
  if (_flagsResolved) return;
  // Isolation is host-owned security policy. Project env overlays must never
  // enable or disable it for the framework process.
  const master = getHostEnvBoolean("WORKER_ISOLATION_ENABLED", false);
  _apiIsolation = master && getHostEnvBoolean("WORKER_ISOLATION_API", false);
  _dataIsolation = master && getHostEnvBoolean("WORKER_ISOLATION_DATA", false);
  _ssrIsolation = master && getHostEnvBoolean("WORKER_ISOLATION_SSR", false);
  _flagsResolved = true;
}

/**
 * Whether worker isolation is enabled for API routes.
 * Controlled by WORKER_ISOLATION_API=1 (or WORKER_ISOLATION_ENABLED=1 as master switch).
 */
export function isWorkerIsolationEnabled(): boolean {
  resolveFlags();
  return _apiIsolation;
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
      // Compatibility/advisory value only. Deno Workers do not provide an
      // enforceable in-process per-worker memory ceiling.
      memoryBudgetMb: getHostEnvInteger(
        "WORKER_MEMORY_BUDGET_MB",
        DEFAULT_WORKER_POOL_CONFIG.memoryBudgetMb,
      ),
    });
  }
  return _pool;
}

/** Reset the singleton and cached flags — for testing only */
export function __resetPoolForTests(): void {
  _pool?.shutdown();
  _pool = null;
  _flagsResolved = false;
  _apiIsolation = false;
  _dataIsolation = false;
  _ssrIsolation = false;
}
