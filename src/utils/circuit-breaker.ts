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
      const remaining = this.resetTimeoutMs - (Date.now() - this.lastFailureTime);
      if (remaining > 0) throw new CircuitBreakerOpen(this.breakerName, remaining);
      this.transitionTo("HALF_OPEN");
    }

    if (this.state === "HALF_OPEN") {
      if (this.halfOpenAttempts >= 3) {
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

    if (this.failureCount >= this.failureThreshold) {
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
    }

    if (newState === "HALF_OPEN") {
      this.successCount = 0;
      this.halfOpenAttempts = 0;
    }

    logger.info(`[CircuitBreaker] ${this.breakerName}: ${oldState} → ${newState}`);
  }

  getState(): CircuitState {
    return this.state;
  }

  /** Get the last activity time (failure or success) */
  getLastActivityTime(): number {
    return this.lastFailureTime || Date.now();
  }

  /** Update last activity time on use */
  touch(): void {
    if (this.state !== "CLOSED" || this.failureCount !== 0) return;
    this.lastFailureTime = Date.now();
  }
}

/** Maximum number of circuit breakers to keep in registry */
const MAX_BREAKERS = 1000;

/** Minimum age (ms) before a breaker can be evicted (1 hour) */
const MIN_EVICTION_AGE_MS = 60 * 60 * 1000;

interface BreakerEntry {
  breaker: CircuitBreaker;
  lastUsed: number;
}

const breakers = new Map<string, BreakerEntry>();

/** Evict stale circuit breakers to prevent memory leaks */
function evictStaleBreakers(): void {
  if (breakers.size <= MAX_BREAKERS) return;

  const now = Date.now();
  const entries = Array.from(breakers.entries()).sort((a, b) => a[1].lastUsed - b[1].lastUsed);

  const toEvict = entries.length - MAX_BREAKERS;
  let evicted = 0;

  for (const [name, entry] of entries) {
    if (evicted >= toEvict) break;

    const age = now - entry.lastUsed;
    if (age < MIN_EVICTION_AGE_MS) continue;
    if (entry.breaker.getState() !== "CLOSED") continue;

    breakers.delete(name);
    evicted++;
    logger.debug(`[CircuitBreaker] Evicted stale breaker: ${name}`, {
      age: Math.round(age / 1000),
    });
  }

  if (evicted > 0) {
    logger.info(`[CircuitBreaker] Evicted ${evicted} stale breakers, ${breakers.size} remaining`);
  }
}

export function getCircuitBreaker(
  name: string,
  options?: Omit<CircuitBreakerOptions, "name">,
): CircuitBreaker {
  const existing = breakers.get(name);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.breaker;
  }

  evictStaleBreakers();

  const breaker = new CircuitBreaker({ ...options, name });
  breakers.set(name, { breaker, lastUsed: Date.now() });
  return breaker;
}

/** Get circuit breaker registry stats for monitoring */
export function getCircuitBreakerStats(): {
  total: number;
  open: number;
  halfOpen: number;
  closed: number;
} {
  let open = 0;
  let halfOpen = 0;
  let closed = 0;

  for (const { breaker } of breakers.values()) {
    const state = breaker.getState();
    if (state === "OPEN") open++;
    else if (state === "HALF_OPEN") halfOpen++;
    else closed++;
  }

  return { total: breakers.size, open, halfOpen, closed };
}
