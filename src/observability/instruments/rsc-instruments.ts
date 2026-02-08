import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import { DURATION_HISTOGRAM_BOUNDARIES_MS } from "#veryfront/config/defaults.ts";
import type { MetricsConfig } from "../metrics/types.ts";

export interface RscInstruments {
  rscRenderDuration: Histogram | null;
  rscStreamDuration: Histogram | null;
  rscManifestCounter: Counter | null;
  rscPageCounter: Counter | null;
  rscStreamCounter: Counter | null;
  rscActionCounter: Counter | null;
  rscErrorCounter: Counter | null;
}

export function createRscInstruments(
  meter: Meter,
  config: MetricsConfig,
): RscInstruments {
  const prefix = `${config.prefix}.rsc`;
  const advice = {
    explicitBucketBoundaries: [...DURATION_HISTOGRAM_BOUNDARIES_MS],
  };

  const rscRenderDuration = meter.createHistogram(`${prefix}.render.duration`, {
    description: "RSC render duration",
    unit: "ms",
    advice,
  });

  const rscStreamDuration = meter.createHistogram(`${prefix}.stream.duration`, {
    description: "RSC stream duration",
    unit: "ms",
    advice,
  });

  function createRequestCounter(name: string, description: string): Counter {
    return meter.createCounter(`${prefix}.${name}`, {
      description,
      unit: "requests",
    });
  }

  const rscManifestCounter = createRequestCounter(
    "manifest",
    "RSC manifest requests",
  );
  const rscPageCounter = createRequestCounter("page", "RSC page requests");
  const rscStreamCounter = createRequestCounter("stream", "RSC stream requests");
  const rscActionCounter = createRequestCounter("action", "RSC action requests");

  const rscErrorCounter = meter.createCounter(`${prefix}.errors`, {
    description: "RSC errors",
    unit: "errors",
  });

  return {
    rscRenderDuration,
    rscStreamDuration,
    rscManifestCounter,
    rscPageCounter,
    rscStreamCounter,
    rscActionCounter,
    rscErrorCounter,
  };
}
