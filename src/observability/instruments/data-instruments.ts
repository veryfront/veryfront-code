/**
 * Data Fetching Metrics Instruments
 * Creation of data fetching metric instruments
 *
 * @module
 */

import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import { DURATION_HISTOGRAM_BOUNDARIES_MS } from "@veryfront/config";
import type { MetricsConfig } from "../metrics/types.ts";

/**
 * Data fetching metric instruments
 */
export interface DataInstruments {
  dataFetchDuration: Histogram | null;
  dataFetchCounter: Counter | null;
  dataFetchErrorCounter: Counter | null;
}

/**
 * Create data fetching metric instruments
 *
 * @param meter - OpenTelemetry meter instance
 * @param config - Metrics configuration
 * @returns Data fetching metric instruments
 *
 * @example
 * ```ts
 * const dataInstruments = createDataInstruments(meter, config);
 * dataInstruments.dataFetchCounter?.add(1);
 * ```
 */
export function createDataInstruments(
  meter: Meter,
  config: MetricsConfig,
): DataInstruments {
  const dataFetchDuration = meter.createHistogram(
    `${config.prefix}.data.fetch.duration`,
    {
      description: "Data fetch duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: DURATION_HISTOGRAM_BOUNDARIES_MS },
    },
  );

  const dataFetchCounter = meter.createCounter(
    `${config.prefix}.data.fetch.count`,
    {
      description: "Total number of data fetches",
      unit: "fetches",
    },
  );

  const dataFetchErrorCounter = meter.createCounter(
    `${config.prefix}.data.fetch.errors`,
    {
      description: "Data fetch errors",
      unit: "errors",
    },
  );

  return {
    dataFetchDuration,
    dataFetchCounter,
    dataFetchErrorCounter,
  };
}
