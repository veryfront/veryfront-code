import { DURATION_HISTOGRAM_BOUNDARIES_MS } from "../../config/defaults.js";
export function createHttpInstruments(meter, config) {
    return {
        httpRequestCounter: meter.createCounter(`${config.prefix}.http.requests`, {
            description: "Total number of HTTP requests",
            unit: "requests",
        }),
        httpRequestDuration: meter.createHistogram(`${config.prefix}.http.request.duration`, {
            description: "HTTP request duration",
            unit: "ms",
            advice: { explicitBucketBoundaries: [...DURATION_HISTOGRAM_BOUNDARIES_MS] },
        }),
        httpActiveRequests: meter.createUpDownCounter(`${config.prefix}.http.requests.active`, {
            description: "Number of active HTTP requests",
            unit: "requests",
        }),
    };
}
