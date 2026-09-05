import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join, toFileUrl } from "#veryfront/compat/path";
import {
  clearAllLocalCaches,
  clearESMDiskCache,
  clearMdxEsmCacheNamespace,
  clearModulePathCache,
  getLocalFs,
  getMdxEsmSsrCacheDir,
  getMdxEsmSsrCacheDirs,
  getModulePathCache,
  invalidateMdxEsmModule,
  invalidateMdxEsmModuleForCachedPath,
  invalidateModulePaths,
  lookupMdxEsmCache,
  saveModulePathCache,
  verifiedModuleDeps,
  waitForDiskCleanup,
} from "./index.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { exists, readTextFile, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { getMdxEsmCacheDir, runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { getCycleManifestGeneration } from "../cycle-manifest-lifecycle.ts";
import { cacheModule } from "../module-fetcher/module-cache.ts";
import { rendererLogger as log } from "#veryfront/utils/logger/logger.ts";
import {
  buildMdxEsmModuleFileName,
  buildMdxEsmPathCacheKey,
  CYCLE_MANIFEST_SIDECAR_SUFFIX,
  getCycleManifestCacheDir,
  UNRESOLVED_IMPORTS_SIDECAR_SUFFIX,
} from "../cache-format.ts";
import { getCacheStats } from "#veryfront/utils/memory/index.ts";
import { formatCacheVersionSegment } from "#veryfront/utils/cache-version.ts";
import { cacheNamespaceSegment, hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";

describe("MDX module path cache", () => {
  it("partitions SSR cache directories by runtime version", async () => {
    const cacheBase = await makeTempDir({ prefix: "vf-mdx-versioned-cache-dir-" });
    const projectId = "project-versioned-cache";
    const contentSourceId = "preview-main";

    try {
      await runWithCacheDir(cacheBase, () => {
        const projectKey = cacheNamespaceSegment(projectId);
        const sourceKey = cacheNamespaceSegment(contentSourceId);
        const legacyProjectKey = hashCodeHex(projectId);
        const legacySourceKey = hashCodeHex(contentSourceId);
        const versionKey = formatCacheVersionSegment(RUNTIME_VERSION);
        const currentDir = getMdxEsmSsrCacheDir(projectId, contentSourceId);

        assertEquals(
          currentDir,
          join(cacheBase, "veryfront-mdx-esm", versionKey, projectKey, sourceKey),
        );
        assertEquals(
          getMdxEsmSsrCacheDirs(projectId, contentSourceId),
          [
            currentDir,
            join(cacheBase, "veryfront-mdx-esm", versionKey, legacyProjectKey, legacySourceKey),
            join(cacheBase, "veryfront-mdx-esm", legacyProjectKey, legacySourceKey),
            join(cacheBase, "veryfront-mdx-esm", legacyProjectKey, contentSourceId),
          ],
        );
      });
    } finally {
      await remove(cacheBase, { recursive: true });
    }
  });

  it("keeps content source ids with colliding 32-bit hashes in distinct SSR cache dirs", async () => {
    const cacheBase = await makeTempDir({ prefix: "vf-mdx-collision-isolation-" });
    const projectId = "project-collision-isolation";

    try {
      await runWithCacheDir(cacheBase, () => {
        // Regression: hashCodeHex is a 32-bit hash and these two preview
        // source ids collide under it. With hash-keyed namespaces one source
        // served the other's transformed modules for the same file path.
        assertEquals(hashCodeHex("preview-58x4ga9b"), hashCodeHex("preview-5icz6rpk"));
        assertNotEquals(
          getMdxEsmSsrCacheDir(projectId, "preview-58x4ga9b"),
          getMdxEsmSsrCacheDir(projectId, "preview-5icz6rpk"),
        );
      });
    } finally {
      await remove(cacheBase, { recursive: true });
    }
  });

  it("keeps traversal-shaped content source ids inside the cache root", async () => {
    const cacheBase = await makeTempDir({ prefix: "vf-mdx-traversal-guard-" });
    const projectId = "project-traversal-guard";

    try {
      await runWithCacheDir(cacheBase, () => {
        // Content source ids come from the x-content-source-id request header,
        // and every directory returned here is passed to a recursive remove.
        const mdxCacheDir = join(cacheBase, "veryfront-mdx-esm");
        for (
          const contentSourceId of [
            "../../escape",
            "..",
            ".",
            "",
            "/outside",
            "preview/../../escape",
          ]
        ) {
          for (const cacheDir of getMdxEsmSsrCacheDirs(projectId, contentSourceId)) {
            assertEquals(
              cacheDir.startsWith(`${mdxCacheDir}/`),
              true,
              `cache dir must stay under the cache root: ${cacheDir}`,
            );
          }
        }
      });
    } finally {
      await remove(cacheBase, { recursive: true });
    }
  });

  it("clears a project/content-source namespace from disk and memory", async () => {
    clearModulePathCache();

    const cacheBase = await makeTempDir({ prefix: "vf-mdx-namespace-clear-" });
    const projectId = "project/with spaces";
    const contentSourceId = "preview-main";
    const cacheKey = buildMdxEsmPathCacheKey("_vf_modules/pages/index.js", "19.1.1");

    try {
      await runWithCacheDir(cacheBase, async () => {
        const cacheDir = join(
          cacheBase,
          "veryfront-mdx-esm",
          encodeURIComponent(projectId),
          encodeURIComponent(contentSourceId),
        );
        const ssrCacheDir = getMdxEsmSsrCacheDir(projectId, contentSourceId);
        const cachedPath = join(cacheDir, "stale.mjs");
        const ssrCachedPath = join(ssrCacheDir, "stale-ssr.mjs");
        const cycleArtifactPath = join(
          getCycleManifestCacheDir(cacheDir),
          "0-stale/artifacts/0.deadbeef.js",
        );

        await getLocalFs().mkdir(cacheDir, { recursive: true });
        await getLocalFs().mkdir(ssrCacheDir, { recursive: true });
        await writeTextFile(cachedPath, "export default function Stale() {}");
        await writeTextFile(ssrCachedPath, "export default function StaleSSR() {}");
        await getLocalFs().mkdir(join(cycleArtifactPath, ".."), { recursive: true });
        await writeTextFile(cycleArtifactPath, "export default 'cycle';");

        const cache = await getModulePathCache(cacheDir);
        cache.set(cacheKey, cachedPath);
        const ssrCache = await getModulePathCache(ssrCacheDir);
        ssrCache.set(cacheKey, ssrCachedPath);
        verifiedModuleDeps.set(`${cachedPath}:${cacheKey}`, true);
        verifiedModuleDeps.set(`${ssrCachedPath}:${cacheKey}`, true);

        await clearMdxEsmCacheNamespace(projectId, contentSourceId);

        assertEquals(await exists(cachedPath), false);
        assertEquals(await exists(ssrCachedPath), false);
        assertEquals(await exists(cycleArtifactPath), false);
        assertEquals((await getModulePathCache(cacheDir)).get(cacheKey), undefined);
        assertEquals((await getModulePathCache(ssrCacheDir)).get(cacheKey), undefined);
        assertEquals(verifiedModuleDeps.get(`${cachedPath}:${cacheKey}`), undefined);
        assertEquals(verifiedModuleDeps.get(`${ssrCachedPath}:${cacheKey}`), undefined);
        assertEquals(await exists(cacheDir), true);
        assertEquals(await exists(ssrCacheDir), true);
      });
    } finally {
      await remove(cacheBase, { recursive: true });
      clearModulePathCache();
    }
  });

  it("does not delete slash-containing sibling SSR namespaces when clearing a prefix source", async () => {
    clearModulePathCache();

    const cacheBase = await makeTempDir({ prefix: "vf-mdx-namespace-slash-isolation-" });
    const projectId = "project-slash-source";
    const parentSourceId = "preview-feature";
    const childSourceId = "preview-feature/refactor";
    const cacheKey = buildMdxEsmPathCacheKey("_vf_modules/pages/index.js", "19.1.1");

    try {
      await runWithCacheDir(cacheBase, async () => {
        const parentCacheDir = getMdxEsmSsrCacheDir(projectId, parentSourceId);
        const childCacheDir = getMdxEsmSsrCacheDir(projectId, childSourceId);
        const parentCachedPath = join(parentCacheDir, "parent.mjs");
        const childCachedPath = join(childCacheDir, "child.mjs");

        await getLocalFs().mkdir(parentCacheDir, { recursive: true });
        await getLocalFs().mkdir(childCacheDir, { recursive: true });
        await writeTextFile(parentCachedPath, "export default 'parent';");
        await writeTextFile(childCachedPath, "export default 'child';");

        const parentCache = await getModulePathCache(parentCacheDir);
        parentCache.set(cacheKey, parentCachedPath);
        const childCache = await getModulePathCache(childCacheDir);
        childCache.set(cacheKey, childCachedPath);
        verifiedModuleDeps.set(`${parentCachedPath}:${cacheKey}`, true);
        verifiedModuleDeps.set(`${childCachedPath}:${cacheKey}`, true);

        await clearMdxEsmCacheNamespace(projectId, parentSourceId);

        assertEquals(await exists(parentCachedPath), false);
        assertEquals(await exists(childCachedPath), true);
        assertEquals((await getModulePathCache(parentCacheDir)).get(cacheKey), undefined);
        assertEquals((await getModulePathCache(childCacheDir)).get(cacheKey), childCachedPath);
        assertEquals(verifiedModuleDeps.get(`${parentCachedPath}:${cacheKey}`), undefined);
        assertEquals(verifiedModuleDeps.get(`${childCachedPath}:${cacheKey}`), true);
      });
    } finally {
      await remove(cacheBase, { recursive: true });
      clearModulePathCache();
    }
  });

  it("clears legacy raw SSR namespaces while preserving current hashed siblings", async () => {
    clearModulePathCache();

    const cacheBase = await makeTempDir({ prefix: "vf-mdx-legacy-raw-namespace-clear-" });
    const projectId = "project-legacy-raw-source";
    const parentSourceId = "preview-feature";
    const childSourceId = "preview-feature/refactor";
    const cacheKey = buildMdxEsmPathCacheKey("_vf_modules/pages/index.js", "19.1.1");

    try {
      await runWithCacheDir(cacheBase, async () => {
        const mdxCacheDir = join(cacheBase, "veryfront-mdx-esm");
        const projectKey = hashCodeHex(projectId);
        const legacyParentDir = join(mdxCacheDir, projectKey, parentSourceId);
        const legacyChildDir = join(mdxCacheDir, projectKey, childSourceId);
        const currentChildDir = getMdxEsmSsrCacheDir(projectId, childSourceId);
        const legacyParentPath = join(legacyParentDir, "parent.mjs");
        const legacyChildPath = join(legacyChildDir, "child-legacy.mjs");
        const currentChildPath = join(currentChildDir, "child-current.mjs");
        const legacyChildCyclePath = join(
          getCycleManifestCacheDir(legacyChildDir),
          "0-stale/artifacts/0.deadbeef.js",
        );
        const currentChildCyclePath = join(
          getCycleManifestCacheDir(currentChildDir),
          "0-current/artifacts/0.cafebabe.js",
        );

        await getLocalFs().mkdir(legacyParentDir, { recursive: true });
        await getLocalFs().mkdir(legacyChildDir, { recursive: true });
        await getLocalFs().mkdir(currentChildDir, { recursive: true });
        await writeTextFile(legacyParentPath, "export default 'legacy-parent';");
        await writeTextFile(legacyChildPath, "export default 'legacy-child';");
        await writeTextFile(currentChildPath, "export default 'current-child';");
        await getLocalFs().mkdir(join(legacyChildCyclePath, ".."), { recursive: true });
        await getLocalFs().mkdir(join(currentChildCyclePath, ".."), { recursive: true });
        await writeTextFile(legacyChildCyclePath, "export default 'legacy-cycle';");
        await writeTextFile(currentChildCyclePath, "export default 'current-cycle';");

        const legacyParentCache = await getModulePathCache(legacyParentDir);
        legacyParentCache.set(cacheKey, legacyParentPath);
        const legacyChildCache = await getModulePathCache(legacyChildDir);
        legacyChildCache.set(cacheKey, legacyChildPath);
        const currentChildCache = await getModulePathCache(currentChildDir);
        currentChildCache.set(cacheKey, currentChildPath);
        verifiedModuleDeps.set(`${legacyParentPath}:${cacheKey}`, true);
        verifiedModuleDeps.set(`${legacyChildPath}:${cacheKey}`, true);
        verifiedModuleDeps.set(`${currentChildPath}:${cacheKey}`, true);

        await clearMdxEsmCacheNamespace(projectId, parentSourceId);

        assertEquals(await exists(legacyParentPath), false);
        assertEquals(await exists(legacyChildPath), false);
        assertEquals(await exists(currentChildPath), true);
        assertEquals(await exists(legacyChildCyclePath), false);
        assertEquals(await exists(currentChildCyclePath), true);
        assertEquals((await getModulePathCache(legacyParentDir)).get(cacheKey), undefined);
        assertEquals((await getModulePathCache(legacyChildDir)).get(cacheKey), undefined);
        assertEquals((await getModulePathCache(currentChildDir)).get(cacheKey), currentChildPath);
        assertEquals(verifiedModuleDeps.get(`${legacyParentPath}:${cacheKey}`), undefined);
        assertEquals(verifiedModuleDeps.get(`${legacyChildPath}:${cacheKey}`), undefined);
        assertEquals(verifiedModuleDeps.get(`${currentChildPath}:${cacheKey}`), true);
      });
    } finally {
      await remove(cacheBase, { recursive: true });
      clearModulePathCache();
    }
  });

  it("isolates per cache dir", async () => {
    clearModulePathCache();

    const cacheDirA = await makeTempDir({ prefix: "vf-mdx-cache-a-" });
    const cacheDirB = await makeTempDir({ prefix: "vf-mdx-cache-b-" });

    try {
      await writeTextFile(
        join(cacheDirA, "_index.json"),
        JSON.stringify({ "_vf_modules/pages/index.js": "/tmp/a.mjs" }),
      );
      await writeTextFile(
        join(cacheDirB, "_index.json"),
        JSON.stringify({ "_vf_modules/pages/index.js": "/tmp/b.mjs" }),
      );

      const cacheA = await getModulePathCache(cacheDirA);
      const cacheB = await getModulePathCache(cacheDirB);

      assertEquals(cacheA.get("_vf_modules/pages/index.js"), "/tmp/a.mjs");
      assertEquals(cacheB.get("_vf_modules/pages/index.js"), "/tmp/b.mjs");

      cacheA.set("_vf_modules/pages/about.js", "/tmp/a-about.mjs");
      await saveModulePathCache(cacheDirA);

      assertEquals(cacheB.get("_vf_modules/pages/about.js"), undefined);
    } finally {
      await Promise.all([
        remove(cacheDirA, { recursive: true }),
        remove(cacheDirB, { recursive: true }),
      ]);
      clearModulePathCache();
    }
  });

  it("keeps cycle storage outside every content-source namespace", async () => {
    const cacheBase = await makeTempDir({ prefix: "vf-cycle-namespace-isolation-" });

    try {
      await runWithCacheDir(cacheBase, () => {
        const projectDir = join(cacheBase, "veryfront-mdx-esm", "project");
        const mainCacheDir = join(projectDir, "main");
        const collidingSourceDir = join(projectDir, "main.veryfront-cycle-manifests");

        assertEquals(getCycleManifestCacheDir(mainCacheDir) === collidingSourceDir, false);
      });
    } finally {
      await remove(cacheBase, { recursive: true });
    }
  });

  it("removes persisted generations that predate a fresh-process full clear", async () => {
    const cacheBase = await makeTempDir({ prefix: "vf-cycle-fresh-clear-" });

    try {
      await runWithCacheDir(cacheBase, async () => {
        const cacheDir = join(getMdxEsmCacheDir(), "project", "source");
        const staleArtifact = join(
          getCycleManifestCacheDir(cacheDir),
          "7-stale/artifacts/0.deadbeef.js",
        );
        const futureDatedArtifact = join(
          getCycleManifestCacheDir(cacheDir),
          `${Number.MAX_SAFE_INTEGER}-stale/artifacts/0.cafebabe.js`,
        );
        await getLocalFs().mkdir(join(staleArtifact, ".."), { recursive: true });
        await getLocalFs().mkdir(join(futureDatedArtifact, ".."), { recursive: true });
        await writeTextFile(staleArtifact, `export default "stale";`);
        await writeTextFile(futureDatedArtifact, `export default "future-stale";`);

        await clearESMDiskCache();

        assertEquals(await exists(staleArtifact), false);
        assertEquals(await exists(futureDatedArtifact), false);
      });
    } finally {
      await remove(cacheBase, { recursive: true }).catch(() => {});
      clearModulePathCache();
    }
  });

  it("reports path-cache state to the memory profiler", async () => {
    clearModulePathCache();

    const cacheDirA = await makeTempDir({ prefix: "vf-mdx-cache-stats-a-" });
    const cacheDirB = await makeTempDir({ prefix: "vf-mdx-cache-stats-b-" });

    try {
      await writeTextFile(
        join(cacheDirA, "_index.json"),
        JSON.stringify({ [buildMdxEsmPathCacheKey("_vf_modules/pages/a.js")]: "/tmp/a.mjs" }),
      );
      await writeTextFile(
        join(cacheDirB, "_index.json"),
        JSON.stringify({ [buildMdxEsmPathCacheKey("_vf_modules/pages/b.js")]: "/tmp/b.mjs" }),
      );

      await getModulePathCache(cacheDirA);
      await getModulePathCache(cacheDirB);

      const stats = getCacheStats();
      const pathCacheStats = stats.find((s) => s.name === "mdx-esm-path-caches") as
        | ({ entries: number; cacheDirs?: number })
        | undefined;

      assertEquals(pathCacheStats?.entries, 2);
      assertEquals(pathCacheStats?.cacheDirs, 2);
      assertEquals(stats.find((s) => s.name === "mdx-esm-verified-deps")?.entries, 0);
    } finally {
      await Promise.all([
        remove(cacheDirA, { recursive: true }),
        remove(cacheDirB, { recursive: true }),
      ]);
      clearModulePathCache();
    }
  });

  it("logs stale cached file removal failures during corrupted-cache invalidation", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-remove-log-" });
    const projectDir = await makeTempDir({ prefix: "vf-mdx-remove-log-project-" });
    const filePath = join(projectDir, "app/page.tsx");
    const cachedPath = join(cacheDir, buildMdxEsmModuleFileName("unresolved"));
    const key = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");
    const localFs = getLocalFs();
    const originalRemove = localFs.remove.bind(localFs);
    const originalDebug = log.debug.bind(log);
    const debugEntries: Array<{ message: string; metadata: unknown[] }> = [];

    try {
      await writeTextFile(
        cachedPath,
        'import stale from "/_vf_modules/_veryfront/stale.mjs"; export default stale;',
      );
      await writeTextFile(join(cacheDir, "_index.json"), JSON.stringify({ [key]: cachedPath }));

      localFs.remove = (path: string, options?: { recursive?: boolean }): Promise<void> => {
        if (path === cachedPath) return Promise.reject(new Error("remove denied"));
        return originalRemove(path, options);
      };
      log.debug = (message: string, ...metadata: unknown[]): void => {
        debugEntries.push({ message, metadata });
        originalDebug(message, ...metadata);
      };

      const result = await lookupMdxEsmCache(
        filePath,
        cacheDir,
        projectDir,
        undefined,
        undefined,
        "19.1.1",
      );

      assertEquals(result.status, "corrupted");
      assertEquals(
        debugEntries.some((entry) => {
          const metadata = entry.metadata[0] as { error?: unknown } | undefined;
          return entry.message.includes("Stale cached module cleanup failed") &&
            metadata?.error instanceof Error &&
            metadata.error.message === "remove denied";
        }),
        true,
        "failed stale-file cleanup should be observable",
      );
    } finally {
      localFs.remove = originalRemove;
      log.debug = originalDebug;
      await Promise.all([
        remove(cacheDir, { recursive: true }).catch(() => {}),
        remove(projectDir, { recursive: true }).catch(() => {}),
      ]);
      clearModulePathCache();
    }
  });

  it("bounds loaded path-cache entries and reports the aggregate limit", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-cache-bound-" });
    const index: Record<string, string> = {};
    for (let i = 0; i < 501; i++) {
      index[buildMdxEsmPathCacheKey(`_vf_modules/pages/${i}.js`)] = `/tmp/${i}.mjs`;
    }

    try {
      await writeTextFile(join(cacheDir, "_index.json"), JSON.stringify(index));

      const cache = await getModulePathCache(cacheDir);
      const stats = getCacheStats();
      const pathCacheStats = stats.find((s) => s.name === "mdx-esm-path-caches") as
        | ({ entries: number; maxEntries?: number; cacheDirs?: number })
        | undefined;

      assertEquals(cache.size, 500);
      assertEquals(pathCacheStats?.entries, 500);
      assertEquals(pathCacheStats?.maxEntries, 500);
      assertEquals(pathCacheStats?.cacheDirs, 1);
      assertEquals(cache.get(buildMdxEsmPathCacheKey("_vf_modules/pages/0.js")), undefined);
      assertEquals(cache.get(buildMdxEsmPathCacheKey("_vf_modules/pages/500.js")), "/tmp/500.mjs");
    } finally {
      await remove(cacheDir, { recursive: true }).catch(() => {});
      clearModulePathCache();
    }
  });
});

