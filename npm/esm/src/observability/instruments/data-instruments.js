import { DURATION_HISTOGRAM_BOUNDARIES_MS } from "../../config/defaults.js";
export function createDataInstruments(meter, config) {
    return {
        dataFetchDuration: meter.createHistogram(`${config.prefix}.data.fetch.duration`, {
            description: "Data fetch duration",
            unit: "ms",
            advice: { explicitBucketBoundaries: [...DURATION_HISTOGRAM_BOUNDARIES_MS] },
        }),
        dataFetchCounter: meter.createCounter(`${config.prefix}.data.fetch.count`, {
            description: "Total number of data fetches",
            unit: "fetches",
        }),
        dataFetchErrorCounter: meter.createCounter(`${config.prefix}.data.fetch.errors`, {
            description: "Data fetch errors",
            unit: "errors",
        }),
    };
}
