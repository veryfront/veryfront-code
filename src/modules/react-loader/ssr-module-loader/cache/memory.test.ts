import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  acquireTransformSlot,
  clearSSRModuleCache,
  clearSSRModuleCacheForProject,
  failedComponents,
  getTransformStats,
  globalCrossProjectCache,
  globalInProgress,
  globalModuleCache,
  globalTmpDirs,
  releaseTransformSlot,
} from "./memory.ts";
import { TRANSFORM_PER_PROJECT_LIMIT } from "../constants.ts";

describe("modules/react-loader/ssr-module-loader/cache/memory", () => {
  function resetState() {
    clearSSRModuleCache();
    globalCrossProjectCache.clear();
    globalInProgress.clear();
    globalTmpDirs.clear();
  }

  describe("acquireTransformSlot / releaseTransformSlot", () => {
    it("should acquire a slot for a project", () => {
      resetState();
      const acquired = acquireTransformSlot("test-acq-a");
      assertEquals(acquired, true);
      releaseTransformSlot("test-acq-a");
    });

    it("should reject when at per-project limit", () => {
      resetState();
      if (TRANSFORM_PER_PROJECT_LIMIT <= 0) return; // limit disabled

      const projectId = "test-limit-proj";
      // Fill up to the limit
      for (let i = 0; i < TRANSFORM_PER_PROJECT_LIMIT; i++) {
        assertEquals(acquireTransformSlot(projectId), true);
      }
      // Next acquire should fail
      assertEquals(acquireTransformSlot(projectId), false);

      // Cleanup
      for (let i = 0; i < TRANSFORM_PER_PROJECT_LIMIT; i++) {
        releaseTransformSlot(projectId);
      }
    });

    it("should release slots and allow re-acquisition", () => {
      resetState();
      if (TRANSFORM_PER_PROJECT_LIMIT <= 0) return;

      const projectId = "test-release-proj";
      // Fill to limit
      for (let i = 0; i < TRANSFORM_PER_PROJECT_LIMIT; i++) {
        acquireTransformSlot(projectId);
      }
      assertEquals(acquireTransformSlot(projectId), false);

      // Release one
      releaseTransformSlot(projectId);

      // Should be able to acquire again
      assertEquals(acquireTransformSlot(projectId), true);

      // Cleanup
      for (let i = 0; i < TRANSFORM_PER_PROJECT_LIMIT; i++) {
        releaseTransformSlot(projectId);
      }
    });

    it("should handle release when count is zero", () => {
      resetState();
      // Should not throw
      releaseTransformSlot("test-no-exist");
      const stats = getTransformStats();
      assertEquals(stats.activeProjects.has("test-no-exist"), false);
    });

    it("should track different projects independently", () => {
      resetState();
      acquireTransformSlot("test-ind-x");
      acquireTransformSlot("test-ind-y");

      const stats = getTransformStats();
      // When per-project limit is 0 (disabled), activeProjects may not track counts
      if (TRANSFORM_PER_PROJECT_LIMIT > 0) {
        assertEquals(stats.activeProjects.get("test-ind-x"), 1);
        assertEquals(stats.activeProjects.get("test-ind-y"), 1);
      }

      releaseTransformSlot("test-ind-x");
      releaseTransformSlot("test-ind-y");
    });

    it("should remove project entry when count drops to zero", () => {
      resetState();
      acquireTransformSlot("test-drop-zero");
      releaseTransformSlot("test-drop-zero");

      const stats = getTransformStats();
      assertEquals(stats.activeProjects.has("test-drop-zero"), false);
    });
  });

  describe("getTransformStats", () => {
    it("should return stats with global semaphore info", () => {
      resetState();
      const stats = getTransformStats();
      assertEquals(typeof stats.globalAvailable, "number");
      assertEquals(typeof stats.globalWaiting, "number");
      assertEquals(typeof stats.perProjectLimit, "number");
      assertEquals(stats.activeProjects instanceof Map, true);
    });

    it("should report correct per-project limit", () => {
      resetState();
      const stats = getTransformStats();
      assertEquals(stats.perProjectLimit, TRANSFORM_PER_PROJECT_LIMIT);
    });
  });

  describe("clearSSRModuleCache", () => {
    it("should clear global module cache", () => {
      resetState();
      globalModuleCache.set("key1", { tempPath: "/tmp/a", contentHash: "abc" });
      globalModuleCache.set("key2", { tempPath: "/tmp/b", contentHash: "def" });

      assertEquals(globalModuleCache.size, 2);
      clearSSRModuleCache();
      assertEquals(globalModuleCache.size, 0);
    });

    it("should clear failed components", () => {
      resetState();
      failedComponents.set("comp-a", { count: 3, lastFailure: Date.now() });

      assertEquals(failedComponents.size, 1);
      clearSSRModuleCache();
      assertEquals(failedComponents.size, 0);
    });

    it("should clear project transform counts", () => {
      resetState();
      acquireTransformSlot("test-clear-proj");

      clearSSRModuleCache();
      const stats = getTransformStats();
      assertEquals(stats.activeProjects.size, 0);
    });
  });

  describe("clearSSRModuleCacheForProject", () => {
    it("should clear module cache entries for a specific project", () => {
      resetState();
      globalModuleCache.set("prefix:project-1:module-a", { tempPath: "/tmp/a", contentHash: "a" });
      globalModuleCache.set("prefix:project-2:module-b", { tempPath: "/tmp/b", contentHash: "b" });

      clearSSRModuleCacheForProject("project-1");

      assertEquals(globalModuleCache.has("prefix:project-1:module-a"), false);
      assertEquals(globalModuleCache.has("prefix:project-2:module-b"), true);

      globalModuleCache.clear();
    });

    it("should clear in-progress entries for a specific project", () => {
      resetState();
      globalInProgress.set("prefix:project-1:mod", Promise.resolve());
      globalInProgress.set("prefix:project-2:mod", Promise.resolve());

      clearSSRModuleCacheForProject("project-1");

      assertEquals(globalInProgress.has("prefix:project-1:mod"), false);
      assertEquals(globalInProgress.has("prefix:project-2:mod"), true);

      globalInProgress.clear();
    });

    it("should clear failed components for a specific project", () => {
      resetState();
      failedComponents.set("prefix:project-1:comp", { count: 1, lastFailure: Date.now() });
      failedComponents.set("prefix:project-2:comp", { count: 1, lastFailure: Date.now() });

      clearSSRModuleCacheForProject("project-1");

      assertEquals(failedComponents.has("prefix:project-1:comp"), false);
      assertEquals(failedComponents.has("prefix:project-2:comp"), true);

      failedComponents.clear();
    });

    it("should clear tmp dirs for a specific project", () => {
      resetState();
      globalTmpDirs.set("base:project-1", "/tmp/proj1");
      globalTmpDirs.set("base:project-2", "/tmp/proj2");

      clearSSRModuleCacheForProject("project-1");

      assertEquals(globalTmpDirs.has("base:project-1"), false);
      assertEquals(globalTmpDirs.has("base:project-2"), true);

      globalTmpDirs.clear();
    });

    it("should clear project transform slot count", () => {
      resetState();
      acquireTransformSlot("proj-target");
      acquireTransformSlot("proj-other");

      clearSSRModuleCacheForProject("proj-target");

      const stats = getTransformStats();
      // When per-project limit is 0 (disabled), slot tracking may be skipped
      if (TRANSFORM_PER_PROJECT_LIMIT > 0) {
        assertEquals(stats.activeProjects.has("proj-target"), false);
        assertEquals(stats.activeProjects.has("proj-other"), true);
      }

      releaseTransformSlot("proj-other");
    });
  });
});
