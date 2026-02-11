import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import {
  clearModulePathCache,
  getModulePathCache,
  invalidateModulePaths,
  saveModulePathCache,
  verifiedModuleDeps,
  waitForDiskCleanup,
} from "./index.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { exists, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { cacheModule } from "../module-fetcher/module-cache.ts";
import { rendererLogger as log } from "#veryfront/utils";

describe("MDX module path cache", () => {
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
});

describe("invalidateModulePaths — disk persistence", () => {
  it("persists invalidation to _index.json so stale entries don't survive reload", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-invalidate-" });
    const versionedKey = `v${VERSION}:_vf_modules/components/EmptyState.js`;
    const staleMjsPath = join(cacheDir, `vfmod-v${VERSION}-stale1234.mjs`);

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
    const versionedKey = `v${VERSION}:_vf_modules/components/EmptyState.js`;
    const staleMjsPath = join(cacheDir, `vfmod-v${VERSION}-stale5678.mjs`);

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

describe("invalidateModulePaths — edge cases", () => {
  it("clears verifiedModuleDeps so stale entries can't bypass validation", async () => {
    clearModulePathCache();

    const cacheDir = await makeTempDir({ prefix: "vf-mdx-verified-deps-" });
    const versionedKey = `v${VERSION}:_vf_modules/components/EmptyState.js`;
    const staleMjsPath = join(cacheDir, `vfmod-v${VERSION}-verified1234.mjs`);
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
    const keyA = `v${VERSION}:_vf_modules/components/Header.js`;
    const keyB = `v${VERSION}:_vf_modules/components/Footer.js`;
    const mjsA = join(cacheDirA, `vfmod-v${VERSION}-header.mjs`);
    const mjsB = join(cacheDirB, `vfmod-v${VERSION}-footer.mjs`);

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
    const emptyStateKey = `v${VERSION}:_vf_modules/components/EmptyState.js`;
    const headerKey = `v${VERSION}:_vf_modules/components/Header.js`;
    const emptyStateMjs = join(cacheDir, `vfmod-v${VERSION}-empty.mjs`);
    const headerMjs = join(cacheDir, `vfmod-v${VERSION}-header.mjs`);

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
    const newKey = `v${VERSION}:_vf_modules/components/EmptyStateNew.js`;
    const newMjs = join(cacheDir, `vfmod-v${VERSION}-new.mjs`);

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
    const versionedKey = `v${VERSION}:_vf_modules/components/EmptyState.js`;
    const mjsPath = join(cacheDir, `vfmod-v${VERSION}-slash.mjs`);

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
      const versionedKey = `v${VERSION}:_vf_modules/utils/helper.js`;
      const mjsPath = join(cacheDir, `vfmod-v${VERSION}-ext.mjs`);

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
    const versionedKey = `v${VERSION}:_vf_modules/lib/utils/formatting/date.js`;
    const mjsPath = join(cacheDir, `vfmod-v${VERSION}-deep.mjs`);

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
    const key = `v${VERSION}:_vf_modules/components/EmptyState.js`;
    const mjsA = join(cacheDirA, `vfmod-v${VERSION}-a.mjs`);
    const mjsB = join(cacheDirB, `vfmod-v${VERSION}-b.mjs`);

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
      const versionedKey = `v${VERSION}:${normalizedPath}`;
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
