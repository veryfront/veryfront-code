/**
 * Worker Pool Manager
 *
 * Manages a pool of per-project Deno Workers for tenant-isolated code execution.
 * Uses LRU eviction when the pool exceeds its capacity, idle timeout for
 * cleanup, and health checks for reliability.
 *
 * @module security/sandbox/worker-pool
 */

import { serverLogger } from "#veryfront/utils";
import { getEnvBoolean, getEnvNumber, unrefTimer } from "#veryfront/platform/compat/process.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SECURITY_VIOLATION } from "#veryfront/errors";
import { ProjectWorker } from "./project-worker.ts";
import { buildWorkerEnvAllowlist, buildWorkerPermissions } from "./worker-permissions.ts";
import type { WorkerPoolConfig, WorkerRequest, WorkerResponse } from "./worker-types.ts";
import { DEFAULT_WORKER_POOL_CONFIG } from "./worker-types.ts";
import { isWithinDirectory, resolvePathSegments } from "../path-validation/normalization.ts";
import { registerProcessStateReset } from "#veryfront/platform/compat/process/state-reset.ts";

const logger = serverLogger.component("worker-pool");

interface PoolEntry {
  worker: ProjectWorker;
  lastAccessedAt: number;
  createdAt: number;
  projectEnvKeys: string[];
  readPaths: string[];
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

function normalizeReadPaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => resolvePathSegments(path)))].sort();
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateWorkerPoolConfig(config: WorkerPoolConfig): void {
  for (const [name, value] of Object.entries(config)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
  }
}

export class WorkerPool {
  private pool = new Map<string, PoolEntry>();
  private recycling = new Set<string>();
  private config: WorkerPoolConfig;
  private closed = false;
  private healthCheckRunning = false;

  private cleanupInterval: ReturnType<typeof setInterval> | undefined;
  private healthCheckInterval: ReturnType<typeof setInterval> | undefined;

  constructor(config: Partial<WorkerPoolConfig> = {}) {
    this.config = { ...DEFAULT_WORKER_POOL_CONFIG, ...config };
    validateWorkerPoolConfig(this.config);
    this.startCleanup();
    this.startHealthChecks();
  }

