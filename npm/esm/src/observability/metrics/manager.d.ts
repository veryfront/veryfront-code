/**
 * Metrics Manager
 * Main OpenTelemetry metrics initialization and management
 */
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import { MetricsRecorder } from "./recorder.js";
import type { MetricsConfig } from "./types.js";
/**
 * Metrics manager class
 * Exported for testing - use metricsManager singleton for production
 */
export declare class MetricsManager {
    private initialized;
    private meter;
    private api;
    private instruments;
    private runtimeState;
    private recorder;
    private createEmptyInstruments;
    initialize(config?: Partial<MetricsConfig>, adapter?: RuntimeAdapter): Promise<void>;
    isEnabled(): boolean;
    getRecorder(): MetricsRecorder | null;
    getState(): {
        initialized: boolean;
        cacheSize: number;
        activeRequests: number;
    };
    shutdown(): void;
}
export declare const metricsManager: MetricsManager;
//# sourceMappingURL=manager.d.ts.map