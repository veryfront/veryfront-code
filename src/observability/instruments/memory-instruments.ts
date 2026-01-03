/**
 * Memory Metrics Instruments
 * Creation of memory-related metric instruments
 *
 * @module
 */

import type { Meter, ObservableGauge, ObservableResult } from "@opentelemetry/api";
import { getMemoryUsage } from "../metrics/config.ts";
import type { MetricsConfig } from "../metrics/types.ts";

// V8 heap limit from DENO_V8_FLAGS or default
const V8_HEAP_LIMIT_MB = (() => {
  try {
    const flags = Deno.env.get("DENO_V8_FLAGS") ?? "";
    const match = flags.match(/--max-old-space-size=(\d+)/);
    if (match?.[1]) return parseInt(match[1], 10);
  } catch {
    // Ignore
  }
  return 4096; // Default from values.yaml
})();

/**
 * Memory metric instruments
 */
export interface MemoryInstruments {
  memoryUsageGauge: ObservableGauge | null;
  heapUsageGauge: ObservableGauge | null;
  heapTotalGauge: ObservableGauge | null;
  heapPercentGauge: ObservableGauge | null;
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
      description: "Memory usage (RSS)",
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
      description: "V8 heap memory used",
      unit: "bytes",
    },
  );
  heapUsageGauge.addCallback((result: ObservableResult) => {
    const memoryUsage = getMemoryUsage();
    if (memoryUsage) {
      result.observe(memoryUsage.heapUsed);
    }
  });

  const heapTotalGauge = meter.createObservableGauge(
    `${config.prefix}.memory.heap_total`,
    {
      description: "V8 heap memory allocated",
      unit: "bytes",
    },
  );
  heapTotalGauge.addCallback((result: ObservableResult) => {
    const memoryUsage = getMemoryUsage();
    if (memoryUsage) {
      result.observe(memoryUsage.heapTotal);
    }
  });

  // Heap utilization as percentage of configured limit
  // This is the key metric for autoscaling decisions
  const heapPercentGauge = meter.createObservableGauge(
    `${config.prefix}.memory.heap_percent`,
    {
      description: "V8 heap usage as percentage of configured limit",
      unit: "percent",
    },
  );
  heapPercentGauge.addCallback((result: ObservableResult) => {
    const memoryUsage = getMemoryUsage();
    if (memoryUsage) {
      const heapUsedMB = memoryUsage.heapUsed / (1024 * 1024);
      const percent = (heapUsedMB / V8_HEAP_LIMIT_MB) * 100;
      result.observe(Math.round(percent * 100) / 100);
    }
  });

  return {
    memoryUsageGauge,
    heapUsageGauge,
    heapTotalGauge,
    heapPercentGauge,
  };
}
