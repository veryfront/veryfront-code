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

import { assert, assertEquals } from "@veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "@veryfront/testing/bdd";
import {
  acquireTransformSlot,
  getTransformStats,
  releaseTransformSlot,
} from "../../../src/modules/react-loader/ssr-module-loader/cache/memory.ts";
import { getTransformPerProjectLimit } from "../../../src/modules/react-loader/ssr-module-loader/constants.ts";

function releaseAllSlots(projectId: string): void {
  const count = getTransformStats().activeProjects.get(projectId) ?? 0;

  for (let i = 0; i < count; i++) {
    releaseTransformSlot(projectId);
  }
}

const limitsEnabled = getTransformPerProjectLimit() > 0;

describe("002.4 Semaphore Fairness", () => {
  const projectA = `test-project-a-${Date.now()}`;
  const projectB = `test-project-b-${Date.now()}`;

  beforeEach((): void => {
    releaseAllSlots(projectA);
    releaseAllSlots(projectB);
  });

  afterEach((): void => {
    releaseAllSlots(projectA);
    releaseAllSlots(projectB);
  });

  describe("Per-Project Transform Limits", () => {
    it(
      "should have a positive per-project limit configured",
      { ignore: !limitsEnabled },
      (): void => {
        assert(
          getTransformPerProjectLimit() > 0,
          "Per-project limit should be positive",
        );
      },
    );

    it(
      "should allow acquiring slots up to per-project limit",
      { ignore: !limitsEnabled },
      (): void => {
        for (let i = 0; i < getTransformPerProjectLimit(); i++) {
          assertEquals(
            acquireTransformSlot(projectA),
            true,
            `Should acquire slot ${i + 1}`,
          );
        }

        assertEquals(
          getTransformStats().activeProjects.get(projectA),
          getTransformPerProjectLimit(),
        );
      },
    );

    it(
      "should reject when project reaches its limit",
      { ignore: !limitsEnabled },
      (): void => {
        for (let i = 0; i < getTransformPerProjectLimit(); i++) {
          acquireTransformSlot(projectA);
        }

        assertEquals(
          acquireTransformSlot(projectA),
          false,
          "Should reject when at capacity",
        );
      },
    );

    it(
      "should allow other projects when one is at capacity",
      { ignore: !limitsEnabled },
      (): void => {
        for (let i = 0; i < getTransformPerProjectLimit(); i++) {
          acquireTransformSlot(projectA);
        }

        assertEquals(acquireTransformSlot(projectA), false);

        assertEquals(
          acquireTransformSlot(projectB),
          true,
          "Project B should acquire while A is at capacity",
        );
      },
    );

    it(
      "should release slots correctly",
      { ignore: !limitsEnabled },
      (): void => {
        acquireTransformSlot(projectA);
        assertEquals(getTransformStats().activeProjects.get(projectA), 1);

        if (getTransformPerProjectLimit() >= 2) {
          acquireTransformSlot(projectA);
          assertEquals(getTransformStats().activeProjects.get(projectA), 2);

          releaseTransformSlot(projectA);
          assertEquals(getTransformStats().activeProjects.get(projectA), 1);
        }

        releaseTransformSlot(projectA);
        assertEquals(
          getTransformStats().activeProjects.has(projectA),
          false,
          "Should remove empty projects",
        );
      },
    );

    it(
      "should track multiple projects independently",
      { ignore: !limitsEnabled },
      (): void => {
        acquireTransformSlot(projectA);
        acquireTransformSlot(projectB);

        const stats = getTransformStats();
        assertEquals(stats.activeProjects.get(projectA), 1);
        assertEquals(stats.activeProjects.get(projectB), 1);

        releaseTransformSlot(projectA);

        const statsAfter = getTransformStats();
        assertEquals(statsAfter.activeProjects.has(projectA), false);
        assertEquals(statsAfter.activeProjects.get(projectB), 1);
      },
    );
  });

  describe("Fairness Under Load", () => {
    it(
      "prevents single project from monopolizing transforms",
      { ignore: !limitsEnabled },
      (): void => {
        const heavyProject = `heavy-${Date.now()}`;
        const lightProject = `light-${Date.now()}`;

        for (let i = 0; i < getTransformPerProjectLimit(); i++) {
          acquireTransformSlot(heavyProject);
        }

        assertEquals(acquireTransformSlot(heavyProject), false);
        assertEquals(acquireTransformSlot(lightProject), true);

        const stats = getTransformStats();
        assertEquals(
          stats.activeProjects.get(heavyProject),
          getTransformPerProjectLimit(),
        );
        assertEquals(stats.activeProjects.get(lightProject), 1);

        releaseAllSlots(heavyProject);
        releaseAllSlots(lightProject);
      },
    );

    it(
      "allows slot reuse after release",
      { ignore: !limitsEnabled },
      (): void => {
        for (let i = 0; i < getTransformPerProjectLimit(); i++) {
          acquireTransformSlot(projectA);
        }

        assertEquals(acquireTransformSlot(projectA), false);

        releaseTransformSlot(projectA);

        assertEquals(acquireTransformSlot(projectA), true);
      },
    );
  });

  describe("Stats Reporting", () => {
    it(
      "provides accurate statistics",
      { ignore: !limitsEnabled },
      (): void => {
        acquireTransformSlot(projectA);
        acquireTransformSlot(projectB);

        const stats = getTransformStats();
        assertEquals(stats.perProjectLimit, getTransformPerProjectLimit());
        assertEquals(stats.activeProjects.size, 2);
        assertEquals(stats.activeProjects.get(projectA), 1);
        assertEquals(stats.activeProjects.get(projectB), 1);
      },
    );

    it("reports global semaphore stats", (): void => {
      const stats = getTransformStats();

      assert(typeof stats.globalAvailable === "number", "Should have globalAvailable");
      assert(typeof stats.globalWaiting === "number", "Should have globalWaiting");
      assert(stats.globalAvailable >= 0, "globalAvailable should be non-negative");
    });
  });
});
