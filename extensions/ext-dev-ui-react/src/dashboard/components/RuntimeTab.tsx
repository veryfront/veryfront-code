import { useCallback, useEffect, useState } from "react";
import { Card } from "./Card.tsx";
import { ErrorState, LoadingState, PageLayout } from "./shared.tsx";
import {
  expectFiniteJsonNumber,
  expectJsonArray,
  expectJsonBoolean,
  expectJsonObject,
  expectJsonString,
  requestJson,
  runOwnedRequest,
  useLatestRequestOwner,
} from "../../browser-request.ts";

/** How often the dashboard auto-refreshes runtime metrics and memory data */
const AUTO_REFRESH_INTERVAL_MS = 15_000;

type SubTab = "metrics" | "memory";

interface HeapStats {
  usedHeapSizeMB: number;
  totalHeapSizeMB: number;
  heapSizeLimitMB: number;
  heapUsedPercent: number;
  rss?: number;
}

interface CacheStats {
  name: string;
  entries: number;
  maxEntries?: number;
}

interface Pressure {
  critical: boolean;
  warning: boolean;
  heapUsedPercent: number;
}

interface MemoryData {
  heap: HeapStats;
  caches: CacheStats[];
  pressure: Pressure;
}

const MAX_METRIC_ENTRIES = 10_000;
const MAX_CACHE_ENTRIES = 1_000;

export function admitRuntimeMetrics(value: unknown): Record<string, number | unknown> {
  const response = expectJsonObject(value, "runtime metrics response");
  const counters = expectJsonObject(response.counters, "runtime metrics response.counters");
  if (Object.keys(counters).length > MAX_METRIC_ENTRIES) {
    throw new RangeError(`runtime metrics response exceeds ${MAX_METRIC_ENTRIES} counters`);
  }
  return counters;
}

export function admitRuntimeMemory(value: unknown): MemoryData {
  const response = expectJsonObject(value, "runtime memory response");
  const heap = expectJsonObject(response.heap, "runtime memory response.heap");
  const pressure = expectJsonObject(response.pressure, "runtime memory response.pressure");
  const caches = expectJsonArray(
    response.caches,
    "runtime memory response.caches",
    MAX_CACHE_ENTRIES,
  ).map((entry, index): CacheStats => {
    const cache = expectJsonObject(entry, `runtime memory response.caches[${index}]`);
    const maxEntries = cache.maxEntries === undefined ? undefined : expectFiniteJsonNumber(
      cache.maxEntries,
      `runtime memory response.caches[${index}].maxEntries`,
    );
    return {
      name: expectJsonString(
        cache.name,
        `runtime memory response.caches[${index}].name`,
        512,
        false,
      ),
      entries: expectFiniteJsonNumber(
        cache.entries,
        `runtime memory response.caches[${index}].entries`,
      ),
      ...(maxEntries === undefined ? {} : { maxEntries }),
    };
  });

  const rss = heap.rss === undefined
    ? undefined
    : expectFiniteJsonNumber(heap.rss, "runtime memory response.heap.rss");
  return {
    heap: {
      usedHeapSizeMB: expectFiniteJsonNumber(
        heap.usedHeapSizeMB,
        "runtime memory response.heap.usedHeapSizeMB",
      ),
      totalHeapSizeMB: expectFiniteJsonNumber(
        heap.totalHeapSizeMB,
        "runtime memory response.heap.totalHeapSizeMB",
      ),
      heapSizeLimitMB: expectFiniteJsonNumber(
        heap.heapSizeLimitMB,
        "runtime memory response.heap.heapSizeLimitMB",
      ),
      heapUsedPercent: expectFiniteJsonNumber(
        heap.heapUsedPercent,
        "runtime memory response.heap.heapUsedPercent",
      ),
      ...(rss === undefined ? {} : { rss }),
    },
    caches,
    pressure: {
      critical: expectJsonBoolean(
        pressure.critical,
        "runtime memory response.pressure.critical",
      ),
      warning: expectJsonBoolean(
        pressure.warning,
        "runtime memory response.pressure.warning",
      ),
      heapUsedPercent: expectFiniteJsonNumber(
        pressure.heapUsedPercent,
        "runtime memory response.pressure.heapUsedPercent",
      ),
    },
  };
}

