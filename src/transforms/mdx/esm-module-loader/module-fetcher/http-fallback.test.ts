import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { resolveUnresolvedModuleViaHttpFallback } from "./http-fallback.ts";

const noopLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  time: (_label, fn) => fn(),
  child: () => noopLog,
  component: () => noopLog,
};

const adapter = {
  env: { get: (_key: string) => undefined },
} as RuntimeAdapter;

describe("module-fetcher/http-fallback", () => {
  it("caches HTTP fallback module code and returns the cached path", async () => {
    const pathCache = new Map<string, string>();

    const result = await resolveUnresolvedModuleViaHttpFallback({
      normalizedPath: "_vf_modules/app/page.js",
      parentModulePath: "_vf_modules/root.js",
      adapter,
      fetchAndCacheModule: (path, parent) => {
        assertEquals(path, "_vf_modules/nested.js");
        assertEquals(parent, "_vf_modules/app/page.js");
        return Promise.resolve("/cache/nested.mjs");
      },
      log: noopLog,
      projectSlug: "docs",
      isLocalProject: true,
      strictMissingModules: true,
      esmCacheDir: "/cache",
      pathCache,
      reactVersion: "19.1.1",
      fetchViaHttp: (
        normalizedPath,
        receivedAdapter,
        fetchAndCacheModule,
        receivedLog,
        projectSlug,
        isLocalProject,
      ) => {
        assertEquals(normalizedPath, "_vf_modules/app/page.js");
        assertEquals(receivedAdapter, adapter);
        assertEquals(receivedLog, noopLog);
        assertEquals(projectSlug, "docs");
        assertEquals(isLocalProject, true);
        return fetchAndCacheModule("_vf_modules/nested.js", normalizedPath).then(() =>
          "export default 1;"
        );
      },
      cacheLocalModule: (
        normalizedPath,
        moduleCode,
        esmCacheDir,
        receivedPathCache,
        _log,
        reactVersion,
      ) => {
        assertEquals(normalizedPath, "_vf_modules/app/page.js");
        assertEquals(moduleCode, "export default 1;");
        assertEquals(esmCacheDir, "/cache");
        assertEquals(receivedPathCache, pathCache);
        assertEquals(reactVersion, "19.1.1");
        return Promise.resolve("/cache/app-page.mjs");
      },
    });

    assertEquals(result, "/cache/app-page.mjs");
  });

  it("returns null for a missing fallback module when strict mode is disabled", async () => {
    const result = await resolveUnresolvedModuleViaHttpFallback({
      normalizedPath: "_vf_modules/missing.js",
      adapter,
      fetchAndCacheModule: () => Promise.resolve(null),
      log: noopLog,
      projectSlug: "docs",
      isLocalProject: false,
      strictMissingModules: false,
      esmCacheDir: "/cache",
      pathCache: new Map(),
      fetchViaHttp: () => Promise.resolve(null),
      cacheLocalModule: () => {
        throw new Error("cacheLocalModule should not run without HTTP fallback code");
      },
    });

    assertEquals(result, null);
  });

  it("throws a missing-module error for a missing fallback module in strict mode", async () => {
    await assertRejects(
      () =>
        resolveUnresolvedModuleViaHttpFallback({
          normalizedPath: "_vf_modules/missing.js",
          parentModulePath: "_vf_modules/root.js",
          adapter,
          fetchAndCacheModule: () => Promise.resolve(null),
          log: noopLog,
          projectSlug: "docs",
          isLocalProject: false,
          strictMissingModules: true,
          esmCacheDir: "/cache",
          pathCache: new Map(),
          fetchViaHttp: () => Promise.resolve(null),
          cacheLocalModule: () => {
            throw new Error("cacheLocalModule should not run without HTTP fallback code");
          },
        }),
      Error,
      "Missing module",
    );
  });
});
