import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { rendererLogger } from "#veryfront/utils";
import { readValidCachedModulePath } from "./path-cache-lookup.ts";
import {
  buildMdxEsmModuleFileName,
  buildMdxEsmPathCacheKey,
} from "../cache-format.ts";

async function withTempCache<T>(
  test: (fixture: { cacheDir: string }) => Promise<T>,
): Promise<T> {
  const cacheDir = await Deno.makeTempDir({ prefix: "vf-path-cache-lookup-" });
  try {
    return await test({ cacheDir });
  } finally {
    await Deno.remove(cacheDir, { recursive: true }).catch(() => undefined);
  }
}

describe("module-fetcher/path-cache-lookup", () => {
  it("returns the cached path when the path-cache entry points at a valid cached file", async () => {
    await withTempCache(async ({ cacheDir }) => {
      const cachedPath = join(cacheDir, buildMdxEsmModuleFileName("a".repeat(64)));
      await Deno.writeTextFile(cachedPath, "export const value = 1;\n");
      const versionedKey = buildMdxEsmPathCacheKey("_vf_modules/page.js");
      const pathCache = new Map([[versionedKey, cachedPath]]);

      const result = await readValidCachedModulePath({
        normalizedPath: "_vf_modules/page.js",
        cacheDir,
        pathCache,
        versionedKey,
        log: rendererLogger.component("path-cache-lookup-test"),
      });

      assertEquals(result, cachedPath);
      assertEquals(pathCache.get(versionedKey), cachedPath);
    });
  });

  it("deletes stale path-cache entries when the cached file is missing", async () => {
    await withTempCache(async ({ cacheDir }) => {
      const versionedKey = buildMdxEsmPathCacheKey("_vf_modules/missing.js");
      const missingPath = join(cacheDir, buildMdxEsmModuleFileName("b".repeat(64)));
      const pathCache = new Map([[versionedKey, missingPath]]);

      const result = await readValidCachedModulePath({
        normalizedPath: "_vf_modules/missing.js",
        cacheDir,
        pathCache,
        versionedKey,
        log: rendererLogger.component("path-cache-lookup-test"),
      });

      assertEquals(result, null);
      assertEquals(pathCache.has(versionedKey), false);
    });
  });
});
