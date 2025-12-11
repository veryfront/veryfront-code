
import type { Meter, ObservableGauge, ObservableResult } from "@opentelemetry/api";
import { getMemoryUsage } from "../metrics/config.ts";
import type { MetricsConfig } from "../metrics/types.ts";

export interface MemoryInstruments {
  memoryUsageGauge: ObservableGauge | null;
  heapUsageGauge: ObservableGauge | null;
}

export function createMemoryInstruments(
  meter: Meter,
  config: MetricsConfig,
): MemoryInstruments {
  const memoryUsageGauge = meter.createObservableGauge(
    `${config.prefix}.memory.usage`,
    {
      description: "Memory usage",
      unit: "bytes",
    },
  );
  memoryUsageGauge.addCallback((result: ObservableResult) => {
    const memoryUsage = getMemoryUsage();
    if (memoryUsage) {
      result.observe(memoryUsage.rss);
    }
  });

  const heapUsageGauge = meter.createObservableGauge(
    `${config.prefix}.memory.heap`,
    {
      description: "Heap memory usage",
      unit: "bytes",
    },
  );
  heapUsageGauge.addCallback((result: ObservableResult) => {
    const memoryUsage = getMemoryUsage();
    if (memoryUsage) {
      result.observe(memoryUsage.heapUsed);
    }
  });

  return {
    memoryUsageGauge,
    heapUsageGauge,
  };
}
