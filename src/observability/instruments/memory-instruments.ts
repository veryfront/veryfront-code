/**
 * Memory Metrics Instruments
 * Creation of memory-related metric instruments
 *
 * @module
 */

import type { Meter, ObservableGauge, ObservableResult } from "npm:@opentelemetry/api@1";
import { getMemoryUsage } from "../metrics/config.ts";
import type { MetricsConfig } from "../metrics/types.ts";

/**
 * Memory metric instruments
 */
export interface MemoryInstruments {
  memoryUsageGauge: ObservableGauge | null;
  heapUsageGauge: ObservableGauge | null;
}

/**
 * Create memory metric instruments
 *
 * @param meter - OpenTelemetry meter instance
 * @param config - Metrics configuration
 * @returns Memory metric instruments
 *
 * @example
 * ```ts
 * const memoryInstruments = createMemoryInstruments(meter, config);
 * // Observables automatically track memory usage
 * ```
 */
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
