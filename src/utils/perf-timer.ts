/**
 * Performance Timer Utility
 *
 * Collects timing data for performance analysis.
 * Enable with VERYFRONT_PERF=1 environment variable.
 */

import { isPerfEnabledEnv } from "#veryfront/config/env.ts";

function isPerfEnabled(): boolean {
  return isPerfEnabledEnv();
}

const enabled = isPerfEnabled();

interface TimingEntry {
  label: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  parent?: string;
}

const timings = new Map<string, TimingEntry[]>();
let currentRequestId: string | null = null;

export function startRequest(requestId: string): void {
  if (!enabled) return;
  currentRequestId = requestId;
  timings.set(requestId, []);
}

export function startTimer(label: string, parent?: string): () => void {
  if (!enabled || !currentRequestId) return () => {};

  const entry: TimingEntry = {
    label,
    startMs: performance.now(),
    parent,
  };

  const entries = timings.get(currentRequestId);
  if (entries) {
    entries.push(entry);
  }

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
  if (!entries || entries.length === 0) {
    currentRequestId = null;
    return;
  }

  // Calculate total and sort by duration
  const sorted = entries
    .filter((e) => e.durationMs !== undefined)
    .sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0));

  const total = entries.find((e) => e.label === "total")?.durationMs ||
    sorted.reduce((sum, e) => sum + (e.durationMs || 0), 0);

  console.log(`\n[PERF] Request ${requestId} - Total: ${total.toFixed(1)}ms`);
  console.log("─".repeat(60));

  // Group by parent
  const roots = sorted.filter((e) => !e.parent);
  const children = new Map<string, TimingEntry[]>();

  for (const entry of sorted) {
    if (entry.parent) {
      const list = children.get(entry.parent) || [];
      list.push(entry);
      children.set(entry.parent, list);
    }
  }

  for (const entry of roots) {
    const pct = ((entry.durationMs || 0) / total * 100).toFixed(1);
    console.log(`  ${entry.label}: ${entry.durationMs?.toFixed(1)}ms (${pct}%)`);

    const childList = children.get(entry.label);
    if (childList) {
      for (const child of childList.slice(0, 5)) {
        const childPct = ((child.durationMs || 0) / total * 100).toFixed(1);
        console.log(`    └─ ${child.label}: ${child.durationMs?.toFixed(1)}ms (${childPct}%)`);
      }
      if (childList.length > 5) {
        console.log(`    └─ ... and ${childList.length - 5} more`);
      }
    }
  }

  console.log("─".repeat(60));

  timings.delete(requestId);
  currentRequestId = null;
}

export function isEnabled(): boolean {
  return enabled;
}
