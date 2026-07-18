/**
 * Metrics Manager
 * Main OpenTelemetry metrics initialization and management
 */

import type { Meter } from "#veryfront/observability/tracing/api-shim.ts";
import { getGlobalMetricsAPI } from "#veryfront/observability/tracing/api-shim.ts";
import { serverLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { loadConfig } from "./config.ts";
import { initializeInstruments } from "../instruments/index.ts";
import { MetricsRecorder } from "./recorder.ts";
import type { MetricsConfig, MetricsInstruments, OpenTelemetryAPI, RuntimeState } from "./types.ts";
import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";

const logger = serverLogger.component("metrics");

/**
 * Metrics manager class
 * Exported for testing - use metricsManager singleton for production
 */
export class MetricsManager {
  private initialized = false;
  private meter: Meter | null = null;
  private api: OpenTelemetryAPI | null = null;
  private instruments: MetricsInstruments = this.createEmptyInstruments();
  private runtimeState: RuntimeState = { cacheSize: 0, activeRequests: 0 };
  private recorder = new MetricsRecorder(this.instruments, this.runtimeState);

  private createEmptyInstruments(): MetricsInstruments {
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

  async initialize(config: Partial<MetricsConfig> = {}, adapter?: RuntimeAdapter): Promise<void> {
    if (this.initialized) {
      logger.debug("Already initialized");
      return;
    }

    const finalConfig = loadConfig(config, adapter);

    this.initialized = true;

    if (!finalConfig.enabled) {
      logger.debug("Metrics collection disabled");
      return;
    }

    try {
      // The metrics API is injected by ext-observability-opentelemetry via setGlobalMetricsAPI().
      // When the extension is not active, metrics collection is disabled.
      const metricsApi = getGlobalMetricsAPI();
      if (!metricsApi) {
        logger.debug("No metrics API available — metrics collection disabled");
        return;
      }
      this.api = { metrics: metricsApi } as OpenTelemetryAPI;
      this.meter = metricsApi.getMeter(finalConfig.prefix, RUNTIME_VERSION);

      this.instruments = initializeInstruments(this.meter, finalConfig, this.runtimeState);
      this.recorder.instruments = this.instruments;

      logger.info("OpenTelemetry metrics initialized", {
        exporter: finalConfig.exporter,
        endpoint: finalConfig.endpoint,
        prefix: finalConfig.prefix,
      });
    } catch (error) {
      logger.warn("Failed to initialize OpenTelemetry metrics", error);
    }
  }

  isEnabled(): boolean {
    return this.initialized && this.meter !== null;
  }

  getRecorder(): MetricsRecorder | null {
    return this.recorder;
  }

  getState(): { initialized: boolean; cacheSize: number; activeRequests: number } {
    return {
      initialized: this.initialized,
      cacheSize: this.runtimeState.cacheSize,
      activeRequests: this.runtimeState.activeRequests,
    };
  }

  shutdown(): void {
    if (!this.initialized) return;

    try {
      logger.info("Metrics shutdown initiated");
    } catch (error) {
      logger.warn("Error during metrics shutdown", error);
    }
  }
}

// Export singleton instance
export const metricsManager = new MetricsManager();
