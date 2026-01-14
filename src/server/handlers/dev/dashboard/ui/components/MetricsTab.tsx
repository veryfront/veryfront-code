import { useEffect, useState } from "react";
import { Card } from "./Card.tsx";
import { ErrorState, LoadingState, PageLayout } from "./shared.tsx";

interface MetricsData {
  counters: Record<string, number | unknown>;
  timestamp: string;
}

export function MetricsTab() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function loadMetrics() {
    setLoading(true);
    fetch("/_dev/api/metrics")
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadMetrics();
  }, []);

  const groups: Record<string, Array<{ key: string; val: unknown }>> = {};
  if (data?.counters) {
    for (const [key, val] of Object.entries(data.counters)) {
      const parts = key.split(".");
      const group = parts.length > 1 ? parts[0] : "general";
      (groups[group] ??= []).push({ key, val });
    }
  }

  return (
    <PageLayout title="Metrics" description="Runtime metrics and counters">
      <div className="mb-4">
        <button
          type="button"
          onClick={loadMetrics}
          disabled={loading}
          className="px-3 py-1.5 bg-white border border-gray-200 text-sm text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {loading
        ? (
          <Card>
            <LoadingState message="Loading metrics..." />
          </Card>
        )
        : error
        ? (
          <Card>
            <ErrorState error={error} />
          </Card>
        )
        : Object.keys(groups).length === 0
        ? (
          <Card>
            <div className="p-4 text-sm text-gray-400">No metrics available yet</div>
          </Card>
        )
        : (
          Object.entries(groups).sort().map(([group, items]) => (
            <Card key={group} title={group.toUpperCase()} className="mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      Metric
                    </th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(({ key, val }) => (
                    <tr key={key} className="border-b last:border-0">
                      <td className="px-3 py-2.5">
                        <code className="text-xs text-sky-600 font-medium">{key}</code>
                      </td>
                      <td className="px-3 py-2.5 text-gray-900">
                        {typeof val === "number" ? val.toLocaleString() : JSON.stringify(val)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))
        )}
    </PageLayout>
  );
}
