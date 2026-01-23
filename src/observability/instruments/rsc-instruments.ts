/**
 * RSC Metrics Instruments
 * Creation of React Server Components metric instruments
 *
 * @module
 */

import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import { DURATION_HISTOGRAM_BOUNDARIES_MS } from "../../config/defaults.ts";
import type { MetricsConfig } from "../metrics/types.ts";

/**
 * RSC metric instruments
 */
export interface RscInstruments {
  rscRenderDuration: Histogram | null;
  rscStreamDuration: Histogram | null;
  rscManifestCounter: Counter | null;
  rscPageCounter: Counter | null;
  rscStreamCounter: Counter | null;
  rscActionCounter: Counter | null;
  rscErrorCounter: Counter | null;
}

/**
 * Create RSC metric instruments
 *
 * @param meter - OpenTelemetry meter instance
 * @param config - Metrics configuration
 * @returns RSC metric instruments
 *
 * @example
 * ```ts
 * const rscInstruments = createRscInstruments(meter, config);
 * rscInstruments.rscPageCounter?.add(1);
 * ```
 */
export function createRscInstruments(
  meter: Meter,
  config: MetricsConfig,
): RscInstruments {
  const rscRenderDuration = meter.createHistogram(
    `${config.prefix}.rsc.render.duration`,
    {
      description: "RSC render duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: DURATION_HISTOGRAM_BOUNDARIES_MS },
    },
  );

  const rscStreamDuration = meter.createHistogram(
    `${config.prefix}.rsc.stream.duration`,
    {
      description: "RSC stream duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: DURATION_HISTOGRAM_BOUNDARIES_MS },
    },
  );

  const rscManifestCounter = meter.createCounter(
    `${config.prefix}.rsc.manifest`,
    {
      description: "RSC manifest requests",
      unit: "requests",
    },
  );

  const rscPageCounter = meter.createCounter(
    `${config.prefix}.rsc.page`,
    {
      description: "RSC page requests",
      unit: "requests",
    },
  );

  const rscStreamCounter = meter.createCounter(
    `${config.prefix}.rsc.stream`,
    {
      description: "RSC stream requests",
      unit: "requests",
    },
  );

  const rscActionCounter = meter.createCounter(
    `${config.prefix}.rsc.action`,
    {
      description: "RSC action requests",
      unit: "requests",
    },
  );

  const rscErrorCounter = meter.createCounter(
    `${config.prefix}.rsc.errors`,
    {
      description: "RSC errors",
      unit: "errors",
    },
  );

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
