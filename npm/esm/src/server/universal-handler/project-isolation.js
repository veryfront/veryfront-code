import * as dntShim from "../../../_dnt.shims.js";
import { serverLogger as logger } from "../../utils/index.js";
import { getEnv } from "../../platform/compat/process.js";
const DEFAULT_CONFIG = {
    maxConcurrentPerProject: 20,
    circuitBreakerThreshold: 5,
    circuitResetTimeMs: 30_000,
    failureWindowMs: 60_000,
};
export class ProjectIsolationManager {
    projects = new Map();
    config;
    cleanupInterval;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.startCleanup();
    }
    startCleanup() {
        this.cleanupInterval = dntShim.setInterval(() => {
            const now = Date.now();
            for (const [slug, state] of this.projects.entries()) {
                state.failures = state.failures.filter((t) => now - t < this.config.failureWindowMs);
                if (state.inFlight === 0 &&
                    state.failures.length === 0 &&
                    state.circuitOpenedAt === 0 &&
                    state.totalRequests === 0) {
                    this.projects.delete(slug);
                }
            }
        }, 60_000);
    }
    getOrCreateState(projectSlug) {
        const existing = this.projects.get(projectSlug);
        if (existing)
            return existing;
        const state = {
            inFlight: 0,
            failures: [],
            circuitOpenedAt: 0,
            totalRequests: 0,
            totalTimeouts: 0,
        };
        this.projects.set(projectSlug, state);
        return state;
    }
    checkRequest(projectSlug) {
        if (!projectSlug)
            return { allowed: true };
        const state = this.getOrCreateState(projectSlug);
        const now = Date.now();
        if (state.circuitOpenedAt > 0) {
            const elapsed = now - state.circuitOpenedAt;
            if (elapsed < this.config.circuitResetTimeMs) {
                const waitTimeMs = this.config.circuitResetTimeMs - elapsed;
                logger.warn("[ProjectIsolation] Circuit open, rejecting request", {
                    projectSlug,
                    waitTimeMs,
                    recentFailures: state.failures.length,
                });
                return { allowed: false, reason: "circuit_open", waitTimeMs };
            }
            state.circuitOpenedAt = 0;
            state.failures = [];
            logger.info("[ProjectIsolation] Circuit reset", { projectSlug });
        }
        if (state.inFlight >= this.config.maxConcurrentPerProject) {
            logger.warn("[ProjectIsolation] Max concurrent requests reached", {
                projectSlug,
                inFlight: state.inFlight,
                maxConcurrent: this.config.maxConcurrentPerProject,
            });
            return { allowed: false, reason: "max_concurrent" };
        }
        return { allowed: true };
    }
    startRequest(projectSlug) {
        if (!projectSlug)
            return;
        const state = this.getOrCreateState(projectSlug);
        state.inFlight++;
        state.totalRequests++;
    }
    completeRequest(projectSlug, timedOut) {
        if (!projectSlug)
            return;
        const state = this.projects.get(projectSlug);
        if (!state)
            return;
        state.inFlight = Math.max(0, state.inFlight - 1);
        if (!timedOut)
            return;
        state.totalTimeouts++;
        const now = Date.now();
        state.failures.push(now);
        state.failures = state.failures.filter((t) => now - t < this.config.failureWindowMs);
        if (state.failures.length < this.config.circuitBreakerThreshold)
            return;
        state.circuitOpenedAt = now;
        logger.error("[ProjectIsolation] Circuit opened due to failures", {
            projectSlug,
            recentFailures: state.failures.length,
            threshold: this.config.circuitBreakerThreshold,
            resetAfterMs: this.config.circuitResetTimeMs,
        });
    }
    getStats() {
        const stats = {};
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
    shutdown() {
        if (this.cleanupInterval)
            clearInterval(this.cleanupInterval);
        this.projects.clear();
    }
}
function parseEnvInt(name, fallback) {
    const value = getEnv(name);
    if (!value)
        return fallback;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}
const maxConcurrent = parseEnvInt("PROJECT_MAX_CONCURRENT", 20);
const circuitThreshold = parseEnvInt("PROJECT_CIRCUIT_THRESHOLD", 5);
const circuitResetMs = parseEnvInt("PROJECT_CIRCUIT_RESET_MS", 30_000);
export const projectIsolation = new ProjectIsolationManager({
    maxConcurrentPerProject: maxConcurrent,
    circuitBreakerThreshold: circuitThreshold,
    circuitResetTimeMs: circuitResetMs,
});
