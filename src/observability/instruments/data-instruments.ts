import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import { DURATION_HISTOGRAM_BOUNDARIES_MS } from "../../config/defaults.ts";
import type { MetricsConfig } from "../metrics/types.ts";

export interface DataInstruments {
  dataFetchDuration: Histogram | null;
  dataFetchCounter: Counter | null;
  dataFetchErrorCounter: Counter | null;
}

export function createDataInstruments(
  meter: Meter,
  config: MetricsConfig,
): DataInstruments {
  const prefix = config.prefix;

  return {
    dataFetchDuration: meter.createHistogram(`${prefix}.data.fetch.duration`, {
      description: "Data fetch duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: [...DURATION_HISTOGRAM_BOUNDARIES_MS] },
    }),
    dataFetchCounter: meter.createCounter(`${prefix}.data.fetch.count`, {
      description: "Total number of data fetches",
      unit: "fetches",
    }),
    dataFetchErrorCounter: meter.createCounter(`${prefix}.data.fetch.errors`, {
      description: "Data fetch errors",
      unit: "errors",
    }),
  };
}