  /**
   * Get or create a worker for the given project.
   */
  getOrCreateWorker(
    projectId: string,
    readPaths: string[],
    projectEnvKeys: Iterable<string | undefined> = [],
  ): ProjectWorker {
    this.assertOpen();
    const normalizedProjectEnvKeys = normalizeProjectEnvKeys(projectEnvKeys);
    const normalizedReadPaths = normalizeReadPaths(readPaths);
    const existing = this.pool.get(projectId);
    if (
      existing && existing.worker.status !== "crashed" && existing.worker.status !== "terminated"
    ) {
      if (
        !sameEnvKeySet(existing.projectEnvKeys, normalizedProjectEnvKeys) ||
        !sameStringSet(existing.readPaths, normalizedReadPaths)
      ) {
        if (existing.worker.hasPendingRequests) {
          throw SECURITY_VIOLATION.create({
            detail: "Worker permissions cannot change while requests are active",
          });
        }
        existing.worker.terminate();
        this.pool.delete(projectId);
      } else {
        existing.lastAccessedAt = Date.now();
        return existing.worker;
      }
    }

    // If an existing entry is crashed/terminated, clean it up
    if (existing && this.pool.has(projectId)) {
      existing.worker.terminate();
      this.pool.delete(projectId);
    }

    // Evict LRU if at capacity
    this.evictIfNeeded();

    const permissions = buildWorkerPermissions(normalizedReadPaths, {
      projectEnvKeys: normalizedProjectEnvKeys,
    });
    const worker = new ProjectWorker({
      projectId,
      permissions,
      requestTimeoutMs: this.config.requestTimeoutMs,
    });

    worker.start();

    const now = Date.now();
    this.pool.set(projectId, {
      worker,
      lastAccessedAt: now,
      createdAt: now,
      projectEnvKeys: normalizedProjectEnvKeys,
      readPaths: normalizedReadPaths,
    });

    logger.debug("Worker created", { poolSize: this.pool.size });

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
    if (this.closed) return Promise.reject(new Error("Worker pool has been shut down"));

    // Validate modulePath is within allowed read paths (defense-in-depth)
    if ("modulePath" in request && request.modulePath) {
      const modulePath = resolvePathSegments(request.modulePath);
      const isAllowed = normalizeReadPaths(readPaths).some((path) =>
        isWithinDirectory(path, modulePath)
      );
      if (!isAllowed) {
        return Promise.reject(
          SECURITY_VIOLATION.create({
            detail: "Module path is outside allowed read paths",
          }),
        );
      }
    }

    return withSpan(
      "workerPool.execute",
      async () => {
        const projectEnvKeys = extractProjectEnvKeys(request);
        const worker = this.getOrCreateWorker(projectId, readPaths, projectEnvKeys);

        // Check if worker should be recycled (request count or age)
        const entry = this.pool.get(projectId);
        const shouldRecycle = worker.requestCount >= this.config.maxRequestsPerWorker ||
          (entry && Date.now() - entry.createdAt > this.config.maxWorkerAgeMs);

        if (shouldRecycle && !this.recycling.has(projectId)) {
          this.recycling.add(projectId);

          logger.debug("Recycling worker", {
            requestCount: worker.requestCount,
            ageMs: entry ? Date.now() - entry.createdAt : 0,
            reason: worker.requestCount >= this.config.maxRequestsPerWorker
              ? "request_count"
              : "age",
          });

          // Warm replacement: let the old worker handle this last request,
          // then evict it and create a replacement after the request settles.
          // This avoids cold-start latency for the caller AND prevents the
          // old worker from being terminated while it still has pending work.
          const result = worker.execute(request);

          const replaceWorker = () => {
            try {
              if (this.closed) return;
              const current = this.pool.get(projectId);
              if (!current || current.worker !== worker) return;
              this.evictWorker(projectId);
              if (!this.closed) this.getOrCreateWorker(projectId, readPaths, projectEnvKeys);
            } catch {
              logger.error("Worker replacement failed");
            } finally {
              this.recycling.delete(projectId);
            }
          };
          void result.then(replaceWorker, replaceWorker);

          return result;
        }

        return worker.execute(request);
      },
      {},
    );
  }

  /**
   * Evict a specific project's worker.
   */
  evictWorker(projectId: string): void {
    const entry = this.pool.get(projectId);
    if (!entry) return;

    entry.worker.terminate();
    this.pool.delete(projectId);

    logger.debug("Worker evicted", { poolSize: this.pool.size });
  }

  /**
   * Get pool statistics for monitoring.
   */
  getStats(): {
    poolSize: number;
    maxPoolSize: number;
    memoryBudgetMb: number;
    workers: Record<string, {
      status: string;
      requestCount: number;
      hasPending: boolean;
      idleMs: number;
      ageMs: number;
    }>;
  } {
    const workers: Record<string, {
      status: string;
      requestCount: number;
      hasPending: boolean;
      idleMs: number;
      ageMs: number;
    }> = {};
    const now = Date.now();

    for (const [id, entry] of this.pool) {
      workers[id] = {
        status: entry.worker.status,
        requestCount: entry.worker.requestCount,
        hasPending: entry.worker.hasPendingRequests,
        idleMs: now - entry.lastAccessedAt,
        ageMs: now - entry.createdAt,
      };
    }

    return {
      poolSize: this.pool.size,
      maxPoolSize: this.config.maxPoolSize,
      memoryBudgetMb: this.config.memoryBudgetMb,
      workers,
    };
  }

