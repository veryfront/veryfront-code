import "#veryfront/schemas/_test-setup.ts";

// Relocated from the colocated unit test: asserting that an invalid cached
// module is unlinked requires reading the filesystem back, which the unit
// boundary does not allow.

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { rendererLogger } from "#veryfront/utils";
import { makeTempDir, remove, stat, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { readValidCachedModulePath } from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/path-cache-lookup.ts";

async function withTempCache<T>(
  test: (fixture: { cacheDir: string }) => Promise<T>,
): Promise<T> {
  const cacheDir = await makeTempDir({ prefix: "vf-path-cache-lookup-" });
  try {
    return await test({ cacheDir });
  } finally {
    await remove(cacheDir, { recursive: true }).catch(() => undefined);
  }
}

describe("module-fetcher/path-cache-lookup eviction", () => {
  it("returns null and drops the entry when the cached file fails validation", async () => {
    await withTempCache(async ({ cacheDir }) => {
      const cachedPath = join(cacheDir, "module.mjs");
      // Raw HTTP imports are rejected by validateCachedModule.
      await writeTextFile(
        cachedPath,
        'import { value } from "https://esm.sh/some-package";\nexport default value;\n',
      );
      const pathCache = new Map([["cache-key", cachedPath]]);

      const result = await readValidCachedModulePath({
        normalizedPath: "_vf_modules/page.js",
        pathCache,
        versionedKey: "cache-key",
        log: rendererLogger.component("path-cache-lookup-test"),
      });

      assertEquals(result, null, "a cached module that fails validation must not be served");
      assertEquals(
        pathCache.has("cache-key"),
        false,
        "the invalid path-cache entry must be deleted",
      );
      assertEquals(
        await stat(cachedPath).then(() => true).catch(() => false),
        false,
        "the invalid cached file must be removed from disk",
      );
    });
  });
});