describe("invalidateModulePaths — disk persistence", () => {
  it("persists invalidation to _index.json so stale entries don't survive reload", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-invalidate-" });
    const versionedKey = buildMdxEsmPathCacheKey("_vf_modules/components/EmptyState.js");
    const staleMjsPath = join(cacheDir, buildMdxEsmModuleFileName("stale1234"));

    try {
      // Simulate a cached module: _index.json entry + .mjs file on disk
      await writeTextFile(staleMjsPath, `export default "old content";`);
      await writeTextFile(
        join(cacheDir, "_index.json"),
        JSON.stringify({ [versionedKey]: staleMjsPath }),
      );

      // Load the path cache from disk
      const cache = await getModulePathCache(cacheDir);
      assertEquals(
        cache.get(versionedKey),
        staleMjsPath,
        "precondition: entry loaded from _index.json",
      );

      // Invalidate — simulates a poke with changedPaths: ["components/EmptyState.tsx"]
      invalidateModulePaths(["components/EmptyState.tsx"]);
      await waitForDiskCleanup();

      // In-memory should be cleared
      assertEquals(cache.get(versionedKey), undefined, "in-memory entry should be removed");

      // Simulate a fresh load (e.g. pod restart or new request on fresh cache dir load)
      clearModulePathCache();
      const reloadedCache = await getModulePathCache(cacheDir);

      // _index.json should NOT contain the stale entry anymore
      assertEquals(
        reloadedCache.get(versionedKey),
        undefined,
        "stale entry must not survive _index.json reload — this is the cache invalidation bug",
      );
    } finally {
      await remove(cacheDir, { recursive: true });
      clearModulePathCache();
    }
  });

  it("deletes stale .mjs files from disk during invalidation", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-invalidate-disk-" });
    const versionedKey = buildMdxEsmPathCacheKey("_vf_modules/components/EmptyState.js");
    const staleMjsPath = join(cacheDir, buildMdxEsmModuleFileName("stale5678"));

    try {
      // Create the stale .mjs file
      await writeTextFile(staleMjsPath, `export default "stale transformed content";`);
      await writeTextFile(
        join(cacheDir, "_index.json"),
        JSON.stringify({ [versionedKey]: staleMjsPath }),
      );

      // Load path cache
      await getModulePathCache(cacheDir);

      // Invalidate
      invalidateModulePaths(["components/EmptyState.tsx"]);
      await waitForDiskCleanup();

      // The .mjs file on disk should be deleted
      const fileStillExists = await exists(staleMjsPath);
      assertEquals(
        fileStillExists,
        false,
        "stale .mjs file must be deleted from disk during invalidation",
      );
    } finally {
      await remove(cacheDir, { recursive: true }).catch(() => {});
      clearModulePathCache();
    }
  });

  it("deletes unresolved-import evidence beside stale modules", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-invalidate-evidence-" });
    const versionedKey = buildMdxEsmPathCacheKey("_vf_modules/components/EmptyState.js");
    const staleMjsPath = join(cacheDir, buildMdxEsmModuleFileName("stale-evidence"));
    const evidencePath = `${staleMjsPath}${UNRESOLVED_IMPORTS_SIDECAR_SUFFIX}`;
    const cycleEvidencePath = `${staleMjsPath}${CYCLE_MANIFEST_SIDECAR_SUFFIX}`;

    try {
      await writeTextFile(staleMjsPath, `export default "stale";`);
      await writeTextFile(evidencePath, JSON.stringify(["./missing"]));
      await writeTextFile(cycleEvidencePath, `{}`);
      await writeTextFile(
        join(cacheDir, "_index.json"),
        JSON.stringify({ [versionedKey]: staleMjsPath }),
      );
      await getModulePathCache(cacheDir);

      invalidateModulePaths(["components/EmptyState.tsx"]);
      await waitForDiskCleanup();

      assertEquals(await exists(staleMjsPath), false);
      assertEquals(await exists(evidencePath), false);
      assertEquals(await exists(cycleEvidencePath), false);
    } finally {
      await remove(cacheDir, { recursive: true }).catch(() => {});
      clearModulePathCache();
    }
  });

  it("deletes every cycle generation for an affected cache directory", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-invalidate-cycle-" });
    const versionedKey = buildMdxEsmPathCacheKey("_vf_modules/components/EmptyState.js");
    const manifestDir = getCycleManifestCacheDir(cacheDir);
    const oldGraphDir = join(manifestDir, "0-graph-a");
    const currentGraphDir = join(manifestDir, "0-graph-b");
    const staleModulePath = join(currentGraphDir, "artifacts", "0.deadbeef.js");

    try {
      await Deno.mkdir(join(oldGraphDir, "artifacts"), { recursive: true });
      await Deno.writeTextFile(
        join(oldGraphDir, "artifacts", "0.cafebabe.js"),
        `export default "orphaned";`,
      );
      await Deno.mkdir(join(currentGraphDir, "artifacts"), { recursive: true });
      await writeTextFile(staleModulePath, `export default "stale";`);
      await writeTextFile(`${staleModulePath}.cycle-manifest.json`, `{}`);
      await writeTextFile(
        join(cacheDir, "_index.json"),
        JSON.stringify({ [versionedKey]: staleModulePath }),
      );
      await getModulePathCache(cacheDir);

      invalidateModulePaths(["components/EmptyState.tsx"]);
      await waitForDiskCleanup();

      assertEquals(await exists(manifestDir), false);
    } finally {
      await remove(manifestDir, { recursive: true }).catch(() => {});
      await remove(cacheDir, { recursive: true }).catch(() => {});
      clearModulePathCache();
    }
  });

  it("does not delete a graph published after invalidation begins", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-invalidate-cycle-race-" });
    const versionedKey = buildMdxEsmPathCacheKey("_vf_modules/components/EmptyState.js");
    const manifestDir = getCycleManifestCacheDir(cacheDir);
    const staleGeneration = getCycleManifestGeneration(manifestDir);
    const staleGraphDir = join(manifestDir, `${staleGeneration}-stale`);
    const freshGraphDir = join(manifestDir, `${staleGeneration + 1}-fresh`);
    const staleModulePath = join(staleGraphDir, "artifacts", "0.deadbeef.js");
    const freshModulePath = join(freshGraphDir, "artifacts", "0.cafebabe.js");
    const localFs = getLocalFs();
    const originalReadDir = localFs.readDir.bind(localFs);
    let releaseRead!: () => void;
    const readReleased = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let reportReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      reportReadStarted = resolve;
    });

    try {
      await Deno.mkdir(join(staleGraphDir, "artifacts"), { recursive: true });
      await writeTextFile(staleModulePath, `export default "stale";`);
      await writeTextFile(
        join(cacheDir, "_index.json"),
        JSON.stringify({ [versionedKey]: staleModulePath }),
      );
      const cache = await getModulePathCache(cacheDir);

      localFs.readDir = (path: string): ReturnType<typeof originalReadDir> => {
        if (path !== manifestDir) return originalReadDir(path);
        return (async function* () {
          reportReadStarted();
          await readReleased;
          yield* originalReadDir(path);
        })();
      };

      invalidateModulePaths(["components/EmptyState.tsx"]);
      await readStarted;
      await Deno.mkdir(join(freshGraphDir, "artifacts"), { recursive: true });
      await writeTextFile(freshModulePath, `export default "fresh";`);
      cache.set(versionedKey, freshModulePath);
      releaseRead();
      await waitForDiskCleanup();

      assertEquals(await exists(staleGraphDir), false);
      assertEquals(await exists(freshModulePath), true);
      assertEquals(cache.get(versionedKey), freshModulePath);
    } finally {
      releaseRead();
      localFs.readDir = originalReadDir;
      await remove(manifestDir, { recursive: true }).catch(() => {});
      await remove(cacheDir, { recursive: true }).catch(() => {});
      clearModulePathCache();
    }
  });

  it("does not delete the latest graph after rapid invalidations", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-invalidate-cycle-rapid-" });
    const versionedKey = buildMdxEsmPathCacheKey("_vf_modules/components/EmptyState.js");
    const manifestDir = getCycleManifestCacheDir(cacheDir);
    const initialGeneration = getCycleManifestGeneration(manifestDir);
    const initialGraphDir = join(manifestDir, `${initialGeneration}-initial`);
    const initialModulePath = join(initialGraphDir, "artifacts", "0.deadbeef.js");
    const localFs = getLocalFs();
    const originalReadDir = localFs.readDir.bind(localFs);
    let releaseRead!: () => void;
    const readReleased = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let reportReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      reportReadStarted = resolve;
    });

    try {
      await Deno.mkdir(join(initialGraphDir, "artifacts"), { recursive: true });
      await writeTextFile(initialModulePath, `export default "initial";`);
      await writeTextFile(
        join(cacheDir, "_index.json"),
        JSON.stringify({ [versionedKey]: initialModulePath }),
      );
      const cache = await getModulePathCache(cacheDir);

      let intercepted = false;
      localFs.readDir = (path: string): ReturnType<typeof originalReadDir> => {
        if (path !== manifestDir || intercepted) return originalReadDir(path);
        intercepted = true;
        return (async function* () {
          reportReadStarted();
          await readReleased;
          yield* originalReadDir(path);
        })();
      };

      invalidateModulePaths(["components/EmptyState.tsx"]);
      await readStarted;

      const intermediateGeneration = getCycleManifestGeneration(manifestDir);
      const intermediateGraphDir = join(
        manifestDir,
        `${intermediateGeneration}-intermediate`,
      );
      const intermediateModulePath = join(
        intermediateGraphDir,
        "artifacts",
        "0.cafebabe.js",
      );
      await Deno.mkdir(join(intermediateGraphDir, "artifacts"), { recursive: true });
      await writeTextFile(intermediateModulePath, `export default "intermediate";`);
      cache.set(versionedKey, intermediateModulePath);

      invalidateModulePaths(["components/EmptyState.tsx"]);
      const latestGeneration = getCycleManifestGeneration(manifestDir);
      const latestGraphDir = join(manifestDir, `${latestGeneration}-latest`);
      const latestModulePath = join(latestGraphDir, "artifacts", "0.8badf00d.js");
      await Deno.mkdir(join(latestGraphDir, "artifacts"), { recursive: true });
      await writeTextFile(latestModulePath, `export default "latest";`);
      cache.set(versionedKey, latestModulePath);

      releaseRead();
      await waitForDiskCleanup();

      assertEquals(await exists(initialGraphDir), false);
      assertEquals(await exists(intermediateGraphDir), false);
      assertEquals(await exists(latestModulePath), true);
      assertEquals(cache.get(versionedKey), latestModulePath);
    } finally {
      releaseRead();
      localFs.readDir = originalReadDir;
      await remove(manifestDir, { recursive: true }).catch(() => {});
      await remove(cacheDir, { recursive: true }).catch(() => {});
      clearModulePathCache();
    }
  });

  it("cacheModule does not resurrect invalidated entries via disk content hash hit", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-no-resurrect-" });
    const normalizedPath = "_vf_modules/components/EmptyState.js";
    const oldModuleCode =
      `import { jsx } from "react/jsx-runtime";\nexport default jsx("h1", { children: "Welcome to AI Chatbot" });`;
    const newModuleCode =
      `import { jsx } from "react/jsx-runtime";\nexport default jsx("h1", { children: "Welcome to AI Chatbotd" });`;

    try {
      // Step 1: Cache the old module code
      const pathCache = await getModulePathCache(cacheDir);
      const oldCachePath = await cacheModule(
        normalizedPath,
        oldModuleCode,
        cacheDir,
        pathCache,
        log,
      );

      assertEquals(oldCachePath !== null, true, "old module should be cached");
      assertEquals(await exists(oldCachePath!), true, "old .mjs should exist on disk");

      // Step 2: Invalidate via poke
      invalidateModulePaths(["components/EmptyState.tsx"]);
      await waitForDiskCleanup();

      // Step 3: Cache the NEW module code (simulates re-fetch after source change)
      const newCachePath = await cacheModule(
        normalizedPath,
        newModuleCode,
        cacheDir,
        pathCache,
        log,
      );

      assertEquals(newCachePath !== null, true, "new module should be cached");

      // The new cache path should be DIFFERENT from the old one (different content hash)
      assertEquals(
        newCachePath !== oldCachePath,
        true,
        "new module must get a different cache path than the old stale one",
      );
    } finally {
      await remove(cacheDir, { recursive: true }).catch(() => {});
      clearModulePathCache();
    }
  });
});

