import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  acquireTransformSlot,
  clearSSRModuleCache,
  clearSSRModuleCacheForProject,
  failedComponents,
  getTransformStats,
  globalCrossProjectCache,
  globalCrossProjectInProgress,
  globalInProgress,
  globalModuleCache,
  globalTmpDirs,
  releaseTransformSlot,
  tryAcquireTransformSlot,
} from "./memory.ts";
import { verifiedHttpBundlePaths } from "../http-bundle-helpers.ts";
import {
  FAILED_COMPONENT_CACHE_MAX_ENTRIES,
  getTransformPerProjectLimit,
  MAX_PROJECT_TRANSFORM_WAITERS,
  SSR_MODULE_CACHE_MAX_ENTRIES,
} from "../constants.ts";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { getTmpDirCacheKey } from "../tmp-paths.ts";
import { buildSSRModuleCacheKey } from "#veryfront/cache/keys.ts";

describe("modules/react-loader/ssr-module-loader/cache/memory", () => {
  function resetState(): void {
    clearSSRModuleCache();
    globalCrossProjectCache.clear();
    globalCrossProjectInProgress.clear();
    globalInProgress.clear();
    globalTmpDirs.clear();
    verifiedHttpBundlePaths.clear();
  }

  describe("acquireTransformSlot / releaseTransformSlot", () => {
    it("should acquire a slot for a project", () => {
      resetState();

      assertEquals(acquireTransformSlot("test-acq-a"), true);
      releaseTransformSlot("test-acq-a");
    });

    it("should reject when at per-project limit", () => {
      resetState();
      if (getTransformPerProjectLimit() <= 0) return; // limit disabled

      const projectId = "test-limit-proj";

      for (let i = 0; i < getTransformPerProjectLimit(); i++) {
        assertEquals(acquireTransformSlot(projectId), true);
      }

      assertEquals(acquireTransformSlot(projectId), false);

      for (let i = 0; i < getTransformPerProjectLimit(); i++) {
        releaseTransformSlot(projectId);
      }
    });

    it("should release slots and allow re-acquisition", () => {
      resetState();
      if (getTransformPerProjectLimit() <= 0) return;

      const projectId = "test-release-proj";

      for (let i = 0; i < getTransformPerProjectLimit(); i++) {
        acquireTransformSlot(projectId);
      }
      assertEquals(acquireTransformSlot(projectId), false);

      releaseTransformSlot(projectId);

      assertEquals(acquireTransformSlot(projectId), true);

      for (let i = 0; i < getTransformPerProjectLimit(); i++) {
        releaseTransformSlot(projectId);
      }
    });

    it("should handle release when count is zero", () => {
      resetState();

      releaseTransformSlot("test-no-exist");

      const stats = getTransformStats();
      assertEquals(stats.activeProjects.has("test-no-exist"), false);
    });

    it("should track different projects independently", () => {
      resetState();

      acquireTransformSlot("test-ind-x");
      acquireTransformSlot("test-ind-y");

      const stats = getTransformStats();
      if (getTransformPerProjectLimit() > 0) {
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

    it("bypass=true always acquires, even past the per-project limit", () => {
      resetState();
      if (getTransformPerProjectLimit() <= 0) return; // limit disabled

      const projectId = "test-bypass-proj";

      // Fill the project to its limit with normal acquisitions.
      for (let i = 0; i < getTransformPerProjectLimit(); i++) {
        assertEquals(acquireTransformSlot(projectId), true);
      }
      // Normal acquisition is now refused...
      assertEquals(acquireTransformSlot(projectId), false);
      // ...but a bypassing caller (e.g. single-tenant dev) still gets through.
      assertEquals(acquireTransformSlot(projectId, true), true);

      for (let i = 0; i < getTransformPerProjectLimit(); i++) {
        releaseTransformSlot(projectId);
      }
    });

    it("bypass=true does not change the project's tracked count", () => {
      resetState();
      if (getTransformPerProjectLimit() <= 0) return;

      const projectId = "test-bypass-count";
      assertEquals(acquireTransformSlot(projectId, true), true);
      // A bypassing acquire must not consume a tracked slot.
      assertEquals(getTransformStats().activeProjects.has(projectId), false);
      // A bypassing release must be a no-op (no underflow / phantom entry).
      releaseTransformSlot(projectId, true);
      assertEquals(getTransformStats().activeProjects.has(projectId), false);
    });

    it("should wake queued acquisitions when a slot is released", async () => {
      const previousLimit = Deno.env.get("SSR_TRANSFORM_PER_PROJECT_LIMIT");
      Deno.env.set("SSR_TRANSFORM_PER_PROJECT_LIMIT", "1");
      resetState();

      const originalSetTimeout = globalThis.setTimeout;
      try {
        const projectId = "test-wake-queued-acquire";
        assertEquals(acquireTransformSlot(projectId), true);

        globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
          if (timeout === 50) {
            throw new Error("queued transform slot acquisition should not poll");
          }
          return originalSetTimeout(handler, timeout, ...args);
        }) as typeof globalThis.setTimeout;

        const waiter = tryAcquireTransformSlot(projectId, 1_000);
        releaseTransformSlot(projectId);

        assertEquals(await waiter, true);
        assertEquals(getTransformStats().activeProjects.get(projectId), 1);

        releaseTransformSlot(projectId);
      } finally {
        globalThis.setTimeout = originalSetTimeout;
        if (previousLimit === undefined) {
          Deno.env.delete("SSR_TRANSFORM_PER_PROJECT_LIMIT");
        } else {
          Deno.env.set("SSR_TRANSFORM_PER_PROJECT_LIMIT", previousLimit);
        }
        resetState();
      }
    });

    it("bounds queued acquisitions for one project", async () => {
      const previousLimit = Deno.env.get("SSR_TRANSFORM_PER_PROJECT_LIMIT");
      Deno.env.set("SSR_TRANSFORM_PER_PROJECT_LIMIT", "1");
      resetState();

      try {
        const projectId = "tenant-bounded-waiters";
        assertEquals(acquireTransformSlot(projectId), true);
        const queued = Array.from(
          { length: MAX_PROJECT_TRANSFORM_WAITERS },
          () => tryAcquireTransformSlot(projectId, 10_000),
        );

        assertEquals(await tryAcquireTransformSlot(projectId, 10_000), false);
        clearSSRModuleCache();
        assertEquals((await Promise.all(queued)).every((acquired) => !acquired), true);
      } finally {
        if (previousLimit === undefined) {
          Deno.env.delete("SSR_TRANSFORM_PER_PROJECT_LIMIT");
        } else {
          Deno.env.set("SSR_TRANSFORM_PER_PROJECT_LIMIT", previousLimit);
        }
        resetState();
      }
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

      assertEquals(getTransformStats().perProjectLimit, getTransformPerProjectLimit());
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

    it("bounds failed component records", () => {
      resetState();

      for (let index = 0; index <= FAILED_COMPONENT_CACHE_MAX_ENTRIES; index++) {
        failedComponents.set(`component-${index}`, { count: 1, lastFailure: index });
      }

      assertEquals(failedComponents.size, FAILED_COMPONENT_CACHE_MAX_ENTRIES);
      assertEquals(failedComponents.has("component-0"), false);
    });

    it("uses the advertised SSR module cache capacity", () => {
      resetState();

      for (let index = 0; index <= SSR_MODULE_CACHE_MAX_ENTRIES; index++) {
        globalModuleCache.set(`module-${index}`, {
          tempPath: `/tmp/module-${index}`,
          contentHash: String(index),
        });
      }

      assertEquals(globalModuleCache.size, SSR_MODULE_CACHE_MAX_ENTRIES);
      assertEquals(globalModuleCache.has("module-0"), false);
      assertEquals(globalModuleCache.has("module-1"), true);
      resetState();
    });

    it("should clear project transform counts", () => {
      resetState();

      acquireTransformSlot("test-clear-proj");

      clearSSRModuleCache();
      assertEquals(getTransformStats().activeProjects.size, 0);
    });

    it("should clear verifiedHttpBundlePaths", () => {
      resetState();

      verifiedHttpBundlePaths.set("/tmp/a:hash1", true);
      verifiedHttpBundlePaths.set("/tmp/b:hash2", true);
      assertEquals(verifiedHttpBundlePaths.size, 2);

      clearSSRModuleCache();
      assertEquals(verifiedHttpBundlePaths.size, 0);
    });

    it("clears every global SSR cache family", () => {
      resetState();
      globalCrossProjectCache.set("cross", { tempPath: "/tmp/cross", contentHash: "a" });
      globalCrossProjectInProgress.set("cross-pending", Promise.resolve("/tmp/cross"));
      globalInProgress.set("pending", Promise.resolve());
      globalTmpDirs.set("tmp", "/tmp/project");

      clearSSRModuleCache();

      assertEquals(globalCrossProjectCache.size, 0);
      assertEquals(globalCrossProjectInProgress.size, 0);
      assertEquals(globalInProgress.size, 0);
      assertEquals(globalTmpDirs.size, 0);
    });
  });

  describe("clearSSRModuleCacheForProject", () => {
    it("does not clear a cross-project cache entry for a containing project ID", () => {
      resetState();

      const targetKey = buildSSRModuleCacheKey("cross-project-default", "acme", "button");
      const containingKey = buildSSRModuleCacheKey(
        "cross-project-default",
        "acme-enterprise",
        "button",
      );
      globalCrossProjectCache.set(targetKey, { tempPath: "/tmp/acme", contentHash: "a" });
      globalCrossProjectCache.set(containingKey, {
        tempPath: "/tmp/acme-enterprise",
        contentHash: "b",
      });

      clearSSRModuleCacheForProject("acme");

      assertEquals(globalCrossProjectCache.has(targetKey), false);
      assertEquals(globalCrossProjectCache.has(containingKey), true);
    });

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

      const baseCacheDir = getMdxEsmCacheDir();
      const key1 = getTmpDirCacheKey(baseCacheDir, "project-1", "preview-main");
      const key2 = getTmpDirCacheKey(baseCacheDir, "project-2", "preview-main");

      globalTmpDirs.set(key1, "/tmp/proj1");
      globalTmpDirs.set(key2, "/tmp/proj2");

      clearSSRModuleCacheForProject("project-1");

      assertEquals(globalTmpDirs.has(key1), false);
      assertEquals(globalTmpDirs.has(key2), true);

      globalTmpDirs.clear();
    });

    it("should clear project transform slot count", () => {
      resetState();

      acquireTransformSlot("proj-target");
      acquireTransformSlot("proj-other");

      clearSSRModuleCacheForProject("proj-target");

      const stats = getTransformStats();
      if (getTransformPerProjectLimit() > 0) {
        assertEquals(stats.activeProjects.has("proj-target"), false);
        assertEquals(stats.activeProjects.has("proj-other"), true);
      }

      releaseTransformSlot("proj-other");
    });

    it("should clear verifiedHttpBundlePaths", () => {
      resetState();

      verifiedHttpBundlePaths.set("/tmp/a:hash1", true);
      verifiedHttpBundlePaths.set("/tmp/b:hash2", true);
      assertEquals(verifiedHttpBundlePaths.size, 2);

      clearSSRModuleCacheForProject("project-1");
      assertEquals(verifiedHttpBundlePaths.size, 0);
    });
  });
});
