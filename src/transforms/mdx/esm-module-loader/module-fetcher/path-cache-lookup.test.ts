import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { rendererLogger } from "#veryfront/utils";
import { readValidCachedModulePath } from "./path-cache-lookup.ts";

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
      const cachedPath = join(cacheDir, "module.mjs");
      await Deno.writeTextFile(cachedPath, "export const value = 1;\n");
      const pathCache = new Map([["cache-key", cachedPath]]);

      const result = await readValidCachedModulePath({
        normalizedPath: "_vf_modules/page.js",
        pathCache,
        versionedKey: "cache-key",
        log: rendererLogger.component("path-cache-lookup-test"),
      });

      assertEquals(result, cachedPath);
      assertEquals(pathCache.get("cache-key"), cachedPath);
    });
  });

  it("deletes stale path-cache entries when the cached file is missing", async () => {
    const pathCache = new Map([["cache-key", "/tmp/veryfront-missing-module.mjs"]]);

    const result = await readValidCachedModulePath({
      normalizedPath: "_vf_modules/missing.js",
      pathCache,
      versionedKey: "cache-key",
      log: rendererLogger.component("path-cache-lookup-test"),
    });

    assertEquals(result, null);
    assertEquals(pathCache.has("cache-key"), false);
  });
});
