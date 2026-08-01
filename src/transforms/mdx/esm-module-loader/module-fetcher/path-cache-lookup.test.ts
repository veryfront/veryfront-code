import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { rendererLogger } from "#veryfront/utils";
import { getLocalFs } from "../cache/index.ts";
import { readValidCachedModulePath } from "./path-cache-lookup.ts";
import { buildMdxEsmModuleFileName, buildMdxEsmPathCacheKey } from "../cache-format.ts";

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

function nonCanonicalNotFoundFailures(): ReadonlyArray<readonly [string, unknown]> {
  return [
    ["a plain ENOENT-shaped rejection", Object.freeze({ code: "ENOENT" })],
    [
      "a native Error with a plain ENOENT-shaped cause",
      new Error("wrapped cached artifact failure", {
        cause: Object.freeze({ code: "ENOENT" }),
      }),
    ],
  ];
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

  for (const [label, failure] of nonCanonicalNotFoundFailures()) {
    it(`propagates ${label} from cached-artifact stat without deleting the path-cache entry`, async () => {
      await withTempCache(async ({ cacheDir }) => {
        const cachedPath = join(cacheDir, buildMdxEsmModuleFileName("e".repeat(64)));
        await Deno.writeTextFile(cachedPath, "export const value = 1;\n");
        const versionedKey = buildMdxEsmPathCacheKey("_vf_modules/untrusted-missing-shape.js");
        const pathCache = new Map([[versionedKey, cachedPath]]);
        const localFs = getLocalFs();
        const originalStat = localFs.stat.bind(localFs);
        let statCalls = 0;

        try {
          localFs.stat = (path: string) => {
            if (path !== cachedPath) return originalStat(path);
            statCalls++;
            return Promise.reject(failure);
          };

          const error = await assertRejects(() =>
            readValidCachedModulePath({
              normalizedPath: "_vf_modules/untrusted-missing-shape.js",
              cacheDir,
              pathCache,
              versionedKey,
              log: rendererLogger.component("path-cache-lookup-test"),
            })
          );

          assertStrictEquals(error, failure);
          assertEquals(statCalls, 1);
          assertEquals(pathCache.get(versionedKey), cachedPath);
        } finally {
          localFs.stat = originalStat;
        }
      });
    });
  }

  it("propagates cached-artifact stat failures without deleting the path-cache entry", async () => {
    await withTempCache(async ({ cacheDir }) => {
      const cachedPath = join(cacheDir, buildMdxEsmModuleFileName("c".repeat(64)));
      await Deno.writeTextFile(cachedPath, "export const value = 1;\n");
      const versionedKey = buildMdxEsmPathCacheKey("_vf_modules/stat-error.js");
      const pathCache = new Map([[versionedKey, cachedPath]]);
      const localFs = getLocalFs();
      const originalStat = localFs.stat.bind(localFs);
      const permissionError = Object.assign(new Error("cached artifact stat denied"), {
        code: "EACCES",
      });

      try {
        localFs.stat = (path: string) =>
          path === cachedPath ? Promise.reject(permissionError) : originalStat(path);

        const error = await assertRejects(() =>
          readValidCachedModulePath({
            normalizedPath: "_vf_modules/stat-error.js",
            cacheDir,
            pathCache,
            versionedKey,
            log: rendererLogger.component("path-cache-lookup-test"),
          })
        );

        assertStrictEquals(error, permissionError);
        assertEquals(pathCache.get(versionedKey), cachedPath);
      } finally {
        localFs.stat = originalStat;
      }
    });
  });

  it("propagates cached-artifact read failures without deleting the path-cache entry", async () => {
    await withTempCache(async ({ cacheDir }) => {
      const cachedPath = join(cacheDir, buildMdxEsmModuleFileName("d".repeat(64)));
      await Deno.writeTextFile(cachedPath, "export const value = 1;\n");
      const versionedKey = buildMdxEsmPathCacheKey("_vf_modules/read-error.js");
      const pathCache = new Map([[versionedKey, cachedPath]]);
      const localFs = getLocalFs();
      const originalReadTextFile = localFs.readTextFile.bind(localFs);
      const ioError = Object.assign(new Error("cached artifact read failed"), { code: "EIO" });

      try {
        localFs.readTextFile = (path: string) =>
          path === cachedPath ? Promise.reject(ioError) : originalReadTextFile(path);

        const error = await assertRejects(() =>
          readValidCachedModulePath({
            normalizedPath: "_vf_modules/read-error.js",
            cacheDir,
            pathCache,
            versionedKey,
            log: rendererLogger.component("path-cache-lookup-test"),
          })
        );

        assertStrictEquals(error, ioError);
        assertEquals(pathCache.get(versionedKey), cachedPath);
      } finally {
        localFs.readTextFile = originalReadTextFile;
      }
    });
  });
});
