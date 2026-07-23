/**
 * Error metrics instruments
 *
 * Provides unified error tracking with slug-based identification for
 * observability dashboards and alerting.
 */

import type { Counter, Meter } from "#veryfront/observability/tracing/api-shim.ts";
import type { MetricsConfig } from "../metrics/types.ts";
import type { VeryfrontError } from "#veryfront/errors/types.ts";
import { sanitizeTelemetryAttributes } from "../telemetry-safety.ts";

export interface ErrorInstruments {
  errorCounter: Counter | null;
}

/**
 * Create error tracking instruments
 *
 * - errorCounter: Total errors by slug, category, and status
 */
export function createErrorInstruments(meter: Meter, config: MetricsConfig): ErrorInstruments {
  const prefix = config.prefix;

  return {
    errorCounter: meter.createCounter(`${prefix}.error.count`, {
      description: "Total errors by slug and category",
      unit: "errors",
    }),
  };
}

/**
 * Record an error occurrence with metrics
 *
 * Increments error counter with slug, category, and status labels.
 * Used by error boundaries to automatically track all errors.
 *
 * @param error - The VeryfrontError to record
 * @param errorCounter - Optional counter override (for testing)
 */
export function recordError(
  error: VeryfrontError,
  errorCounter?: Counter | null,
): void {
  if (!errorCounter) {
    return;
  }

  try {
    errorCounter.add(
      1,
      sanitizeTelemetryAttributes({
        slug: error.slug,
        category: error.category,
        status: Number.isSafeInteger(error.status) ? String(error.status) : "unknown",
      }),
    );
  } catch {
    // Error metrics must not affect error handling.
  }
}
