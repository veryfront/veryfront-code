
import type { Counter, Histogram, Meter, UpDownCounter } from "@opentelemetry/api";
import { DURATION_HISTOGRAM_BOUNDARIES_MS } from "@veryfront/config";
import type { MetricsConfig } from "../metrics/types.ts";

export interface HttpInstruments {
  httpRequestCounter: Counter | null;
  httpRequestDuration: Histogram | null;
  httpActiveRequests: UpDownCounter | null;
}

export function createHttpInstruments(
  meter: Meter,
  config: MetricsConfig,
): HttpInstruments {
  const httpRequestCounter = meter.createCounter(
    `${config.prefix}.http.requests`,
    {
      description: "Total number of HTTP requests",
      unit: "requests",
    },
  );

  const httpRequestDuration = meter.createHistogram(
    `${config.prefix}.http.request.duration`,
    {
      description: "HTTP request duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: DURATION_HISTOGRAM_BOUNDARIES_MS },
    },
  );

  const httpActiveRequests = meter.createUpDownCounter(
    `${config.prefix}.http.requests.active`,
    {
      description: "Number of active HTTP requests",
      unit: "requests",
    },
  );

  return {
    httpRequestCounter,
    httpRequestDuration,
    httpActiveRequests,
  };
}
