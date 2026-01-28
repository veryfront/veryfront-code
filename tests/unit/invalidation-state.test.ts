/**
 * Global Invalidation State Tests
 *
 * Tests for the module-level invalidation state that fixes the race condition
 * where POKE arrives on OLD adapter but request is handled by NEW adapter.
 *
 * The key invariant: pending invalidations are shared across ALL adapter instances.
 */

import { beforeEach, describe, it } from "@veryfront/testing/bdd";
import { assertEquals } from "@veryfront/testing/assert";
import {
  addPendingInvalidation,
  clearAllPendingInvalidations,
  getInvalidationDebugState,
  getPendingInvalidationsCount,
  isPrefixBeingInvalidated,
  removePendingInvalidation,
} from "../../src/platform/adapters/fs/veryfront/invalidation-state.ts";

describe("Global Invalidation State", () => {
  beforeEach(() => {
    clearAllPendingInvalidations();
  });

  it("blocks cache reads for matching prefixes", () => {
    // Adapter A adds invalidation (simulates POKE on old adapter)
    addPendingInvalidation("file:env:project:production:release-123:");

    // Adapter B checks (simulates new adapter created for same project)
    assertEquals(
      isPrefixBeingInvalidated("file:env:project:production:release-123:/pages/index.tsx"),
      true,
      "Should block cache reads for files under the invalidated prefix",
    );
  });

  it("does not block unrelated projects", () => {
    addPendingInvalidation("file:env:project-a:production:rel1:");

    assertEquals(
      isPrefixBeingInvalidated("file:env:project-b:production:rel2:/pages/index.tsx"),
      false,
      "Should not block cache reads for different projects",
    );
  });

  it("unblocks after invalidation completes", () => {
    addPendingInvalidation("file:env:project:production:rel1:");
    removePendingInvalidation("file:env:project:production:rel1:");

    assertEquals(
      isPrefixBeingInvalidated("file:env:project:production:rel1:/pages/index.tsx"),
      false,
      "Should allow cache reads after invalidation completes",
    );
  });

  it("tracks multiple pending invalidations", () => {
    addPendingInvalidation("file:env:project-a:production:rel1:");
    addPendingInvalidation("file:env:project-b:staging:rel2:");

    assertEquals(getPendingInvalidationsCount(), 2);

    assertEquals(
      isPrefixBeingInvalidated("file:env:project-a:production:rel1:/pages/index.tsx"),
      true,
    );
    assertEquals(
      isPrefixBeingInvalidated("file:env:project-b:staging:rel2:/components/Button.tsx"),
      true,
    );
    assertEquals(
      isPrefixBeingInvalidated("file:env:project-c:production:rel3:/pages/index.tsx"),
      false,
    );
  });

  it("supports bidirectional prefix matching", () => {
    // This simulates the case where a broad prefix blocks specific file lookups
    addPendingInvalidation("file:env:project:production:");

    // Specific file should be blocked
    assertEquals(
      isPrefixBeingInvalidated("file:env:project:production:rel1:/pages/index.tsx"),
      true,
      "Broad prefix should block specific file lookups",
    );

    // Release-specific prefix should also be blocked
    assertEquals(
      isPrefixBeingInvalidated("file:env:project:production:rel1:"),
      true,
      "Broad prefix should block release-specific prefix",
    );
  });

  it("handles reverse prefix matching", () => {
    // Add a specific file invalidation
    addPendingInvalidation("file:env:project:production:rel1:/pages/index.tsx");

    // Broader prefix check should also match
    assertEquals(
      isPrefixBeingInvalidated("file:env:project:production:rel1:"),
      true,
      "Specific file invalidation should block broader prefix checks",
    );
  });

  it("clearAllPendingInvalidations resets state", () => {
    addPendingInvalidation("file:env:project:production:rel1:");
    addPendingInvalidation("file:env:project:staging:rel2:");

    assertEquals(getPendingInvalidationsCount(), 2);

    clearAllPendingInvalidations();

    assertEquals(getPendingInvalidationsCount(), 0);
    assertEquals(
      isPrefixBeingInvalidated("file:env:project:production:rel1:/pages/index.tsx"),
      false,
    );
  });

  it("handles exact prefix match", () => {
    const prefix = "file:env:project:production:rel1:";
    addPendingInvalidation(prefix);

    assertEquals(
      isPrefixBeingInvalidated(prefix),
      true,
      "Exact prefix match should return true",
    );
  });

  it("does not match partial prefixes", () => {
    addPendingInvalidation("file:env:project:production:");

    // Different project with similar name should not match
    assertEquals(
      isPrefixBeingInvalidated("file:env:project-extra:production:rel1:"),
      false,
      "Similar but different project should not match",
    );
  });
});

