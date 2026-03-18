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
import { ProjectWorker } from "./project-worker.ts";
import { buildWorkerPermissions } from "./worker-permissions.ts";
import type {
  WorkerPoolConfig,
  WorkerRequest,
  WorkerResponse,
} from "./worker-types.ts";
import { DEFAULT_WORKER_POOL_CONFIG } from "./worker-types.ts";

const logger = serverLogger.component("worker-pool");

interface PoolEntry {
  worker: ProjectWorker;
  lastAccessedAt: number;
}

export class WorkerPool {
  private pool = new Map<string, PoolEntry>();
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
    if (existing && existing.worker.status !== "crashed" && existing.worker.status !== "terminated") {
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

    this.pool.set(projectId, {
      worker,
      lastAccessedAt: Date.now(),
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
    return withSpan(
      "workerPool.execute",
      async () => {
        const worker = this.getOrCreateWorker(projectId, readPaths);

        // Check if worker should be recycled
        if (worker.requestCount >= this.config.maxRequestsPerWorker) {
          logger.debug("Recycling worker due to request count", {
            projectId,
            requestCount: worker.requestCount,
          });
          this.evictWorker(projectId);
          const fresh = this.getOrCreateWorker(projectId, readPaths);
          return fresh.execute(request);
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
    workers: Record<string, {
      status: string;
      requestCount: number;
      hasPending: boolean;
      idleMs: number;
    }>;
  } {
    const workers: Record<string, {
      status: string;
      requestCount: number;
      hasPending: boolean;
      idleMs: number;
    }> = {};
    const now = Date.now();

    for (const [id, entry] of this.pool) {
      workers[id] = {
        status: entry.worker.status,
        requestCount: entry.worker.requestCount,
        hasPending: entry.worker.hasPendingRequests,
        idleMs: now - entry.lastAccessedAt,
      };
    }

    return {
      poolSize: this.pool.size,
      maxPoolSize: this.config.maxPoolSize,
      workers,
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
  }
}

// ---------------------------------------------------------------------------
// Singleton & Feature Flag
// ---------------------------------------------------------------------------

/**
 * Whether worker isolation is enabled for API routes.
 * Controlled by WORKER_ISOLATION_API=1 (or WORKER_ISOLATION_ENABLED=1 as master switch).
 */
export function isWorkerIsolationEnabled(): boolean {
  const master = getEnvBoolean("WORKER_ISOLATION_ENABLED", false);
  if (!master) return false;

  return getEnvBoolean("WORKER_ISOLATION_API", false);
}

/** Lazy singleton — created on first use when isolation is enabled */
let _pool: WorkerPool | null = null;

export function getWorkerPool(): WorkerPool {
  if (!_pool) {
    _pool = new WorkerPool({
      maxPoolSize: getEnvNumber("WORKER_MAX_POOL_SIZE") ?? DEFAULT_WORKER_POOL_CONFIG.maxPoolSize,
      idleTimeoutMs: getEnvNumber("WORKER_IDLE_TIMEOUT_MS") ?? DEFAULT_WORKER_POOL_CONFIG.idleTimeoutMs,
      requestTimeoutMs: getEnvNumber("WORKER_REQUEST_TIMEOUT_MS") ?? DEFAULT_WORKER_POOL_CONFIG.requestTimeoutMs,
      maxRequestsPerWorker: getEnvNumber("WORKER_MAX_REQUESTS_PER_WORKER") ??
        DEFAULT_WORKER_POOL_CONFIG.maxRequestsPerWorker,
    });
  }
  return _pool;
}

/** Reset the singleton — for testing only */
export function __resetPoolForTests(): void {
  _pool?.shutdown();
  _pool = null;
}
