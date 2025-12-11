
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
  const cacheGetCounter = meter.createCounter(
    `${config.prefix}.cache.gets`,
    {
      description: "Total number of cache get operations",
      unit: "operations",
    },
  );

  const cacheHitCounter = meter.createCounter(
    `${config.prefix}.cache.hits`,
    {
      description: "Total number of cache hits",
      unit: "hits",
    },
  );

  const cacheMissCounter = meter.createCounter(
    `${config.prefix}.cache.misses`,
    {
      description: "Total number of cache misses",
      unit: "misses",
    },
  );

  const cacheSetCounter = meter.createCounter(
    `${config.prefix}.cache.sets`,
    {
      description: "Total number of cache set operations",
      unit: "operations",
    },
  );

  const cacheInvalidateCounter = meter.createCounter(
    `${config.prefix}.cache.invalidations`,
    {
      description: "Total number of cache invalidations",
      unit: "operations",
    },
  );

  const cacheSizeGauge = meter.createObservableGauge(
    `${config.prefix}.cache.size`,
    {
      description: "Current cache size",
      unit: "entries",
    },
  );
  cacheSizeGauge.addCallback((result: ObservableResult) => {
    result.observe(runtimeState.cacheSize);
  });

  return {
    cacheGetCounter,
    cacheHitCounter,
    cacheMissCounter,
    cacheSetCounter,
    cacheInvalidateCounter,
    cacheSizeGauge,
  };
}
