import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { rendererLogger } from "#veryfront/utils";
import {
  clearAllManifests,
  getRouteManifest,
} from "#veryfront/modules/manifest/route-module-manifest.ts";
import { readValidCachedModulePath } from "./path-cache-lookup.ts";
import { endRenderSession, runInRenderSession, startRenderSession } from "./render-sessions.ts";

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

  it("records the module to the active render session on a path-cache hit", async () => {
    await withTempCache(async ({ cacheDir }) => {
      const cachedPath = join(cacheDir, "module.mjs");
      await Deno.writeTextFile(cachedPath, "export const value = 1;\n");
      const pathCache = new Map([["cache-key", cachedPath]]);

      clearAllManifests();
      try {
        startRenderSession("path-cache-lookup-session", "proj", "/page");
        const result = await runInRenderSession(
          "path-cache-lookup-session",
          () =>
            readValidCachedModulePath({
              normalizedPath: "_vf_modules/page.js",
              pathCache,
              versionedKey: "cache-key",
              log: rendererLogger.component("path-cache-lookup-test"),
            }),
        );
        endRenderSession("path-cache-lookup-session");

        assertEquals(result, cachedPath, "the valid cached path is still returned");
        assertEquals(
          getRouteManifest("proj", "/page")?.modules.map((entry) => entry.path),
          ["page.js"],
          "a path-cache hit must still record the module to the render session",
        );
      } finally {
        clearAllManifests();
      }
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
