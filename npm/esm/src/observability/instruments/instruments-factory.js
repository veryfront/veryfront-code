import { serverLogger as logger } from "../../utils/index.js";
import { createBuildInstruments } from "./build-instruments.js";
import { createCacheInstruments } from "./cache-instruments.js";
import { createDataInstruments } from "./data-instruments.js";
import { createHttpInstruments } from "./http-instruments.js";
import { createMemoryInstruments } from "./memory-instruments.js";
import { createRenderInstruments } from "./render-instruments.js";
import { createRscInstruments } from "./rsc-instruments.js";
export function initializeInstruments(meter, config, runtimeState) {
    const instruments = {
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
    try {
        Object.assign(instruments, createHttpInstruments(meter, config), createCacheInstruments(meter, config, runtimeState), createRenderInstruments(meter, config), createRscInstruments(meter, config), createBuildInstruments(meter, config), createDataInstruments(meter, config), createMemoryInstruments(meter, config));
    }
    catch (error) {
        logger.warn("[metrics] Failed to initialize metric instruments", error);
    }
    return Promise.resolve(instruments);
}
