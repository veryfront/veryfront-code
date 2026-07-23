import { AsyncLocalStorage } from "#veryfront/platform/compat/async-local-storage.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
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
  active: boolean;
  entries: TimingEntry[];
  parent?: RequestTiming;
  requestId: string;
}

const MAX_ACTIVE_REQUESTS = 1_024;
const MAX_TIMINGS_PER_REQUEST = 1_000;

let cachedEnabled: boolean | undefined;

function getEnabled(): boolean {
  if (cachedEnabled !== undefined) return cachedEnabled;
  // Read env directly to avoid triggering getEnvironmentConfig() at module-load time.
  // This module is imported before .env is loaded, so going through the config
  // pipeline produces a noisy early-access warning.
  cachedEnabled = getHostEnv("VERYFRONT_PERF") === "1";
  return cachedEnabled;
}
const requestTimingContext = new AsyncLocalStorage<RequestTiming | undefined>();
const activeRequests = new Set<RequestTiming>();

function formatMs(value: number | undefined): number {
  return Number(value?.toFixed(1));
}

function formatPct(duration: number, total: number): string {
  if (total <= 0) return "0.0";
  return ((duration / total) * 100).toFixed(1);
}

/** Request payload for start. */
export function startRequest(requestId: string): void {
  if (!getEnabled()) return;

  if (activeRequests.size >= MAX_ACTIVE_REQUESTS) {
    const oldest = activeRequests.values().next().value;
    if (oldest) {
      oldest.active = false;
      activeRequests.delete(oldest);
    }
  }

  const parent = requestTimingContext.getStore();
  const request: RequestTiming = {
    active: true,
    entries: [],
    ...(parent?.active ? { parent } : {}),
    requestId,
  };
  activeRequests.add(request);
  requestTimingContext.enterWith(request);
}

/** Starts timer. */
export function startTimer(label: string, parent?: string): () => void {
  if (!getEnabled()) return () => {};
  const request = requestTimingContext.getStore();
  if (!request?.active || request.entries.length >= MAX_TIMINGS_PER_REQUEST) return () => {};

  const entry: TimingEntry = { label, startMs: performance.now(), parent };
  request.entries.push(entry);
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

/** Request payload for end. */
export function endRequest(requestId: string): void {
  if (!getEnabled()) return;

  const current = requestTimingContext.getStore();
  const request = current?.active && current.requestId === requestId
    ? current
    : [...activeRequests].reverse().find((candidate) => candidate.requestId === requestId);
  if (!request) return;

  request.active = false;
  activeRequests.delete(request);
  if (current === request) {
    const activeParent = request.parent?.active ? request.parent : undefined;
    requestTimingContext.enterWith(activeParent);
  }

  const entries = request.entries;
  if (!entries?.length) {
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
}

/** Check whether request performance timing is enabled. */
export function isEnabled(): boolean {
  return getEnabled();
}

/** @internal Test-only state reset. */
export function __resetPerfTimerForTests(): void {
  for (const request of activeRequests) request.active = false;
  activeRequests.clear();
  cachedEnabled = undefined;
  requestTimingContext.enterWith(undefined);
}

/** @internal Test-only active-request count. */
export function __getActivePerfRequestCountForTests(): number {
  return activeRequests.size;
}
