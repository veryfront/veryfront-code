import { serverLogger } from "#veryfront/utils";
import { getEnvNumber, unrefTimer } from "#veryfront/compat/process.ts";

const logger = serverLogger.component("project-isolation");

export interface ProjectIsolationConfig {
  maxConcurrentPerProject: number;
  circuitBreakerThreshold: number;
  circuitResetTimeMs: number;
  failureWindowMs: number;
}

interface ProjectState {
  inFlight: number;
  failures: number[];
  circuitOpenedAt: number;
  totalRequests: number;
  totalTimeouts: number;
}

export interface IsolationCheckResult {
  allowed: boolean;
  reason?: "circuit_open" | "max_concurrent";
  waitTimeMs?: number;
}

const DEFAULT_CONFIG: ProjectIsolationConfig = {
  maxConcurrentPerProject: 20,
  circuitBreakerThreshold: 5,
  circuitResetTimeMs: 30_000,
  failureWindowMs: 60_000,
};

export class ProjectIsolationManager {
  private projects = new Map<string, ProjectState>();
  private config: ProjectIsolationConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;

  constructor(config: Partial<ProjectIsolationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanup();
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();

      for (const [slug, state] of this.projects.entries()) {
        state.failures = state.failures.filter(
          (t) => now - t < this.config.failureWindowMs,
        );

        if (
          state.inFlight === 0 &&
          state.failures.length === 0 &&
          state.circuitOpenedAt === 0 &&
          state.totalRequests === 0
        ) {
          this.projects.delete(slug);
        }
      }
    }, 60_000);

    // Global singleton cleanup should not keep short-lived CLI processes alive.
    unrefTimer(this.cleanupInterval);
  }

  private getOrCreateState(projectSlug: string): ProjectState {
    const existing = this.projects.get(projectSlug);
    if (existing) return existing;

    const state: ProjectState = {
      inFlight: 0,
      failures: [],
      circuitOpenedAt: 0,
      totalRequests: 0,
      totalTimeouts: 0,
    };

    this.projects.set(projectSlug, state);
    return state;
  }

  checkRequest(projectSlug: string | undefined): IsolationCheckResult {
    if (!projectSlug) return { allowed: true };

    const state = this.getOrCreateState(projectSlug);
    const now = Date.now();

    if (state.circuitOpenedAt > 0) {
      const elapsed = now - state.circuitOpenedAt;

      if (elapsed < this.config.circuitResetTimeMs) {
        const waitTimeMs = this.config.circuitResetTimeMs - elapsed;

        logger.warn("Circuit open, rejecting request", {
          projectSlug,
          waitTimeMs,
          recentFailures: state.failures.length,
        });

        return { allowed: false, reason: "circuit_open", waitTimeMs };
      }

      state.circuitOpenedAt = 0;
      state.failures = [];
      logger.info("Circuit reset", { projectSlug });
    }

    if (state.inFlight >= this.config.maxConcurrentPerProject) {
      logger.warn("Max concurrent requests reached", {
        projectSlug,
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
    state.inFlight++;
    state.totalRequests++;
  }

  completeRequest(projectSlug: string | undefined, timedOut: boolean): void {
    if (!projectSlug) return;

    const state = this.projects.get(projectSlug);
    if (!state) return;

    state.inFlight = Math.max(0, state.inFlight - 1);
    if (!timedOut) return;

    state.totalTimeouts++;
    const now = Date.now();
    state.failures.push(now);

    state.failures = state.failures.filter(
      (t) => now - t < this.config.failureWindowMs,
    );

    if (state.failures.length < this.config.circuitBreakerThreshold) return;

    state.circuitOpenedAt = now;
    logger.error("Circuit opened due to failures", {
      projectSlug,
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

  shutdown(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.projects.clear();
  }
}

export const projectIsolation = new ProjectIsolationManager({
  maxConcurrentPerProject: getEnvNumber("PROJECT_MAX_CONCURRENT", 20),
  circuitBreakerThreshold: getEnvNumber("PROJECT_CIRCUIT_THRESHOLD", 5),
  circuitResetTimeMs: getEnvNumber("PROJECT_CIRCUIT_RESET_MS", 30_000),
});
