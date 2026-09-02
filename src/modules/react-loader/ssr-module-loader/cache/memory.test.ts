import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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
  tryAcquireTransformSlot,
} from "./memory.ts";
import { buildCrossProjectImportCacheKey } from "../cross-project-import-loader.ts";
import { verifiedHttpBundlePaths } from "../http-bundle-helpers.ts";
import { getTransformPerProjectLimit } from "../constants.ts";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { getTmpDirCacheKey } from "../tmp-paths.ts";
import { cacheRegistry } from "#veryfront/cache/registry.ts";

describe("modules/react-loader/ssr-module-loader/cache/memory", () => {
  function resetState(): void {
    clearSSRModuleCache();
    globalCrossProjectCache.clear();
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

    it("should reject and remove a queued acquisition when its signal aborts", async () => {
      const previousLimit = Deno.env.get("SSR_TRANSFORM_PER_PROJECT_LIMIT");
      Deno.env.set("SSR_TRANSFORM_PER_PROJECT_LIMIT", "1");
      resetState();

      try {
        const projectId = "test-abort-queued-acquire";
        const controller = new AbortController();
        assertEquals(acquireTransformSlot(projectId), true);

        const waiter = tryAcquireTransformSlot(projectId, 10_000, false, controller.signal);
        controller.abort(new DOMException("render cancelled", "AbortError"));
        releaseTransformSlot(projectId);

        await assertRejects(() => waiter, DOMException, "render cancelled");
        assertEquals(await tryAcquireTransformSlot(projectId, 0), true);
        releaseTransformSlot(projectId);
      } finally {
        if (previousLimit === undefined) {
          Deno.env.delete("SSR_TRANSFORM_PER_PROJECT_LIMIT");
        } else {
          Deno.env.set("SSR_TRANSFORM_PER_PROJECT_LIMIT", previousLimit);
        }
        resetState();
      }
    });

    it("should bound queued acquisitions for one project", async () => {
      const previousLimit = Deno.env.get("SSR_TRANSFORM_PER_PROJECT_LIMIT");
      Deno.env.set("SSR_TRANSFORM_PER_PROJECT_LIMIT", "1");
      resetState();

      const projectId = "bounded-waiter-project";
      try {
        assertEquals(acquireTransformSlot(projectId), true);

        const waiters = Array.from(
          { length: 1_024 },
          () => tryAcquireTransformSlot(projectId, 10_000),
        );
        assertEquals(await tryAcquireTransformSlot(projectId, 10_000), false);

        clearSSRModuleCacheForProject(projectId);
        assertEquals(await Promise.all(waiters), Array(1_024).fill(false));
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
  });

  describe("clearSSRModuleCacheForProject", () => {
    it("should expose and delete framed cross-project entries through generic registry APIs", async () => {
      resetState();

      const projectId = "project:01J2XYZ";
      const ownedKey = buildCrossProjectImportCacheKey({
        projectId,
        specifier: "@acme/component:variant",
        reactVersion: "1.0.0",
        registryBaseUrl: "https://registry.example.com",
      });
      const foreignKey = buildCrossProjectImportCacheKey({
        projectId: `tenant:${projectId}`,
        specifier: `prefix:${projectId}:component`,
        reactVersion: "1.0.0",
        registryBaseUrl: "https://registry.example.com",
      });
      const entry = { tempPath: "cross-project.mjs", contentHash: "hash" };
      globalCrossProjectCache.set(ownedKey, entry);
      globalCrossProjectCache.set(foreignKey, entry);

      assertEquals(
        cacheRegistry.getKeysForProject(projectId).get("ssr-cross-project-cache"),
        [ownedKey],
      );
      assertEquals(cacheRegistry.deleteKeysForProject(projectId), 1);
      assertEquals(globalCrossProjectCache.has(ownedKey), false);
      assertEquals(globalCrossProjectCache.has(foreignKey), true);

      globalCrossProjectCache.set(ownedKey, entry);
      assertEquals(
        await cacheRegistry.deleteAllKeysForProjectAsync(projectId),
        { memoryDeleted: 1, redisDeleted: 0 },
      );
      assertEquals(globalCrossProjectCache.has(ownedKey), false);
      assertEquals(globalCrossProjectCache.has(foreignKey), true);
    });

    it("should clear module cache entries for a specific project", () => {
      resetState();

      globalModuleCache.set("prefix:project-1:module-a", { tempPath: "/tmp/a", contentHash: "a" });
      globalModuleCache.set("prefix:project-2:module-b", { tempPath: "/tmp/b", contentHash: "b" });
      globalCrossProjectCache.set("prefix:project-1:mod", {
        tempPath: "/tmp/x1.mjs",
        contentHash: "x1",
      });
      const prefixSharingProjectKey = buildCrossProjectImportCacheKey({
        projectId: "project-1-extra",
        specifier: "@acme/component",
        reactVersion: "1.0.0",
        registryBaseUrl: "https://registry.example.com",
      });
      globalCrossProjectCache.set(prefixSharingProjectKey, {
        tempPath: "/tmp/x2.mjs",
        contentHash: "x2",
      });
      const colonSpecifierKey = buildCrossProjectImportCacheKey({
        projectId: "project-1",
        specifier: "@acme/component:variant:deep",
        reactVersion: "1.0.0",
        registryBaseUrl: "https://registry.example.com",
      });
      globalCrossProjectCache.set(colonSpecifierKey, {
        tempPath: "/tmp/colon-specifier.mjs",
        contentHash: "colon-specifier",
      });
      const foreignSpecifierContainingProjectIdKey = buildCrossProjectImportCacheKey({
        projectId: "project-2",
        specifier: "prefix:project-1:component",
        reactVersion: "1.0.0",
        registryBaseUrl: "https://registry.example.com",
      });
      globalCrossProjectCache.set(foreignSpecifierContainingProjectIdKey, {
        tempPath: "/tmp/foreign-specifier.mjs",
        contentHash: "foreign-specifier",
      });
      const opaqueProjectIdKey = buildCrossProjectImportCacheKey({
        projectId: "project:01J2XYZ",
        specifier: "@acme/component",
        reactVersion: "1.0.0",
        registryBaseUrl: "https://registry.example.com",
      });
      globalCrossProjectCache.set(opaqueProjectIdKey, {
        tempPath: "/tmp/opaque-project-id.mjs",
        contentHash: "opaque-project-id",
      });
      const opaqueSuffixSharingProjectKey = buildCrossProjectImportCacheKey({
        projectId: "tenant:project:01J2XYZ",
        specifier: "@acme/component",
        reactVersion: "1.0.0",
        registryBaseUrl: "https://registry.example.com",
      });
      globalCrossProjectCache.set(opaqueSuffixSharingProjectKey, {
        tempPath: "/tmp/opaque-suffix-sharing-project.mjs",
        contentHash: "opaque-suffix-sharing-project",
      });
      globalCrossProjectCache.set("prefix:project-2:mod", {
        tempPath: "/tmp/y.mjs",
        contentHash: "y",
      });
      const collidingPathKey =
        "path:project-1:file.ts:project-2:1.0.0:registry:https://registry.example.com";
      globalCrossProjectCache.set(collidingPathKey, {
        tempPath: "other-project-temp.mjs",
        contentHash: "other-project",
      });

      clearSSRModuleCacheForProject("project-1");

      assertEquals(globalModuleCache.has("prefix:project-1:module-a"), false);
      assertEquals(globalModuleCache.has("prefix:project-2:module-b"), true);
      assertEquals(
        globalCrossProjectCache.has("prefix:project-1:mod"),
        false,
        "project invalidation must evict its cross-project entries",
      );
      assertEquals(
        globalCrossProjectCache.has(prefixSharingProjectKey),
        true,
        "a prefix-sharing project's cross-project entry must survive exact project invalidation",
      );
      assertEquals(
        globalCrossProjectCache.has(colonSpecifierKey),
        false,
        "cross-project entries with colon-containing specifiers must be evicted for their owner",
      );
      assertEquals(
        globalCrossProjectCache.has(foreignSpecifierContainingProjectIdKey),
        true,
        "a foreign entry must survive when only its specifier contains the cleared project id",
      );
      assertEquals(
        globalCrossProjectCache.has("prefix:project-2:mod"),
        true,
        "another project's cross-project entries must survive",
      );
      assertEquals(
        globalCrossProjectCache.has(collidingPathKey),
        true,
        "a project ID in the source path must not claim another project's cache entry",
      );

      clearSSRModuleCacheForProject("project:01J2XYZ");

      assertEquals(
        globalCrossProjectCache.has(opaqueProjectIdKey),
        false,
        "opaque project ids containing colons must still own their cache entries",
      );
      assertEquals(
        globalCrossProjectCache.has(opaqueSuffixSharingProjectKey),
        true,
        "a foreign opaque project id sharing the cleared suffix must survive",
      );

      globalModuleCache.clear();
      globalCrossProjectCache.clear();
    });

    it("should clear in-progress entries for a specific project", () => {
      resetState();
      const transformEntry = { tempPath: "/tmp/in-progress.mjs", contentHash: "test" };

      globalInProgress.set("prefix:project-1:mod", Promise.resolve(transformEntry));
      globalInProgress.set("prefix:project-2:mod", Promise.resolve(transformEntry));

      clearSSRModuleCacheForProject("project-1");

      assertEquals(globalInProgress.has("prefix:project-1:mod"), false);
      assertEquals(globalInProgress.has("prefix:project-2:mod"), true);

      globalInProgress.clear();
    });

    it("should preserve in-progress entries for a specific project when requested", () => {
      resetState();
      const transformEntry = { tempPath: "/tmp/in-progress.mjs", contentHash: "test" };

      const projectTransform = Promise.resolve(transformEntry);
      globalInProgress.set("prefix:project-1:mod", projectTransform);
      globalInProgress.set("prefix:project-2:mod", Promise.resolve(transformEntry));

      clearSSRModuleCacheForProject("project-1", { preserveActiveTransforms: true });

      assertEquals(globalInProgress.get("prefix:project-1:mod"), projectTransform);
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
      const legacyKey = `${baseCacheDir}|${hashCodeHex("project-1")}|${
        hashCodeHex("preview-main")
      }`;
      // Keys written before the namespace segments became collision-free still
      // carry the weak 32-bit project hash and must still be cleared.
      const legacyWeakHashKey = `${baseCacheDir}|v0-1-7|${hashCodeHex("project-1")}|${
        hashCodeHex("preview-main")
      }`;

      globalTmpDirs.set(key1, "/tmp/proj1");
      globalTmpDirs.set(key2, "/tmp/proj2");
      globalTmpDirs.set(legacyKey, "/tmp/proj1-legacy");
      globalTmpDirs.set(legacyWeakHashKey, "/tmp/proj1-legacy-weak-hash");

      clearSSRModuleCacheForProject("project-1");

      assertEquals(globalTmpDirs.has(key1), false);
      assertEquals(globalTmpDirs.has(key2), true);
      assertEquals(globalTmpDirs.has(legacyKey), false);
      assertEquals(globalTmpDirs.has(legacyWeakHashKey), false);

      globalTmpDirs.clear();
    });

    it("should clear project tmp dirs even when active transforms are preserved", () => {
      resetState();

      const baseCacheDir = getMdxEsmCacheDir();
      const key1 = getTmpDirCacheKey(baseCacheDir, "project-1", "preview-main");
      const key2 = getTmpDirCacheKey(baseCacheDir, "project-2", "preview-main");

      globalTmpDirs.set(key1, "/tmp/proj1");
      globalTmpDirs.set(key2, "/tmp/proj2");

      clearSSRModuleCacheForProject("project-1", { preserveActiveTransforms: true });

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

    it("should reject project transform waiters by default", async () => {
      resetState();
      if (getTransformPerProjectLimit() <= 0) return;

      const projectId = "proj-waiter-default-clear";
      for (let i = 0; i < getTransformPerProjectLimit(); i++) {
        assertEquals(acquireTransformSlot(projectId), true);
      }

      const waiter = tryAcquireTransformSlot(projectId, 10_000);
      clearSSRModuleCacheForProject(projectId);

      assertEquals(await waiter, false);
      assertEquals(getTransformStats().activeProjects.has(projectId), false);
    });

    it("should preserve project transform slots and waiters when requested", async () => {
      resetState();
      if (getTransformPerProjectLimit() <= 0) return;

      const projectId = "proj-waiter-preserved-clear";
      for (let i = 0; i < getTransformPerProjectLimit(); i++) {
        assertEquals(acquireTransformSlot(projectId), true);
      }

      const waiter = tryAcquireTransformSlot(projectId, 10_000);
      clearSSRModuleCacheForProject(projectId, { preserveActiveTransforms: true });

      assertEquals(getTransformStats().activeProjects.has(projectId), true);
      releaseTransformSlot(projectId);
      assertEquals(await waiter, true);

      for (let i = 0; i < getTransformPerProjectLimit(); i++) {
        releaseTransformSlot(projectId);
      }
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
