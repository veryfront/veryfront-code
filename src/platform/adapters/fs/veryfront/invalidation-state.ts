import { logger as baseLogger } from "#veryfront/utils";

const logger = baseLogger.component("invalidation-state");

const STALE_INVALIDATION_THRESHOLD_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;

let lastCleanupTime = 0;
let totalBlockedReads = 0;

const pendingInvalidations = new Map<string, { startedAt: number; count: number }>();

function cleanupStaleInvalidations(): void {
  const now = Date.now();

  if (now - lastCleanupTime < CLEANUP_INTERVAL_MS) return;
  lastCleanupTime = now;

  const staleEntries: Array<{ prefix: string; ageMs: number }> = [];

  for (const [prefix, entry] of pendingInvalidations) {
    const { startedAt } = entry;
    const ageMs = now - startedAt;
    if (ageMs <= STALE_INVALIDATION_THRESHOLD_MS) continue;

    staleEntries.push({ prefix, ageMs });
    pendingInvalidations.delete(prefix);
  }

  if (staleEntries.length === 0) return;

  logger.warn("INVALIDATION_STALE_CLEANUP - removed orphaned entries", {
    removedCount: staleEntries.length,
    entries: staleEntries,
    remainingCount: pendingInvalidations.size,
  });
}

export function addPendingInvalidation(prefix: string): void {
  const startedAt = Date.now();
  const existing = pendingInvalidations.get(prefix);
  pendingInvalidations.set(prefix, {
    startedAt: existing?.startedAt ?? startedAt,
    count: (existing?.count ?? 0) + 1,
  });

  const count = pendingInvalidations.get(prefix)?.count ?? 1;

  logger.info("INVALIDATION_STARTED - cache prefix marked for invalidation", {
    prefix,
    startedAt,
    count,
    totalPending: pendingInvalidations.size,
  });
}

export function removePendingInvalidation(prefix: string): void {
  const entry = pendingInvalidations.get(prefix);
  const durationMs = entry != null ? Date.now() - entry.startedAt : null;

  if (entry && entry.count > 1) {
    pendingInvalidations.set(prefix, {
      startedAt: entry.startedAt,
      count: entry.count - 1,
    });
  } else {
    pendingInvalidations.delete(prefix);
  }

  const remainingCount = pendingInvalidations.get(prefix)?.count ?? 0;

  logger.info("INVALIDATION_COMPLETED - cache prefix invalidation finished", {
    prefix,
    durationMs,
    remainingCount,
    totalPending: pendingInvalidations.size,
  });
}

export function isPrefixBeingInvalidated(prefix: string): boolean {
  cleanupStaleInvalidations();

  for (const [pendingPrefix, entry] of pendingInvalidations) {
    if (!prefix.startsWith(pendingPrefix) && !pendingPrefix.startsWith(prefix)) continue;

    const ageMs = Date.now() - entry.startedAt;
    totalBlockedReads++;

    logger.info("CACHE_READ_BLOCKED - preventing stale cache read", {
      requestedPrefix: prefix,
      blockingPrefix: pendingPrefix,
      invalidationAgeMs: ageMs,
      blockingCount: entry.count,
      totalBlockedReads,
      totalPending: pendingInvalidations.size,
    });

    return true;
  }

  return false;
}

export function getPendingInvalidationsCount(): number {
  return pendingInvalidations.size;
}

export function getInvalidationDebugState(): {
  pendingCount: number;
  totalBlockedReads: number;
  entries: Array<{ prefix: string; ageMs: number; startedAt: number; count: number }>;
} {
  const now = Date.now();

  return {
    pendingCount: pendingInvalidations.size,
    totalBlockedReads,
    entries: Array.from(pendingInvalidations, ([prefix, entry]) => ({
      prefix,
      startedAt: entry.startedAt,
      ageMs: now - entry.startedAt,
      count: entry.count,
    })),
  };
}

export function clearAllPendingInvalidations(): void {
  pendingInvalidations.clear();
  totalBlockedReads = 0;
}
