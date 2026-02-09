/**
 * Test: 002.5 Transform Concurrency Under Load
 *
 * Validates that the transform semaphore and per-project limits
 * handle realistic concurrent workloads without false capacity errors.
 *
 * These tests ensure:
 * 1. Recursive transforms don't deadlock (slots held only during transform, not recursion)
 * 2. Multiple projects can render concurrently without starving each other
 * 3. The global semaphore handles burst traffic gracefully
 * 4. clearSSRModuleCache properly resets semaphore state
 */

import { assert, assertEquals } from "#veryfront/testing/assert";
import { afterEach, describe, it } from "#veryfront/testing/bdd";
import {
  acquireTransformSlot,
  clearSSRModuleCache,
  getTransformSemaphore,
  getTransformStats,
  releaseTransformSlot,
  tryAcquireTransformSlot,
} from "../../../src/modules/react-loader/ssr-module-loader/cache/memory.ts";
import {
  getMaxConcurrentTransforms,
  getTransformPerProjectLimit,
  TRANSFORM_ACQUIRE_TIMEOUT_MS,
} from "../../../src/modules/react-loader/ssr-module-loader/constants.ts";
import { Semaphore } from "../../../src/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";

function releaseAllSlots(projectId: string): void {
  const count = getTransformStats().activeProjects.get(projectId) ?? 0;
  for (let i = 0; i < count; i++) {
    releaseTransformSlot(projectId);
  }
}

