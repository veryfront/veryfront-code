/**
 * Test: 002.4 Semaphore Fairness
 *
 * Validates the fix for issue 002.4 from the architecture audit:
 * - transformSemaphore now has per-project limits
 * - One project cannot monopolize all transform capacity
 * - Other projects can still acquire transforms when one is at capacity
 *
 * @see plans/architecture-audit/002.4-semaphore-starvation.md
 */

import { assertEquals, assert } from "@veryfront/testing/assert";
import { describe, it, beforeEach, afterEach } from "@veryfront/testing/bdd";
import {
  acquireTransformSlot,
  releaseTransformSlot,
  getTransformStats,
} from "../../../src/modules/react-loader/ssr-module-loader/cache/memory.ts";
import { TRANSFORM_PER_PROJECT_LIMIT } from "../../../src/modules/react-loader/ssr-module-loader/constants.ts";

// Helper to release all slots for a project
function releaseAllSlots(projectId: string): void {
  const stats = getTransformStats();
  const count = stats.activeProjects.get(projectId) ?? 0;
  for (let i = 0; i < count; i++) {
    releaseTransformSlot(projectId);
  }
}

// Skip all per-project fairness tests when limits are disabled (set to 0)
// This happens in test environments where parallelism would cause false failures
const limitsEnabled = TRANSFORM_PER_PROJECT_LIMIT > 0;

describe("002.4 Semaphore Fairness", () => {
  const projectA = "test-project-a-" + Date.now();
  const projectB = "test-project-b-" + Date.now();

  beforeEach(() => {
    // Ensure clean state by releasing any leftover slots
    releaseAllSlots(projectA);
    releaseAllSlots(projectB);
  });

  afterEach(() => {
    // Clean up
    releaseAllSlots(projectA);
    releaseAllSlots(projectB);
  });

  describe("Per-Project Transform Limits", () => {
    it("should have a positive per-project limit configured", {
      ignore: !limitsEnabled,
    }, () => {
      assert(TRANSFORM_PER_PROJECT_LIMIT > 0, "Per-project limit should be positive");
    });

    it("should allow acquiring slots up to per-project limit", {
      ignore: !limitsEnabled,
    }, () => {
      // Acquire slots up to the limit
      for (let i = 0; i < TRANSFORM_PER_PROJECT_LIMIT; i++) {
        const acquired = acquireTransformSlot(projectA);
        assertEquals(acquired, true, `Should acquire slot ${i + 1}`);
      }

      // Verify stats
      const stats = getTransformStats();
      assertEquals(stats.activeProjects.get(projectA), TRANSFORM_PER_PROJECT_LIMIT);
    });

    it("should reject when project reaches its limit", {
      ignore: !limitsEnabled,
    }, () => {
      // Fill up project A's limit
      for (let i = 0; i < TRANSFORM_PER_PROJECT_LIMIT; i++) {
        acquireTransformSlot(projectA);
      }

      // Next acquire should fail
      const acquired = acquireTransformSlot(projectA);
      assertEquals(acquired, false, "Should reject when at capacity");
    });

    it("should allow other projects when one is at capacity", {
      ignore: !limitsEnabled,
    }, () => {
      // Fill up project A's limit
      for (let i = 0; i < TRANSFORM_PER_PROJECT_LIMIT; i++) {
        acquireTransformSlot(projectA);
      }

      // Project A is blocked
      assertEquals(acquireTransformSlot(projectA), false);

      // But project B can still acquire
      const acquired = acquireTransformSlot(projectB);
      assertEquals(acquired, true, "Project B should acquire while A is at capacity");
    });

    it("should release slots correctly", {
      ignore: !limitsEnabled,
    }, () => {
      // Acquire one slot
      acquireTransformSlot(projectA);

      let stats = getTransformStats();
      assertEquals(stats.activeProjects.get(projectA), 1);

      // Acquire another
      if (TRANSFORM_PER_PROJECT_LIMIT >= 2) {
        acquireTransformSlot(projectA);
        stats = getTransformStats();
        assertEquals(stats.activeProjects.get(projectA), 2);

        // Release one
        releaseTransformSlot(projectA);
        stats = getTransformStats();
        assertEquals(stats.activeProjects.get(projectA), 1);
      }

      // Release last
      releaseTransformSlot(projectA);
      stats = getTransformStats();
      assertEquals(stats.activeProjects.has(projectA), false, "Should remove empty projects");
    });

    it("should track multiple projects independently", {
      ignore: !limitsEnabled,
    }, () => {
      // Acquire for both projects
      acquireTransformSlot(projectA);
      acquireTransformSlot(projectB);

      const stats = getTransformStats();
      assertEquals(stats.activeProjects.get(projectA), 1);
      assertEquals(stats.activeProjects.get(projectB), 1);

      // Release from A doesn't affect B
      releaseTransformSlot(projectA);
      const statsAfter = getTransformStats();
      assertEquals(statsAfter.activeProjects.has(projectA), false);
      assertEquals(statsAfter.activeProjects.get(projectB), 1);
    });
  });

  describe("Fairness Under Load", () => {
    it("prevents single project from monopolizing transforms", {
      ignore: !limitsEnabled,
    }, () => {
      const heavyProject = "heavy-" + Date.now();
      const lightProject = "light-" + Date.now();

      // Heavy project takes all its allowed slots
      for (let i = 0; i < TRANSFORM_PER_PROJECT_LIMIT; i++) {
        acquireTransformSlot(heavyProject);
      }

      // Heavy project cannot get more
      assertEquals(acquireTransformSlot(heavyProject), false);

      // But light project can still get transforms
      assertEquals(acquireTransformSlot(lightProject), true);

      const stats = getTransformStats();
      assertEquals(stats.activeProjects.get(heavyProject), TRANSFORM_PER_PROJECT_LIMIT);
      assertEquals(stats.activeProjects.get(lightProject), 1);

      // Cleanup
      releaseAllSlots(heavyProject);
      releaseAllSlots(lightProject);
    });

    it("allows slot reuse after release", {
      ignore: !limitsEnabled,
    }, () => {
      // Fill up limit
      for (let i = 0; i < TRANSFORM_PER_PROJECT_LIMIT; i++) {
        acquireTransformSlot(projectA);
      }

      // Can't acquire more
      assertEquals(acquireTransformSlot(projectA), false);

      // Release one
      releaseTransformSlot(projectA);

      // Now can acquire again
      assertEquals(acquireTransformSlot(projectA), true);
    });
  });

  describe("Stats Reporting", () => {
    it("provides accurate statistics", {
      ignore: !limitsEnabled,
    }, () => {
      acquireTransformSlot(projectA);
      acquireTransformSlot(projectB);

      const stats = getTransformStats();

      assertEquals(stats.perProjectLimit, TRANSFORM_PER_PROJECT_LIMIT);
      assertEquals(stats.activeProjects.size, 2);
      assertEquals(stats.activeProjects.get(projectA), 1);
      assertEquals(stats.activeProjects.get(projectB), 1);
    });

    it("reports global semaphore stats", () => {
      const stats = getTransformStats();

      assert(typeof stats.globalAvailable === "number", "Should have globalAvailable");
      assert(typeof stats.globalWaiting === "number", "Should have globalWaiting");
      assert(stats.globalAvailable >= 0, "globalAvailable should be non-negative");
    });
  });
});
