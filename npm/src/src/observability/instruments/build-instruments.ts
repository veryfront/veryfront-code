/**
 * Build Metrics Instruments
 * Creation of build-related metric instruments
 *
 * @module
 */

import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import {
  DURATION_HISTOGRAM_BOUNDARIES_MS,
  SIZE_HISTOGRAM_BOUNDARIES_KB,
} from "../../config/defaults.js";
import type { MetricsConfig } from "../metrics/types.js";

export interface BuildInstruments {
  buildDuration: Histogram | null;
  bundleSizeHistogram: Histogram | null;
  bundleCounter: Counter | null;
}

export function createBuildInstruments(
  meter: Meter,
  config: MetricsConfig,
): BuildInstruments {
  return {
    buildDuration: meter.createHistogram(`${config.prefix}.build.duration`, {
      description: "Build operation duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: [...DURATION_HISTOGRAM_BOUNDARIES_MS] },
    }),
    bundleSizeHistogram: meter.createHistogram(
      `${config.prefix}.build.bundle.size`,
      {
        description: "Bundle size distribution",
        unit: "kb",
        advice: { explicitBucketBoundaries: [...SIZE_HISTOGRAM_BOUNDARIES_KB] },
      },
    ),
    bundleCounter: meter.createCounter(`${config.prefix}.build.bundles`, {
      description: "Total number of bundles created",
      unit: "bundles",
    }),
  };
}