describe("Global Invalidation State - Debug State", () => {
  beforeEach(() => {
    clearAllPendingInvalidations();
  });

  it("provides debug state with entry details", () => {
    const beforeAdd = Date.now();
    addPendingInvalidation("file:env:project:production:rel1:");

    const state = getInvalidationDebugState();

    assertEquals(state.pendingCount, 1);
    assertEquals(state.entries.length, 1);

    const entry = state.entries[0];
    if (!entry) throw new Error("Expected entry to exist");

    assertEquals(entry.prefix, "file:env:project:production:rel1:");
    assertEquals(entry.startedAt >= beforeAdd, true);
    assertEquals(entry.ageMs >= 0, true);
  });

  it("tracks total blocked reads", () => {
    addPendingInvalidation("file:env:project:production:");

    // Trigger some blocked reads
    isPrefixBeingInvalidated("file:env:project:production:rel1:/a.tsx");
    isPrefixBeingInvalidated("file:env:project:production:rel1:/b.tsx");
    isPrefixBeingInvalidated("file:env:project:production:rel1:/c.tsx");

    const state = getInvalidationDebugState();
    assertEquals(state.totalBlockedReads, 3, "Should track blocked read count");
  });

  it("resets blocked reads counter on clear", () => {
    addPendingInvalidation("file:env:project:production:");
    isPrefixBeingInvalidated("file:env:project:production:rel1:/a.tsx");

    clearAllPendingInvalidations();

    const state = getInvalidationDebugState();
    assertEquals(state.totalBlockedReads, 0, "Counter should reset on clear");
  });
});

describe("Global Invalidation State - Race Condition Scenario", () => {
  beforeEach(() => {
    clearAllPendingInvalidations();
  });

  it("simulates the deployment race condition fix", () => {
    // Timeline simulation:
    // 1. POKE arrives on OLD adapter instance
    // 2. OLD adapter starts cache deletion, adds pending invalidation
    // 3. Request arrives with NEW releaseId
    // 4. NEW adapter instance is created (would have empty state without fix)
    // 5. NEW adapter checks cache - should see pending invalidation from OLD adapter

    const projectSlug = "my-project";
    const oldReleaseId = "release-old";
    const newReleaseId = "release-new";

    // Step 1-2: POKE on old adapter adds pending invalidation
    const oldAdapterPrefix = `file:env:${projectSlug}:production:${oldReleaseId}:`;
    addPendingInvalidation(oldAdapterPrefix);

    // Step 4-5: New adapter instance checks if cache should be skipped
    // The new adapter would be checking for a different release, but the project
    // prefix should still match because we're invalidating at the project level
    const newAdapterFileKey = `file:env:${projectSlug}:production:${newReleaseId}:/pages/index.tsx`;

    // With broad project-level invalidation, new release should also be blocked
    // This requires the invalidation to be at project level, not release level
    const broadProjectPrefix = `file:env:${projectSlug}:production:`;
    clearAllPendingInvalidations();
    addPendingInvalidation(broadProjectPrefix);

    assertEquals(
      isPrefixBeingInvalidated(newAdapterFileKey),
      true,
      "New adapter should see pending invalidation from old adapter when using broad prefix",
    );

    // After invalidation completes
    removePendingInvalidation(broadProjectPrefix);

    assertEquals(
      isPrefixBeingInvalidated(newAdapterFileKey),
      false,
      "Cache should be accessible after invalidation completes",
    );
  });

  it("logs provide proof of fix working", () => {
    // This test verifies the observability aspect
    // In production, look for these log patterns:
    // - INVALIDATION_STARTED
    // - CACHE_READ_BLOCKED (this is the PROOF)
    // - INVALIDATION_COMPLETED

    addPendingInvalidation("file:env:project:production:");

    // This call should log CACHE_READ_BLOCKED
    const blocked = isPrefixBeingInvalidated("file:env:project:production:rel1:/pages/index.tsx");
    assertEquals(blocked, true);

    const state = getInvalidationDebugState();
    assertEquals(
      state.totalBlockedReads >= 1,
      true,
      "Should have at least one blocked read recorded",
    );
  });
});
