/**
 * Metrics Instruments Factory
 * Main orchestrator for initializing all metric instruments
 *
 * @module
 */

import type { Meter } from "npm:@opentelemetry/api@1";
import { serverLogger as logger } from "@veryfront/utils";
import type { MetricsConfig, MetricsInstruments, RuntimeState } from "../metrics/types.ts";
import { createBuildInstruments } from "./build-instruments.ts";
import { createCacheInstruments } from "./cache-instruments.ts";
import { createDataInstruments } from "./data-instruments.ts";
import { createHttpInstruments } from "./http-instruments.ts";
import { createMemoryInstruments } from "./memory-instruments.ts";
import { createRenderInstruments } from "./render-instruments.ts";
import { createRscInstruments } from "./rsc-instruments.ts";

/**
 * Initialize all metric instruments
 *
 * This function creates all OpenTelemetry metric instruments organized by category:
 * - HTTP metrics (requests, duration, active requests)
 * - Cache metrics (hits, misses, size)
 * - Render metrics (duration, count, errors)
 * - RSC metrics (render, stream, actions)
 * - Build metrics (duration, bundle size)
 * - Data fetching metrics (duration, count, errors)
 * - Memory metrics (usage, heap)
 *
 * Note: This function is async to maintain backward compatibility with the original API,
 * even though current implementation is synchronous.
 *
 * @param meter - OpenTelemetry meter instance
 * @param config - Metrics configuration
 * @param runtimeState - Runtime state for observable metrics
 * @returns Promise resolving to all metric instruments
 *
 * @example
 * ```ts
 * const instruments = await initializeInstruments(meter, config, runtimeState);
 * instruments.httpRequestCounter?.add(1, { method: "GET", status: 200 });
 * ```
 */
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
    // Create HTTP metrics
    const httpInstruments = createHttpInstruments(meter, config);
    Object.assign(instruments, httpInstruments);

    // Create cache metrics
    const cacheInstruments = createCacheInstruments(meter, config, runtimeState);
    Object.assign(instruments, cacheInstruments);

    // Create render metrics
    const renderInstruments = createRenderInstruments(meter, config);
    Object.assign(instruments, renderInstruments);

    // Create RSC metrics
    const rscInstruments = createRscInstruments(meter, config);
    Object.assign(instruments, rscInstruments);

    // Create build metrics
    const buildInstruments = createBuildInstruments(meter, config);
    Object.assign(instruments, buildInstruments);

    // Create data fetching metrics
    const dataInstruments = createDataInstruments(meter, config);
    Object.assign(instruments, dataInstruments);

    // Create memory metrics
    const memoryInstruments = createMemoryInstruments(meter, config);
    Object.assign(instruments, memoryInstruments);
  } catch (error) {
    logger.warn("[metrics] Failed to initialize metric instruments", error);
  }

  return Promise.resolve(instruments);
}
