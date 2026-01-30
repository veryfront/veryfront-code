/**
 * Circuit Breaker Pattern
 *
 * Prevents cascade failures by failing fast when a service is unhealthy.
 * States: CLOSED (normal) → OPEN (failing fast) → HALF_OPEN (testing recovery)
 *
 * @module utils/circuit-breaker
 */
import { logger } from "./index.js";
export class CircuitBreakerOpen extends Error {
    breakerName;
    nextAttemptMs;
    constructor(breakerName, nextAttemptMs) {
        super(`Circuit breaker '${breakerName}' is open. Retry after ${nextAttemptMs}ms`);
        this.breakerName = breakerName;
        this.nextAttemptMs = nextAttemptMs;
        this.name = "CircuitBreakerOpen";
    }
}
export class CircuitBreaker {
    state = "CLOSED";
    failureCount = 0;
    successCount = 0;
    lastFailureTime = 0;
    halfOpenAttempts = 0;
    failureThreshold;
    resetTimeoutMs;
    successThreshold;
    breakerName;
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold ?? 5;
        this.resetTimeoutMs = options.resetTimeoutMs ?? 30000;
        this.successThreshold = options.successThreshold ?? 3;
        this.breakerName = options.name ?? "default";
    }
    /** Execute operation through circuit breaker. Throws CircuitBreakerOpen if open. */
    async execute(operation) {
        if (this.state === "OPEN") {
            const elapsed = Date.now() - this.lastFailureTime;
            const remaining = this.resetTimeoutMs - elapsed;
            if (remaining > 0) {
                throw new CircuitBreakerOpen(this.breakerName, remaining);
            }
            this.transitionTo("HALF_OPEN");
        }
        if (this.state === "HALF_OPEN") {
            if (this.halfOpenAttempts >= 3) {
                // Too many half-open attempts failed - transition back to OPEN
                this.transitionTo("OPEN");
                this.lastFailureTime = Date.now();
                throw new CircuitBreakerOpen(this.breakerName, this.resetTimeoutMs);
            }
            this.halfOpenAttempts++;
        }
        try {
            const result = await operation();
            this.recordSuccess();
            return result;
        }
        catch (error) {
            this.recordFailure();
            throw error;
        }
    }
    recordSuccess() {
        this.failureCount = 0;
        if (this.state !== "HALF_OPEN")
            return;
        this.successCount++;
        if (this.successCount >= this.successThreshold) {
            this.transitionTo("CLOSED");
        }
    }
    recordFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.state === "HALF_OPEN") {
            this.transitionTo("OPEN");
            return;
        }
        if (this.state === "CLOSED" && this.failureCount >= this.failureThreshold) {
            this.transitionTo("OPEN");
        }
    }
    transitionTo(newState) {
        const oldState = this.state;
        this.state = newState;
        if (newState === "CLOSED") {
            this.successCount = 0;
            this.halfOpenAttempts = 0;
            this.failureCount = 0;
        }
        else if (newState === "HALF_OPEN") {
            this.successCount = 0;
            this.halfOpenAttempts = 0;
        }
        logger.info(`[CircuitBreaker] ${this.breakerName}: ${oldState} → ${newState}`);
    }
    getState() {
        return this.state;
    }
    /** Get the last activity time (failure or success) */
    getLastActivityTime() {
        return this.lastFailureTime || Date.now();
    }
    /** Update last activity time on use */
    touch() {
        if (this.state === "CLOSED" && this.failureCount === 0) {
            // Only update for healthy breakers to track activity
            this.lastFailureTime = Date.now();
        }
    }
}
/** Maximum number of circuit breakers to keep in registry */
const MAX_BREAKERS = 1000;
/** Minimum age (ms) before a breaker can be evicted (1 hour) */
const MIN_EVICTION_AGE_MS = 60 * 60 * 1000;
const breakers = new Map();
/** Evict stale circuit breakers to prevent memory leaks */
function evictStaleBreakers() {
    if (breakers.size <= MAX_BREAKERS)
        return;
    const now = Date.now();
    const entries = Array.from(breakers.entries());
    // Sort by last used time (oldest first)
    entries.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    // Evict oldest entries that are past minimum age, keeping at most MAX_BREAKERS
    const toEvict = entries.length - MAX_BREAKERS;
    let evicted = 0;
    for (const [name, entry] of entries) {
        if (evicted >= toEvict)
            break;
        const age = now - entry.lastUsed;
        // Only evict if idle for at least MIN_EVICTION_AGE_MS and in CLOSED state
        if (age >= MIN_EVICTION_AGE_MS && entry.breaker.getState() === "CLOSED") {
            breakers.delete(name);
            evicted++;
            logger.debug(`[CircuitBreaker] Evicted stale breaker: ${name}`, {
                age: Math.round(age / 1000),
            });
        }
    }
    if (evicted > 0) {
        logger.info(`[CircuitBreaker] Evicted ${evicted} stale breakers, ${breakers.size} remaining`);
    }
}
export function getCircuitBreaker(name, options) {
    const existing = breakers.get(name);
    if (existing) {
        existing.lastUsed = Date.now();
        return existing.breaker;
    }
    // Evict stale breakers before adding new one
    evictStaleBreakers();
    const breaker = new CircuitBreaker({ ...options, name });
    breakers.set(name, { breaker, lastUsed: Date.now() });
    return breaker;
}
/** Get circuit breaker registry stats for monitoring */
export function getCircuitBreakerStats() {
    let open = 0;
    let halfOpen = 0;
    let closed = 0;
    for (const entry of breakers.values()) {
        switch (entry.breaker.getState()) {
            case "OPEN":
                open++;
                break;
            case "HALF_OPEN":
                halfOpen++;
                break;
            case "CLOSED":
                closed++;
                break;
        }
    }
    return { total: breakers.size, open, halfOpen, closed };
}
