/**
 * Performance Timer Utility
 *
 * Collects timing data for performance analysis.
 * Enable with VERYFRONT_PERF=1 environment variable.
 */

import { isPerfEnabledEnv } from "../config/env.js";
import { serverLogger } from "./index.js";

interface TimingEntry {
  label: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  parent?: string;
}

const enabled = isPerfEnabledEnv();
const timings = new Map<string, TimingEntry[]>();
let currentRequestId: string | null = null;

export function startRequest(requestId: string): void {
  if (!enabled) return;

  currentRequestId = requestId;
  timings.set(requestId, []);
}

export function startTimer(label: string, parent?: string): () => void {
  if (!enabled || !currentRequestId) return () => {};

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
  if (!enabled) return fn();

  const stop = startTimer(label, parent);
  try {
    return await fn();
  } finally {
    stop();
  }
}

export function endRequest(requestId: string): void {
  if (!enabled) return;

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
    if (!entry.parent) continue;
    const list = children.get(entry.parent) ?? [];
    list.push(entry);
    children.set(entry.parent, list);
  }

  const breakdown: Record<string, unknown>[] = [];
  for (const entry of roots) {
    const duration = entry.durationMs ?? 0;
    const pct = ((duration / total) * 100).toFixed(1);
    const item: Record<string, unknown> = {
      label: entry.label,
      durationMs: Number(entry.durationMs?.toFixed(1)),
      pct,
    };

    const childList = children.get(entry.label);
    if (childList) {
      item.children = childList.slice(0, 5).map((child) => ({
        label: child.label,
        durationMs: Number(child.durationMs?.toFixed(1)),
        pct: ((child.durationMs ?? 0) / total * 100).toFixed(1),
      }));
      if (childList.length > 5) {
        item.childrenOmitted = childList.length - 5;
      }
    }

    breakdown.push(item);
  }

  serverLogger.debug(`[PERF] Request ${requestId}`, {
    requestId,
    totalMs: Number(total.toFixed(1)),
    breakdown,
  });

  timings.delete(requestId);
  currentRequestId = null;
}

export function isEnabled(): boolean {
  return enabled;
}
