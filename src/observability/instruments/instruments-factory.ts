import type { Meter } from "@opentelemetry/api";
import { serverLogger } from "#veryfront/utils";
import type { MetricsConfig, MetricsInstruments, RuntimeState } from "../metrics/types.ts";
import { createBuildInstruments } from "./build-instruments.ts";
import { createCacheInstruments } from "./cache-instruments.ts";
import { createDataInstruments } from "./data-instruments.ts";
import { createErrorInstruments } from "./error-instruments.ts";
import { createHttpInstruments } from "./http-instruments.ts";
import { createMemoryInstruments } from "./memory-instruments.ts";
import { createRenderInstruments } from "./render-instruments.ts";
import { createRscInstruments } from "./rsc-instruments.ts";

const logger = serverLogger.component("metrics");

export function initializeInstruments(
  meter: Meter,
  config: MetricsConfig,
  runtimeState: RuntimeState,
): Promise<MetricsInstruments> {
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

  try {
    Object.assign(instruments, {
      ...createHttpInstruments(meter, config),
      ...createCacheInstruments(meter, config, runtimeState),
      ...createRenderInstruments(meter, config),
      ...createRscInstruments(meter, config),
      ...createBuildInstruments(meter, config),
      ...createDataInstruments(meter, config),
      ...createMemoryInstruments(meter, config),
      ...createErrorInstruments(meter, config),
    });
  } catch (error) {
    logger.warn("Failed to initialize metric instruments", error);
  }

  return Promise.resolve(instruments);
}
