import { serverLogger } from "#veryfront/utils";
import { getEnvNumber, unrefTimer } from "#veryfront/compat/process.ts";
import {
  getWorkerPool,
  isWorkerIsolationEnabled,
} from "#veryfront/security/sandbox/worker-pool.ts";

const logger = serverLogger.component("project-isolation");

interface ProjectIsolationConfig {
  maxConcurrentPerProject: number;
  circuitBreakerThreshold: number;
  circuitResetTimeMs: number;
  failureWindowMs: number;
  maxTrackedProjects: number;
}

interface ProjectState {
  inFlight: number;
  failures: number[];
  circuitOpenedAt: number;
  totalRequests: number;
  totalTimeouts: number;
  lastAccessedAt: number;
}

export interface IsolationCheckResult {
  allowed: boolean;
  reason?: "circuit_open" | "max_concurrent" | "capacity";
  waitTimeMs?: number;
}

const DEFAULT_CONFIG: ProjectIsolationConfig = {
  maxConcurrentPerProject: 20,
  circuitBreakerThreshold: 5,
  circuitResetTimeMs: 30_000,
  failureWindowMs: 60_000,
  maxTrackedProjects: 10_000,
};

function validateConfig(config: ProjectIsolationConfig): void {
  for (const [name, value] of Object.entries(config)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
  }
}

export class ProjectIsolationManager {
  private projects = new Map<string, ProjectState>();
  private config: ProjectIsolationConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;

  constructor(config: Partial<ProjectIsolationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    validateConfig(this.config);
    this.startCleanup();
  }

  private refreshState(state: ProjectState, now: number): void {
    state.failures = state.failures.filter(
      (timestamp) => now - timestamp < this.config.failureWindowMs,
    );

    if (
      state.circuitOpenedAt > 0 &&
      now - state.circuitOpenedAt >= this.config.circuitResetTimeMs
    ) {
      state.circuitOpenedAt = 0;
      state.failures = [];
    }
  }

