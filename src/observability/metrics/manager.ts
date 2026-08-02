/**
 * Metrics Manager
 * Main OpenTelemetry metrics initialization and management
 */

import type { Meter } from "#veryfront/observability/tracing/api-shim.ts";
import { getGlobalTelemetryAPISnapshot } from "#veryfront/observability/tracing/api-shim.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { loadConfig } from "./config.ts";
import {
  createEmptyInstruments,
  disposeInstruments,
  initializeInstruments,
  isInitializedInstrumentSet,
} from "../instruments/instruments-factory.ts";
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
  private instruments: MetricsInstruments = createEmptyInstruments();
  private runtimeState: RuntimeState = { cacheSize: 0, activeRequests: 0 };
  private recorder = new MetricsRecorder(this.instruments, this.runtimeState);
  private config: MetricsConfig | null = null;
  private providerRevision = -1;

  async initialize(config: Partial<MetricsConfig> = {}, adapter?: RuntimeAdapter): Promise<void> {
    if (this.initialized) {
      logger.debug("Already initialized");
      return;
    }

    const finalConfig = loadConfig(config, adapter);

    this.initialized = true;
    this.config = finalConfig;

    if (!finalConfig.enabled) {
      logger.debug("Metrics collection disabled");
      return;
    }

    this.refreshProvider(true);
    if (this.meter) {
      logger.info("OpenTelemetry metrics initialized", {
        exporter: finalConfig.exporter,
        endpoint: finalConfig.endpoint,
        prefix: finalConfig.prefix,
      });
    }
  }

  private clearProviderState(): void {
    disposeInstruments(this.instruments);
    this.instruments = createEmptyInstruments();
    this.recorder.instruments = this.instruments;
    this.api = null;
    this.meter = null;
  }

  private refreshProvider(force = false): void {
    if (!this.initialized || !this.config?.enabled) return;

    const snapshot = getGlobalTelemetryAPISnapshot();
    if (!force && snapshot.metricsApiRevision === this.providerRevision) return;

    this.clearProviderState();
    if (!snapshot.metricsApi) {
      this.providerRevision = snapshot.metricsApiRevision;
      return;
    }

    try {
      const api = { metrics: snapshot.metricsApi } as OpenTelemetryAPI;
      const meter = snapshot.metricsApi.getMeter(this.config.prefix, RUNTIME_VERSION);
      const instruments = initializeInstruments(meter, this.config, this.runtimeState);
      if (!isInitializedInstrumentSet(instruments)) {
        // The factory already reported the backend failure. Do not mark this
        // revision complete: a later operation may retry after a transient
        // provider initialization failure.
        return;
      }
      this.api = api;
      this.meter = meter;
      this.instruments = instruments;
      this.recorder.instruments = instruments;
      this.providerRevision = snapshot.metricsApiRevision;
    } catch (error) {
      try {
        logger.warn("Failed to initialize OpenTelemetry metrics", error);
      } catch (_) {
        /* expected: metrics lifecycle remains fail-open */
      }
    }
  }

  isEnabled(): boolean {
    this.refreshProvider();
    return this.initialized && this.meter !== null;
  }

  getRecorder(): MetricsRecorder | null {
    this.refreshProvider();
    return this.recorder;
  }

  getState(): { initialized: boolean; cacheSize: number; activeRequests: number } {
    this.refreshProvider();
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
    this.clearProviderState();
    this.initialized = false;
    this.config = null;
    this.providerRevision = -1;
    this.runtimeState.cacheSize = 0;
    this.runtimeState.activeRequests = 0;
  }
}

// Export singleton instance
export const metricsManager = new MetricsManager();
