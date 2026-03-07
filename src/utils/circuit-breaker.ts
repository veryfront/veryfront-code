/**
 * Circuit Breaker Pattern
 *
 * Prevents cascade failures by failing fast when a service is unhealthy.
 * States: CLOSED (normal) → OPEN (failing fast) → HALF_OPEN (testing recovery)
 *
 * @module utils/circuit-breaker
 */

import { logger as baseLogger } from "#veryfront/utils";

const logger = baseLogger.component("circuit-breaker");

/** Default number of consecutive failures before the circuit opens */
const DEFAULT_FAILURE_THRESHOLD = 5;

/** Default time to wait in OPEN state before attempting recovery (30 seconds) */
const DEFAULT_RESET_TIMEOUT_MS = 30_000;

/** Default number of successes in HALF_OPEN required to close the circuit */
const DEFAULT_SUCCESS_THRESHOLD = 3;

/** Maximum concurrent attempts allowed while the circuit is HALF_OPEN */
const MAX_HALF_OPEN_ATTEMPTS = 3;

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitBreakerOptions {
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
  readonly breakerName: string;
  readonly nextAttemptMs: number;

  constructor(
    breakerName: string,
    nextAttemptMs: number,
  ) {
    super(`Circuit breaker '${breakerName}' is open. Retry after ${nextAttemptMs}ms`);
    this.name = "CircuitBreakerOpen";
    this.breakerName = breakerName;
    this.nextAttemptMs = nextAttemptMs;
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
    this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.resetTimeoutMs = options.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS;
    this.successThreshold = options.successThreshold ?? DEFAULT_SUCCESS_THRESHOLD;
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
      if (this.halfOpenAttempts >= MAX_HALF_OPEN_ATTEMPTS) {
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

    logger.info(`${this.breakerName}: ${oldState} → ${newState}`);
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
const MAX_BREAKERS = 1_000;

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
    logger.debug(`Evicted stale breaker: ${name}`, {
      age: Math.round(age / 1000),
    });
  }

  if (evicted > 0) {
    logger.info(`Evicted ${evicted} stale breakers, ${breakers.size} remaining`);
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

