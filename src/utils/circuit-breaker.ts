/**
 * Circuit Breaker Pattern
 *
 * Prevents cascade failures by failing fast when a service is unhealthy.
 * States: CLOSED (normal) → OPEN (failing fast) → HALF_OPEN (testing recovery)
 *
 * @module utils/circuit-breaker
 */

import { logger as baseLogger } from "#veryfront/utils/logger/index.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";
import {
  CIRCUIT_BREAKER_OPEN,
  SERVICE_OVERLOADED,
} from "#veryfront/errors/error-registry/server.ts";
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

/** Maximum length accepted for registry and diagnostic names. */
const MAX_BREAKER_NAME_LENGTH = 256;

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitBreakerOptions {
  /** Failures before opening (default: 5) */
  failureThreshold?: number;
  /** Ms to wait before retry (default: 30000) */
  resetTimeoutMs?: number;
  /** Successes to close (default: 3) */
  successThreshold?: number;
  /** Optional diagnostic identity. Serialized errors and logs omit this value. */
  name?: string;
}

interface ResolvedCircuitBreakerOptions {
  failureThreshold: number;
  name: string;
  resetTimeoutMs: number;
  successThreshold: number;
}

function invalidCircuitBreakerOption(message: string): Error {
  return INVALID_ARGUMENT.create({ message });
}

function resolveCircuitBreakerOptions(
  options: CircuitBreakerOptions,
  registryName?: { value: unknown },
): ResolvedCircuitBreakerOptions {
  if (options === null || typeof options !== "object") {
    throw invalidCircuitBreakerOption("Circuit breaker options must be an object");
  }

  let failureThreshold: unknown;
  let resetTimeoutMs: unknown;
  let successThreshold: unknown;
  let optionName: unknown;
  try {
    failureThreshold = options.failureThreshold;
    resetTimeoutMs = options.resetTimeoutMs;
    successThreshold = options.successThreshold;
    if (!registryName) optionName = options.name;
  } catch {
    throw invalidCircuitBreakerOption("Circuit breaker options are not readable");
  }

  const resolvedFailureThreshold = failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
  if (
    !Number.isSafeInteger(resolvedFailureThreshold) ||
    (resolvedFailureThreshold as number) <= 0
  ) {
    throw invalidCircuitBreakerOption(
      "Circuit breaker failureThreshold must be a positive safe integer",
    );
  }

  const resolvedResetTimeoutMs = resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(resolvedResetTimeoutMs) ||
    (resolvedResetTimeoutMs as number) < 0
  ) {
    throw invalidCircuitBreakerOption(
      "Circuit breaker resetTimeoutMs must be a non-negative safe integer",
    );
  }

  const resolvedSuccessThreshold = successThreshold ?? DEFAULT_SUCCESS_THRESHOLD;
  if (
    !Number.isSafeInteger(resolvedSuccessThreshold) ||
    (resolvedSuccessThreshold as number) <= 0
  ) {
    throw invalidCircuitBreakerOption(
      "Circuit breaker successThreshold must be a positive safe integer",
    );
  }

  const resolvedName = registryName ? registryName.value : optionName ?? "default";
  if (
    typeof resolvedName !== "string" || resolvedName.length === 0 ||
    resolvedName.length > MAX_BREAKER_NAME_LENGTH ||
    hasControlCharacters(resolvedName)
  ) {
    throw invalidCircuitBreakerOption(
      "Circuit breaker name must be a safe non-empty string",
    );
  }

  return {
    failureThreshold: resolvedFailureThreshold as number,
    name: resolvedName,
    resetTimeoutMs: resolvedResetTimeoutMs as number,
    successThreshold: resolvedSuccessThreshold as number,
  };
}

/**
 * Thrown when an operation is attempted while the circuit breaker is open.
 *
 * Extends {@link VeryfrontError} so it carries registry slug/status/category
 * and RFC-9457 fields, while remaining `instanceof CircuitBreakerOpen` for
 * existing catch sites.
 */
