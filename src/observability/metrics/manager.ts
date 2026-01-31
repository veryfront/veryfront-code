/**
 * Metrics Manager
 * Main OpenTelemetry metrics initialization and management
 */

import type { Meter } from "@opentelemetry/api";
import { serverLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { loadConfig } from "./config.ts";
import { initializeInstruments } from "../instruments/index.ts";
import { MetricsRecorder } from "./recorder.ts";
import type { MetricsConfig, MetricsInstruments, OpenTelemetryAPI, RuntimeState } from "./types.ts";
import { VERSION } from "#veryfront/utils/version.ts";

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
    };
  }

  async initialize(config: Partial<MetricsConfig> = {}, adapter?: RuntimeAdapter): Promise<void> {
    if (this.initialized) {
      logger.debug("[metrics] Already initialized");
      return;
    }

    const finalConfig = loadConfig(config, adapter);

    this.initialized = true;

    if (!finalConfig.enabled) {
      logger.debug("[metrics] Metrics collection disabled");
      return;
    }

    try {
      this.api = await import("@opentelemetry/api");
      this.meter = this.api.metrics.getMeter(finalConfig.prefix, VERSION);

      this.instruments = await initializeInstruments(this.meter, finalConfig, this.runtimeState);
      this.recorder.instruments = this.instruments;

      logger.info("[metrics] OpenTelemetry metrics initialized", {
        exporter: finalConfig.exporter,
        endpoint: finalConfig.endpoint,
        prefix: finalConfig.prefix,
      });
    } catch (error) {
      logger.warn("[metrics] Failed to initialize OpenTelemetry metrics", error);
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
      logger.info("[metrics] Metrics shutdown initiated");
    } catch (error) {
      logger.warn("[metrics] Error during metrics shutdown", error);
    }
  }
}

// Export singleton instance
export const metricsManager = new MetricsManager();
