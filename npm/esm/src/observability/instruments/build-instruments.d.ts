/**
 * Build Metrics Instruments
 * Creation of build-related metric instruments
 *
 * @module
 */
import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import type { MetricsConfig } from "../metrics/types.js";
export interface BuildInstruments {
    buildDuration: Histogram | null;
    bundleSizeHistogram: Histogram | null;
    bundleCounter: Counter | null;
}
export declare function createBuildInstruments(meter: Meter, config: MetricsConfig): BuildInstruments;
//# sourceMappingURL=build-instruments.d.ts.map