export class CircuitBreakerOpen extends VeryfrontError {
  /** Diagnostic identity for direct programmatic inspection. This property is not enumerable. */
  readonly breakerName: string;
  readonly nextAttemptMs: number;

  constructor(
    breakerName: string,
    nextAttemptMs: number,
  ) {
    super(`Circuit breaker is unavailable. Retry after ${nextAttemptMs}ms`, {
      slug: CIRCUIT_BREAKER_OPEN.slug,
      category: CIRCUIT_BREAKER_OPEN.category,
      status: CIRCUIT_BREAKER_OPEN.status,
      title: CIRCUIT_BREAKER_OPEN.title,
      suggestion: CIRCUIT_BREAKER_OPEN.suggestion,
      context: { nextAttemptMs },
    });
    this.name = "CircuitBreakerOpen";
    this.breakerName = breakerName;
    Object.defineProperty(this, "breakerName", { enumerable: false });
    this.nextAttemptMs = nextAttemptMs;
  }
}

const breakerEvictionChecks = new WeakMap<object, () => boolean>();

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private lastActivityTime = Date.now();
  private activeExecutions = 0;
  private halfOpenGeneration = 0;
  private halfOpenInFlight = 0;
  private closedFromHalfOpenGeneration: number | undefined;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly successThreshold: number;
  private readonly breakerName: string;

  constructor(options: CircuitBreakerOptions = {}) {
    const config = resolveCircuitBreakerOptions(options);
    this.failureThreshold = config.failureThreshold;
    this.resetTimeoutMs = config.resetTimeoutMs;
    this.successThreshold = config.successThreshold;
    this.breakerName = config.name;
    breakerEvictionChecks.set(
      this,
      () => this.activeExecutions === 0 && this.state === "CLOSED",
    );
  }

  /** Execute operation through circuit breaker. Throws CircuitBreakerOpen if open. */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (typeof operation !== "function") {
      throw invalidCircuitBreakerOption("Circuit breaker operation must be a function");
    }
    this.touch();

    if (this.state === "OPEN") {
      const remaining = this.resetTimeoutMs - (Date.now() - this.lastFailureTime);
      if (remaining > 0) throw new CircuitBreakerOpen(this.breakerName, remaining);
      this.transitionTo("HALF_OPEN");
    }

    let probeGeneration: number | undefined;
    if (this.state === "HALF_OPEN") {
      if (this.halfOpenInFlight >= MAX_HALF_OPEN_ATTEMPTS) {
        throw new CircuitBreakerOpen(this.breakerName, 0);
      }
      probeGeneration = this.halfOpenGeneration;
      this.halfOpenInFlight++;
    }

    this.activeExecutions++;
    try {
      const result = await operation();
      this.recordSuccess(probeGeneration);
      return result;
    } catch (error) {
      this.recordFailure(probeGeneration);
      throw error;
    } finally {
      this.activeExecutions--;
      this.lastActivityTime = Date.now();
      if (
        probeGeneration !== undefined &&
        probeGeneration === this.halfOpenGeneration && this.halfOpenInFlight > 0
      ) {
        this.halfOpenInFlight--;
        if (
          this.halfOpenInFlight === 0 && this.state === "CLOSED" &&
          this.closedFromHalfOpenGeneration === probeGeneration
        ) {
          this.closedFromHalfOpenGeneration = undefined;
        }
      }
    }
  }

  private recordSuccess(probeGeneration: number | undefined): void {
    if (probeGeneration === undefined) {
      if (this.state === "CLOSED") this.failureCount = 0;
      return;
    }

    if (
      this.state === "HALF_OPEN" &&
      probeGeneration === this.halfOpenGeneration
    ) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.closedFromHalfOpenGeneration = probeGeneration;
        this.transitionTo("CLOSED");
      }
    }
  }

  private recordFailure(probeGeneration: number | undefined): void {
    if (probeGeneration !== undefined) {
      if (probeGeneration !== this.halfOpenGeneration) return;
      if (
        this.state === "HALF_OPEN" ||
        (this.state === "CLOSED" &&
          this.closedFromHalfOpenGeneration === probeGeneration)
      ) {
        this.lastFailureTime = Date.now();
        this.failureCount++;
        this.transitionTo("OPEN");
      }
      return;
    }

    this.lastFailureTime = Date.now();
    this.failureCount++;
    if (
      this.state === "HALF_OPEN" ||
      (this.state === "CLOSED" && this.failureCount >= this.failureThreshold)
    ) {
      this.transitionTo("OPEN");
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    if (newState === "CLOSED") {
      this.successCount = 0;
      this.failureCount = 0;
    }

    if (newState === "HALF_OPEN") {
      this.halfOpenGeneration++;
      this.halfOpenInFlight = 0;
      this.successCount = 0;
      this.closedFromHalfOpenGeneration = undefined;
    }

    if (newState === "OPEN") {
      this.successCount = 0;
      this.closedFromHalfOpenGeneration = undefined;
    }

    logger.info("Circuit breaker state changed", {
      previousState: oldState,
      state: newState,
    });
  }

  getState(): CircuitState {
    return this.state;
  }

  /** Get the last activity time (failure or success) */
  getLastActivityTime(): number {
    return this.lastActivityTime;
  }

  /** Update last activity time on use */
  touch(): void {
    this.lastActivityTime = Date.now();
  }
}

