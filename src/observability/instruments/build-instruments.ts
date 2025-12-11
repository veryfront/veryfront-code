
import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import { DURATION_HISTOGRAM_BOUNDARIES_MS, SIZE_HISTOGRAM_BOUNDARIES_KB } from "@veryfront/config";
import type { MetricsConfig } from "../metrics/types.ts";

export interface BuildInstruments {
  buildDuration: Histogram | null;
  bundleSizeHistogram: Histogram | null;
  bundleCounter: Counter | null;
}

export function createBuildInstruments(
  meter: Meter,
  config: MetricsConfig,
): BuildInstruments {
  const buildDuration = meter.createHistogram(
    `${config.prefix}.build.duration`,
    {
      description: "Build operation duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: DURATION_HISTOGRAM_BOUNDARIES_MS },
    },
  );

  const bundleSizeHistogram = meter.createHistogram(
    `${config.prefix}.build.bundle.size`,
    {
      description: "Bundle size distribution",
      unit: "kb",
      advice: { explicitBucketBoundaries: SIZE_HISTOGRAM_BOUNDARIES_KB },
    },
  );

  const bundleCounter = meter.createCounter(
    `${config.prefix}.build.bundles`,
    {
      description: "Total number of bundles created",
      unit: "bundles",
    },
  );

  return {
    buildDuration,
    bundleSizeHistogram,
    bundleCounter,
  };
}