describe("lookupMdxEsmCache", () => {
  it("keeps cached modules whose encoded file URL dependencies exist", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-encoded-dependency-" });
    const projectDir = await makeTempDir({ prefix: "vf-mdx-encoded-project-" });
    const filePath = join(projectDir, "app/page.tsx");
    const dependencyPath = join(cacheDir, "_pins/on%3Asnapshot/lib/value.mjs");
    const cachedPath = join(cacheDir, buildMdxEsmModuleFileName("encodeddep"));
    const key = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");

    try {
      await getLocalFs().mkdir(join(cacheDir, "_pins/on%3Asnapshot/lib"), {
        recursive: true,
      });
      await writeTextFile(dependencyPath, `export default "available";`);
      await writeTextFile(
        cachedPath,
        `import value from ${
          JSON.stringify(toFileUrl(dependencyPath).href)
        }; export default value;`,
      );
      await writeTextFile(join(cacheDir, "_index.json"), JSON.stringify({ [key]: cachedPath }));

      const result = await lookupMdxEsmCache(
        filePath,
        cacheDir,
        projectDir,
        undefined,
        undefined,
        "19.1.1",
      );

      assertEquals(result, { status: "hit", path: cachedPath });
    } finally {
      await Promise.all([
        remove(cacheDir, { recursive: true }).catch(() => {}),
        remove(projectDir, { recursive: true }).catch(() => {}),
      ]);
      clearModulePathCache();
    }
  });

  it("invalidates cached modules whose file:// dependencies are missing", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-missing-dependency-" });
    const projectDir = await makeTempDir({ prefix: "vf-mdx-missing-project-" });
    const filePath = join(projectDir, "app/page.tsx");
    const missingDependency = join(projectDir, "vf-missing-dependency.mjs");
    const cachedPath = join(cacheDir, buildMdxEsmModuleFileName("missingdep"));
    const key = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");

    try {
      await writeTextFile(
        cachedPath,
        `import value from ${
          JSON.stringify(toFileUrl(missingDependency).href)
        }; export default value;`,
      );
      await writeTextFile(join(cacheDir, "_index.json"), JSON.stringify({ [key]: cachedPath }));

      const result = await lookupMdxEsmCache(
        filePath,
        cacheDir,
        projectDir,
        undefined,
        undefined,
        "19.1.1",
      );

      assertEquals(
        result.status,
        "corrupted",
        "a cached module with a missing file dependency must be reported corrupted",
      );
      assertEquals(
        (result as { reason: string }).reason.startsWith("Missing file dependencies"),
        true,
        "reports the missing-dependency reason",
      );
      assertEquals(await exists(cachedPath), false, "the stale .mjs must be deleted");
      assertEquals(
        (await getModulePathCache(cacheDir)).get(key),
        undefined,
        "the dead path-cache entry must be dropped",
      );
    } finally {
      await Promise.all([
        remove(cacheDir, { recursive: true }).catch(() => {}),
        remove(projectDir, { recursive: true }).catch(() => {}),
      ]);
      clearModulePathCache();
    }
  });

  it("invalidates cached modules carrying another environment's cache paths", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-foreign-paths-" });
    const projectDir = await makeTempDir({ prefix: "vf-mdx-foreign-project-" });
    const filePath = join(projectDir, "app/page.tsx");
    const cachedPath = join(cacheDir, buildMdxEsmModuleFileName("foreignpaths"));
    const key = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");

    try {
      await writeTextFile(
        cachedPath,
        `import x from "file:///some-other-machine/.cache/veryfront-http-bundle/http-1.mjs"; export default x;`,
      );
      await writeTextFile(join(cacheDir, "_index.json"), JSON.stringify({ [key]: cachedPath }));

      const result = await lookupMdxEsmCache(
        filePath,
        cacheDir,
        projectDir,
        undefined,
        undefined,
        "19.1.1",
      );

      assertEquals(
        result.status,
        "corrupted",
        "a cached module carrying another environment's cache paths must not be served",
      );
      assertEquals(
        (result as { reason: string }).reason,
        "Incompatible cache paths from different environment",
        "reports the incompatible-paths reason",
      );
      assertEquals(await exists(cachedPath), false, "the foreign-path .mjs must be deleted");
    } finally {
      await Promise.all([
        remove(cacheDir, { recursive: true }).catch(() => {}),
        remove(projectDir, { recursive: true }).catch(() => {}),
      ]);
      clearModulePathCache();
    }
  });

  it("serves cached modules whose file:// dependencies live in the local cache dir", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-local-paths-" });
    const projectDir = await makeTempDir({ prefix: "vf-mdx-local-project-" });
    const filePath = join(projectDir, "app/page.tsx");
    const dependencyDir = join(getMdxEsmCacheDir(), "vf-mdx-local-paths-dependency");
    const dependencyPath = join(dependencyDir, "local-dep.mjs");
    const cachedPath = join(cacheDir, buildMdxEsmModuleFileName("localpaths"));
    const key = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");

    try {
      await getLocalFs().mkdir(dependencyDir, { recursive: true });
      await writeTextFile(dependencyPath, `export default "local";`);
      await writeTextFile(
        cachedPath,
        `import x from ${JSON.stringify(toFileUrl(dependencyPath).href)}; export default x;`,
      );
      await writeTextFile(join(cacheDir, "_index.json"), JSON.stringify({ [key]: cachedPath }));

      const result = await lookupMdxEsmCache(
        filePath,
        cacheDir,
        projectDir,
        undefined,
        undefined,
        "19.1.1",
      );

      assertEquals(
        result,
        { status: "hit", path: cachedPath },
        "a dependency under the local MDX ESM cache dir must not be treated as foreign",
      );
    } finally {
      await Promise.all([
        remove(dependencyDir, { recursive: true }).catch(() => {}),
        remove(cacheDir, { recursive: true }).catch(() => {}),
        remove(projectDir, { recursive: true }).catch(() => {}),
      ]);
      clearModulePathCache();
    }
  });

  it("isolates local path-cache entries by react version", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-react-version-" });
    const projectDir = await makeTempDir({ prefix: "vf-mdx-project-" });
    const filePath = join(projectDir, "components/Button.tsx");
    const cachedPath = join(cacheDir, buildMdxEsmModuleFileName("react18"));
    const react18Key = buildMdxEsmPathCacheKey("_vf_modules/components/Button.js", "18.3.1");

    try {
      await writeTextFile(cachedPath, `export default "react18";`);
      await writeTextFile(
        join(cacheDir, "_index.json"),
        JSON.stringify({ [react18Key]: cachedPath }),
      );

      const react19Result = await lookupMdxEsmCache(
        filePath,
        cacheDir,
        projectDir,
        undefined,
        undefined,
        "19.1.1",
      );
      assertEquals(react19Result, { status: "miss" });

      const react18Result = await lookupMdxEsmCache(
        filePath,
        cacheDir,
        projectDir,
        undefined,
        undefined,
        "18.3.1",
      );
      assertEquals(react18Result, { status: "hit", path: cachedPath });
    } finally {
      await Promise.all([
        remove(cacheDir, { recursive: true }).catch(() => {}),
        remove(projectDir, { recursive: true }).catch(() => {}),
      ]);
      clearModulePathCache();
    }
  });
});

