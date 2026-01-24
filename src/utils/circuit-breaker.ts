/**
 * Circuit Breaker Pattern
 *
 * Prevents cascade failures by failing fast when a service is unhealthy.
 * States: CLOSED (normal) → OPEN (failing fast) → HALF_OPEN (testing recovery)
 *
 * @module utils/circuit-breaker
 */

import { logger } from "#veryfront/utils";

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

export class CircuitBreakerOpen extends Error {
  constructor(
    public readonly breakerName: string,
    public readonly nextAttemptMs: number,
  ) {
    super(`Circuit breaker '${breakerName}' is open. Retry after ${nextAttemptMs}ms`);
    this.name = "CircuitBreakerOpen";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly successThreshold: number;
  private readonly breakerName: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30000;
    this.successThreshold = options.successThreshold ?? 3;
    this.breakerName = options.name ?? "default";
  }

  /** Execute operation through circuit breaker. Throws CircuitBreakerOpen if open. */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
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
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private recordSuccess(): void {
    this.failureCount = 0;

    if (this.state !== "HALF_OPEN") return;

    this.successCount++;
    if (this.successCount >= this.successThreshold) {
      this.transitionTo("CLOSED");
    }
  }

  private recordFailure(): void {
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

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    if (newState === "CLOSED") {
      this.successCount = 0;
      this.halfOpenAttempts = 0;
      this.failureCount = 0;
    } else if (newState === "HALF_OPEN") {
      this.successCount = 0;
      this.halfOpenAttempts = 0;
    }

    logger.info(`[CircuitBreaker] ${this.breakerName}: ${oldState} → ${newState}`);
  }

  getState(): CircuitState {
    return this.state;
  }
}

const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(
  name: string,
  options?: Omit<CircuitBreakerOptions, "name">,
): CircuitBreaker {
  const existing = breakers.get(name);
  if (existing) return existing;

  const breaker = new CircuitBreaker({ ...options, name });
  breakers.set(name, breaker);
  return breaker;
}
