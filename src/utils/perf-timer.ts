import { serverLogger } from "#veryfront/utils";
import { getEnv } from "#veryfront/platform/compat/process.ts";

const logger = serverLogger.component("perf");

interface TimingEntry {
  label: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  parent?: string;
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
const timings = new Map<string, TimingEntry[]>();
let currentRequestId: string | null = null;

function formatMs(value: number | undefined): number {
  return Number(value?.toFixed(1));
}

function formatPct(duration: number, total: number): string {
  return ((duration / total) * 100).toFixed(1);
}

export function startRequest(requestId: string): void {
  if (!getEnabled()) return;

  currentRequestId = requestId;
  timings.set(requestId, []);
}

export function startTimer(label: string, parent?: string): () => void {
  if (!getEnabled() || !currentRequestId) return () => {};

  const entry: TimingEntry = { label, startMs: performance.now(), parent };
  timings.get(currentRequestId)?.push(entry);

  return () => {
    entry.endMs = performance.now();
    entry.durationMs = entry.endMs - entry.startMs;
  };
}

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

export function endRequest(requestId: string): void {
  if (!getEnabled()) return;

  const entries = timings.get(requestId);
  if (!entries?.length) {
    currentRequestId = null;
    return;
  }

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

  timings.delete(requestId);
  currentRequestId = null;
}

export function isEnabled(): boolean {
  return getEnabled();
}
