import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  addPendingInvalidation,
  clearAllPendingInvalidations,
  getInvalidationDebugState,
  getPendingInvalidationsCount,
  isPrefixBeingInvalidated,
  removePendingInvalidation,
} from "./invalidation-state.ts";

describe("veryfront/invalidation-state", () => {
  it("blocks reads for exact, parent, and child prefixes during invalidation", () => {
    clearAllPendingInvalidations();

    const prefix = "file:release:project-a:rel-1";
    addPendingInvalidation(prefix);

    assertEquals(isPrefixBeingInvalidated(prefix), true);
    assertEquals(isPrefixBeingInvalidated(`${prefix}:pages/home.tsx`), true);
    assertEquals(isPrefixBeingInvalidated("file:release:project-a"), true);
    assertEquals(isPrefixBeingInvalidated("file:release:project-b:rel-2"), false);

    const state = getInvalidationDebugState();
    assertEquals(state.pendingCount, 1);
    assertEquals(state.totalBlockedReads >= 3, true);

    clearAllPendingInvalidations();
  });

  it("stops blocking after invalidation is removed", () => {
    clearAllPendingInvalidations();

    const prefix = "file:env:project-a:production";
    addPendingInvalidation(prefix);
    assertEquals(getPendingInvalidationsCount(), 1);
    assertEquals(isPrefixBeingInvalidated(`${prefix}:pages/index.tsx`), true);

    removePendingInvalidation(prefix);
    assertEquals(getPendingInvalidationsCount(), 0);
    assertEquals(isPrefixBeingInvalidated(`${prefix}:pages/index.tsx`), false);

    clearAllPendingInvalidations();
  });

  it("keeps blocking until overlapping invalidations are fully removed", () => {
    clearAllPendingInvalidations();

    const prefix = "file:branch:project-a:main";
    addPendingInvalidation(prefix);
    addPendingInvalidation(prefix);

    assertEquals(getPendingInvalidationsCount(), 1);
    assertEquals(isPrefixBeingInvalidated(`${prefix}:pages/index.tsx`), true);

    removePendingInvalidation(prefix);
    assertEquals(getPendingInvalidationsCount(), 1);
    assertEquals(isPrefixBeingInvalidated(`${prefix}:pages/index.tsx`), true);

    removePendingInvalidation(prefix);
    assertEquals(getPendingInvalidationsCount(), 0);
    assertEquals(isPrefixBeingInvalidated(`${prefix}:pages/index.tsx`), false);

    clearAllPendingInvalidations();
  });

  it("cleans up stale invalidations and avoids blocking after stale timeout", () => {
    clearAllPendingInvalidations();

    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;

    try {
      const stalePrefix = "file:branch:project-a:main";
      addPendingInvalidation(stalePrefix);

      // Advance past cleanup interval (30s) and stale threshold (5m)
      now += (5 * 60 * 1000) + (30 * 1000) + 1;

      assertEquals(isPrefixBeingInvalidated(stalePrefix), false);
      assertEquals(getPendingInvalidationsCount(), 0);
    } finally {
      Date.now = originalNow;
      clearAllPendingInvalidations();
    }
  });

  it("clearAllPendingInvalidations resets pending entries and blocked-read counter", () => {
    clearAllPendingInvalidations();

    const prefix = "file:branch:project-reset:main";
    addPendingInvalidation(prefix);
    assertEquals(isPrefixBeingInvalidated(prefix), true);
    assertEquals(getInvalidationDebugState().totalBlockedReads > 0, true);

    clearAllPendingInvalidations();

    const state = getInvalidationDebugState();
    assertEquals(state.pendingCount, 0);
    assertEquals(state.totalBlockedReads, 0);
  });
});
