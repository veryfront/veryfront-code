import type { Counter, Meter, ObservableGauge } from "@opentelemetry/api";
import type { MetricsConfig, RuntimeState } from "../metrics/types.js";
export interface CacheInstruments {
    cacheGetCounter: Counter | null;
    cacheHitCounter: Counter | null;
    cacheMissCounter: Counter | null;
    cacheSetCounter: Counter | null;
    cacheInvalidateCounter: Counter | null;
    cacheSizeGauge: ObservableGauge | null;
}
export declare function createCacheInstruments(meter: Meter, config: MetricsConfig, runtimeState: RuntimeState): CacheInstruments;
//# sourceMappingURL=cache-instruments.d.ts.map