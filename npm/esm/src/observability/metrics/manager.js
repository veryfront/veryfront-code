/**
 * Metrics Manager
 * Main OpenTelemetry metrics initialization and management
 */
import { serverLogger as logger } from "../../utils/index.js";
import { loadConfig } from "./config.js";
import { initializeInstruments } from "../instruments/index.js";
import { MetricsRecorder } from "./recorder.js";
/**
 * Metrics manager class
 * Exported for testing - use metricsManager singleton for production
 */
export class MetricsManager {
    initialized = false;
    meter = null;
    api = null;
    instruments = this.createEmptyInstruments();
    runtimeState = { cacheSize: 0, activeRequests: 0 };
    recorder = new MetricsRecorder(this.instruments, this.runtimeState);
    createEmptyInstruments() {
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
    async initialize(config = {}, adapter) {
        if (this.initialized) {
            logger.debug("[metrics] Already initialized");
            return;
        }
        const finalConfig = loadConfig(config, adapter);
        if (!finalConfig.enabled) {
            logger.debug("[metrics] Metrics collection disabled");
            this.initialized = true;
            return;
        }
        try {
            this.api = await import("@opentelemetry/api");
            this.meter = this.api.metrics.getMeter(finalConfig.prefix, "0.1.0");
            this.instruments = await initializeInstruments(this.meter, finalConfig, this.runtimeState);
            this.recorder.instruments = this.instruments;
            this.initialized = true;
            logger.info("[metrics] OpenTelemetry metrics initialized", {
                exporter: finalConfig.exporter,
                endpoint: finalConfig.endpoint,
                prefix: finalConfig.prefix,
            });
        }
        catch (error) {
            logger.warn("[metrics] Failed to initialize OpenTelemetry metrics", error);
            this.initialized = true; // Mark as initialized to prevent retry loops
        }
    }
    isEnabled() {
        return this.initialized && this.meter !== null;
    }
    getRecorder() {
        return this.recorder;
    }
    getState() {
        return {
            initialized: this.initialized,
            cacheSize: this.runtimeState.cacheSize,
            activeRequests: this.runtimeState.activeRequests,
        };
    }
    shutdown() {
        if (!this.initialized)
            return;
        try {
            logger.info("[metrics] Metrics shutdown initiated");
        }
        catch (error) {
            logger.warn("[metrics] Error during metrics shutdown", error);
        }
    }
}
// Export singleton instance
export const metricsManager = new MetricsManager();
