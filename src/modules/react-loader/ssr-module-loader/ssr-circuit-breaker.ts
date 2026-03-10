/**
 * SSR Circuit Breaker
 *
 * Circuit breaker pattern for SSR module transform failures.
 * Tracks component failures and temporarily blocks repeated transform attempts
 * for components that have exceeded the failure threshold.
 *
 * @module module-system/react-loader/ssr-module-loader/ssr-circuit-breaker
 */

import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { CIRCUIT_BREAKER_RESET_MS, CIRCUIT_BREAKER_THRESHOLD } from "./constants.ts";
import { failedComponents } from "./cache/index.ts";

/**
 * Manages the circuit breaker state for SSR module transforms.
 *
 * When a component fails to transform/load repeatedly (exceeding the threshold),
 * the circuit breaker "opens" and blocks further attempts for a cooldown period.
 * After the cooldown, the circuit resets and allows retry attempts.
 */
export class SSRCircuitBreaker {
  /**
   * Check if the circuit breaker is open for a given cache key.
   * Throws if the component has exceeded the failure threshold and
   * the cooldown period hasn't elapsed.
   */
  check(circuitKey: string, filePath: string): void {
    const failureRecord = failedComponents.get(circuitKey);
    if (!failureRecord) return;

    const timeSinceFailure = Date.now() - failureRecord.lastFailure;

    if (
      failureRecord.count >= CIRCUIT_BREAKER_THRESHOLD &&
      timeSinceFailure < CIRCUIT_BREAKER_RESET_MS
    ) {
      throw toError(
        createError({
          type: "runtime",
          message:
            `Component ${filePath} is temporarily blocked due to repeated failures. Will retry in ${
              Math.ceil((CIRCUIT_BREAKER_RESET_MS - timeSinceFailure) / 1000)
            }s.`,
          context: {
            file: filePath,
            phase: "circuit-breaker",
            failures: failureRecord.count,
          },
        }),
      );
    }

    if (timeSinceFailure >= CIRCUIT_BREAKER_RESET_MS) {
      failedComponents.delete(circuitKey);
    }
  }

  /**
   * Record a successful load, resetting the failure count.
   */
  recordSuccess(circuitKey: string): void {
    failedComponents.delete(circuitKey);
  }

  /**
   * Record a failure, incrementing the failure count.
   */
  recordFailure(circuitKey: string): void {
    const existing = failedComponents.get(circuitKey);
    failedComponents.set(circuitKey, {
      count: (existing?.count ?? 0) + 1,
      lastFailure: Date.now(),
    });
  }
}
