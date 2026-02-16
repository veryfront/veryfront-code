import { useEffect, useState } from "react";
import { Card } from "./Card.tsx";
import { ErrorState, LoadingState } from "./shared.tsx";

interface SpanEntry {
  id: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: "server" | "client" | "internal";
  status: "ok" | "error" | "unset";
  statusMessage?: string;
  startTime: number;
  endTime: number;
  duration: number;
  attributes: Record<string, string | number | boolean>;
}

interface TraceGroup {
  traceId: string;
  rootSpan: SpanEntry;
  spans: SpanEntry[];
  duration: number;
}

interface TracesResponse {
  traces: TraceGroup[];
  spans: number;
  countByStatus: Record<string, number>;
  total: number;
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function statusBadge(status: string): React.JSX.Element {
  const colors: Record<string, string> = {
    ok: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
    unset: "bg-gray-100 text-gray-600",
  };

  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
        colors[status] ?? colors.unset
      }`}
    >
      {status}
    </span>
  );
}

function kindBadge(kind: string): React.JSX.Element {
  const colors: Record<string, string> = {
    server: "text-cyan-600",
    client: "text-purple-600",
    internal: "text-gray-500",
  };

  return (
    <span className={`text-[10px] font-mono ${colors[kind] ?? colors.internal}`}>
      {kind.slice(0, 3)}
    </span>
  );
}

function WaterfallBar({
  span,
  traceStart,
  traceDuration,
}: {
  span: SpanEntry;
  traceStart: number;
  traceDuration: number;
}): React.JSX.Element {
  const offset = traceDuration > 0 ? ((span.startTime - traceStart) / traceDuration) * 100 : 0;
  const width = traceDuration > 0 ? Math.max((span.duration / traceDuration) * 100, 0.5) : 100;

  const barColor = span.status === "error"
    ? "bg-red-400"
    : span.kind === "server"
    ? "bg-cyan-400"
    : span.kind === "client"
    ? "bg-purple-400"
    : "bg-sky-300";

  return (
    <div className="relative h-4 w-full bg-gray-50 rounded overflow-hidden">
      <div
        className={`absolute top-0.5 bottom-0.5 rounded ${barColor}`}
        style={{ left: `${offset}%`, width: `${Math.min(width, 100 - offset)}%` }}
      />
    </div>
  );
}

function buildSpanTree(
  spans: SpanEntry[],
): Array<{ span: SpanEntry; depth: number }> {
  const childMap = new Map<string | undefined, SpanEntry[]>();

  for (const span of spans) {
    const parentKey = span.parentSpanId ?? undefined;
    const children = childMap.get(parentKey);
    if (children) {
      children.push(span);
    } else {
      childMap.set(parentKey, [span]);
    }
  }

  const result: Array<{ span: SpanEntry; depth: number }> = [];

  function walk(parentId: string | undefined, depth: number): void {
    const children = childMap.get(parentId) ?? [];
    children.sort((a, b) => a.startTime - b.startTime);
    for (const child of children) {
      result.push({ span: child, depth });
      walk(child.spanId, depth + 1);
    }
  }

  // Find root spans (no parent, or parent not in this trace)
  const spanIds = new Set(spans.map((s) => s.spanId));
  const roots = spans.filter((s) => !s.parentSpanId || !spanIds.has(s.parentSpanId));
  roots.sort((a, b) => a.startTime - b.startTime);

  for (const root of roots) {
    result.push({ span: root, depth: 0 });
    walk(root.spanId, 1);
  }

  return result;
}

function TraceDetail({
  trace,
  onClose,
}: {
  trace: TraceGroup;
  onClose: () => void;
}): React.JSX.Element {
  const traceStart = Math.min(...trace.spans.map((s) => s.startTime));
  const tree = buildSpanTree(trace.spans);
  const [selectedSpan, setSelectedSpan] = useState<SpanEntry | null>(null);

  return (
    <Card className="mb-4">
      <div className="p-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-gray-400">
            {trace.traceId.slice(0, 8)}...
          </span>
          <span className="text-sm font-medium">{trace.rootSpan.name}</span>
          <span className="text-xs text-gray-500">{formatDuration(trace.duration)}</span>
          <span className="text-xs text-gray-400">{trace.spans.length} spans</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Close
        </button>
      </div>

      <div className="divide-y divide-gray-50">
        {tree.map(({ span, depth }) => (
          <button
            type="button"
            key={span.id}
            onClick={() => setSelectedSpan(selectedSpan?.id === span.id ? null : span)}
            className={`w-full text-left px-3 py-1.5 hover:bg-gray-50 grid grid-cols-[1fr_200px_70px] gap-2 items-center ${
              selectedSpan?.id === span.id ? "bg-sky-50" : ""
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span style={{ width: `${depth * 16}px` }} className="flex-shrink-0" />
              {kindBadge(span.kind)}
              <code className="text-xs truncate">{span.name}</code>
              {statusBadge(span.status)}
            </div>
            <WaterfallBar span={span} traceStart={traceStart} traceDuration={trace.duration} />
            <span className="text-xs text-gray-500 text-right">
              {formatDuration(span.duration)}
            </span>
          </button>
        ))}
      </div>

      {selectedSpan && (
        <div className="p-3 border-t border-gray-200 bg-gray-50">
          <div className="text-xs font-semibold text-gray-600 mb-2">Span Detail</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
            <span className="text-gray-500">Name</span>
            <code>{selectedSpan.name}</code>
            <span className="text-gray-500">Span ID</span>
            <code className="text-gray-400">{selectedSpan.spanId}</code>
            <span className="text-gray-500">Duration</span>
            <span>{formatDuration(selectedSpan.duration)}</span>
            <span className="text-gray-500">Kind</span>
            <span>{selectedSpan.kind}</span>
            <span className="text-gray-500">Status</span>
            <span>
              {selectedSpan.status}
              {selectedSpan.statusMessage ? `: ${selectedSpan.statusMessage}` : ""}
            </span>
          </div>
          {Object.keys(selectedSpan.attributes).length > 0 && (
            <>
              <div className="text-xs font-semibold text-gray-600 mb-1 mt-2">Attributes</div>
              <table className="w-full text-xs">
                <tbody>
                  {Object.entries(selectedSpan.attributes).map(([key, value]) => (
                    <tr key={key} className="border-b border-gray-100 last:border-0">
                      <td className="py-0.5 pr-3 text-gray-500">{key}</td>
                      <td className="py-0.5 font-mono">{String(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

export function TracesSection(): React.JSX.Element {
  const [data, setData] = useState<TracesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const [nameFilter, setNameFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [minDuration, setMinDuration] = useState("");

  function loadTraces(): void {
    const params = new URLSearchParams();
    if (nameFilter) params.set("name", nameFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (minDuration) params.set("minDuration", minDuration);
    params.set("limit", "50");

    fetch(`/_dev/api/traces?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d as TracesResponse);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadTraces();
    const interval = setInterval(loadTraces, 5000);
    return () => clearInterval(interval);
  }, [nameFilter, statusFilter, minDuration]);

  if (!data && loading) {
    return (
      <Card>
        <LoadingState message="Loading traces..." />
      </Card>
    );
  }

  if (!data && error) {
    return (
      <Card>
        <ErrorState error={error} />
      </Card>
    );
  }

  const traces = data?.traces ?? [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          placeholder="Filter by name..."
          className="px-2 py-1.5 text-sm border border-gray-200 rounded w-48"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-2 py-1.5 text-sm border border-gray-200 rounded"
        >
          <option value="">All statuses</option>
          <option value="ok">OK</option>
          <option value="error">Error</option>
          <option value="unset">Unset</option>
        </select>
        <input
          type="number"
          value={minDuration}
          onChange={(e) => setMinDuration(e.target.value)}
          placeholder="Min ms..."
          className="px-2 py-1.5 text-sm border border-gray-200 rounded w-24"
        />
        <div className="flex-1" />
        <span className="text-xs text-gray-400">
          {data?.total ?? 0} spans, {traces.length} traces
        </span>
        <button
          type="button"
          onClick={loadTraces}
          disabled={loading}
          className="px-3 py-1.5 bg-white border border-gray-200 text-sm text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {traces.length === 0
        ? (
          <Card>
            <div className="p-6 text-center text-gray-400">
              No traces recorded yet. Make some requests to see traces appear.
            </div>
          </Card>
        )
        : (
          <>
            {expandedTrace
              ? (
                (() => {
                  const trace = traces.find((t) => t.traceId === expandedTrace);
                  return trace
                    ? <TraceDetail trace={trace} onClose={() => setExpandedTrace(null)} />
                    : null;
                })()
              )
              : null}

            <Card>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      Trace
                    </th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      Root Span
                    </th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      Duration
                    </th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      Spans
                    </th>
                    <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {traces.map((trace) => (
                    <tr
                      key={trace.traceId}
                      onClick={() =>
                        setExpandedTrace(expandedTrace === trace.traceId ? null : trace.traceId)}
                      className={`border-b last:border-0 cursor-pointer hover:bg-gray-50 ${
                        expandedTrace === trace.traceId ? "bg-sky-50" : ""
                      }`}
                    >
                      <td className="px-3 py-2">
                        <code className="text-xs text-gray-400">{trace.traceId.slice(0, 8)}</code>
                      </td>
                      <td className="px-3 py-2">
                        <code className="text-xs text-sky-600">{trace.rootSpan.name}</code>
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {formatDuration(trace.duration)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500">{trace.spans.length}</td>
                      <td className="px-3 py-2 text-center">
                        {statusBadge(trace.rootSpan.status)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
    </div>
  );
}
