/**
 * Circuit Breaker Pattern
 *
 * Prevents cascade failures by failing fast when a service is unhealthy.
 * States: CLOSED (normal) → OPEN (failing fast) → HALF_OPEN (testing recovery)
 *
 * @module utils/circuit-breaker
 */

import { logger as baseLogger } from "#veryfront/utils/logger/index.ts";
import { CIRCUIT_BREAKER_OPEN } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";

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

export interface CircuitBreakerOptions {
  /** Failures before opening (default: 5) */
  failureThreshold?: number;
  /**
   * Ms to wait before retrying an open circuit and before aging an isolated
   * failure from a closed circuit (default: 30000).
   */
  resetTimeoutMs?: number;
  /** Successes to close (default: 3) */
  successThreshold?: number;
  /** Optional name for logging */
  name?: string;
  /**
   * Clock used for timeout decisions. Defaults to {@link Date.now}.
   * Supplying a clock makes timeout behavior deterministic in tests and in
   * runtimes that provide their own monotonic wall-clock adapter.
   */
  now?: () => number;
}

function requireIntegerOption(value: number, option: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    const requirement = minimum === 0 ? "a non-negative integer" : "a positive integer";
    throw new RangeError(`${option} must be ${requirement}`);
  }
  return value;
}

/**
 * Thrown when an operation is attempted while the circuit breaker is open.
 *
 * Extends {@link VeryfrontError} so it carries registry slug/status/category
 * and RFC-9457 fields, while remaining `instanceof CircuitBreakerOpen` for
 * existing catch sites.
 */
export class CircuitBreakerOpen extends VeryfrontError {
  readonly breakerName: string;
  readonly nextAttemptMs: number;

