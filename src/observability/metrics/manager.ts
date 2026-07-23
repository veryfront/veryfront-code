/**
 * Metrics Manager
 * Main OpenTelemetry metrics initialization and management
 */

import type { Meter } from "#veryfront/observability/tracing/api-shim.ts";
import { getGlobalMetricsAPI } from "#veryfront/observability/tracing/api-shim.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import type { ObservabilityRuntimeAdapter } from "../runtime-adapter.ts";
import { loadConfig } from "./config.ts";
import { initializeInstruments } from "../instruments/index.ts";
import { MetricsRecorder } from "./recorder.ts";
import type {
  MetricsConfig,
  MetricsInstruments,
  MetricsRuntimeState,
  OpenTelemetryAPI,
  RuntimeState,
} from "./types.ts";
import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";
import { classifyTelemetryError } from "../telemetry-safety.ts";

const logger = serverLogger.component("metrics");

function safeLog(
  level: "debug" | "info" | "warn",
  message: string,
  context?: Record<string, unknown>,
): void {
  try {
    logger[level](message, context);
  } catch {
    // Telemetry logging must not affect application execution.
  }
}

/**
 * Metrics manager class
 * Exported for testing - use metricsManager singleton for production
 */
export class MetricsManager {
  private initialized = false;
  private meter: Meter | null = null;
  private api: OpenTelemetryAPI | null = null;
  private config: MetricsConfig | null = null;
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

  async initialize(
    config: Partial<MetricsConfig> = {},
    adapter?: ObservabilityRuntimeAdapter,
  ): Promise<void> {
    if (this.initialized) {
      if (this.config?.enabled && this.meter === null && getGlobalMetricsAPI()) {
        this.initializeMeter(this.config);
        return;
      }
      safeLog("debug", "Already initialized");
      return;
    }

    const finalConfig = loadConfig(config, adapter);

    this.initialized = true;
    this.config = finalConfig;

    if (!finalConfig.enabled) {
      safeLog("debug", "Metrics collection disabled");
      return;
    }

    this.initializeMeter(finalConfig);
  }

  private initializeMeter(finalConfig: MetricsConfig): void {
    try {
      // The metrics API is injected by the observability extension via setGlobalMetricsAPI().
      // When the extension is not active, metrics collection is disabled.
      const metricsApi = getGlobalMetricsAPI();
      if (!metricsApi) {
        safeLog("debug", "No metrics API available, metrics collection disabled");
        return;
      }
      this.api = { metrics: metricsApi } as OpenTelemetryAPI;
      this.meter = metricsApi.getMeter(finalConfig.prefix, RUNTIME_VERSION);

      this.instruments = initializeInstruments(this.meter, finalConfig, this.runtimeState);
      this.recorder.instruments = this.instruments;

      safeLog("info", "OpenTelemetry metrics initialized", {
        exporter: finalConfig.exporter,
      });
    } catch (error) {
      safeLog("warn", "Failed to initialize OpenTelemetry metrics", {
        failure_category: classifyTelemetryError(error),
      });
    }
  }

  isEnabled(): boolean {
    return this.initialized && this.meter !== null;
  }

  getRecorder(): MetricsRecorder | null {
    return this.recorder;
  }

  getState(): MetricsRuntimeState {
    return {
      initialized: this.initialized,
      cacheSize: this.runtimeState.cacheSize,
      activeRequests: this.runtimeState.activeRequests,
    };
  }

  shutdown(): void {
    if (!this.initialized) return;

    safeLog("info", "Metrics shutdown initiated");
    this.initialized = false;
    this.config = null;
    this.meter = null;
    this.api = null;
    this.instruments = this.createEmptyInstruments();
    this.runtimeState.cacheSize = 0;
    this.runtimeState.activeRequests = 0;
    this.recorder.instruments = this.instruments;
  }
}

// Export singleton instance
export const metricsManager = new MetricsManager();
