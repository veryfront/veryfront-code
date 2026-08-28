import type {
  Meter,
  ObservableGauge,
  ObservableResult,
} from "#veryfront/observability/tracing/api-shim.ts";
import { getV8FlagsEnv } from "#veryfront/config/env.ts";
import { getMemoryUsage } from "../metrics/config.ts";
import type { MetricsConfig } from "../metrics/types.ts";
import type { ObservableCallbackBinding } from "./observable-callbacks.ts";

const BYTES_PER_MEBIBYTE = 1024 * 1024;
type MemoryUsage = NonNullable<ReturnType<typeof getMemoryUsage>>;
type MemoryUsageReader = () => MemoryUsage | null;

/** Parse the configured V8 old-space limit, when present. */
export function parseV8HeapLimitBytes(flags: string): number | undefined {
  const value = flags.match(/--max[-_]old[-_]space[-_]size(?:=|\s+)(\d+)/)?.[1];
  if (!value) return undefined;

  const megabytes = Number(value);
  const bytes = megabytes * BYTES_PER_MEBIBYTE;
  return Number.isSafeInteger(megabytes) && megabytes > 0 && Number.isSafeInteger(bytes)
    ? bytes
    : undefined;
}

let cachedV8HeapLimitBytes: number | null | undefined;
let pendingV8HeapLimitBytes: Promise<number | undefined> | undefined;

async function getV8HeapLimitBytes(): Promise<number | undefined> {
  if (cachedV8HeapLimitBytes !== undefined) return cachedV8HeapLimitBytes ?? undefined;

  let configuredLimit: number | undefined;
  try {
    configuredLimit = parseV8HeapLimitBytes(getV8FlagsEnv());
  } catch (_) {
    // Host environment access is optional for metrics collection.
  }
  if (configuredLimit !== undefined) {
    cachedV8HeapLimitBytes = configuredLimit;
    return configuredLimit;
  }

  if (!pendingV8HeapLimitBytes) {
    pendingV8HeapLimitBytes = (async () => {
      try {
        const { getHeapStatistics } = await import("node:v8");
        const runtimeLimit = getHeapStatistics().heap_size_limit;
        cachedV8HeapLimitBytes = Number.isFinite(runtimeLimit) && runtimeLimit > 0
          ? runtimeLimit
          : null;
      } catch (_) {
        cachedV8HeapLimitBytes = null;
      }
      return cachedV8HeapLimitBytes ?? undefined;
    })();
  }
  return await pendingV8HeapLimitBytes;
}

export interface MemoryInstruments {
  memoryUsageGauge: ObservableGauge | null;
  heapUsageGauge: ObservableGauge | null;
  heapTotalGauge: ObservableGauge | null;
  heapPercentGauge: ObservableGauge | null;
}

function createMemoryCallback(
  observe: (
    result: ObservableResult,
    memoryUsage: MemoryUsage,
  ) => void,
  readMemoryUsage: MemoryUsageReader,
): (result: ObservableResult) => void {
  return (result: ObservableResult) => {
    const memoryUsage = readMemoryUsage();
    if (!memoryUsage) return;
    observe(result, memoryUsage);
  };
}

export function createMemoryInstruments(meter: Meter, config: MetricsConfig): MemoryInstruments {
  const memoryUsageGauge = meter.createObservableGauge(`${config.prefix}.memory.usage`, {
    description: "Memory usage (RSS)",
    unit: "bytes",
  });
  const heapUsageGauge = meter.createObservableGauge(`${config.prefix}.memory.heap`, {
    description: "V8 heap memory used",
    unit: "bytes",
  });
  const heapTotalGauge = meter.createObservableGauge(`${config.prefix}.memory.heap_total`, {
    description: "V8 heap memory allocated",
    unit: "bytes",
  });
  // Heap utilization as percentage of configured limit
  // This is the key metric for autoscaling decisions
  const heapPercentGauge = meter.createObservableGauge(`${config.prefix}.memory.heap_percent`, {
    description: "V8 heap usage as percentage of configured limit",
    unit: "percent",
  });
  return { memoryUsageGauge, heapUsageGauge, heapTotalGauge, heapPercentGauge };
}

export function createMemoryObservableBindings(
  instruments: MemoryInstruments,
  readMemoryUsage: MemoryUsageReader = getMemoryUsage,
): ObservableCallbackBinding[] {
  const bindings: ObservableCallbackBinding[] = [];
  if (instruments.memoryUsageGauge) {
    bindings.push({
      instrument: instruments.memoryUsageGauge,
      callback: createMemoryCallback(
        (result, memoryUsage) => result.observe(memoryUsage.rss),
        readMemoryUsage,
      ),
    });
  }
  if (instruments.heapUsageGauge) {
    bindings.push({
      instrument: instruments.heapUsageGauge,
      callback: createMemoryCallback(
        (result, memoryUsage) => result.observe(memoryUsage.heapUsed),
        readMemoryUsage,
      ),
    });
  }
  if (instruments.heapTotalGauge) {
    bindings.push({
      instrument: instruments.heapTotalGauge,
      callback: createMemoryCallback(
        (result, memoryUsage) => result.observe(memoryUsage.heapTotal),
        readMemoryUsage,
      ),
    });
  }
  if (instruments.heapPercentGauge) {
    bindings.push({
      instrument: instruments.heapPercentGauge,
      callback: async (result) => {
        const heapLimitBytes = await getV8HeapLimitBytes();
        if (heapLimitBytes === undefined) return;
        const memoryUsage = readMemoryUsage();
        if (!memoryUsage) return;
        const percent = (memoryUsage.heapUsed / heapLimitBytes) * 100;
        result.observe(Math.round(percent * 100) / 100);
      },
    });
  }
  return bindings;
}
