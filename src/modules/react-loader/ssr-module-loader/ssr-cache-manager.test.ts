import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { makeTempDir, readTextFile, remove } from "#veryfront/testing/deno-compat.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { tokenizeAllVeryFrontPaths } from "#veryfront/cache";
import { __injectCachesForTests } from "#veryfront/transforms/esm/transform-cache.ts";
import { buildMdxEsmModuleRecoveryCacheKey } from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";
import { SSRCacheManager } from "./ssr-cache-manager.ts";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";

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
    const vfmodDir = join(getMdxEsmCacheDir(), "project-a", "preview-main");
    const childPath = join(vfmodDir, "vfmod-child.mjs");

    try {
      __injectCachesForTests({ cacheBackend: distributedCache });

      await distributedCache.set(
        buildMdxEsmModuleRecoveryCacheKey("project-a", "preview-main", "vfmod-child.mjs"),
        tokenizeAllVeryFrontPaths(`export default "recovered";`),
      );

      const cacheManager = new SSRCacheManager({
        projectDir,
        projectId: "project-a",
        contentSourceId: "preview-main",
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

      assertEquals(isValid, true);
      assertEquals(await readTextFile(childPath), `export default "recovered";`);
    } finally {
      __injectCachesForTests(null);
      await remove(vfmodDir, { recursive: true }).catch(() => {});
      await remove(projectDir, { recursive: true });
    }
  });

  it("rejects redis cache entries with missing legacy .cache TSX imports", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-ssr-cache-manager-" });

    try {
      const cacheManager = new SSRCacheManager({
        projectDir,
        projectId: "project-a",
        contentSourceId: "preview-main",
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
});