describe("lookupMdxEsmCache — stale verified artifact (#2077)", () => {
  it("re-validates a verified module and returns miss when the artifact was evicted", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-stale-verified-" });
    const projectDir = await makeTempDir({ prefix: "vf-mdx-stale-project-" });
    const filePath = join(projectDir, "app/page.tsx");
    const cachedPath = join(cacheDir, buildMdxEsmModuleFileName("page7b82"));
    const key = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");

    try {
      await writeTextFile(cachedPath, `export default 1;`);
      await writeTextFile(join(cacheDir, "_index.json"), JSON.stringify({ [key]: cachedPath }));

      // First lookup: full validation path → hit, and marks the entry verified.
      const first = await lookupMdxEsmCache(
        filePath,
        cacheDir,
        projectDir,
        undefined,
        undefined,
        "19.1.1",
      );
      assertEquals(first, { status: "hit", path: cachedPath });
      assertEquals(
        verifiedModuleDeps.get(`${cachedPath}:${key}`),
        true,
        "precondition: lookup marked the artifact verified",
      );

      // Artifact is evicted/rebuilt under a different hash out from under us,
      // WITHOUT going through invalidateModulePaths (so the verified marker stays).
      await remove(cachedPath);

      // Second lookup: the verified fast-path must still confirm existence and,
      // finding the file gone, report a miss so the caller rebuilds — instead of
      // returning a dead path that import() would hard-fail on.
      const second = await lookupMdxEsmCache(
        filePath,
        cacheDir,
        projectDir,
        undefined,
        undefined,
        "19.1.1",
      );
      assertEquals(second, { status: "miss" });
      assertEquals(
        verifiedModuleDeps.get(`${cachedPath}:${key}`),
        undefined,
        "stale verified marker must be cleared",
      );
      assertEquals(
        (await getModulePathCache(cacheDir)).get(key),
        undefined,
        "stale path-cache entry must be cleared",
      );

      // The eviction must also be persisted to _index.json so the dead pointer
      // does not resurrect on restart — an SSR-only caller never re-registers it.
      await waitForDiskCleanup();
      clearModulePathCache();
      const reloaded = await getModulePathCache(cacheDir);
      assertEquals(
        reloaded.get(key),
        undefined,
        "stale entry must not resurrect from _index.json after a verified-miss eviction",
      );
    } finally {
      await Promise.all([
        remove(cacheDir, { recursive: true }).catch(() => {}),
        remove(projectDir, { recursive: true }).catch(() => {}),
      ]);
      clearModulePathCache();
    }
  });
});