describe("002.5 Transform Concurrency Under Load", () => {
  afterEach(() => {
    clearSSRModuleCache();
  });

  describe("Recursive Transform Simulation", () => {
    it("recursive child transforms don't exhaust parent's project slots", async () => {
      // Simulates the real rendering flow:
      // 1. Parent starts transform for page.tsx
      // 2. processLocalImports triggers child transforms for each import
      // 3. Each child acquires its own slot for its own transform only
      // 4. Parent then acquires slot for its own transform

      const projectId = `recursive-test-${Date.now()}`;
      const limit = getTransformPerProjectLimit();
      if (limit <= 0) return; // limits disabled

      // Simulate child transforms in batches (like TRANSFORM_BATCH_SIZE=10).
      // Each batch completes before the next starts, matching real recursion.
      const totalChildren = 30; // More than per-project limit
      const batchSize = 10;

      for (let batch = 0; batch < totalChildren; batch += batchSize) {
        const batchTasks = Array.from(
          { length: Math.min(batchSize, totalChildren - batch) },
          async (_, i) => {
            const acquired = await tryAcquireTransformSlot(projectId, 2000);
            assert(acquired, `Child transform ${batch + i} should acquire slot`);
            await new Promise((r) => setTimeout(r, 5));
            releaseTransformSlot(projectId);
          },
        );
        await Promise.all(batchTasks);
      }

      // After all children complete, parent should be able to acquire
      const parentAcquired = acquireTransformSlot(projectId);
      assert(parentAcquired, "Parent should acquire slot after children complete");
      releaseTransformSlot(projectId);

      // Verify clean state
      assertEquals(
        getTransformStats().activeProjects.has(projectId),
        false,
        "No slots should be held after cleanup",
      );
    });

    it("deep recursion (15 levels) completes without deadlock", async () => {
      // Simulates MAX_TRANSFORM_DEPTH=15 levels of recursive transforms
      // Each level acquires a slot, does work, releases, then the parent acquires

      const projectId = `deep-recursion-${Date.now()}`;
      const limit = getTransformPerProjectLimit();
      if (limit <= 0) return;

      async function simulateRecursiveTransform(depth: number): Promise<void> {
        if (depth <= 0) return;

        // Recurse first (like processLocalImports before slot acquisition)
        await simulateRecursiveTransform(depth - 1);

        // Then acquire slot for our own transform
        const acquired = await tryAcquireTransformSlot(projectId, TRANSFORM_ACQUIRE_TIMEOUT_MS);
        assert(acquired, `Transform at depth ${depth} should acquire slot`);
        // Brief transform
        await new Promise((r) => setTimeout(r, 1));
        releaseTransformSlot(projectId);
      }

      await simulateRecursiveTransform(15);

      assertEquals(
        getTransformStats().activeProjects.has(projectId),
        false,
        "All slots released after deep recursion",
      );
    });
  });

  describe("Multi-Project Concurrent Load", () => {
    it("10 projects rendering concurrently don't starve each other", async () => {
      const projectCount = 10;
      const transformsPerProject = 5;
      const limit = getTransformPerProjectLimit();
      if (limit <= 0) return;

      const completedTransforms = new Map<string, number>();

      const projectTasks = Array.from({ length: projectCount }, async (_, projectIndex) => {
        const projectId = `concurrent-proj-${projectIndex}-${Date.now()}`;
        let completed = 0;

        for (let i = 0; i < transformsPerProject; i++) {
          const acquired = await tryAcquireTransformSlot(projectId, TRANSFORM_ACQUIRE_TIMEOUT_MS);
          assert(acquired, `Project ${projectIndex} transform ${i} should acquire slot`);
          await new Promise((r) => setTimeout(r, 2)); // Brief transform
          releaseTransformSlot(projectId);
          completed++;
        }

        completedTransforms.set(projectId, completed);
        return projectId;
      });

      const projectIds = await Promise.all(projectTasks);

      // All projects should complete all transforms
      for (const projectId of projectIds) {
        assertEquals(
          completedTransforms.get(projectId),
          transformsPerProject,
          `${projectId} should complete all ${transformsPerProject} transforms`,
        );
      }
    });

    it("one heavy project doesn't block others", async () => {
      const heavyProject = `heavy-${Date.now()}`;
      const lightProject = `light-${Date.now()}`;
      const limit = getTransformPerProjectLimit();
      if (limit <= 0) return;

      // Heavy project holds slots for a while
      const heavySlots: boolean[] = [];
      for (let i = 0; i < Math.min(limit, 10); i++) {
        heavySlots.push(acquireTransformSlot(heavyProject));
      }

      // Light project should still be able to get slots
      const lightAcquired = acquireTransformSlot(lightProject);
      assert(lightAcquired, "Light project should acquire slot while heavy is loaded");

      // Light project can complete transforms
      releaseTransformSlot(lightProject);
      const lightAcquired2 = acquireTransformSlot(lightProject);
      assert(lightAcquired2, "Light project should acquire second slot");
      releaseTransformSlot(lightProject);

      // Cleanup heavy
      for (const acquired of heavySlots) {
        if (acquired) releaseTransformSlot(heavyProject);
      }
    });
  });

  describe("Global Semaphore Under Burst Traffic", () => {
    it("handles burst of 100 transforms with 50-permit semaphore", async () => {
      const semaphore = getTransformSemaphore();
      const maxConcurrent = getMaxConcurrentTransforms();
      if (maxConcurrent <= 0) return;

      let peakConcurrent = 0;
      let currentConcurrent = 0;
      let completedCount = 0;

      const transforms = Array.from({ length: 100 }, async () => {
        const acquired = await semaphore.tryAcquire(5000); // 5s timeout for test
        assert(acquired, "All 100 transforms should eventually acquire a permit");

        currentConcurrent++;
        peakConcurrent = Math.max(peakConcurrent, currentConcurrent);

        // Simulate ~10ms transform work
        await new Promise((r) => setTimeout(r, Math.random() * 20));

        currentConcurrent--;
        completedCount++;
        semaphore.release();
      });

      await Promise.all(transforms);

      assertEquals(completedCount, 100, "All 100 transforms should complete");
      assert(
        peakConcurrent <= maxConcurrent,
        `Peak concurrency (${peakConcurrent}) should not exceed limit (${maxConcurrent})`,
      );
      assert(
        peakConcurrent > 1,
        `Peak concurrency (${peakConcurrent}) should demonstrate parallelism`,
      );
    });

    it("semaphore recovers after burst - no permit leaks", async () => {
      const semaphore = getTransformSemaphore();
      const maxConcurrent = getMaxConcurrentTransforms();
      if (maxConcurrent <= 0) return;

      const initialAvailable = semaphore.available;

      // Burst of transforms
      const burst = Array.from({ length: 30 }, async () => {
        const acquired = await semaphore.tryAcquire(2000);
        assert(acquired);
        await new Promise((r) => setTimeout(r, 5));
        semaphore.release();
      });

      await Promise.all(burst);

      assertEquals(
        semaphore.available,
        initialAvailable,
        "All permits should be returned after burst (no leaks)",
      );
      assertEquals(semaphore.waiting, 0, "No waiters should remain after burst");
    });

    it("semaphore handles mixed success/failure without leaking", async () => {
      const semaphore = getTransformSemaphore();
      const maxConcurrent = getMaxConcurrentTransforms();
      if (maxConcurrent <= 0) return;

      const initialAvailable = semaphore.available;
      let errorCount = 0;

      const transforms = Array.from({ length: 40 }, async (_, i) => {
        const acquired = await semaphore.tryAcquire(2000);
        assert(acquired);
        try {
          await new Promise((r) => setTimeout(r, 2));
          // Every 5th transform "fails"
          if (i % 5 === 0) {
            errorCount++;
            throw new Error(`Simulated transform failure ${i}`);
          }
        } finally {
          semaphore.release();
        }
      });

      const results = await Promise.allSettled(transforms);
      const failures = results.filter((r) => r.status === "rejected");
      assertEquals(failures.length, errorCount, "Expected number of failures");

      assertEquals(
        semaphore.available,
        initialAvailable,
        "All permits returned even after failures (no leaks)",
      );
    });
  });

  describe("clearSSRModuleCache Resets Semaphore", () => {
    it("resets semaphore permits after cache clear", () => {
      const maxConcurrent = getMaxConcurrentTransforms();
      if (maxConcurrent <= 0) return;

      // Acquire some permits
      const semaphore = getTransformSemaphore();
      const acquired1 = semaphore.tryAcquire(0);
      const acquired2 = semaphore.tryAcquire(0);

      // Verify permits consumed
      assert(acquired1);
      assert(acquired2);
      const beforeClear = getTransformSemaphore().available;
      assert(beforeClear < maxConcurrent, "Some permits should be consumed");

      // Clear should reset
      clearSSRModuleCache();

      // New semaphore should have full permits
      const afterClear = getTransformSemaphore().available;
      assertEquals(afterClear, maxConcurrent, "Semaphore should have full permits after clear");
    });

    it("env var changes take effect after cache clear", () => {
      const originalMax = getMaxConcurrentTransforms();

      // Set higher limit
      Deno.env.set("SSR_MAX_CONCURRENT_TRANSFORMS", "200");
      clearSSRModuleCache();

      const newMax = getMaxConcurrentTransforms();
      assertEquals(newMax, 200, "New limit should be 200 after cache clear");

      // Restore
      if (originalMax === 50) {
        Deno.env.delete("SSR_MAX_CONCURRENT_TRANSFORMS");
      } else {
        Deno.env.set("SSR_MAX_CONCURRENT_TRANSFORMS", String(originalMax));
      }
      clearSSRModuleCache();
    });
  });

  describe("Timeout Adequacy", () => {
    it("500ms timeout is sufficient for typical transform queue depth", async () => {
      // With 50 permits and ~10ms per transform, queue depth of 50 takes ~10ms
      // 500ms timeout is 50x the expected wait time
      const semaphore = new Semaphore(50);

      // Fill the semaphore
      for (let i = 0; i < 50; i++) {
        await semaphore.tryAcquire(0);
      }

      // Start releasing with realistic transform times
      const releaseTask = (async () => {
        for (let i = 0; i < 50; i++) {
          await new Promise((r) => setTimeout(r, 5)); // ~5ms per transform
          semaphore.release();
        }
      })();

      // Try to acquire with 500ms timeout — should succeed
      const start = Date.now();
      const acquired = await semaphore.tryAcquire(500);
      const elapsed = Date.now() - start;

      assert(acquired, "Should acquire within 500ms timeout");
      assert(elapsed < 500, `Should acquire well within timeout (took ${elapsed}ms)`);

      semaphore.release();
      await releaseTask;
    });
  });
});
