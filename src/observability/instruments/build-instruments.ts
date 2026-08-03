import type { Counter, Histogram, Meter } from "#veryfront/observability/tracing/api-shim.ts";
import {
  DURATION_HISTOGRAM_BOUNDARIES_MS,
  SIZE_HISTOGRAM_BOUNDARIES_KB,
} from "#veryfront/config/defaults.ts";
import type { MetricsConfig } from "../metrics/types.ts";

export interface BuildInstruments {
  buildDuration: Histogram | null;
  bundleSizeHistogram: Histogram | null;
  bundleCounter: Counter | null;
  dependencyArtifactBuildCounter: Counter | null;
  dependencyArtifactBuildDuration: Histogram | null;
  dependencyArtifactBuildBytes: Histogram | null;
  dependencyArtifactBuildAssetCount: Histogram | null;
  dependencyArtifactBuildExternalImportCount: Histogram | null;
}

export function createBuildInstruments(
  meter: Meter,
  config: MetricsConfig,
): BuildInstruments {
  const prefix = config.prefix;

  return {
    buildDuration: meter.createHistogram(`${prefix}.build.duration`, {
      description: "Build operation duration",
      unit: "ms",
      advice: { explicitBucketBoundaries: [...DURATION_HISTOGRAM_BOUNDARIES_MS] },
    }),
    bundleSizeHistogram: meter.createHistogram(`${prefix}.build.bundle.size`, {
      description: "Bundle size distribution",
      unit: "kb",
      advice: { explicitBucketBoundaries: [...SIZE_HISTOGRAM_BOUNDARIES_KB] },
    }),
    bundleCounter: meter.createCounter(`${prefix}.build.bundles`, {
      description: "Total number of bundles created",
      unit: "bundles",
    }),
    dependencyArtifactBuildCounter: meter.createCounter(
      `${prefix}.dependency_artifact.builds`,
      { description: "Dependency artifact build lifecycle events", unit: "events" },
    ),
    dependencyArtifactBuildDuration: meter.createHistogram(
      `${prefix}.dependency_artifact.build.duration`,
      { description: "Dependency artifact build duration", unit: "ms" },
    ),
    dependencyArtifactBuildBytes: meter.createHistogram(
      `${prefix}.dependency_artifact.build.bytes`,
      { description: "Dependency artifact build output bytes", unit: "bytes" },
    ),
    dependencyArtifactBuildAssetCount: meter.createHistogram(
      `${prefix}.dependency_artifact.build.assets`,
      { description: "Dependency artifact build asset count", unit: "assets" },
    ),
    dependencyArtifactBuildExternalImportCount: meter.createHistogram(
      `${prefix}.dependency_artifact.build.external_imports`,
      {
        description: "Allowed external imports remaining after artifact materialization",
        unit: "imports",
      },
    ),
  };
}
