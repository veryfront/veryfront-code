/**
 * Runtime/application metric hooks for project code.
 *
 * @module metrics
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
