import { DURATION_HISTOGRAM_BOUNDARIES_MS } from "../../config/defaults.js";
export function createRscInstruments(meter, config) {
    const prefix = `${config.prefix}.rsc`;
    const rscRenderDuration = meter.createHistogram(`${prefix}.render.duration`, {
        description: "RSC render duration",
        unit: "ms",
        advice: { explicitBucketBoundaries: [...DURATION_HISTOGRAM_BOUNDARIES_MS] },
    });
    const rscStreamDuration = meter.createHistogram(`${prefix}.stream.duration`, {
        description: "RSC stream duration",
        unit: "ms",
        advice: { explicitBucketBoundaries: [...DURATION_HISTOGRAM_BOUNDARIES_MS] },
    });
    const createRequestCounter = (name, description) => meter.createCounter(`${prefix}.${name}`, {
        description,
        unit: "requests",
    });
    const rscManifestCounter = createRequestCounter("manifest", "RSC manifest requests");
    const rscPageCounter = createRequestCounter("page", "RSC page requests");
    const rscStreamCounter = createRequestCounter("stream", "RSC stream requests");
    const rscActionCounter = createRequestCounter("action", "RSC action requests");
    const rscErrorCounter = meter.createCounter(`${prefix}.errors`, {
        description: "RSC errors",
        unit: "errors",
    });
    return {
        rscRenderDuration,
        rscStreamDuration,
        rscManifestCounter,
        rscPageCounter,
        rscStreamCounter,
        rscActionCounter,
        rscErrorCounter,
    };
}
