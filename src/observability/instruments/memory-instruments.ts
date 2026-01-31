import type { Meter, ObservableGauge, ObservableResult } from "@opentelemetry/api";
import { getV8FlagsEnv } from "#veryfront/config/env.ts";
import { getMemoryUsage } from "../metrics/config.ts";
import type { MetricsConfig } from "../metrics/types.ts";

let _v8HeapLimitMB: number | undefined;
function getV8HeapLimitMB(): number {
  if (_v8HeapLimitMB !== undefined) return _v8HeapLimitMB;
  const match = getV8FlagsEnv().match(/--max-old-space-size=(\d+)/);
  const value = match?.[1];
  _v8HeapLimitMB = value ? parseInt(value, 10) : 5120; // Default from values.yaml
  return _v8HeapLimitMB;
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
    const memoryUsage = getMemoryUsage();
    if (!memoryUsage) return;
    observe(result, memoryUsage);
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

  // Heap utilization as percentage of configured limit
  // This is the key metric for autoscaling decisions
  const heapPercentGauge = meter.createObservableGauge(`${config.prefix}.memory.heap_percent`, {
    description: "V8 heap usage as percentage of configured limit",
    unit: "percent",
  });
  addMemoryCallback(heapPercentGauge, (result, memoryUsage) => {
    const heapUsedMB = memoryUsage.heapUsed / (1024 * 1024);
    const percent = (heapUsedMB / getV8HeapLimitMB()) * 100;
    result.observe(Math.round(percent * 100) / 100);
  });

  return { memoryUsageGauge, heapUsageGauge, heapTotalGauge, heapPercentGauge };
}
