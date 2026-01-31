import type { Counter, Meter, ObservableGauge, ObservableResult } from "@opentelemetry/api";
import type { MetricsConfig, RuntimeState } from "../metrics/types.ts";

export interface CacheInstruments {
  cacheGetCounter: Counter | null;
  cacheHitCounter: Counter | null;
  cacheMissCounter: Counter | null;
  cacheSetCounter: Counter | null;
  cacheInvalidateCounter: Counter | null;
  cacheSizeGauge: ObservableGauge | null;
}

export function createCacheInstruments(
  meter: Meter,
  config: MetricsConfig,
  runtimeState: RuntimeState,
): CacheInstruments {
  const prefix = `${config.prefix}.cache`;

  const cacheGetCounter = meter.createCounter(`${prefix}.gets`, {
    description: "Total number of cache get operations",
    unit: "operations",
  });

  const cacheHitCounter = meter.createCounter(`${prefix}.hits`, {
    description: "Total number of cache hits",
    unit: "hits",
  });

  const cacheMissCounter = meter.createCounter(`${prefix}.misses`, {
    description: "Total number of cache misses",
    unit: "misses",
  });

  const cacheSetCounter = meter.createCounter(`${prefix}.sets`, {
    description: "Total number of cache set operations",
    unit: "operations",
  });

  const cacheInvalidateCounter = meter.createCounter(`${prefix}.invalidations`, {
    description: "Total number of cache invalidations",
    unit: "operations",
  });

  const cacheSizeGauge = meter.createObservableGauge(`${prefix}.size`, {
    description: "Current cache size",
    unit: "entries",
  });

  cacheSizeGauge.addCallback((result: ObservableResult) => result.observe(runtimeState.cacheSize));

  return {
    cacheGetCounter,
    cacheHitCounter,
    cacheMissCounter,
    cacheSetCounter,
    cacheInvalidateCounter,
    cacheSizeGauge,
  };
}
