import { DURATION_HISTOGRAM_BOUNDARIES_MS } from "../../config/defaults.js";
export function createRenderInstruments(meter, config) {
    return {
        renderDuration: meter.createHistogram(`${config.prefix}.render.duration`, {
            description: "Page render duration",
            unit: "ms",
            advice: { explicitBucketBoundaries: [...DURATION_HISTOGRAM_BOUNDARIES_MS] },
        }),
        renderCounter: meter.createCounter(`${config.prefix}.render.count`, {
            description: "Total number of page renders",
            unit: "renders",
        }),
        renderErrorCounter: meter.createCounter(`${config.prefix}.render.errors`, {
            description: "Total number of render errors",
            unit: "errors",
        }),
    };
}