  constructor(
    breakerName: string,
    nextAttemptMs: number,
  ) {
    super(`Circuit breaker '${breakerName}' is open. Retry after ${nextAttemptMs}ms`, {
      slug: CIRCUIT_BREAKER_OPEN.slug,
      category: CIRCUIT_BREAKER_OPEN.category,
      status: CIRCUIT_BREAKER_OPEN.status,
      title: CIRCUIT_BREAKER_OPEN.title,
      suggestion: CIRCUIT_BREAKER_OPEN.suggestion,
      context: { breakerName, nextAttemptMs },
    });
    this.name = "CircuitBreakerOpen";
    this.breakerName = breakerName;
    this.nextAttemptMs = nextAttemptMs;
  }
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | undefined;
  private halfOpenAttempts = 0;
  private activeExecutions = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly successThreshold: number;
  private readonly breakerName: string;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = requireIntegerOption(
      options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD,
      "failureThreshold",
      1,
    );
    this.resetTimeoutMs = requireIntegerOption(
      options.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS,
      "resetTimeoutMs",
      0,
    );
    this.successThreshold = requireIntegerOption(
      options.successThreshold ?? DEFAULT_SUCCESS_THRESHOLD,
      "successThreshold",
      1,
    );
    this.breakerName = options.name ?? "default";
    if (options.now !== undefined && typeof options.now !== "function") {
      throw new TypeError("now must be a function");
    }
    this.now = options.now ?? Date.now;
  }

  /** Execute operation through circuit breaker. Throws CircuitBreakerOpen if open. */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const now = this.currentTime();
    this.expireClosedFailureHistory(now);

    if (this.state === "OPEN") {
      const elapsed = this.lastFailureTime === undefined
        ? 0
        : Math.max(0, now - this.lastFailureTime);
      const remaining = this.resetTimeoutMs - elapsed;
      if (remaining > 0) throw new CircuitBreakerOpen(this.breakerName, remaining);
      this.transitionTo("HALF_OPEN");
    }

    let halfOpenProbe = false;
    if (this.state === "HALF_OPEN") {
      if (this.halfOpenAttempts >= MAX_HALF_OPEN_ATTEMPTS) {
        throw new CircuitBreakerOpen(this.breakerName, 0);
      }
      this.halfOpenAttempts++;
      halfOpenProbe = true;
    }

    this.activeExecutions++;
    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    } finally {
      if (halfOpenProbe && this.state === "HALF_OPEN") {
        this.halfOpenAttempts--;
      }
      this.activeExecutions--;
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
    this.lastFailureTime = this.currentTime();

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

  private currentTime(): number {
    const now = this.now();
    if (!Number.isFinite(now)) {
      throw new RangeError("now must return a finite timestamp");
    }
    return now;
  }

  /**
   * Forget an isolated CLOSED-state failure once it is older than the reset
   * window. Until then the failure remains protected against registry churn;
   * afterwards an idle breaker can be reclaimed instead of occupying capacity
   * forever when a dependency recovered without another call.
   */
  private expireClosedFailureHistory(now: number): void {
    if (
      this.state !== "CLOSED" ||
      this.activeExecutions !== 0 ||
      this.failureCount === 0 ||
      this.lastFailureTime === undefined
    ) {
      return;
    }

    const elapsed = Math.max(0, now - this.lastFailureTime);
    if (elapsed >= this.resetTimeoutMs) {
      this.failureCount = 0;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  /** Whether the breaker has no admitted operation still executing. */
  isIdle(): boolean {
    return this.activeExecutions === 0;
  }

  /**
   * Whether capacity pressure may safely forget this breaker.
   *
   * A closed breaker with failures below its opening threshold still carries
   * protection state. Evicting it would reset the consecutive-failure count
   * and let dependency-name churn prevent the circuit from ever opening.
   */
  isSafeToEvict(): boolean {
    this.expireClosedFailureHistory(this.currentTime());
    return this.state === "CLOSED" && this.activeExecutions === 0 && this.failureCount === 0;
  }

  /** Get the last activity time (failure or success) */
  getLastActivityTime(): number {
    return this.lastFailureTime ?? this.currentTime();
  }

  /** Update last activity time on use */
  touch(): void {
    if (this.state !== "CLOSED" || this.failureCount !== 0) return;
    this.lastFailureTime = this.currentTime();
  }
}

/** Maximum number of circuit breakers to keep in registry */
const MAX_BREAKERS = 1_000;

interface BreakerEntry {
  breaker: CircuitBreaker;
  lastUsed: number;
}

export interface CircuitBreakerRegistry {
  readonly size: number;
  get(name: string, options?: Omit<CircuitBreakerOptions, "name">): CircuitBreaker;
  clear(): void;
}

/**
 * Create a hard-bounded breaker registry.
 *
 * Capacity pressure evicts only closed breakers. Open and half-open breakers
 * encode active protection for an unhealthy dependency; forgetting them would
 * fail open and immediately resume downstream traffic. If every slot is
 * protected, admission of a new breaker therefore fails closed.
 */
export function createCircuitBreakerRegistry(maxBreakers = MAX_BREAKERS): CircuitBreakerRegistry {
  requireIntegerOption(maxBreakers, "maxBreakers", 1);
  const entries = new Map<string, BreakerEntry>();
  let accessSequence = 0;

  function evictClosedBreaker(): boolean {
    let candidate: { name: string; lastUsed: number } | undefined;
    for (const [name, entry] of entries) {
      if (!entry.breaker.isSafeToEvict()) continue;
      if (!candidate || entry.lastUsed < candidate.lastUsed) {
        candidate = { name, lastUsed: entry.lastUsed };
      }
    }
    if (!candidate) return false;

    entries.delete(candidate.name);
    logger.debug(`Evicted closed breaker: ${candidate.name}`);
    return true;
  }

  function get(
    name: string,
    options?: Omit<CircuitBreakerOptions, "name">,
  ): CircuitBreaker {
    const existing = entries.get(name);
    if (existing) {
      existing.lastUsed = ++accessSequence;
      return existing.breaker;
    }

    if (entries.size >= maxBreakers && !evictClosedBreaker()) {
      logger.warn("Circuit breaker registry is full of active protections", {
        maxBreakers,
        rejectedBreaker: name,
      });
      throw new CircuitBreakerOpen(name, DEFAULT_RESET_TIMEOUT_MS);
    }

    const breaker = new CircuitBreaker({ ...options, name });
    entries.set(name, { breaker, lastUsed: ++accessSequence });
    return breaker;
  }

  return {
    get size() {
      return entries.size;
    },
    get,
    clear() {
      entries.clear();
    },
  };
}

const defaultRegistry = createCircuitBreakerRegistry();

export function getCircuitBreaker(
  name: string,
  options?: Omit<CircuitBreakerOptions, "name">,
): CircuitBreaker {
  return defaultRegistry.get(name, options);
}
