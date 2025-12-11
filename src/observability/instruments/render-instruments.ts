
import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import { DURATION_HISTOGRAM_BOUNDARIES_MS } from "@veryfront/config";
import type { MetricsConfig } from "../metrics/types.ts";

export interface RenderInstruments {
  renderDuration: Histogram | null;
  renderCounter: Counter | null;
  renderErrorCounter: Counter | null;
}

export function createRenderInstruments(
  meter: Meter,
  config: MetricsConfig,
): RenderInstruments {
  const renderDuration = meter.createHistogram(
    `${config.prefix}.render.duration`,
    {
      description: "Page render duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: DURATION_HISTOGRAM_BOUNDARIES_MS },
    },
  );

  const renderCounter = meter.createCounter(
    `${config.prefix}.render.count`,
    {
      description: "Total number of page renders",
      unit: "renders",
    },
  );

  const renderErrorCounter = meter.createCounter(
    `${config.prefix}.render.errors`,
    {
      description: "Total number of render errors",
      unit: "errors",
    },
  );

  return {
    renderDuration,
    renderCounter,
    renderErrorCounter,
  };
}
