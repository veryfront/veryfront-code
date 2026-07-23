import { getEnv } from "#veryfront/platform/compat/process.ts";
import { AsyncLocalStorage } from "#veryfront/platform/compat/async-context.ts";
import { serverLogger } from "./logger/logger.ts";

const logger = serverLogger.component("perf");

interface TimingEntry {
  label: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  parent?: string;
}

interface RequestTiming {
  requestId: string;
  entries: TimingEntry[];
}

let cachedEnabled: boolean | undefined;

function getEnabled(): boolean {
  if (cachedEnabled !== undefined) return cachedEnabled;
  // Read env directly to avoid triggering getEnvironmentConfig() at module-load time.
  // This module is imported before .env is loaded, so going through the config
  // pipeline produces a noisy early-access warning.
  cachedEnabled = getEnv("VERYFRONT_PERF") === "1";
  return cachedEnabled;
}
const requestTimingStorage = new AsyncLocalStorage<RequestTiming | null>();
const activeTimings = new Set<RequestTiming>();

function formatMs(value: number | undefined): number {
  return Number(value?.toFixed(1));
}

function formatPct(duration: number, total: number): string {
  if (total <= 0) return "0.0";
  return ((duration / total) * 100).toFixed(1);
}

function getCurrentTiming(): RequestTiming | undefined {
  const scoped = requestTimingStorage.getStore();
  if (scoped && activeTimings.has(scoped)) return scoped;
  return undefined;
}

function beginRequestTiming(requestId: string): RequestTiming {
  const timing: RequestTiming = { requestId, entries: [] };
  activeTimings.add(timing);
  return timing;
}

/** Request payload for start. */
export function startRequest(requestId: string): void {
  if (!getEnabled()) return;

  const timing = beginRequestTiming(requestId);
  requestTimingStorage.enterWith(timing);
}

/** Starts timer. */
export function startTimer(label: string, parent?: string): () => void {
  if (!getEnabled()) return () => {};

  const timing = getCurrentTiming();
  if (!timing) return () => {};

  const entry: TimingEntry = { label, startMs: performance.now(), parent };
  timing.entries.push(entry);
  let stopped = false;

  return () => {
    if (stopped) return;
    stopped = true;
    entry.endMs = performance.now();
    entry.durationMs = entry.endMs - entry.startMs;
  };
}

/** Time async. */
export async function timeAsync<T>(
  label: string,
  fn: () => Promise<T>,
  parent?: string,
): Promise<T> {
  if (!getEnabled()) return fn();

  const stop = startTimer(label, parent);
  try {
    return await fn();
  } finally {
    stop();
  }
}

/** Run an operation in an isolated request-timing scope and always clean it up. */
export async function runWithRequestTiming<T>(
  requestId: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!getEnabled()) return operation();

  const timing = beginRequestTiming(requestId);
  return requestTimingStorage.run(timing, async () => {
    try {
      return await operation();
    } finally {
      endRequest(requestId);
    }
  });
}

/** Request payload for end. */
export function endRequest(requestId: string): void {
  if (!getEnabled()) return;

  const scopedTiming = requestTimingStorage.getStore();
  let timing = scopedTiming?.requestId === requestId && activeTimings.has(scopedTiming)
    ? scopedTiming
    : undefined;
  if (!timing) {
    timing = [...activeTimings].find((candidate) => candidate.requestId === requestId);
  }
  if (!timing) return;

  activeTimings.delete(timing);
  if (scopedTiming === timing) requestTimingStorage.enterWith(null);

  const entries = timing.entries;
  if (entries.length === 0) return;

  const sorted = entries
    .filter((e) => e.durationMs !== undefined)
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));

  const total = entries.find((e) => e.label === "total")?.durationMs ??
    sorted.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);

  const roots = sorted.filter((e) => !e.parent);
  const children = new Map<string, TimingEntry[]>();

  for (const entry of sorted) {
    const parentLabel = entry.parent;
    if (!parentLabel) continue;

    const list = children.get(parentLabel);
    if (list) {
      list.push(entry);
    } else {
      children.set(parentLabel, [entry]);
    }
  }

  const breakdown: Record<string, unknown>[] = roots.map((entry) => {
    const duration = entry.durationMs ?? 0;

    const item: Record<string, unknown> = {
      label: entry.label,
      durationMs: formatMs(entry.durationMs),
      pct: formatPct(duration, total),
    };

    const childList = children.get(entry.label);
    if (!childList) return item;

    item.children = childList.slice(0, 5).map((child) => {
      const childDuration = child.durationMs ?? 0;
      return {
        label: child.label,
        durationMs: formatMs(child.durationMs),
        pct: formatPct(childDuration, total),
      };
    });

    if (childList.length > 5) {
      item.childrenOmitted = childList.length - 5;
    }

    return item;
  });

  logger.debug(`Request ${requestId}`, {
    requestId,
    totalMs: formatMs(total),
    breakdown,
  });
}

/** Check whether request performance timing is enabled. */
export function isEnabled(): boolean {
  return getEnabled();
}