describe("invalidateMdxEsmModule (#2077 self-heal)", () => {
  it("clears the path-cache entry and verified marker for a single source file", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-selfheal-" });
    const projectDir = await makeTempDir({ prefix: "vf-mdx-selfheal-project-" });
    const filePath = join(projectDir, "app/page.tsx");
    const key = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");
    const cachedPath = join(cacheDir, buildMdxEsmModuleFileName("selfheal"));
    const verifyKey = `${cachedPath}:${key}`;

    try {
      await writeTextFile(join(cacheDir, "_index.json"), JSON.stringify({ [key]: cachedPath }));
      const cache = await getModulePathCache(cacheDir);
      verifiedModuleDeps.set(verifyKey, true);

      invalidateMdxEsmModule(cacheDir, filePath, projectDir, "19.1.1");

      assertEquals(cache.get(key), undefined, "path-cache entry must be removed");
      assertEquals(
        verifiedModuleDeps.get(verifyKey),
        undefined,
        "verified marker must be removed",
      );
    } finally {
      await Promise.all([
        remove(cacheDir, { recursive: true }).catch(() => {}),
        remove(projectDir, { recursive: true }).catch(() => {}),
      ]);
      clearModulePathCache();
    }
  });

  it("is a safe no-op when the file is not cached", () => {
    clearModulePathCache();
    invalidateMdxEsmModule("/cache/dir", "/project/app/page.tsx", "/project", "19.1.1");
  });

  it("only touches the failing cache dir, not other tenants sharing the same key", async () => {
    clearModulePathCache();

    // Two tenants whose projects both contain app/page.tsx → identical path key
    // (the key is scoped only by react version + relative path, not by project).
    const cacheDirA = await makeTempDir({ prefix: "vf-mdx-tenant-a-" });
    const cacheDirB = await makeTempDir({ prefix: "vf-mdx-tenant-b-" });
    const projectDirA = await makeTempDir({ prefix: "vf-mdx-tenant-a-project-" });
    const projectDirB = await makeTempDir({ prefix: "vf-mdx-tenant-b-project-" });
    const filePathA = join(projectDirA, "app/page.tsx");
    const key = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");
    const cachedA = join(cacheDirA, buildMdxEsmModuleFileName("tenantA"));
    const cachedB = join(cacheDirB, buildMdxEsmModuleFileName("tenantB"));

    try {
      await writeTextFile(join(cacheDirA, "_index.json"), JSON.stringify({ [key]: cachedA }));
      await writeTextFile(join(cacheDirB, "_index.json"), JSON.stringify({ [key]: cachedB }));
      const cacheA = await getModulePathCache(cacheDirA);
      const cacheB = await getModulePathCache(cacheDirB);

      // Tenant A's artifact went missing — invalidate scoped to A's cache dir.
      invalidateMdxEsmModule(cacheDirA, filePathA, projectDirA, "19.1.1");
      await waitForDiskCleanup();

      assertEquals(cacheA.get(key), undefined, "tenant A entry must be removed");
      assertEquals(cacheB.get(key), cachedB, "tenant B's valid entry must be untouched");

      // And tenant B's _index.json must be unchanged on disk.
      clearModulePathCache();
      assertEquals(
        (await getModulePathCache(cacheDirB)).get(key),
        cachedB,
        "tenant B entry must survive reload (no cross-tenant persistence)",
      );
    } finally {
      await Promise.all([
        remove(cacheDirA, { recursive: true }).catch(() => {}),
        remove(cacheDirB, { recursive: true }).catch(() => {}),
        remove(projectDirA, { recursive: true }).catch(() => {}),
        remove(projectDirB, { recursive: true }).catch(() => {}),
      ]);
      clearModulePathCache();
    }
  });

  it("persists the deletion to _index.json so the stale entry does not survive reload", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-selfheal-persist-" });
    const projectDir = await makeTempDir({ prefix: "vf-mdx-selfheal-persist-project-" });
    const filePath = join(projectDir, "app/page.tsx");
    const key = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");
    const cachedPath = join(cacheDir, buildMdxEsmModuleFileName("persist"));

    try {
      await writeTextFile(join(cacheDir, "_index.json"), JSON.stringify({ [key]: cachedPath }));
      await getModulePathCache(cacheDir);

      invalidateMdxEsmModule(cacheDir, filePath, projectDir, "19.1.1");
      await waitForDiskCleanup();

      // Simulate a process restart: drop in-memory state and reload from disk.
      clearModulePathCache();
      const reloaded = await getModulePathCache(cacheDir);
      assertEquals(
        reloaded.get(key),
        undefined,
        "stale entry must not resurrect from _index.json after self-heal",
      );
    } finally {
      await Promise.all([
        remove(cacheDir, { recursive: true }).catch(() => {}),
        remove(projectDir, { recursive: true }).catch(() => {}),
      ]);
      clearModulePathCache();
    }
  });

  it("self-heals legacy raw slash-containing cache dirs", async () => {
    clearModulePathCache();

    const cacheBase = await makeTempDir({ prefix: "vf-mdx-legacy-selfheal-" });
    const projectDir = await makeTempDir({ prefix: "vf-mdx-legacy-selfheal-project-" });
    const filePath = join(projectDir, "app/page.tsx");
    const projectId = "project-legacy-selfheal";
    const contentSourceId = "preview-feature/refactor";
    const key = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");

    try {
      await runWithCacheDir(cacheBase, async () => {
        const legacyRawCacheDir = join(
          cacheBase,
          "veryfront-mdx-esm",
          hashCodeHex(projectId),
          contentSourceId,
        );
        const cachedPath = join(legacyRawCacheDir, buildMdxEsmModuleFileName("legacyraw"));

        await getLocalFs().mkdir(legacyRawCacheDir, { recursive: true });
        await writeTextFile(cachedPath, `export default "legacy";`);
        await writeTextFile(
          join(legacyRawCacheDir, "_index.json"),
          JSON.stringify({ [key]: cachedPath }),
        );
        const cache = await getModulePathCache(legacyRawCacheDir);
        verifiedModuleDeps.set(`${cachedPath}:${key}`, true);

        const invalidated = await invalidateMdxEsmModuleForCachedPath(
          cachedPath,
          filePath,
          projectDir,
          "19.1.1",
          getMdxEsmSsrCacheDirs(projectId, contentSourceId),
        );

        assertEquals(invalidated, true);
        assertEquals(cache.get(key), undefined);
        assertEquals(verifiedModuleDeps.get(`${cachedPath}:${key}`), undefined);

        await waitForDiskCleanup();
        clearModulePathCache();
        assertEquals((await getModulePathCache(legacyRawCacheDir)).get(key), undefined);
      });
    } finally {
      await Promise.all([
        remove(cacheBase, { recursive: true }).catch(() => {}),
        remove(projectDir, { recursive: true }).catch(() => {}),
      ]);
      clearModulePathCache();
    }
  });

  it("self-heals Darwin /private/var aliases for the same cached SSR path", async () => {
    clearModulePathCache();

    const cacheBase = await makeTempDir({ prefix: "vf-mdx-darwin-alias-selfheal-" });
    const projectDir = await makeTempDir({ prefix: "vf-mdx-darwin-alias-project-" });
    const filePath = join(projectDir, "app/page.tsx");
    const projectId = "project-darwin-alias-selfheal";
    const contentSourceId = "preview-main";
    const key = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");

    try {
      await runWithCacheDir(cacheBase, async () => {
        const cacheDir = getMdxEsmSsrCacheDir(projectId, contentSourceId);
        const cachedPath = join(cacheDir, buildMdxEsmModuleFileName("darwinalias"));
        const aliasedCachedPath = cachedPath.startsWith("/var/")
          ? `/private${cachedPath}`
          : cachedPath;

        await getLocalFs().mkdir(cacheDir, { recursive: true });
        await writeTextFile(
          join(cacheDir, "_index.json"),
          JSON.stringify({ [key]: cachedPath }),
        );
        const cache = await getModulePathCache(cacheDir);
        verifiedModuleDeps.set(`${cachedPath}:${key}`, true);
        verifiedModuleDeps.set(`${aliasedCachedPath}:${key}`, true);

        const invalidated = await invalidateMdxEsmModuleForCachedPath(
          aliasedCachedPath,
          filePath,
          projectDir,
          "19.1.1",
          getMdxEsmSsrCacheDirs(projectId, contentSourceId),
        );

        assertEquals(invalidated, true);
        assertEquals(cache.get(key), undefined);
        assertEquals(verifiedModuleDeps.get(`${cachedPath}:${key}`), undefined);
        assertEquals(verifiedModuleDeps.get(`${aliasedCachedPath}:${key}`), undefined);
      });
    } finally {
      await Promise.all([
        remove(cacheBase, { recursive: true }).catch(() => {}),
        remove(projectDir, { recursive: true }).catch(() => {}),
      ]);
      clearModulePathCache();
    }
  });

  it("self-heals cached SSR paths when the cache-dir context is no longer active", async () => {
    clearModulePathCache();

    const cacheBase = await makeTempDir({ prefix: "vf-mdx-contextless-selfheal-" });
    const projectDir = await makeTempDir({ prefix: "vf-mdx-contextless-project-" });
    const filePath = join(projectDir, "app/page.tsx");
    const projectId = "project-contextless-selfheal";
    const contentSourceId = "preview-main";
    const key = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");
    let cacheDir = "";
    let cachedPath = "";
    let cache: Map<string, string> | undefined;

    try {
      await runWithCacheDir(cacheBase, async () => {
        cacheDir = getMdxEsmSsrCacheDir(projectId, contentSourceId);
        cachedPath = join(cacheDir, buildMdxEsmModuleFileName("contextless"));

        await getLocalFs().mkdir(cacheDir, { recursive: true });
        await writeTextFile(
          join(cacheDir, "_index.json"),
          JSON.stringify({ [key]: cachedPath }),
        );
        cache = await getModulePathCache(cacheDir);
        verifiedModuleDeps.set(`${cachedPath}:${key}`, true);
      });

      const invalidated = await invalidateMdxEsmModuleForCachedPath(
        cachedPath,
        filePath,
        projectDir,
        "19.1.1",
        null,
      );

      assertEquals(invalidated, true);
      assertEquals(cache?.get(key), undefined);
      assertEquals(verifiedModuleDeps.get(`${cachedPath}:${key}`), undefined);
    } finally {
      await Promise.all([
        remove(cacheBase, { recursive: true }).catch(() => {}),
        remove(projectDir, { recursive: true }).catch(() => {}),
      ]);
      clearModulePathCache();
    }
  });

  it("self-heals stale entries from older versioned cache dirs", async () => {
    clearModulePathCache();

    const cacheBase = await makeTempDir({ prefix: "vf-mdx-old-version-selfheal-" });
    const projectDir = await makeTempDir({ prefix: "vf-mdx-old-version-project-" });
    const filePath = join(projectDir, "app/page.tsx");
    const projectId = "project-old-version-selfheal";
    const contentSourceId = "preview-main";
    const key = buildMdxEsmPathCacheKey("_vf_modules/app/page.js", "19.1.1");

    try {
      await runWithCacheDir(cacheBase, async () => {
        const oldVersionCacheDir = join(
          cacheBase,
          "veryfront-mdx-esm",
          formatCacheVersionSegment("0.1.1030"),
          hashCodeHex(projectId),
          hashCodeHex(contentSourceId),
        );
        const cachedPath = join(oldVersionCacheDir, buildMdxEsmModuleFileName("oldversion"));

        await getLocalFs().mkdir(oldVersionCacheDir, { recursive: true });
        await writeTextFile(cachedPath, `export default "old-version";`);
        await writeTextFile(
          join(oldVersionCacheDir, "_index.json"),
          JSON.stringify({ [key]: cachedPath }),
        );
        const cache = await getModulePathCache(oldVersionCacheDir);
        verifiedModuleDeps.set(`${cachedPath}:${key}`, true);

        const invalidated = await invalidateMdxEsmModuleForCachedPath(
          cachedPath,
          filePath,
          projectDir,
          "19.1.1",
          getMdxEsmSsrCacheDirs(projectId, contentSourceId),
        );

        assertEquals(invalidated, true);
        assertEquals(cache.get(key), undefined);
        assertEquals(verifiedModuleDeps.get(`${cachedPath}:${key}`), undefined);

        await waitForDiskCleanup();
        clearModulePathCache();
        assertEquals((await getModulePathCache(oldVersionCacheDir)).get(key), undefined);
      });
    } finally {
      await Promise.all([
        remove(cacheBase, { recursive: true }).catch(() => {}),
        remove(projectDir, { recursive: true }).catch(() => {}),
      ]);
      clearModulePathCache();
    }
  });
});

