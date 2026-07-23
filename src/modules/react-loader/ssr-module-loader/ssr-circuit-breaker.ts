/**
 * SSR Circuit Breaker
 *
 * Circuit breaker pattern for SSR module transform failures.
 * Tracks component failures and temporarily blocks repeated transform attempts
 * for components that have exceeded the failure threshold.
 *
 * @module module-system/react-loader/ssr-module-loader/ssr-circuit-breaker
 */

import { CIRCUIT_BREAKER_OPEN } from "#veryfront/errors";
import { CIRCUIT_BREAKER_RESET_MS, CIRCUIT_BREAKER_THRESHOLD } from "./constants.ts";
import { failedComponents } from "./cache/index.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const MAX_CIRCUIT_KEY_LENGTH = 16_384;

function validateCircuitKey(circuitKey: string): void {
  if (
    circuitKey.length === 0 || circuitKey.length > MAX_CIRCUIT_KEY_LENGTH ||
    hasUnsafeControlCharacters(circuitKey)
  ) {
    throw new TypeError("Circuit breaker identity is invalid");
  }
}

/**
 * Manages the circuit breaker state for SSR module transforms.
 *
 * When a component fails to transform/load repeatedly (exceeding the threshold),
 * the circuit breaker "opens" and blocks further attempts for a cooldown period.
 * After the cooldown, the circuit resets and allows retry attempts.
 */
export class SSRCircuitBreaker {
  constructor(private now: () => number = Date.now) {}

  /**
   * Check if the circuit breaker is open for a given cache key.
   * Throws if the component has exceeded the failure threshold and
   * the cooldown period hasn't elapsed.
   */
  check(circuitKey: string, _filePath: string): void {
    validateCircuitKey(circuitKey);
    const failureRecord = failedComponents.get(circuitKey);
    if (!failureRecord) return;

    const timeSinceFailure = Math.max(0, this.now() - failureRecord.lastFailure);

    if (
      failureRecord.count >= CIRCUIT_BREAKER_THRESHOLD &&
      timeSinceFailure < CIRCUIT_BREAKER_RESET_MS
    ) {
      const retryAfterSeconds = Math.ceil(
        (CIRCUIT_BREAKER_RESET_MS - timeSinceFailure) / 1000,
      );
      throw CIRCUIT_BREAKER_OPEN.create({
        detail: `Component loading is temporarily unavailable. Retry in ${retryAfterSeconds}s.`,
        context: { retryAfterSeconds },
      });
    }

    if (timeSinceFailure >= CIRCUIT_BREAKER_RESET_MS) {
      failedComponents.delete(circuitKey);
    }
  }

  /**
   * Record a successful load, resetting the failure count.
   */
  recordSuccess(circuitKey: string): void {
    validateCircuitKey(circuitKey);
    failedComponents.delete(circuitKey);
  }

  /**
   * Record a failure, incrementing the failure count.
   */
  recordFailure(circuitKey: string): void {
    validateCircuitKey(circuitKey);
    const existing = failedComponents.get(circuitKey);
    failedComponents.set(circuitKey, {
      count: Math.min(CIRCUIT_BREAKER_THRESHOLD, (existing?.count ?? 0) + 1),
      lastFailure: this.now(),
    });
  }
}
