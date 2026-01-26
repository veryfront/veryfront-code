/**
 * Build Metrics Instruments
 * Creation of build-related metric instruments
 *
 * @module
 */
import { DURATION_HISTOGRAM_BOUNDARIES_MS, SIZE_HISTOGRAM_BOUNDARIES_KB, } from "../../config/defaults.js";
export function createBuildInstruments(meter, config) {
    return {
        buildDuration: meter.createHistogram(`${config.prefix}.build.duration`, {
            description: "Build operation duration",
            unit: "ms",
            advice: { explicitBucketBoundaries: [...DURATION_HISTOGRAM_BOUNDARIES_MS] },
        }),
        bundleSizeHistogram: meter.createHistogram(`${config.prefix}.build.bundle.size`, {
            description: "Bundle size distribution",
            unit: "kb",
            advice: { explicitBucketBoundaries: [...SIZE_HISTOGRAM_BOUNDARIES_KB] },
        }),
        bundleCounter: meter.createCounter(`${config.prefix}.build.bundles`, {
            description: "Total number of bundles created",
            unit: "bundles",
        }),
    };
}