describe("invalidateModulePaths — edge cases", () => {
  it("clears verifiedModuleDeps so stale entries can't bypass validation", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-verified-deps-" });
    const versionedKey = buildMdxEsmPathCacheKey("_vf_modules/components/EmptyState.js");
    const staleMjsPath = join(cacheDir, buildMdxEsmModuleFileName("verified1234"));
    const verifyKey = `${staleMjsPath}:${versionedKey}`;

    try {
      await writeTextFile(staleMjsPath, `export default "old";`);
      await writeTextFile(
        join(cacheDir, "_index.json"),
        JSON.stringify({ [versionedKey]: staleMjsPath }),
      );

      await getModulePathCache(cacheDir);

      // Simulate a previously verified module (lookupMdxEsmCache sets this)
      verifiedModuleDeps.set(verifyKey, true);
      assertEquals(verifiedModuleDeps.get(verifyKey), true, "precondition: verifiedModuleDeps set");

      // Invalidate
      invalidateModulePaths(["components/EmptyState.tsx"]);
      await waitForDiskCleanup();

      // verifiedModuleDeps must be cleared for this entry
      assertEquals(
        verifiedModuleDeps.get(verifyKey),
        undefined,
        "verifiedModuleDeps must be cleared — otherwise lookupMdxEsmCache would skip stat check on a deleted .mjs",
      );
    } finally {
      await remove(cacheDir, { recursive: true }).catch(() => {});
      clearModulePathCache();
    }
  });

  it("rapid sequential invalidations both complete disk cleanup", async () => {
    clearModulePathCache();

    const cacheDirA = await makeTempDir({ prefix: "vf-mdx-rapid-a-" });
    const cacheDirB = await makeTempDir({ prefix: "vf-mdx-rapid-b-" });
    const keyA = buildMdxEsmPathCacheKey("_vf_modules/components/Header.js");
    const keyB = buildMdxEsmPathCacheKey("_vf_modules/components/Footer.js");
    const mjsA = join(cacheDirA, buildMdxEsmModuleFileName("header"));
    const mjsB = join(cacheDirB, buildMdxEsmModuleFileName("footer"));

    try {
      // Set up two entries in two different cache dirs
      await writeTextFile(mjsA, `export default "Header";`);
      await writeTextFile(
        join(cacheDirA, "_index.json"),
        JSON.stringify({ [keyA]: mjsA }),
      );

      await writeTextFile(mjsB, `export default "Footer";`);
      await writeTextFile(
        join(cacheDirB, "_index.json"),
        JSON.stringify({ [keyB]: mjsB }),
      );

      await getModulePathCache(cacheDirA);
      await getModulePathCache(cacheDirB);

      // Fire two invalidations rapidly without awaiting between them
      invalidateModulePaths(["components/Header.tsx"]);
      invalidateModulePaths(["components/Footer.tsx"]);
      await waitForDiskCleanup();

      // Both .mjs files must be deleted
      assertEquals(await exists(mjsA), false, "Header .mjs must be deleted");
      assertEquals(await exists(mjsB), false, "Footer .mjs must be deleted");

      // Both _index.json files must be updated (empty after invalidation)
      clearModulePathCache();
      const reloadA = await getModulePathCache(cacheDirA);
      const reloadB = await getModulePathCache(cacheDirB);
      assertEquals(reloadA.get(keyA), undefined, "Header must not survive _index.json reload");
      assertEquals(reloadB.get(keyB), undefined, "Footer must not survive _index.json reload");
    } finally {
      await Promise.all([
        remove(cacheDirA, { recursive: true }).catch(() => {}),
        remove(cacheDirB, { recursive: true }).catch(() => {}),
      ]);
      clearModulePathCache();
    }
  });

  it("is a safe no-op when modulePathCaches is empty", () => {
    clearModulePathCache();
    // Must not throw
    invalidateModulePaths(["components/EmptyState.tsx"]);
    invalidateModulePaths([]);
  });

  it("only removes matching entries, leaving unrelated entries intact", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-selective-" });
    const emptyStateKey = buildMdxEsmPathCacheKey("_vf_modules/components/EmptyState.js");
    const headerKey = buildMdxEsmPathCacheKey("_vf_modules/components/Header.js");
    const emptyStateMjs = join(cacheDir, buildMdxEsmModuleFileName("empty"));
    const headerMjs = join(cacheDir, buildMdxEsmModuleFileName("header"));

    try {
      await writeTextFile(emptyStateMjs, `export default "EmptyState";`);
      await writeTextFile(headerMjs, `export default "Header";`);
      await writeTextFile(
        join(cacheDir, "_index.json"),
        JSON.stringify({
          [emptyStateKey]: emptyStateMjs,
          [headerKey]: headerMjs,
        }),
      );

      const cache = await getModulePathCache(cacheDir);
      assertEquals(cache.size, 2, "precondition: both entries loaded");

      // Invalidate only EmptyState
      invalidateModulePaths(["components/EmptyState.tsx"]);
      await waitForDiskCleanup();

      // EmptyState removed, Header untouched
      assertEquals(cache.get(emptyStateKey), undefined, "EmptyState must be removed");
      assertEquals(cache.get(headerKey), headerMjs, "Header must remain");
      assertEquals(await exists(emptyStateMjs), false, "EmptyState .mjs must be deleted");
      assertEquals(await exists(headerMjs), true, "Header .mjs must still exist");

      // Verify _index.json only has Header
      clearModulePathCache();
      const reloaded = await getModulePathCache(cacheDir);
      assertEquals(reloaded.get(emptyStateKey), undefined, "EmptyState gone from _index.json");
      assertEquals(reloaded.get(headerKey), headerMjs, "Header preserved in _index.json");
    } finally {
      await remove(cacheDir, { recursive: true }).catch(() => {});
      clearModulePathCache();
    }
  });

  it("does not false-match partial path segments (EmptyStateNew vs EmptyState)", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-no-false-" });
    const newKey = buildMdxEsmPathCacheKey("_vf_modules/components/EmptyStateNew.js");
    const newMjs = join(cacheDir, buildMdxEsmModuleFileName("new"));

    try {
      await writeTextFile(newMjs, `export default "EmptyStateNew";`);
      await writeTextFile(
        join(cacheDir, "_index.json"),
        JSON.stringify({ [newKey]: newMjs }),
      );

      const cache = await getModulePathCache(cacheDir);

      // Invalidate "EmptyState" — must NOT match "EmptyStateNew"
      invalidateModulePaths(["components/EmptyState.tsx"]);
      await waitForDiskCleanup();

      assertEquals(
        cache.get(newKey),
        newMjs,
        "EmptyStateNew must NOT be invalidated when EmptyState changes",
      );
      assertEquals(await exists(newMjs), true, "EmptyStateNew .mjs must still exist");
    } finally {
      await remove(cacheDir, { recursive: true }).catch(() => {});
      clearModulePathCache();
    }
  });

  it("matches changedPaths with leading slash", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-leadslash-" });
    const versionedKey = buildMdxEsmPathCacheKey("_vf_modules/components/EmptyState.js");
    const mjsPath = join(cacheDir, buildMdxEsmModuleFileName("slash"));

    try {
      await writeTextFile(mjsPath, `export default "test";`);
      await writeTextFile(
        join(cacheDir, "_index.json"),
        JSON.stringify({ [versionedKey]: mjsPath }),
      );

      const cache = await getModulePathCache(cacheDir);

      // Leading slash in changedPath (some APIs may include it)
      invalidateModulePaths(["/components/EmptyState.tsx"]);
      await waitForDiskCleanup();

      assertEquals(cache.get(versionedKey), undefined, "must match despite leading slash");
    } finally {
      await remove(cacheDir, { recursive: true }).catch(() => {});
      clearModulePathCache();
    }
  });

  it("matches all supported extensions: .ts .tsx .jsx .mdx .js", async () => {
    clearModulePathCache();

    const extensions = [".ts", ".tsx", ".jsx", ".mdx", ".js"];

    for (const ext of extensions) {
      const cacheDir = await makeTempDir({ prefix: `vf-mdx-ext-${ext.slice(1)}-` });
      const versionedKey = buildMdxEsmPathCacheKey("_vf_modules/utils/helper.js");
      const mjsPath = join(cacheDir, buildMdxEsmModuleFileName("ext"));

      try {
        await writeTextFile(mjsPath, `export default "test";`);
        await writeTextFile(
          join(cacheDir, "_index.json"),
          JSON.stringify({ [versionedKey]: mjsPath }),
        );

        await getModulePathCache(cacheDir);

        invalidateModulePaths([`utils/helper${ext}`]);
        await waitForDiskCleanup();

        clearModulePathCache();
        const reloaded = await getModulePathCache(cacheDir);
        assertEquals(
          reloaded.get(versionedKey),
          undefined,
          `must invalidate for extension ${ext}`,
        );
      } finally {
        await remove(cacheDir, { recursive: true }).catch(() => {});
        clearModulePathCache();
      }
    }
  });

  it("handles deeply nested paths", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-deep-" });
    const versionedKey = buildMdxEsmPathCacheKey("_vf_modules/lib/utils/formatting/date.js");
    const mjsPath = join(cacheDir, buildMdxEsmModuleFileName("deep"));

    try {
      await writeTextFile(mjsPath, `export default "date";`);
      await writeTextFile(
        join(cacheDir, "_index.json"),
        JSON.stringify({ [versionedKey]: mjsPath }),
      );

      await getModulePathCache(cacheDir);

      invalidateModulePaths(["lib/utils/formatting/date.tsx"]);
      await waitForDiskCleanup();

      clearModulePathCache();
      const reloaded = await getModulePathCache(cacheDir);
      assertEquals(reloaded.get(versionedKey), undefined, "deeply nested path must be invalidated");
      assertEquals(await exists(mjsPath), false, "deeply nested .mjs must be deleted");
    } finally {
      await remove(cacheDir, { recursive: true }).catch(() => {});
      clearModulePathCache();
    }
  });

  it("invalidates across multiple cache dirs (multi-project pods)", async () => {
    clearModulePathCache();

    const cacheDirA = await makeTempDir({ prefix: "vf-mdx-multi-a-" });
    const cacheDirB = await makeTempDir({ prefix: "vf-mdx-multi-b-" });
    const key = buildMdxEsmPathCacheKey("_vf_modules/components/EmptyState.js");
    const mjsA = join(cacheDirA, buildMdxEsmModuleFileName("a"));
    const mjsB = join(cacheDirB, buildMdxEsmModuleFileName("b"));

    try {
      await writeTextFile(mjsA, `export default "A";`);
      await writeTextFile(join(cacheDirA, "_index.json"), JSON.stringify({ [key]: mjsA }));
      await writeTextFile(mjsB, `export default "B";`);
      await writeTextFile(join(cacheDirB, "_index.json"), JSON.stringify({ [key]: mjsB }));

      const cacheA = await getModulePathCache(cacheDirA);
      const cacheB = await getModulePathCache(cacheDirB);

      invalidateModulePaths(["components/EmptyState.tsx"]);
      await waitForDiskCleanup();

      // Both cache dirs must be invalidated
      assertEquals(cacheA.get(key), undefined, "project A entry must be removed");
      assertEquals(cacheB.get(key), undefined, "project B entry must be removed");
      assertEquals(await exists(mjsA), false, "project A .mjs must be deleted");
      assertEquals(await exists(mjsB), false, "project B .mjs must be deleted");

      // Both _index.json files updated
      clearModulePathCache();
      assertEquals((await getModulePathCache(cacheDirA)).get(key), undefined, "A survives reload");
      clearModulePathCache();
      assertEquals((await getModulePathCache(cacheDirB)).get(key), undefined, "B survives reload");
    } finally {
      await Promise.all([
        remove(cacheDirA, { recursive: true }).catch(() => {}),
        remove(cacheDirB, { recursive: true }).catch(() => {}),
      ]);
      clearModulePathCache();
    }
  });

  it("full lifecycle: cache → invalidate → re-cache with new content → verify fresh", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-lifecycle-" });
    const normalizedPath = "_vf_modules/components/EmptyState.js";
    const oldCode =
      `import { jsx } from "react/jsx-runtime";\nexport default jsx("h1", { children: "Welcome to AI Chatbot" });`;
    const newCode =
      `import { jsx } from "react/jsx-runtime";\nexport default jsx("h1", { children: "Welcome to AI Chatbotd" });`;

    try {
      // Phase 1: Cache old content
      const pathCache = await getModulePathCache(cacheDir);
      const oldPath = await cacheModule(normalizedPath, oldCode, cacheDir, pathCache, log);
      assertEquals(oldPath !== null, true);

      // Verify _index.json has the entry
      clearModulePathCache();
      const loaded1 = await getModulePathCache(cacheDir);
      const versionedKey = buildMdxEsmPathCacheKey(normalizedPath);
      assertEquals(loaded1.get(versionedKey), oldPath, "phase 1: _index.json has old entry");

      // Phase 2: Invalidate (simulates poke)
      invalidateModulePaths(["components/EmptyState.tsx"]);
      await waitForDiskCleanup();

      // Verify disk is clean
      assertEquals(await exists(oldPath!), false, "phase 2: old .mjs deleted");
      clearModulePathCache();
      const loaded2 = await getModulePathCache(cacheDir);
      assertEquals(loaded2.get(versionedKey), undefined, "phase 2: _index.json clean");

      // Phase 3: Re-cache new content (simulates next request with fresh source)
      const newPath = await cacheModule(normalizedPath, newCode, cacheDir, loaded2, log);
      assertEquals(newPath !== null, true, "phase 3: new module cached");
      assertEquals(newPath !== oldPath, true, "phase 3: different .mjs (different content hash)");
      assertEquals(await exists(newPath!), true, "phase 3: new .mjs exists");

      // Verify _index.json has only the new entry
      clearModulePathCache();
      const loaded3 = await getModulePathCache(cacheDir);
      assertEquals(loaded3.get(versionedKey), newPath, "phase 3: _index.json has new entry");

      // Verify the new .mjs content is the fresh code
      const { readTextFile } = await import("#veryfront/compat/fs.ts");
      const newContent = await readTextFile(newPath!);
      assertEquals(
        newContent.includes("Chatbotd"),
        true,
        "phase 3: new .mjs contains updated content with trailing 'd'",
      );
    } finally {
      await remove(cacheDir, { recursive: true }).catch(() => {});
      clearModulePathCache();
    }
  });
});