  /**
   * Get aggregate metrics suitable for Prometheus exposition.
   */
  getMetrics(): {
    /** Current number of active workers */
    workerPoolSize: number;
    /** Number of workers at capacity (max pool size) */
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
    if (this.closed) return;
    this.closed = true;
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    this.cleanupInterval = undefined;
    this.healthCheckInterval = undefined;

    for (const [, entry] of this.pool) {
      entry.worker.terminate();
    }

    this.pool.clear();
    this.recycling.clear();
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
      if (this.closed || this.healthCheckRunning) return;
      this.healthCheckRunning = true;
      void this.checkHealth()
        .catch(() => logger.error("Worker health check failed"))
        .finally(() => {
          this.healthCheckRunning = false;
        });
    }, this.config.healthCheckIntervalMs);

    unrefTimer(this.healthCheckInterval);
  }

  private evictIdleWorkers(): void {
    const now = Date.now();

    for (const [projectId, entry] of this.pool) {
      const idleTime = now - entry.lastAccessedAt;

      if (idleTime > this.config.idleTimeoutMs && !entry.worker.hasPendingRequests) {
        entry.worker.terminate();
        this.pool.delete(projectId);

        logger.debug("Evicted idle worker", {
          idleMs: idleTime,
          poolSize: this.pool.size,
        });
      }
    }
  }

  private evictIfNeeded(): void {
    if (this.pool.size < this.config.maxPoolSize) return;

    // Find the LRU entry that has no pending requests
    let lruId: string | null = null;
    let lruTime = Infinity;

    for (const [projectId, entry] of this.pool) {
      if (!entry.worker.hasPendingRequests && entry.lastAccessedAt < lruTime) {
        lruTime = entry.lastAccessedAt;
        lruId = projectId;
      }
    }

    if (lruId) {
      this.evictWorker(lruId);
    } else {
      throw new Error("Worker pool is at capacity with active requests");
    }
  }

  private async checkHealth(): Promise<void> {
    for (const [projectId, entry] of this.pool) {
      if (entry.worker.status === "crashed" || entry.worker.status === "terminated") {
        this.pool.delete(projectId);
        continue;
      }

      const healthy = await entry.worker.isHealthy();
      if (!healthy) {
        logger.warn("Worker failed health check");
        entry.worker.terminate();
        this.pool.delete(projectId);
      }
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Worker pool has been shut down");
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
  const master = getEnvBoolean("WORKER_ISOLATION_ENABLED", false);
  _apiIsolation = master && getEnvBoolean("WORKER_ISOLATION_API", false);
  _dataIsolation = master && getEnvBoolean("WORKER_ISOLATION_DATA", false);
  _ssrIsolation = master && getEnvBoolean("WORKER_ISOLATION_SSR", false);
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
      maxPoolSize: getEnvNumber("WORKER_MAX_POOL_SIZE") ?? DEFAULT_WORKER_POOL_CONFIG.maxPoolSize,
      idleTimeoutMs: getEnvNumber("WORKER_IDLE_TIMEOUT_MS") ??
        DEFAULT_WORKER_POOL_CONFIG.idleTimeoutMs,
      requestTimeoutMs: getEnvNumber("WORKER_REQUEST_TIMEOUT_MS") ??
        DEFAULT_WORKER_POOL_CONFIG.requestTimeoutMs,
      maxRequestsPerWorker: getEnvNumber("WORKER_MAX_REQUESTS_PER_WORKER") ??
        DEFAULT_WORKER_POOL_CONFIG.maxRequestsPerWorker,
      maxWorkerAgeMs: getEnvNumber("WORKER_MAX_AGE_MS") ??
        DEFAULT_WORKER_POOL_CONFIG.maxWorkerAgeMs,
      memoryBudgetMb: getEnvNumber("WORKER_MEMORY_BUDGET_MB") ??
        DEFAULT_WORKER_POOL_CONFIG.memoryBudgetMb,
    });
  }
  return _pool;
}

/** Shut down and release the process-owned pool without changing feature flags. */
export function shutdownWorkerPool(): void {
  const pool = _pool;
  _pool = null;
  pool?.shutdown();
}

/** Reset the singleton and cached flags — for testing only */
export function __resetPoolForTests(): void {
  shutdownWorkerPool();
  _flagsResolved = false;
  _apiIsolation = false;
  _dataIsolation = false;
  _ssrIsolation = false;
}

registerProcessStateReset("sandbox worker pool", __resetPoolForTests);
