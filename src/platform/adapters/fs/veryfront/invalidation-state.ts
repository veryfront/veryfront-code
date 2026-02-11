import { logger } from "#veryfront/utils";

const log = logger.component("invalidation-state");

const STALE_INVALIDATION_THRESHOLD_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;

let lastCleanupTime = 0;
let totalBlockedReads = 0;

const pendingInvalidations = new Map<string, number>();

function cleanupStaleInvalidations(): void {
  const now = Date.now();

  if (now - lastCleanupTime < CLEANUP_INTERVAL_MS) return;
  lastCleanupTime = now;

  const staleEntries: Array<{ prefix: string; ageMs: number }> = [];

  for (const [prefix, startedAt] of pendingInvalidations) {
    const ageMs = now - startedAt;
    if (ageMs <= STALE_INVALIDATION_THRESHOLD_MS) continue;

    staleEntries.push({ prefix, ageMs });
    pendingInvalidations.delete(prefix);
  }

  if (staleEntries.length === 0) return;

  log.warn("INVALIDATION_STALE_CLEANUP - removed orphaned entries", {
    removedCount: staleEntries.length,
    entries: staleEntries,
    remainingCount: pendingInvalidations.size,
  });
}

export function addPendingInvalidation(prefix: string): void {
  const startedAt = Date.now();
  pendingInvalidations.set(prefix, startedAt);

  log.info("INVALIDATION_STARTED - cache prefix marked for invalidation", {
    prefix,
    startedAt,
    totalPending: pendingInvalidations.size,
  });
}

export function removePendingInvalidation(prefix: string): void {
  const startedAt = pendingInvalidations.get(prefix);
  const durationMs = startedAt != null ? Date.now() - startedAt : null;

  pendingInvalidations.delete(prefix);

  log.info("INVALIDATION_COMPLETED - cache prefix invalidation finished", {
    prefix,
    durationMs,
    totalPending: pendingInvalidations.size,
  });
}

export function isPrefixBeingInvalidated(prefix: string): boolean {
  cleanupStaleInvalidations();

  for (const [pendingPrefix, startedAt] of pendingInvalidations) {
    if (!prefix.startsWith(pendingPrefix) && !pendingPrefix.startsWith(prefix)) continue;

    const ageMs = Date.now() - startedAt;
    totalBlockedReads++;

    log.info("CACHE_READ_BLOCKED - preventing stale cache read", {
      requestedPrefix: prefix,
      blockingPrefix: pendingPrefix,
      invalidationAgeMs: ageMs,
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
  entries: Array<{ prefix: string; ageMs: number; startedAt: number }>;
} {
  const now = Date.now();

  return {
    pendingCount: pendingInvalidations.size,
    totalBlockedReads,
    entries: Array.from(pendingInvalidations, ([prefix, startedAt]) => ({
      prefix,
      startedAt,
      ageMs: now - startedAt,
    })),
  };
}

export function clearAllPendingInvalidations(): void {
  pendingInvalidations.clear();
  totalBlockedReads = 0;
}
