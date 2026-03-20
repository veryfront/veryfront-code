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
import { buildWorkerPermissions } from "./worker-permissions.ts";
import type { WorkerPoolConfig, WorkerRequest, WorkerResponse } from "./worker-types.ts";
import { DEFAULT_WORKER_POOL_CONFIG } from "./worker-types.ts";

const logger = serverLogger.component("worker-pool");

interface PoolEntry {
  worker: ProjectWorker;
  lastAccessedAt: number;
  createdAt: number;
}

export class WorkerPool {
  private pool = new Map<string, PoolEntry>();
  private recycling = new Set<string>();
  private config: WorkerPoolConfig;

  private cleanupInterval: ReturnType<typeof setInterval> | undefined;
  private healthCheckInterval: ReturnType<typeof setInterval> | undefined;

  constructor(config: Partial<WorkerPoolConfig> = {}) {
    this.config = { ...DEFAULT_WORKER_POOL_CONFIG, ...config };
    this.startCleanup();
    this.startHealthChecks();
  }

  /**
   * Get or create a worker for the given project.
   */
  getOrCreateWorker(projectId: string, readPaths: string[]): ProjectWorker {
    const existing = this.pool.get(projectId);
    if (
      existing && existing.worker.status !== "crashed" && existing.worker.status !== "terminated"
    ) {
      existing.lastAccessedAt = Date.now();
      return existing.worker;
    }

    // If an existing entry is crashed/terminated, clean it up
    if (existing) {
      existing.worker.terminate();
      this.pool.delete(projectId);
    }

    // Evict LRU if at capacity
    this.evictIfNeeded();

    const permissions = buildWorkerPermissions(readPaths);
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
    });

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
    // Validate modulePath is within allowed read paths (defense-in-depth)
    if ("modulePath" in request && request.modulePath) {
      const modulePath = request.modulePath;
      const isAllowed = readPaths.some((p) => modulePath.startsWith(p));
      if (!isAllowed) {
        return Promise.reject(
          SECURITY_VIOLATION.create({
            detail:
              `Module path "${modulePath}" is outside allowed read paths for project "${projectId}"`,
          }),
        );
      }
    }

    return withSpan(
      "workerPool.execute",
      async () => {
        const worker = this.getOrCreateWorker(projectId, readPaths);

        // Check if worker should be recycled (request count or age)
        const entry = this.pool.get(projectId);
        const shouldRecycle = worker.requestCount >= this.config.maxRequestsPerWorker ||
          (entry && Date.now() - entry.createdAt > this.config.maxWorkerAgeMs);

        if (shouldRecycle && !this.recycling.has(projectId)) {
          this.recycling.add(projectId);

          logger.debug("Recycling worker", {
            projectId,
            requestCount: worker.requestCount,
            ageMs: entry ? Date.now() - entry.createdAt : 0,
            reason: worker.requestCount >= this.config.maxRequestsPerWorker
              ? "request_count"
              : "age",
          });

          // Warm replacement: execute on the current worker while creating
          // the replacement in the background. The old worker handles this
          // last request so the caller doesn't pay cold-start latency.
          const result = worker.execute(request);

          // Create replacement worker in the background after dispatching
          // the request to the old worker. The recycling guard is cleared
          // here (not in a finally) to prevent concurrent requests from
          // seeing the old worker between the finally and the microtask.
          queueMicrotask(() => {
            this.evictWorker(projectId);
            this.getOrCreateWorker(projectId, readPaths);
            this.recycling.delete(projectId);
          });

          return result;
        }

        return worker.execute(request);
      },
      { "workerPool.projectId": projectId },
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

    logger.debug("Worker evicted", { projectId, poolSize: this.pool.size });
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
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);

    for (const [, entry] of this.pool) {
      entry.worker.terminate();
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

    for (const [projectId, entry] of this.pool) {
      const idleTime = now - entry.lastAccessedAt;

      if (idleTime > this.config.idleTimeoutMs && !entry.worker.hasPendingRequests) {
        entry.worker.terminate();
        this.pool.delete(projectId);

        logger.debug("Evicted idle worker", {
          projectId,
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
      // All workers have pending requests — force evict the oldest
      for (const [projectId, entry] of this.pool) {
        if (entry.lastAccessedAt < lruTime) {
          lruTime = entry.lastAccessedAt;
          lruId = projectId;
        }
      }
      if (lruId) this.evictWorker(lruId);
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
        logger.warn("Worker failed health check", { projectId });
        entry.worker.terminate();
        this.pool.delete(projectId);
      }
    }

    // Evict oldest workers when under memory pressure
    this.evictUnderMemoryPressure();
  }

  /**
   * Evict workers when the process is under memory pressure.
   * Uses the global heap stats — if heap usage is above a threshold,
   * evict idle workers starting with the oldest to free memory.
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
        .filter(([, e]) => !e.worker.hasPendingRequests)
        .sort(([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt);

      // Evict up to 25% of idle workers
      const toEvict = Math.max(1, Math.ceil(entries.length * 0.25));
      for (let i = 0; i < toEvict && i < entries.length; i++) {
        const projectId = entries[i]![0];
        this.evictWorker(projectId);
        logger.debug("Evicted worker due to memory pressure", {
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

/** Reset the singleton and cached flags — for testing only */
export function __resetPoolForTests(): void {
  _pool?.shutdown();
  _pool = null;
  _flagsResolved = false;
  _apiIsolation = false;
  _dataIsolation = false;
  _ssrIsolation = false;
}