  private isInactive(state: ProjectState): boolean {
    return state.inFlight === 0 && state.failures.length === 0 && state.circuitOpenedAt === 0;
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();

      for (const [slug, state] of this.projects.entries()) {
        this.refreshState(state, now);

        if (this.isInactive(state)) {
          this.projects.delete(slug);
        }
      }
    }, 60_000);

    // Global singleton cleanup should not keep short-lived CLI processes alive.
    unrefTimer(this.cleanupInterval);
  }

  private getOrCreateState(projectSlug: string): ProjectState | undefined {
    const now = Date.now();
    const existing = this.projects.get(projectSlug);
    if (existing) {
      this.refreshState(existing, now);
      existing.lastAccessedAt = now;
      return existing;
    }

    if (this.projects.size >= this.config.maxTrackedProjects) {
      let evictionSlug: string | undefined;
      let oldestAccess = Number.POSITIVE_INFINITY;

      for (const [slug, state] of this.projects.entries()) {
        this.refreshState(state, now);
        if (this.isInactive(state) && state.lastAccessedAt < oldestAccess) {
          evictionSlug = slug;
          oldestAccess = state.lastAccessedAt;
        }
      }

      if (evictionSlug !== undefined) this.projects.delete(evictionSlug);
    }

    if (this.projects.size >= this.config.maxTrackedProjects) return undefined;

    const state: ProjectState = {
      inFlight: 0,
      failures: [],
      circuitOpenedAt: 0,
      totalRequests: 0,
      totalTimeouts: 0,
      lastAccessedAt: now,
    };

    this.projects.set(projectSlug, state);
    return state;
  }

  checkRequest(projectSlug: string | undefined): IsolationCheckResult {
    if (!projectSlug) return { allowed: true };

    const state = this.getOrCreateState(projectSlug);
    if (!state) {
      logger.warn("Project isolation state capacity reached", {
        maxTrackedProjects: this.config.maxTrackedProjects,
      });
      return { allowed: false, reason: "capacity" };
    }
    const now = Date.now();

    if (state.circuitOpenedAt > 0) {
      const elapsed = now - state.circuitOpenedAt;

      if (elapsed < this.config.circuitResetTimeMs) {
        const waitTimeMs = this.config.circuitResetTimeMs - elapsed;

        logger.warn("Circuit open, rejecting request", {
          waitTimeMs,
          recentFailures: state.failures.length,
        });

        return { allowed: false, reason: "circuit_open", waitTimeMs };
      }
    }

    if (state.inFlight >= this.config.maxConcurrentPerProject) {
      logger.warn("Max concurrent requests reached", {
        inFlight: state.inFlight,
        maxConcurrent: this.config.maxConcurrentPerProject,
      });
      return { allowed: false, reason: "max_concurrent" };
    }

    return { allowed: true };
  }

  startRequest(projectSlug: string | undefined): void {
    if (!projectSlug) return;

    const state = this.getOrCreateState(projectSlug);
    if (!state) throw new Error("Project isolation state capacity reached");
    state.inFlight++;
    state.totalRequests++;
  }

  completeRequest(projectSlug: string | undefined, timedOut: boolean): void {
    if (!projectSlug) return;

    const state = this.projects.get(projectSlug);
    if (!state) return;

    state.lastAccessedAt = Date.now();
    state.inFlight = Math.max(0, state.inFlight - 1);
    if (timedOut) this.recordTimeout(projectSlug);
  }

  /**
   * Record a request timeout without releasing its concurrency slot.
   *
   * Runtime handlers use this when a timeout response is returned before the
   * underlying work settles. This lets the circuit breaker react immediately
   * while the still-running work remains counted against the project limit.
   */
  recordTimeout(projectSlug: string | undefined): void {
    if (!projectSlug) return;

    const state = this.projects.get(projectSlug);
    if (!state) return;

    state.totalTimeouts++;
    const now = Date.now();
    this.refreshState(state, now);
    state.lastAccessedAt = now;
    state.failures.push(now);

    if (state.failures.length < this.config.circuitBreakerThreshold) return;

    state.circuitOpenedAt = now;
    logger.error("Circuit opened due to failures", {
      recentFailures: state.failures.length,
      threshold: this.config.circuitBreakerThreshold,
      resetAfterMs: this.config.circuitResetTimeMs,
    });
  }

  /**
   * Record a worker crash for a project. This counts as a failure
   * toward the circuit breaker threshold and evicts the worker.
   */
  recordWorkerCrash(projectSlug: string | undefined): void {
    if (!projectSlug) return;

    const now = Date.now();
    const state = this.getOrCreateState(projectSlug);

    // Evict the crashed worker from the pool
    if (isWorkerIsolationEnabled()) {
      getWorkerPool().evictWorker(projectSlug);
    }

    if (!state) {
      logger.warn("Worker crash could not be tracked because isolation state is at capacity", {
        maxTrackedProjects: this.config.maxTrackedProjects,
      });
      return;
    }

    this.refreshState(state, now);
    state.lastAccessedAt = now;
    state.failures.push(now);

    logger.warn("Worker crash recorded", { recentFailures: state.failures.length });

    if (state.failures.length < this.config.circuitBreakerThreshold) return;

    state.circuitOpenedAt = now;
    logger.error("Circuit opened due to worker crashes", {
      recentFailures: state.failures.length,
      threshold: this.config.circuitBreakerThreshold,
      resetAfterMs: this.config.circuitResetTimeMs,
    });
  }

  getStats(): Record<
    string,
    {
      inFlight: number;
      recentFailures: number;
      circuitOpen: boolean;
      totalRequests: number;
      totalTimeouts: number;
    }
  > {
    const stats: Record<
      string,
      {
        inFlight: number;
        recentFailures: number;
        circuitOpen: boolean;
        totalRequests: number;
        totalTimeouts: number;
      }
    > = {};

    const now = Date.now();
    for (const [slug, state] of this.projects.entries()) {
      this.refreshState(state, now);
      stats[slug] = {
        inFlight: state.inFlight,
        recentFailures: state.failures.length,
        circuitOpen: state.circuitOpenedAt > 0,
        totalRequests: state.totalRequests,
        totalTimeouts: state.totalTimeouts,
      };
    }

    return stats;
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.projects.clear();
  }
}

export const projectIsolation = new ProjectIsolationManager({
  maxConcurrentPerProject: getEnvNumber("PROJECT_MAX_CONCURRENT", 20),
  circuitBreakerThreshold: getEnvNumber("PROJECT_CIRCUIT_THRESHOLD", 5),
  circuitResetTimeMs: getEnvNumber("PROJECT_CIRCUIT_RESET_MS", 30_000),
  maxTrackedProjects: getEnvNumber("PROJECT_MAX_TRACKED", 10_000),
});
