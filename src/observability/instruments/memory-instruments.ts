import type {
  Meter,
  ObservableGauge,
  ObservableResult,
} from "#veryfront/observability/tracing/api-shim.ts";
import { getHeapStatistics } from "node:v8";
import { getMemoryUsage } from "../metrics/config.ts";
import type { MetricsConfig } from "../metrics/types.ts";

function readV8HeapLimitBytes(): number | null {
  try {
    const limit = getHeapStatistics().heap_size_limit;
    return Number.isFinite(limit) && limit > 0 ? limit : null;
  } catch {
    return null;
  }
}

/** Calculate bounded heap utilization from runtime-reported values. */
export function calculateHeapUtilizationPercent(
  heapUsed: number,
  heapTotal: number,
  heapLimit: number | null = readV8HeapLimitBytes(),
): number | null {
  if (!Number.isFinite(heapUsed) || heapUsed < 0) return null;
  const denominator = heapLimit !== null && Number.isFinite(heapLimit) && heapLimit > 0
    ? heapLimit
    : Number.isFinite(heapTotal) && heapTotal > 0
    ? heapTotal
    : null;
  if (denominator === null) return null;
  const percent = Math.min(100, (heapUsed / denominator) * 100);
  return Math.round(percent * 100) / 100;
}

export interface MemoryInstruments {
  memoryUsageGauge: ObservableGauge | null;
  heapUsageGauge: ObservableGauge | null;
  heapTotalGauge: ObservableGauge | null;
  heapPercentGauge: ObservableGauge | null;
}

function addMemoryCallback(
  gauge: ObservableGauge,
  observe: (
    result: ObservableResult,
    memoryUsage: NonNullable<ReturnType<typeof getMemoryUsage>>,
  ) => void,
): void {
  gauge.addCallback((result: ObservableResult) => {
    try {
      const memoryUsage = getMemoryUsage();
      if (!memoryUsage) return;
      observe(result, memoryUsage);
    } catch {
      // Observable callbacks must not disrupt metric collection.
    }
  });
}

export function createMemoryInstruments(meter: Meter, config: MetricsConfig): MemoryInstruments {
  const memoryUsageGauge = meter.createObservableGauge(`${config.prefix}.memory.usage`, {
    description: "Memory usage (RSS)",
    unit: "bytes",
  });
  addMemoryCallback(memoryUsageGauge, (result, memoryUsage) => result.observe(memoryUsage.rss));

  const heapUsageGauge = meter.createObservableGauge(`${config.prefix}.memory.heap`, {
    description: "V8 heap memory used",
    unit: "bytes",
  });
  addMemoryCallback(heapUsageGauge, (result, memoryUsage) => result.observe(memoryUsage.heapUsed));

  const heapTotalGauge = meter.createObservableGauge(`${config.prefix}.memory.heap_total`, {
    description: "V8 heap memory allocated",
    unit: "bytes",
  });
  addMemoryCallback(heapTotalGauge, (result, memoryUsage) => result.observe(memoryUsage.heapTotal));

  const heapPercentGauge = meter.createObservableGauge(`${config.prefix}.memory.heap_percent`, {
    description: "V8 heap usage as percentage of the runtime heap limit",
    unit: "percent",
  });
  addMemoryCallback(heapPercentGauge, (result, memoryUsage) => {
    const percent = calculateHeapUtilizationPercent(
      memoryUsage.heapUsed,
      memoryUsage.heapTotal,
    );
    if (percent !== null) result.observe(percent);
  });

  return { memoryUsageGauge, heapUsageGauge, heapTotalGauge, heapPercentGauge };
}
