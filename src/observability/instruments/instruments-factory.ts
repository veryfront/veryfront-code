
import type { Meter } from "@opentelemetry/api";
import { serverLogger as logger } from "@veryfront/utils";
import type { MetricsConfig, MetricsInstruments, RuntimeState } from "../metrics/types.ts";
import { createBuildInstruments } from "./build-instruments.ts";
import { createCacheInstruments } from "./cache-instruments.ts";
import { createDataInstruments } from "./data-instruments.ts";
import { createHttpInstruments } from "./http-instruments.ts";
import { createMemoryInstruments } from "./memory-instruments.ts";
import { createRenderInstruments } from "./render-instruments.ts";
import { createRscInstruments } from "./rsc-instruments.ts";

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
  };

  try {
    const httpInstruments = createHttpInstruments(meter, config);
    Object.assign(instruments, httpInstruments);

    const cacheInstruments = createCacheInstruments(meter, config, runtimeState);
    Object.assign(instruments, cacheInstruments);

    const renderInstruments = createRenderInstruments(meter, config);
    Object.assign(instruments, renderInstruments);

    const rscInstruments = createRscInstruments(meter, config);
    Object.assign(instruments, rscInstruments);

    const buildInstruments = createBuildInstruments(meter, config);
    Object.assign(instruments, buildInstruments);

    const dataInstruments = createDataInstruments(meter, config);
    Object.assign(instruments, dataInstruments);

    const memoryInstruments = createMemoryInstruments(meter, config);
    Object.assign(instruments, memoryInstruments);
  } catch (error) {
    logger.warn("[metrics] Failed to initialize metric instruments", error);
  }

  return Promise.resolve(instruments);
}