export function RuntimeTab(): React.JSX.Element {
  const [subTab, setSubTab] = useState<SubTab>("metrics");
  const [metrics, setMetrics] = useState<Record<string, number | unknown>>({});
  const [memory, setMemory] = useState<MemoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requests = useLatestRequestOwner();

  const loadData = useCallback((): Promise<void> =>
    runOwnedRequest(
      requests,
      async (signal) => {
        const [metricsResult, memoryResult] = await Promise.all([
          requestJson("/_dev/api/metrics", {
            responseLabel: "Runtime metrics",
            admit: admitRuntimeMetrics,
            init: { signal },
          }),
          requestJson("/_dev/api/memory", {
            responseLabel: "Runtime memory",
            admit: admitRuntimeMemory,
            init: { signal },
          }),
        ]);
        return { metrics: metricsResult, memory: memoryResult };
      },
      {
        start: () => setLoading(true),
        success: (result) => {
          setMetrics(result.metrics);
          setMemory(result.memory);
          setError(null);
        },
        error: (requestError) =>
          setError(requestError instanceof Error ? requestError.message : String(requestError)),
        finish: () => setLoading(false),
      },
      "skip-while-busy",
    ), [requests]);

  useEffect(() => {
    void loadData();
    const interval = setInterval(() => void loadData(), AUTO_REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      requests.cancel();
    };
  }, [loadData, requests]);

  if (!memory && loading) {
    return (
      <PageLayout title="Runtime" description="Metrics, memory, and caches">
        <Card>
          <LoadingState message="Loading runtime info..." />
        </Card>
      </PageLayout>
    );
  }

  if (!memory && error) {
    return (
      <PageLayout title="Runtime" description="Metrics, memory, and caches">
        <Card>
          <ErrorState error={error} />
        </Card>
      </PageLayout>
    );
  }

  const metricsCount = Object.keys(metrics).length;

  return (
    <PageLayout title="Runtime" description="Metrics, memory, and caches">
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-1 border-b border-gray-200 pb-2">
          <TabButton
            active={subTab === "metrics"}
            onClick={() => setSubTab("metrics")}
            label={`Metrics (${metricsCount})`}
          />
          <TabButton
            active={subTab === "memory"}
            onClick={() => setSubTab("memory")}
            label={`Memory (${memory?.caches.length ?? 0} caches)`}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Auto-refresh: 15s</span>
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="px-3 py-1.5 bg-white border border-gray-200 text-sm text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {subTab === "metrics" && <MetricsSection metrics={metrics} />}
      {subTab === "memory" && memory && <MemorySection memory={memory} />}
    </PageLayout>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}): React.JSX.Element {
  const className = active
    ? "bg-white text-sky-600 border border-gray-200 border-b-white -mb-[1px]"
    : "text-gray-500 hover:text-gray-700";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-medium rounded-t transition-colors ${className}`}
    >
      {label}
    </button>
  );
}

function MetricsSection({
  metrics,
}: {
  metrics: Record<string, number | unknown>;
}): React.JSX.Element {
  const groups: Record<string, Array<{ key: string; val: unknown }>> = {};

  for (const [key, val] of Object.entries(metrics)) {
    const [group = "general"] = key.split(".");
    (groups[group] ??= []).push({ key, val });
  }

  if (Object.keys(groups).length === 0) {
    return (
      <Card>
        <div className="p-6 text-center text-gray-400">No metrics recorded yet</div>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Object.entries(groups)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([group, items]) => (
          <Card key={group} title={group.toUpperCase()}>
            <table className="w-full text-sm">
              <tbody>
                {items.map(({ key, val }) => (
                  <tr key={key} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <code className="text-xs text-sky-600">
                        {key.replace(`${group}.`, "")}
                      </code>
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {typeof val === "number" ? val.toLocaleString() : JSON.stringify(val)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
    </div>
  );
}

function MemorySection({ memory }: { memory: MemoryData }): React.JSX.Element {
  const progressPercent = memory.heap.heapUsedPercent;

  let progressColor = "bg-green-500";
  if (memory.pressure.critical) progressColor = "bg-red-500";
  else if (memory.pressure.warning) progressColor = "bg-amber-500";

  let pressureColor = "text-green-600";
  if (memory.pressure.critical) pressureColor = "text-red-600";
  else if (memory.pressure.warning) pressureColor = "text-amber-600";

  let pressureLabel = "OK";
  if (memory.pressure.critical) pressureLabel = "CRITICAL";
  else if (memory.pressure.warning) pressureLabel = "WARNING";

  return (
    <>
      <Card className="mb-4">
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700">Heap Usage</span>
            <span className={`text-sm font-semibold ${pressureColor}`}>{pressureLabel}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full ${progressColor} transition-all duration-500`}
                style={{ width: `${Math.min(progressPercent, 100)}%` }}
              />
            </div>
            <span className="text-sm text-gray-600 w-32 text-right">
              {memory.heap.usedHeapSizeMB.toFixed(0)} / {memory.heap.heapSizeLimitMB} MB
            </span>
          </div>
          <div className="flex gap-6 mt-3 text-xs text-gray-500">
            <span>RSS: {memory.heap.rss?.toFixed(0) ?? "—"} MB</span>
            <span>Total: {memory.heap.totalHeapSizeMB.toFixed(0)} MB</span>
          </div>
        </div>
      </Card>

      <Card title={`CACHES (${memory.caches.length})`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Cache
              </th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Entries
              </th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Max
              </th>
            </tr>
          </thead>
          <tbody>
            {memory.caches.map((cache) => (
              <tr key={cache.name} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <code className="text-xs text-sky-600">{cache.name}</code>
                </td>
                <td className="px-3 py-2 text-right font-medium">{cache.entries}</td>
                <td className="px-3 py-2 text-right text-gray-500">
                  {cache.maxEntries ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
