/**
 * Runtime/application metric hooks for project code.
 *
 * @module metrics
 *
 * @example Record application metrics
 * ```ts
 * import { metrics } from "veryfront/metrics";
 *
 * metrics.counter("orders_processed_total", 1, { status: "completed" });
 * metrics.histogram("order_processing_ms", 240);
 * metrics.gauge("orders_queued", 3);
 * ```
 */

import { counter, gauge, histogram } from "./index.ts";

export {
  counter,
  gauge,
  histogram,
  type MetricAttributes,
  type MetricAttributeValue,
  type MetricInstrumentOptions,
} from "./index.ts";

/** Immutable metric recording facade for project code. */
export const metrics = Object.freeze({ counter, histogram, gauge });
