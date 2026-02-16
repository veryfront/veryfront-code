export type SpanKind = "server" | "client" | "internal" | "producer" | "consumer";
export type SpanStatus = "ok" | "error" | "unset";

export interface SpanEntry {
  id: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  status: SpanStatus;
  statusMessage?: string;
  startTime: number;
  endTime: number;
  duration: number;
  attributes: Record<string, string | number | boolean>;
}

export interface SpanFilter {
  traceId?: string;
  name?: string | RegExp;
  status?: SpanStatus | SpanStatus[];
  kind?: SpanKind | SpanKind[];
  minDuration?: number;
  maxDuration?: number;
  since?: number;
  limit?: number;
}

export type SpanSubscriber = (entry: SpanEntry) => void;

export class SpanBuffer {
  private entries: SpanEntry[] = [];
  private subscribers = new Set<SpanSubscriber>();
  private idCounter = 0;
  private maxSize: number;

  constructor(options: { maxSize?: number } = {}) {
    this.maxSize = options.maxSize ?? 1000;
  }

  private generateId(): string {
    return `span_${Date.now()}_${++this.idCounter}`;
  }

  append(entry: Omit<SpanEntry, "id">): SpanEntry {
    const fullEntry: SpanEntry = {
      ...entry,
      id: this.generateId(),
    };

    this.entries.push(fullEntry);

    while (this.entries.length > this.maxSize) {
      this.entries.shift();
    }

    for (const subscriber of this.subscribers) {
      try {
        subscriber(fullEntry);
      } catch {
        // Ignore subscriber errors
      }
    }

    return fullEntry;
  }

  query(filter?: SpanFilter): SpanEntry[] {
    if (!filter) return [...this.entries];

    let results = [...this.entries];

    if (filter.traceId) {
      results = results.filter((e) => e.traceId === filter.traceId);
    }

    if (filter.name) {
      const { name } = filter;
      if (typeof name === "string") {
        const lower = name.toLowerCase();
        results = results.filter((e) => e.name.toLowerCase().includes(lower));
      } else {
        results = results.filter((e) => name.test(e.name));
      }
    }

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      results = results.filter((e) => statuses.includes(e.status));
    }

    if (filter.kind) {
      const kinds = Array.isArray(filter.kind) ? filter.kind : [filter.kind];
      results = results.filter((e) => kinds.includes(e.kind));
    }

    if (filter.minDuration != null) {
      results = results.filter((e) => e.duration >= filter.minDuration!);
    }

    if (filter.maxDuration != null) {
      results = results.filter((e) => e.duration <= filter.maxDuration!);
    }

    if (filter.since != null) {
      results = results.filter((e) => e.startTime >= filter.since!);
    }

    if (filter.limit != null) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  getTrace(traceId: string): SpanEntry[] {
    return this.entries
      .filter((e) => e.traceId === traceId)
      .sort((a, b) => a.startTime - b.startTime);
  }

  getTraces(options?: { limit?: number; since?: number }): Array<{
    traceId: string;
    rootSpan: SpanEntry;
    spans: SpanEntry[];
    duration: number;
  }> {
    const traceMap = new Map<string, SpanEntry[]>();

    for (const entry of this.entries) {
      if (options?.since != null && entry.startTime < options.since) continue;

      const spans = traceMap.get(entry.traceId);
      if (spans) {
        spans.push(entry);
      } else {
        traceMap.set(entry.traceId, [entry]);
      }
    }

    const traces = Array.from(traceMap.entries())
      .map(([traceId, spans]) => {
        spans.sort((a, b) => a.startTime - b.startTime);
        // spans always has at least one entry (built from map insertion)
        const rootSpan = (spans.find((s) => !s.parentSpanId) ?? spans[0])!;
        const minStart = Math.min(...spans.map((s) => s.startTime));
        const maxEnd = Math.max(...spans.map((s) => s.endTime));
        return { traceId, rootSpan, spans, duration: maxEnd - minStart };
      })
      .sort((a, b) => b.rootSpan.startTime - a.rootSpan.startTime);

    if (options?.limit != null) {
      return traces.slice(0, options.limit);
    }

    return traces;
  }

  getAll(): SpanEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }

  get count(): number {
    return this.entries.length;
  }

  countByStatus(): Record<SpanStatus, number> {
    const counts: Record<SpanStatus, number> = { ok: 0, error: 0, unset: 0 };

    for (const entry of this.entries) {
      counts[entry.status]++;
    }

    return counts;
  }

  subscribe(callback: SpanSubscriber): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  toJSON(): SpanEntry[] {
    return this.getAll();
  }

  format(entries?: SpanEntry[]): string {
    const spans = entries ?? this.entries;

    return spans
      .map((e) => {
        const time = new Date(e.startTime).toISOString().slice(11, 23);
        const status = e.status.toUpperCase().padEnd(5);
        const dur = `${e.duration.toFixed(1)}ms`.padStart(9);
        return `${time} ${status} ${dur}  ${e.name}`;
      })
      .join("\n");
  }
}

let globalBuffer: SpanBuffer | null = null;

export function getSpanBuffer(): SpanBuffer {
  globalBuffer ??= new SpanBuffer();
  return globalBuffer;
}

export function resetSpanBuffer(): void {
  globalBuffer?.clear();
  globalBuffer = null;
}
