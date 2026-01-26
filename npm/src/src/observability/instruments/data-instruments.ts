import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import { DURATION_HISTOGRAM_BOUNDARIES_MS } from "../../config/defaults.js";
import type { MetricsConfig } from "../metrics/types.js";

export interface DataInstruments {
  dataFetchDuration: Histogram | null;
  dataFetchCounter: Counter | null;
  dataFetchErrorCounter: Counter | null;
}

export function createDataInstruments(
  meter: Meter,
  config: MetricsConfig,
): DataInstruments {
  return {
    dataFetchDuration: meter.createHistogram(
      `${config.prefix}.data.fetch.duration`,
      {
        description: "Data fetch duration",
        unit: "ms",
        advice: { explicitBucketBoundaries: [...DURATION_HISTOGRAM_BOUNDARIES_MS] },
      },
    ),
    dataFetchCounter: meter.createCounter(`${config.prefix}.data.fetch.count`, {
      description: "Total number of data fetches",
      unit: "fetches",
    }),
    dataFetchErrorCounter: meter.createCounter(
      `${config.prefix}.data.fetch.errors`,
      {
        description: "Data fetch errors",
        unit: "errors",
      },
    ),
  };
}
