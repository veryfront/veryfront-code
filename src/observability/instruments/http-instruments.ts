import type { Counter, Histogram, Meter, UpDownCounter } from "@opentelemetry/api";
import { DURATION_HISTOGRAM_BOUNDARIES_MS } from "#veryfront/config/defaults.ts";
import type { MetricsConfig } from "../metrics/types.ts";

export interface HttpInstruments {
  httpRequestCounter: Counter | null;
  httpRequestDuration: Histogram | null;
  httpActiveRequests: UpDownCounter | null;
}

export function createHttpInstruments(meter: Meter, config: MetricsConfig): HttpInstruments {
  const prefix = config.prefix;

  return {
    httpRequestCounter: meter.createCounter(`${prefix}.http.requests`, {
      description: "Total number of HTTP requests",
      unit: "requests",
    }),
    httpRequestDuration: meter.createHistogram(`${prefix}.http.request.duration`, {
      description: "HTTP request duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: [...DURATION_HISTOGRAM_BOUNDARIES_MS] },
    }),
    httpActiveRequests: meter.createUpDownCounter(`${prefix}.http.requests.active`, {
      description: "Number of active HTTP requests",
      unit: "requests",
    }),
  };
}
