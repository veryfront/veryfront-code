import { useEffect, useState } from "react";
import type { Handler } from "../App.tsx";
import { Card } from "./Card.tsx";
import { ErrorState, LoadingState, PageLayout } from "./shared.tsx";

interface HandlersData {
  handlers: Handler[];
  count: number;
  stats?: {
    totalHandlers: number;
    handlersByPriority: Record<string, number>;
    handlerNames: string[];
  };
}

export function HandlersTab() {
  const [data, setData] = useState<HandlersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/_dev/api/handlers")
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageLayout title="Request Handlers" description="Handler chain processed in priority order">
      {loading
        ? (
          <Card>
            <LoadingState message="Loading handlers..." />
          </Card>
        )
        : error
        ? (
          <Card>
            <ErrorState error={error} />
          </Card>
        )
        : data
        ? (
          <>
            <Card title={`Handler Chain (${data.count} handlers)`} className="mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      Priority
                    </th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      Handler
                    </th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      Patterns
                    </th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      Enabled
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.handlers.map((h, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-2.5">
                        <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-[10px] font-medium font-mono rounded">
                          {h.priority}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <code className="text-xs text-sky-600 font-medium">{h.name}</code>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 text-xs">
                        {h.patterns.map((p) => p.pattern || p).join(", ") || "-"}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{h.enabled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {data.stats?.handlersByPriority && (
              <Card title="Priority Distribution">
                <div className="p-3 flex flex-wrap gap-1.5">
                  {Object.entries(data.stats.handlersByPriority)
                    .sort((a, b) => Number(a[0]) - Number(b[0]))
                    .map(([priority, count]) => (
                      <span
                        key={priority}
                        className="px-2.5 py-1 text-xs font-medium bg-sky-50 text-sky-600 rounded"
                      >
                        {priority}: {count}
                      </span>
                    ))}
                </div>
              </Card>
            )}
          </>
        )
        : null}
    </PageLayout>
  );
}
