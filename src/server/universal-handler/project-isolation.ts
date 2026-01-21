/**
 * Per-project request isolation and circuit breaker.
 *
 * Prevents one project from consuming all server capacity by:
 * 1. Limiting concurrent requests per project
 * 2. Circuit breaking when a project has too many failures
 *
 * This ensures that a misbehaving project cannot take down other projects.
 */

import { serverLogger as logger } from "#veryfront/utils";
import { getEnv } from "#veryfront/compat/process.ts";

/** Configuration for project isolation */
export interface ProjectIsolationConfig {
  /** Maximum concurrent requests per project (default: 100) */
  maxConcurrentPerProject: number;
  /** Maximum consecutive failures before circuit opens (default: 20) */
  circuitBreakerThreshold: number;
  /** Time in ms before circuit resets (default: 60000) */
  circuitResetTimeMs: number;
  /** Time window in ms for tracking failures (default: 120000) */
  failureWindowMs: number;
}

/** State for a single project */
interface ProjectState {
  /** Current in-flight request count */
  inFlight: number;
  /** Timestamps of recent failures (within failureWindowMs) */
  failures: number[];
  /** When the circuit was opened (0 if closed) */
  circuitOpenedAt: number;
  /** Total requests served */
  totalRequests: number;
  /** Total timeouts */
  totalTimeouts: number;
}

/** Result of checking if a request should be allowed */
export interface IsolationCheckResult {
  allowed: boolean;
  reason?: "circuit_open" | "max_concurrent";
  waitTimeMs?: number;
}

const DEFAULT_CONFIG: ProjectIsolationConfig = {
  maxConcurrentPerProject: 100,
  circuitBreakerThreshold: 20,
  circuitResetTimeMs: 60_000,
  failureWindowMs: 120_000,
};

/**
 * Project isolation manager - ensures one project cannot monopolize server resources.
 */
export class ProjectIsolationManager {
  private projects = new Map<string, ProjectState>();
  private config: ProjectIsolationConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;

  constructor(config: Partial<ProjectIsolationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanup();
  }

  private startCleanup(): void {
    // Periodically clean up old failure records and idle projects
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [slug, state] of this.projects.entries()) {
        // Remove old failures
        state.failures = state.failures.filter(
          (t) => now - t < this.config.failureWindowMs,
        );

        // Remove projects with no activity and no in-flight requests
        if (state.inFlight === 0 && state.failures.length === 0 && state.circuitOpenedAt === 0) {
          // Keep recently active projects for stats
          if (state.totalRequests === 0) {
            this.projects.delete(slug);
          }
        }
      }
    }, 60_000);
  }

  private getOrCreateState(projectSlug: string): ProjectState {
    let state = this.projects.get(projectSlug);
    if (!state) {
      state = {
        inFlight: 0,
        failures: [],
        circuitOpenedAt: 0,
        totalRequests: 0,
        totalTimeouts: 0,
      };
      this.projects.set(projectSlug, state);
    }
    return state;
  }

  /**
   * Check if a request for a project should be allowed.
   * Call this before processing a request.
   */
  checkRequest(projectSlug: string | undefined): IsolationCheckResult {
    // Allow requests without a project slug (health checks, etc.)
    if (!projectSlug) {
      return { allowed: true };
    }

    const state = this.getOrCreateState(projectSlug);
    const now = Date.now();

    // Check circuit breaker
    if (state.circuitOpenedAt > 0) {
      const elapsed = now - state.circuitOpenedAt;
      if (elapsed < this.config.circuitResetTimeMs) {
        const waitTime = this.config.circuitResetTimeMs - elapsed;
        logger.warn("[ProjectIsolation] Circuit open, rejecting request", {
          projectSlug,
          waitTimeMs: waitTime,
          recentFailures: state.failures.length,
        });
        return {
          allowed: false,
          reason: "circuit_open",
          waitTimeMs: waitTime,
        };
      }
      // Circuit reset
      state.circuitOpenedAt = 0;
      state.failures = [];
      logger.info("[ProjectIsolation] Circuit reset", { projectSlug });
    }

    // Check concurrent limit
    if (state.inFlight >= this.config.maxConcurrentPerProject) {
      logger.warn("[ProjectIsolation] Max concurrent requests reached", {
        projectSlug,
        inFlight: state.inFlight,
        maxConcurrent: this.config.maxConcurrentPerProject,
      });
      return {
        allowed: false,
        reason: "max_concurrent",
      };
    }

    return { allowed: true };
  }

  /**
   * Record that a request has started.
   * Call this when starting to process a request.
   */
  startRequest(projectSlug: string | undefined): void {
    if (!projectSlug) return;

    const state = this.getOrCreateState(projectSlug);
    state.inFlight++;
    state.totalRequests++;
  }

  /**
   * Record that a request has completed.
   * Call this when a request finishes (success or failure).
   */
  completeRequest(projectSlug: string | undefined, timedOut: boolean): void {
    if (!projectSlug) return;

    const state = this.projects.get(projectSlug);
    if (!state) return;

    state.inFlight = Math.max(0, state.inFlight - 1);

    if (timedOut) {
      state.totalTimeouts++;
      const now = Date.now();
      state.failures.push(now);

      // Clean old failures
      state.failures = state.failures.filter(
        (t) => now - t < this.config.failureWindowMs,
      );

      // Check if circuit should open
      if (state.failures.length >= this.config.circuitBreakerThreshold) {
        state.circuitOpenedAt = now;
        logger.error("[ProjectIsolation] Circuit opened due to failures", {
          projectSlug,
          recentFailures: state.failures.length,
          threshold: this.config.circuitBreakerThreshold,
          resetAfterMs: this.config.circuitResetTimeMs,
        });
      }
    }
  }

  /**
   * Get stats for all projects (for monitoring/debugging).
   */
  getStats(): Record<string, {
    inFlight: number;
    recentFailures: number;
    circuitOpen: boolean;
    totalRequests: number;
    totalTimeouts: number;
  }> {
    const stats: Record<string, {
      inFlight: number;
      recentFailures: number;
      circuitOpen: boolean;
      totalRequests: number;
      totalTimeouts: number;
    }> = {};

    for (const [slug, state] of this.projects.entries()) {
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

  /**
   * Clean up resources.
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.projects.clear();
  }
}

// Singleton instance with configurable limits via env vars
const maxConcurrent = parseInt(getEnv("PROJECT_MAX_CONCURRENT") || "100", 10);
const circuitThreshold = parseInt(getEnv("PROJECT_CIRCUIT_THRESHOLD") || "20", 10);
const circuitResetMs = parseInt(getEnv("PROJECT_CIRCUIT_RESET_MS") || "60000", 10);

export const projectIsolation = new ProjectIsolationManager({
  maxConcurrentPerProject: maxConcurrent,
  circuitBreakerThreshold: circuitThreshold,
  circuitResetTimeMs: circuitResetMs,
});
