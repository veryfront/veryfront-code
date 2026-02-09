/**
 * Error metrics instruments
 *
 * Provides unified error tracking with slug-based identification for
 * observability dashboards and alerting.
 */

import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import type { MetricsConfig } from "../metrics/types.ts";
import type { VeryfrontError } from "#veryfront/errors/types.ts";

export interface ErrorInstruments {
  errorCounter: Counter | null;
  errorRate: Histogram | null;
}

/**
 * Create error tracking instruments
 *
 * - errorCounter: Total errors by slug, category, and status
 * - errorRate: Error rate histogram for spike detection
 */
export function createErrorInstruments(meter: Meter, config: MetricsConfig): ErrorInstruments {
  const prefix = config.prefix;

  return {
    errorCounter: meter.createCounter(`${prefix}.error.count`, {
      description: "Total errors by slug and category",
      unit: "errors",
    }),
    errorRate: meter.createHistogram(`${prefix}.error.rate`, {
      description: "Error rate tracking for spike detection",
      unit: "errors/s",
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

  errorCounter.add(1, {
    slug: error.slug,
    category: error.category,
    status: String(error.status),
  });
}
