/**
 * Circuit Breaker Pattern
 *
 * Prevents cascade failures by failing fast when a service is unhealthy.
 * States: CLOSED (normal) → OPEN (failing fast) → HALF_OPEN (testing recovery)
 *
 * @module utils/circuit-breaker
 */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";
export interface CircuitBreakerOptions {
    /** Failures before opening (default: 5) */
    failureThreshold?: number;
    /** Ms to wait before retry (default: 30000) */
    resetTimeoutMs?: number;
    /** Successes to close (default: 3) */
    successThreshold?: number;
    /** Optional name for logging */
    name?: string;
}
export declare class CircuitBreakerOpen extends Error {
    readonly breakerName: string;
    readonly nextAttemptMs: number;
    constructor(breakerName: string, nextAttemptMs: number);
}
export declare class CircuitBreaker {
    private state;
    private failureCount;
    private successCount;
    private lastFailureTime;
    private halfOpenAttempts;
    private readonly failureThreshold;
    private readonly resetTimeoutMs;
    private readonly successThreshold;
    private readonly breakerName;
    constructor(options?: CircuitBreakerOptions);
    /** Execute operation through circuit breaker. Throws CircuitBreakerOpen if open. */
    execute<T>(operation: () => Promise<T>): Promise<T>;
    private recordSuccess;
    private recordFailure;
    private transitionTo;
    getState(): CircuitState;
    /** Get the last activity time (failure or success) */
    getLastActivityTime(): number;
    /** Update last activity time on use */
    touch(): void;
}
export declare function getCircuitBreaker(name: string, options?: Omit<CircuitBreakerOptions, "name">): CircuitBreaker;
/** Get circuit breaker registry stats for monitoring */
export declare function getCircuitBreakerStats(): {
    total: number;
    open: number;
    halfOpen: number;
    closed: number;
};
//# sourceMappingURL=circuit-breaker.d.ts.map