import type { Meter } from "#veryfront/observability/tracing/api-shim.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import type { MetricsConfig, MetricsInstruments, RuntimeState } from "../metrics/types.ts";
import { createBuildInstruments } from "./build-instruments.ts";
import { createCacheInstruments, createCacheObservableBindings } from "./cache-instruments.ts";
import { createDataInstruments } from "./data-instruments.ts";
import { createErrorInstruments } from "./error-instruments.ts";
import { createHttpInstruments } from "./http-instruments.ts";
import { createMemoryInstruments, createMemoryObservableBindings } from "./memory-instruments.ts";
import { installObservableCallbacks } from "./observable-callbacks.ts";
import { createRenderInstruments } from "./render-instruments.ts";
import { createRscInstruments } from "./rsc-instruments.ts";

const logger = serverLogger.component("metrics");
const instrumentDisposers = new WeakMap<MetricsInstruments, () => void>();
const initializedInstrumentSets = new WeakSet<MetricsInstruments>();

export function createEmptyInstruments(): MetricsInstruments {
  return {
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
}

export function disposeInstruments(instruments: MetricsInstruments): void {
  const dispose = instrumentDisposers.get(instruments);
  instrumentDisposers.delete(instruments);
  dispose?.();
}

export function isInitializedInstrumentSet(instruments: MetricsInstruments): boolean {
  return initializedInstrumentSets.has(instruments);
}

export function initializeInstruments(
  meter: Meter,
  config: MetricsConfig,
  runtimeState: RuntimeState,
): MetricsInstruments {
  const emptyInstruments = createEmptyInstruments();

  try {
    const instruments: MetricsInstruments = {
      ...emptyInstruments,
      ...createHttpInstruments(meter, config),
      ...createCacheInstruments(meter, config),
      ...createRenderInstruments(meter, config),
      ...createRscInstruments(meter, config),
      ...createBuildInstruments(meter, config),
      ...createDataInstruments(meter, config),
      ...createMemoryInstruments(meter, config),
      ...createErrorInstruments(meter, config),
    };
    const dispose = installObservableCallbacks([
      ...createCacheObservableBindings(instruments, runtimeState),
      ...createMemoryObservableBindings(instruments),
    ]);
    instrumentDisposers.set(instruments, dispose);
    initializedInstrumentSets.add(instruments);
    return instruments;
  } catch (error) {
    logger.warn("Failed to initialize metric instruments", error);
    return emptyInstruments;
  }
}
