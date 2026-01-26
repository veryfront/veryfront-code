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
}
const breakers = new Map();
export function getCircuitBreaker(name, options) {
    const existing = breakers.get(name);
    if (existing)
        return existing;
    const breaker = new CircuitBreaker({ ...options, name });
    breakers.set(name, breaker);
    return breaker;
}