/** Maximum number of circuit breakers to keep in registry */
const MAX_BREAKERS = 1_000;

interface BreakerEntry {
  breaker: CircuitBreaker;
  config: ResolvedCircuitBreakerOptions;
  lastUsed: number;
}

const breakers = new Map<string, BreakerEntry>();

/** Evict the least recently used idle breaker before inserting at the hard cap. */
function ensureBreakerRegistryCapacity(): void {
  if (breakers.size < MAX_BREAKERS) return;

  let oldest: { lastUsed: number; name: string } | undefined;
  for (const [name, entry] of breakers) {
    if (breakerEvictionChecks.get(entry.breaker)?.() !== true) continue;
    const lastUsed = Math.max(entry.lastUsed, entry.breaker.getLastActivityTime());
    if (!oldest || lastUsed < oldest.lastUsed) oldest = { lastUsed, name };
  }

  if (!oldest) {
    throw SERVICE_OVERLOADED.create({
      message: "Circuit breaker registry capacity reached",
    });
  }

  breakers.delete(oldest.name);
  logger.debug("Evicted idle circuit breaker", {
    ageSeconds: Math.max(0, Math.round((Date.now() - oldest.lastUsed) / 1000)),
  });
}

export function getCircuitBreaker(
  name: string,
  options?: Omit<CircuitBreakerOptions, "name">,
): CircuitBreaker {
  const config = resolveCircuitBreakerOptions(
    options === undefined ? {} : options,
    { value: name },
  );
  const existing = breakers.get(name);
  if (existing) {
    if (
      existing.config.failureThreshold !== config.failureThreshold ||
      existing.config.resetTimeoutMs !== config.resetTimeoutMs ||
      existing.config.successThreshold !== config.successThreshold
    ) {
      throw invalidCircuitBreakerOption(
        "Circuit breaker name is already configured with different options",
      );
    }
    existing.lastUsed = Date.now();
    existing.breaker.touch();
    return existing.breaker;
  }

  ensureBreakerRegistryCapacity();

  const breaker = new CircuitBreaker({
    failureThreshold: config.failureThreshold,
    name: config.name,
    resetTimeoutMs: config.resetTimeoutMs,
    successThreshold: config.successThreshold,
  });
  breakers.set(name, { breaker, config, lastUsed: Date.now() });
  return breaker;
}
