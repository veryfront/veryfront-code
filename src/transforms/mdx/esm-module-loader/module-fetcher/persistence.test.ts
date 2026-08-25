import "#veryfront/schemas/_test-setup.ts";
import type { CacheBackend } from "#veryfront/cache/backend.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { persistResolvedModule } from "./persistence.ts";

const noopLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  time: (_label, fn) => fn(),
  child: () => noopLog,
  component: () => noopLog,
};

describe("module-fetcher/persistence", () => {
  it("writes distributed cache before local cache and returns the local cache path", async () => {
    const calls: string[] = [];
    const pathCache = new Map<string, string>();
    const distributedCache: CacheBackend = {
      type: "memory",
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      del: () => Promise.resolve(),
    };

    const result = await persistResolvedModule({
      normalizedPath: "_vf_modules/app/page.js",
      moduleCode: "export default 1;",
      esmCacheDir: "/cache",
      pathCache,
      log: noopLog,
      projectSlug: "docs",
      reactVersion: "19.1.1",
      dependencyPinningCacheKey: "on:pins",
      moduleServerOrigin: "http://mods.test:3000",
      serverExternalPackages: ["sharp"],
      dev: true,
      distributedCacheWrite: {
        distributedCache,
        transformCacheKey: "transform-key",
        projectId: "project-1",
        contentSourceId: "preview-main",
      },
      writeToDistributedCache: (
        receivedCache,
        transformCacheKey,
        projectId,
        contentSourceId,
        moduleCode,
        normalizedPath,
      ) => {
        calls.push("distributed");
        assertEquals(receivedCache, distributedCache);
        assertEquals(transformCacheKey, "transform-key");
        assertEquals(projectId, "project-1");
        assertEquals(contentSourceId, "preview-main");
        assertEquals(moduleCode, "export default 1;");
        assertEquals(normalizedPath, "_vf_modules/app/page.js");
      },
      cacheLocalModule: (
        normalizedPath,
        moduleCode,
        esmCacheDir,
        receivedPathCache,
        _log,
        reactVersion,
        dependencyPinningCacheKey,
        moduleServerOrigin,
        serverExternalPackages,
        dev,
      ) => {
        calls.push("local");
        assertEquals(normalizedPath, "_vf_modules/app/page.js");
        assertEquals(moduleCode, "export default 1;");
        assertEquals(esmCacheDir, "/cache");
        assertEquals(receivedPathCache, pathCache);
        assertEquals(reactVersion, "19.1.1");
        assertEquals(dependencyPinningCacheKey, "on:pins");
        assertEquals(
          moduleServerOrigin,
          "http://mods.test:3000",
          "forwards the module server origin into the local cache identity",
        );
        assertEquals(serverExternalPackages, ["sharp"], "forwards server-external packages");
        assertEquals(
          dev,
          true,
          "forwards the compile mode so dev and prod do not share a cache entry",
        );
        return Promise.resolve("/cache/page.mjs");
      },
    });

    assertEquals(calls, ["distributed", "local"]);
    assertEquals(result, "/cache/page.mjs");
  });

  it("caches the module code with the filename-derived default export appended", async () => {
    const distributedCache: CacheBackend = {
      type: "memory",
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      del: () => Promise.resolve(),
    };
    const expectedCode = "export function Button() {}\nexport { Button as default };\n";
    let distributedCode: string | null = null;
    let localCode: string | null = null;

    await persistResolvedModule({
      normalizedPath: "_vf_modules/components/Button.js",
      moduleCode: "export function Button() {}",
      esmCacheDir: "/cache",
      pathCache: new Map<string, string>(),
      log: noopLog,
      projectSlug: "docs",
      distributedCacheWrite: {
        distributedCache,
        transformCacheKey: "transform-key",
        projectId: "project-1",
        contentSourceId: "preview-main",
      },
      writeToDistributedCache: (_cache, _key, _projectId, _contentSourceId, moduleCode) => {
        distributedCode = moduleCode;
      },
      cacheLocalModule: (_normalizedPath, moduleCode) => {
        localCode = moduleCode;
        return Promise.resolve("/cache/Button.mjs");
      },
    });

    assertEquals(
      localCode,
      expectedCode,
      "the locally cached module must carry the filename-derived default export",
    );
    assertEquals(
      distributedCode,
      expectedCode,
      "the distributed cache must receive the same default-export-bearing code",
    );
  });
});
