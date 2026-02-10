import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import { DURATION_HISTOGRAM_BOUNDARIES_MS } from "#veryfront/config/defaults.ts";
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
  const prefix = config.prefix;

  return {
    renderDuration: meter.createHistogram(`${prefix}.render.duration`, {
      description: "Page render duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: [...DURATION_HISTOGRAM_BOUNDARIES_MS] },
    }),
    renderCounter: meter.createCounter(`${prefix}.render.count`, {
      description: "Total number of page renders",
      unit: "renders",
    }),
    renderErrorCounter: meter.createCounter(`${prefix}.render.errors`, {
      description: "Total number of render errors",
      unit: "errors",
    }),
  };
}
