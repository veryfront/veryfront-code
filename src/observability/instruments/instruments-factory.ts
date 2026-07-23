import type { Meter } from "#veryfront/observability/tracing/api-shim.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import type { MetricsConfig, MetricsInstruments, RuntimeState } from "../metrics/types.ts";
import { createBuildInstruments } from "./build-instruments.ts";
import { createCacheInstruments } from "./cache-instruments.ts";
import { createDataInstruments } from "./data-instruments.ts";
import { createErrorInstruments } from "./error-instruments.ts";
import { createHttpInstruments } from "./http-instruments.ts";
import { createMemoryInstruments } from "./memory-instruments.ts";
import { createRenderInstruments } from "./render-instruments.ts";
import { createRscInstruments } from "./rsc-instruments.ts";
import { classifyTelemetryError } from "../telemetry-safety.ts";

const logger = serverLogger.component("metrics");

export function initializeInstruments(
  meter: Meter,
  config: MetricsConfig,
  runtimeState: RuntimeState,
): MetricsInstruments {
  const instruments: MetricsInstruments = {
    httpRequestCounter: null,
    httpRequestDuration: null,
    httpActiveRequests: null,
    cacheGetCounter: null,
    cacheHitCounter: null,
    cacheMissCounter: null,
    cacheSetCounter: null,
    cacheInvalidateCounter: null,
    cacheSizeGauge: null,
    renderDuration: null,
    renderCounter: null,
    renderErrorCounter: null,
    rscRenderDuration: null,
    rscStreamDuration: null,
    rscManifestCounter: null,
    rscPageCounter: null,
    rscStreamCounter: null,
    rscActionCounter: null,
    rscErrorCounter: null,
    buildDuration: null,
    bundleSizeHistogram: null,
    bundleCounter: null,
    dataFetchDuration: null,
    dataFetchCounter: null,
    dataFetchErrorCounter: null,
    corsRejectionCounter: null,
    securityHeadersCounter: null,
    memoryUsageGauge: null,
    heapUsageGauge: null,
    heapTotalGauge: null,
    heapPercentGauge: null,
    errorCounter: null,
  };

  const groups: ReadonlyArray<{
    name: string;
    create(): Partial<MetricsInstruments>;
  }> = [
    { name: "http", create: () => createHttpInstruments(meter, config) },
    { name: "cache", create: () => createCacheInstruments(meter, config, runtimeState) },
    { name: "render", create: () => createRenderInstruments(meter, config) },
    { name: "rsc", create: () => createRscInstruments(meter, config) },
    { name: "build", create: () => createBuildInstruments(meter, config) },
    { name: "data", create: () => createDataInstruments(meter, config) },
    { name: "memory", create: () => createMemoryInstruments(meter, config) },
    { name: "error", create: () => createErrorInstruments(meter, config) },
  ];

  for (const group of groups) {
    try {
      Object.assign(instruments, group.create());
    } catch (error) {
      try {
        logger.warn("Failed to initialize metric instrument group", {
          failure_category: classifyTelemetryError(error),
          instrument_group: group.name,
        });
      } catch {
        // Metric initialization remains best effort when logging is unavailable.
      }
    }
  }

  return instruments;
}
