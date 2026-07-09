import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import {
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { tokenizeAllVeryFrontPaths } from "#veryfront/cache";
import { __injectCachesForTests } from "#veryfront/transforms/esm/transform-cache.ts";
import { buildMdxEsmModuleRecoveryCacheKey } from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";
import { SSRCacheManager } from "./ssr-cache-manager.ts";
import { getMdxEsmSsrCacheDir } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";

class FakeDistributedCache implements CacheBackend {
  readonly type = "redis" as const;
  private values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

describe("SSRCacheManager", { sanitizeResources: false, sanitizeOps: false }, () => {
  it("recovers missing vfmod dependencies for redis cache entries", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-ssr-cache-manager-" });
    const distributedCache = new FakeDistributedCache();
    const projectId = `project-${crypto.randomUUID()}`;
    const contentSourceId = `preview-${crypto.randomUUID()}`;
    const vfmodDir = getMdxEsmSsrCacheDir(projectId, contentSourceId);
    const childPath = join(vfmodDir, "vfmod-child.mjs");
    const stablePath = join(projectDir, "stable.mjs");

    try {
      __injectCachesForTests({ cacheBackend: distributedCache });
      await writeTextFile(stablePath, `export default "stable";`);

      await distributedCache.set(
        buildMdxEsmModuleRecoveryCacheKey(projectId, contentSourceId, "vfmod-child.mjs"),
        tokenizeAllVeryFrontPaths(`export default "recovered";`),
      );

      const cacheManager = new SSRCacheManager({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const statCounts = new Map<string, number>();
      const fs = cacheManager.getFs();
      const originalStat = fs.stat.bind(fs);
      fs.stat = async (path) => {
        statCounts.set(path, (statCounts.get(path) ?? 0) + 1);
        return await originalStat(path);
      };

      const isValid = await cacheManager.validateCachedCode(
        [
          `import stable from "file://${stablePath}";`,
          `import child from "file://${childPath}";`,
          `export default [stable, child];`,
        ].join("\n"),
        join(projectDir, "pages", "index.tsx"),
        "redis-cache",
        {
          checkLocalPaths: true,
          checkInvalidEsmShPath: true,
        },
      );

      assertEquals(isValid, true);
      assertEquals(await readTextFile(childPath), `export default "recovered";`);
      assertEquals(statCounts.get(stablePath), 1);
      assertEquals(statCounts.get(childPath), 2);
    } finally {
      __injectCachesForTests(null);
      await remove(vfmodDir, { recursive: true }).catch(() => {});
      await remove(projectDir, { recursive: true });
    }
  });

  it("rejects redis cache entries with missing legacy .cache TSX imports", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-ssr-cache-manager-" });
    const projectId = `project-${crypto.randomUUID()}`;
    const contentSourceId = `preview-${crypto.randomUUID()}`;

    try {
      const cacheManager = new SSRCacheManager({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const isValid = await cacheManager.validateCachedCode(
        `import child from "file:///app/.cache/markdown.tsx"; export default child;`,
        join(projectDir, "pages", "index.tsx"),
        "redis-cache",
        {
          checkLocalPaths: true,
          checkInvalidEsmShPath: true,
        },
      );

      assertEquals(isValid, false);
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("rejects redis cache entries with nested legacy .cache TSX imports inside vfmods", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-ssr-cache-manager-" });
    const projectId = `project-${crypto.randomUUID()}`;
    const contentSourceId = `preview-${crypto.randomUUID()}`;
    const vfmodDir = getMdxEsmSsrCacheDir(projectId, contentSourceId);
    const childPath = join(vfmodDir, "vfmod-child.mjs");

    try {
      await mkdir(vfmodDir, { recursive: true });
      await writeTextFile(
        childPath,
        `import child from "file:///app/.cache/markdown.tsx"; export default child;`,
      );

      const cacheManager = new SSRCacheManager({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const isValid = await cacheManager.validateCachedCode(
        `import child from "file://${childPath}"; export default child;`,
        join(projectDir, "pages", "index.tsx"),
        "redis-cache",
        {
          checkLocalPaths: true,
          checkInvalidEsmShPath: true,
        },
      );

      assertEquals(isValid, false);
    } finally {
      await remove(vfmodDir, { recursive: true }).catch(() => {});
      await remove(projectDir, { recursive: true });
    }
  });

  it("rejects only real unresolved _vf_modules imports", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-ssr-cache-manager-" });
    const cacheManager = new SSRCacheManager({
      projectDir,
      projectId: `project-${crypto.randomUUID()}`,
      contentSourceId: `preview-${crypto.randomUUID()}`,
      adapter: denoAdapter,
      dev: true,
    });

    try {
      const importLookingTextIsValid = await cacheManager.validateCachedCode(
        [
          `const text = 'from "/_vf_modules/react@18.3.1/some-module.js"';`,
          `// import x from "/_vf_modules/commented.js";`,
          `export default text;`,
        ].join("\n"),
        join(projectDir, "pages", "index.tsx"),
        "redis-cache",
        {
          checkLocalPaths: false,
          checkInvalidEsmShPath: true,
        },
      );

      assertEquals(importLookingTextIsValid, true);

      const realImportIsInvalid = await cacheManager.validateCachedCode(
        [
          `import x from "/_vf_modules/react@18.3.1/some-module.js";`,
          `export default x;`,
        ].join("\n"),
        join(projectDir, "pages", "index.tsx"),
        "redis-cache",
        {
          checkLocalPaths: false,
          checkInvalidEsmShPath: true,
        },
      );

      assertEquals(realImportIsInvalid, false);
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });
});
