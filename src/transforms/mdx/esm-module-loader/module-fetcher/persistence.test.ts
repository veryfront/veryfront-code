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
      ) => {
        calls.push("local");
        assertEquals(normalizedPath, "_vf_modules/app/page.js");
        assertEquals(moduleCode, "export default 1;");
        assertEquals(esmCacheDir, "/cache");
        assertEquals(receivedPathCache, pathCache);
        assertEquals(reactVersion, "19.1.1");
        return Promise.resolve("/cache/page.mjs");
      },
    });

    assertEquals(calls, ["distributed", "local"]);
    assertEquals(result, "/cache/page.mjs");
  });
});