describe("local cache root version-control hygiene", () => {
  // Regression: `veryfront dev` writes its ESM/bundle caches into
  // `<project>/.cache`. Projects that adopted Veryfront without scaffolding
  // (their .gitignore predates `veryfront init`) have no `.cache/` entry, so
  // the generated .mjs bundles showed up as untracked files and a `git add -A`
  // committed them. Server startup must leave the cache root ignoring itself.
  it("marks the local cache root as ignored on startup", async () => {
    const cacheBase = await makeTempDir({ prefix: "vf-cache-root-ignore-" });

    try {
      await runWithCacheDir(cacheBase, async () => {
        const cycleArtifactPath = join(
          getCycleManifestCacheDir(join(cacheBase, "veryfront-mdx-esm/project/source")),
          "0-stale/artifacts/0.deadbeef.js",
        );
        await getLocalFs().mkdir(join(cycleArtifactPath, ".."), { recursive: true });
        await writeTextFile(cycleArtifactPath, "export default 'stale-cycle';");
        await clearAllLocalCaches();
        assertEquals(await exists(cycleArtifactPath), false);
      });

      const ignorePath = join(cacheBase, ".gitignore");
      assertEquals(await exists(ignorePath), true);
      assertEquals(
        (await readTextFile(ignorePath)).split(/\r?\n/).includes("*"),
        true,
      );
    } finally {
      await remove(cacheBase, { recursive: true });
      clearModulePathCache();
    }
  });
});
