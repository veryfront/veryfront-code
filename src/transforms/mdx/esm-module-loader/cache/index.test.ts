import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import {
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
import { exists, remove, symlink, writeTextFile } from "#veryfront/compat/fs.ts";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { cacheModule } from "../module-fetcher/module-cache.ts";
import { rendererLogger as log } from "#veryfront/utils";
import { buildMdxEsmModuleFileName, buildMdxEsmPathCacheKey } from "../cache-format.ts";
import { getCacheStats } from "#veryfront/utils/memory/index.ts";
import { formatCacheVersionSegment } from "#veryfront/utils/cache-version.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";

describe("MDX module path cache", () => {
  it("atomically replaces the persisted module index", async () => {
    clearModulePathCache();
    const cacheDir = await makeTempDir({ prefix: "vf-mdx-index-atomic-" });
    const localFs = getLocalFs();
    const originalWriteTextFile = localFs.writeTextFile.bind(localFs);
    const originalRename = localFs.rename?.bind(localFs);
    if (!originalRename) throw new Error("Test filesystem must support rename");

    const cachedPath = join(cacheDir, buildMdxEsmModuleFileName("atomicindex"));
    const cacheKey = buildMdxEsmPathCacheKey("_vf_modules/atomic.js", "19.1.1");
    const cache = await getModulePathCache(cacheDir);
    cache.set(cacheKey, cachedPath);

    const writes: string[] = [];
    const renames: Array<[string, string]> = [];
    localFs.writeTextFile = async (path, data) => {
      writes.push(path);
      await originalWriteTextFile(path, data);
    };
    localFs.rename = async (from, to) => {
      renames.push([from, to]);
      await originalRename(from, to);
    };

    try {
      await saveModulePathCache(cacheDir);

      const indexPath = join(cacheDir, "_index.json");
      const temporaryWrite = writes.find((path) => path.startsWith(`${indexPath}.tmp-`));
      assertEquals(typeof temporaryWrite, "string");
      assertEquals(renames, [[temporaryWrite!, indexPath]]);
      assertEquals(JSON.parse(await localFs.readTextFile(indexPath)), {
        [cacheKey]: cachedPath,
      });
    } finally {
      localFs.writeTextFile = originalWriteTextFile;
      localFs.rename = originalRename;
      clearModulePathCache();
      await remove(cacheDir, { recursive: true }).catch(() => {});
    }
  });

  it("serializes index replacement so an older snapshot cannot win", async () => {
    clearModulePathCache();
    const cacheDir = await makeTempDir({ prefix: "vf-mdx-index-order-" });
    const localFs = getLocalFs();
    const originalRename = localFs.rename?.bind(localFs);
    if (!originalRename) throw new Error("Test filesystem must support rename");

    const firstPath = join(cacheDir, buildMdxEsmModuleFileName("first"));
    const secondPath = join(cacheDir, buildMdxEsmModuleFileName("second"));
    const firstKey = buildMdxEsmPathCacheKey("_vf_modules/first.js", "19.1.1");
    const secondKey = buildMdxEsmPathCacheKey("_vf_modules/second.js", "19.1.1");
    const cache = await getModulePathCache(cacheDir);
    cache.set(firstKey, firstPath);

    let releaseFirstRename!: () => void;
    const firstRenameGate = new Promise<void>((resolve) => {
      releaseFirstRename = resolve;
    });
    let signalFirstRename!: () => void;
    const firstRenameStarted = new Promise<void>((resolve) => {
      signalFirstRename = resolve;
    });
    let renameCount = 0;
    localFs.rename = async (from, to) => {
      renameCount++;
      if (renameCount === 1) {
        signalFirstRename();
        await firstRenameGate;
      }
      await originalRename(from, to);
    };

    try {
      const firstSave = saveModulePathCache(cacheDir);
      await firstRenameStarted;
      cache.set(secondKey, secondPath);
      const secondSave = saveModulePathCache(cacheDir);
      releaseFirstRename();
      await Promise.all([firstSave, secondSave]);

      assertEquals(JSON.parse(await localFs.readTextFile(join(cacheDir, "_index.json"))), {
        [firstKey]: firstPath,
        [secondKey]: secondPath,
      });
      assertEquals(renameCount, 2);
    } finally {
      releaseFirstRename();
      localFs.rename = originalRename;
      clearModulePathCache();
      await remove(cacheDir, { recursive: true }).catch(() => {});
    }
  });

  it("partitions SSR cache directories by runtime version", async () => {
    const cacheBase = await makeTempDir({ prefix: "vf-mdx-versioned-cache-dir-" });
    const projectId = "project-versioned-cache";
    const contentSourceId = "preview-main";

    try {
      await runWithCacheDir(cacheBase, () => {
        const projectKey = hashCodeHex(projectId);
        const sourceKey = hashCodeHex(contentSourceId);
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
            join(cacheBase, "veryfront-mdx-esm", projectKey, sourceKey),
            join(cacheBase, "veryfront-mdx-esm", projectKey, contentSourceId),
          ],
        );
      });
    } finally {
      await remove(cacheBase, { recursive: true });
    }
  });

  it("keeps legacy raw namespace cleanup inside its hashed project directory", async () => {
    clearModulePathCache();

    const cacheBase = await makeTempDir({ prefix: "vf-mdx-raw-cache-containment-" });
    const projectId = "project-cache-containment";
    const contentSourceId = "../../raw-outside";
    const outsideDir = join(cacheBase, "raw-outside");
    const sentinelPath = join(outsideDir, "sentinel.txt");

    try {
      await getLocalFs().mkdir(outsideDir, { recursive: true });
      await writeTextFile(sentinelPath, "keep");

      await runWithCacheDir(cacheBase, async () => {
        await clearMdxEsmCacheNamespace(projectId, contentSourceId);

        assertEquals(await exists(sentinelPath), true);
        assertEquals(
          getMdxEsmSsrCacheDirs(projectId, contentSourceId).includes(outsideDir),
          false,
        );
      });
    } finally {
      await remove(cacheBase, { recursive: true });
      clearModulePathCache();
    }
  });

  it("keeps legacy encoded namespace cleanup inside the MDX cache root", async () => {
    clearModulePathCache();

    const cacheBase = await makeTempDir({ prefix: "vf-mdx-encoded-cache-containment-" });
    const outsideDir = join(cacheBase, "encoded-outside");
    const sentinelPath = join(outsideDir, "sentinel.txt");

    try {
      await getLocalFs().mkdir(outsideDir, { recursive: true });
      await writeTextFile(sentinelPath, "keep");

      await runWithCacheDir(cacheBase, async () => {
        await clearMdxEsmCacheNamespace("..", "encoded-outside");

        assertEquals(await exists(sentinelPath), true);
      });
    } finally {
      await remove(cacheBase, { recursive: true });
      clearModulePathCache();
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

        await getLocalFs().mkdir(cacheDir, { recursive: true });
        await getLocalFs().mkdir(ssrCacheDir, { recursive: true });
        await writeTextFile(cachedPath, "export default function Stale() {}");
        await writeTextFile(ssrCachedPath, "export default function StaleSSR() {}");

        const cache = await getModulePathCache(cacheDir);
        cache.set(cacheKey, cachedPath);
        const ssrCache = await getModulePathCache(ssrCacheDir);
        ssrCache.set(cacheKey, ssrCachedPath);
        verifiedModuleDeps.set(`${cachedPath}:${cacheKey}`, true);
        verifiedModuleDeps.set(`${ssrCachedPath}:${cacheKey}`, true);

        await clearMdxEsmCacheNamespace(projectId, contentSourceId);

        assertEquals(await exists(cachedPath), false);
        assertEquals(await exists(ssrCachedPath), false);
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

        await getLocalFs().mkdir(legacyParentDir, { recursive: true });
        await getLocalFs().mkdir(legacyChildDir, { recursive: true });
        await getLocalFs().mkdir(currentChildDir, { recursive: true });
        await writeTextFile(legacyParentPath, "export default 'legacy-parent';");
        await writeTextFile(legacyChildPath, "export default 'legacy-child';");
        await writeTextFile(currentChildPath, "export default 'current-child';");

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
        JSON.stringify({ "_vf_modules/pages/index.js": join(cacheDirA, "a.mjs") }),
      );
      await writeTextFile(
        join(cacheDirB, "_index.json"),
        JSON.stringify({ "_vf_modules/pages/index.js": join(cacheDirB, "b.mjs") }),
      );

      const cacheA = await getModulePathCache(cacheDirA);
      const cacheB = await getModulePathCache(cacheDirB);

      assertEquals(cacheA.get("_vf_modules/pages/index.js"), join(cacheDirA, "a.mjs"));
      assertEquals(cacheB.get("_vf_modules/pages/index.js"), join(cacheDirB, "b.mjs"));

      cacheA.set("_vf_modules/pages/about.js", join(cacheDirA, "a-about.mjs"));
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

  it("ignores module indexes that point outside the cache directory", async () => {
    clearModulePathCache();
    const cacheDir = await makeTempDir({ prefix: "vf-mdx-cache-index-scope-" });
    const externalDir = await makeTempDir({ prefix: "vf-mdx-cache-external-" });
    const externalPath = join(externalDir, "external.mjs");
    const key = buildMdxEsmPathCacheKey("_vf_modules/pages/index.js");

    try {
      await writeTextFile(externalPath, "export const secret = true;");
      await writeTextFile(join(cacheDir, "_index.json"), JSON.stringify({ [key]: externalPath }));

      const cache = await getModulePathCache(cacheDir);

      assertEquals(cache.size, 0);
      assertEquals(await exists(externalPath), true);
    } finally {
      await Promise.all([
        remove(cacheDir, { recursive: true }),
        remove(externalDir, { recursive: true }),
      ]);
      clearModulePathCache();
    }
  });

  it("rejects cached module symlinks that escape the cache directory", async () => {
    clearModulePathCache();
    const cacheDir = await makeTempDir({ prefix: "vf-mdx-cache-symlink-scope-" });
    const externalDir = await makeTempDir({ prefix: "vf-mdx-cache-symlink-external-" });
    const externalPath = join(externalDir, "external.mjs");
    const linkedPath = join(cacheDir, "linked.mjs");
    const sourcePath = join(cacheDir, "page.tsx");
    const key = buildMdxEsmPathCacheKey("_vf_modules/page.js");

    try {
      await writeTextFile(externalPath, "export const secret = true;");
      await symlink(externalPath, linkedPath);
      await writeTextFile(join(cacheDir, "_index.json"), JSON.stringify({ [key]: linkedPath }));

      const result = await lookupMdxEsmCache(sourcePath, cacheDir, cacheDir);

      assertEquals(result.status, "corrupted");
      assertEquals(await exists(externalPath), true);
    } finally {
      await waitForDiskCleanup();
      await Promise.all([
        remove(cacheDir, { recursive: true }),
        remove(externalDir, { recursive: true }),
      ]);
      clearModulePathCache();
    }
  });

  it("bounds the number of resident cache directories", async () => {
    clearModulePathCache();
    const cacheBase = await makeTempDir({ prefix: "vf-mdx-cache-dir-bound-" });

    try {
      for (let index = 0; index < 140; index++) {
        await getModulePathCache(join(cacheBase, String(index)));
      }

      const stats = getCacheStats();
      const pathCacheStats = stats.find((entry) => entry.name === "mdx-esm-path-caches") as
        | { cacheDirs?: number }
        | undefined;
      assertEquals(pathCacheStats?.cacheDirs, 128);
    } finally {
      await remove(cacheBase, { recursive: true });
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
        JSON.stringify({
          [buildMdxEsmPathCacheKey("_vf_modules/pages/a.js")]: join(cacheDirA, "a.mjs"),
        }),
      );
      await writeTextFile(
        join(cacheDirB, "_index.json"),
        JSON.stringify({
          [buildMdxEsmPathCacheKey("_vf_modules/pages/b.js")]: join(cacheDirB, "b.mjs"),
        }),
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
          const metadata = entry.metadata[0] as
            | { sourceFile?: unknown; cacheFile?: unknown; errorName?: unknown }
            | undefined;
          return entry.message.includes("Stale cached module cleanup failed") &&
            metadata?.sourceFile === "page.tsx" &&
            metadata.cacheFile === buildMdxEsmModuleFileName("unresolved") &&
            metadata.errorName === "Error";
        }),
        true,
        "failed stale-file cleanup should be observable",
      );
      assertEquals(
        JSON.stringify(debugEntries).includes("remove denied"),
        false,
        "failed stale-file cleanup should not expose the raw backend error",
      );
      assertEquals(
        JSON.stringify(debugEntries).includes(projectDir),
        false,
        "failed stale-file cleanup should not expose local paths",
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
      index[buildMdxEsmPathCacheKey(`_vf_modules/pages/${i}.js`)] = join(cacheDir, `${i}.mjs`);
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
      assertEquals(
        cache.get(buildMdxEsmPathCacheKey("_vf_modules/pages/500.js")),
        join(cacheDir, "500.mjs"),
      );
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
