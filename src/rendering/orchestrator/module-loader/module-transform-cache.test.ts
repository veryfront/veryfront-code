import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import {
  type ModuleTransformCacheDeps,
  transformModuleCodeWithCache,
} from "./module-transform-cache.ts";

function createDeps(
  overrides: Partial<ModuleTransformCacheDeps>,
): ModuleTransformCacheDeps {
  return {
    initializeTransformCache: () => Promise.resolve(false),
    getOrComputeTransform: () => {
      throw new Error("getOrComputeTransform was not configured");
    },
    transformToESM: () => {
      throw new Error("transformToESM was not configured");
    },
    validateCachedBundlesByManifestOrCode: () => {
      throw new Error("validateCachedBundlesByManifestOrCode was not configured");
    },
    findMissingFrameworkBundlePaths: () => Promise.resolve([]),
    getHttpBundleCacheDir: () => "/tmp/vf-http-bundles",
    setCachedTransformAsync: () => Promise.resolve(),
    loadImportMap: () => Promise.resolve({ imports: {}, scopes: {} }),
    runPipeline: () => {
      throw new Error("runPipeline was not configured");
    },
    ...overrides,
  };
}

describe("module-loader/module-transform-cache", () => {
  it("isolates outer transform cache keys by React version and runtime mode", async () => {
    const cacheKeys: string[] = [];
    const deps = createDeps({
      getOrComputeTransform: async (key, compute) => {
        cacheKeys.push(key);
        return { code: await compute(), cacheHit: false };
      },
      transformToESM: (_code, _filePath, _projectDir, _adapter, options) =>
        Promise.resolve(`export const version = ${JSON.stringify(options.reactVersion)};`),
    });
    const baseInput = {
      fileContent: "export const page = 1;",
      filePath: "/project/app/page.tsx",
      projectDir: "/project",
      effectiveProjectId: "project-1",
      adapter: {} as RuntimeAdapter,
      deps,
    };

    await transformModuleCodeWithCache({
      ...baseInput,
      mode: "production",
      reactVersion: "18.3.1",
    });
    await transformModuleCodeWithCache({
      ...baseInput,
      mode: "production",
      reactVersion: "19.0.0",
    });
    await transformModuleCodeWithCache({
      ...baseInput,
      mode: "development",
      reactVersion: "19.0.0",
    });

    assertEquals(new Set(cacheKeys).size, 3);
  });

  it("isolates outer transform cache keys by adapter-bound import-map content", async () => {
    const cacheKeys: string[] = [];
    let importTarget = "/vendor/one.ts";
    const deps = createDeps({
      loadImportMap: () => Promise.resolve({ imports: { vendor: importTarget } }),
      getOrComputeTransform: async (key, compute) => {
        cacheKeys.push(key);
        return { code: await compute(), cacheHit: false };
      },
      transformToESM: (_code, _filePath, _projectDir, _adapter, options) =>
        options.loadImportMap!().then((map) => `export default ${JSON.stringify(map.imports)};`),
    });
    const input = {
      fileContent: 'import value from "vendor";',
      filePath: "/project/app/page.tsx",
      projectDir: "/project",
      effectiveProjectId: "project-1",
      mode: "production" as const,
      adapter: {} as RuntimeAdapter,
      deps,
    };

    const first = await transformModuleCodeWithCache(input);
    importTarget = "/vendor/two.ts";
    const second = await transformModuleCodeWithCache(input);

    assertEquals(first.cacheKey === second.cacheKey, false);
    assertEquals(new Set(cacheKeys).size, 2);
    assertEquals(first.contentHash, await computeHash(input.fileContent));
  });

  it("re-transforms cached code when HTTP bundle validation fails", async () => {
    let transformCalls = 0;
    let validatorCalls = 0;

    const result = await transformModuleCodeWithCache({
      fileContent: "export const page = 1;",
      filePath: "/project/app/page.tsx",
      projectDir: "/project",
      effectiveProjectId: "project-1",
      mode: "production",
      adapter: {} as RuntimeAdapter,
      ttlSeconds: 123,
      deps: createDeps({
        getOrComputeTransform: async (_key, compute, _ttl, _onProgress, _signal, validator) => {
          validatorCalls++;
          const cacheEntry = {
            code: 'import x from "file:///tmp/veryfront-http-bundle/http-deadbeef.mjs";',
            cacheHit: true,
            bundleManifestId: "manifest-abc",
          };
          if (await validator?.(cacheEntry)) return cacheEntry;
          return { code: await compute(), cacheHit: false };
        },
        validateCachedBundlesByManifestOrCode: (code, manifestId, cacheDir) => {
          assertEquals(code.includes("deadbeef"), true);
          assertEquals(manifestId, "manifest-abc");
          assertEquals(cacheDir, "/tmp/vf-http-bundles");
          return Promise.resolve({
            valid: false,
            failedHashes: ["deadbeef"],
            reason: "bundle_missing",
            source: "manifest",
          });
        },
        transformToESM: () => {
          transformCalls++;
          return Promise.resolve("export const page = 1;");
        },
      }),
    });

    assertEquals(result.code, "export const page = 1;");
    assertEquals(transformCalls, 1);
    assertEquals(validatorCalls, 1);
  });

  it("re-transforms cached code when a referenced framework file URL is missing", async () => {
    const missingFrameworkPath =
      "/tmp/.cache/veryfront/veryfront-mdx-esm/framework/vfmod-vf-framework-deadbeef.mjs";
    const freshCode = "export const page = 3;";
    let transformCalls = 0;
    let validatorCalls = 0;

    const result = await transformModuleCodeWithCache({
      fileContent: "export const page = 3;",
      filePath: "/project/app/page.tsx",
      projectDir: "/project",
      effectiveProjectId: "project-3",
      mode: "production",
      adapter: {} as RuntimeAdapter,
      ttlSeconds: 789,
      deps: createDeps({
        getOrComputeTransform: async (_key, compute, _ttl, _onProgress, _signal, validator) => {
          validatorCalls++;
          const cacheEntry = {
            code: `import helper from "file://${missingFrameworkPath}";\nexport default helper;`,
            cacheHit: true,
            bundleManifestId: "manifest-valid",
          };
          if (await validator?.(cacheEntry)) return cacheEntry;
          return { code: await compute(), cacheHit: false };
        },
        validateCachedBundlesByManifestOrCode: () =>
          Promise.resolve({
            valid: true,
            failedHashes: [],
            source: "manifest",
          }),
        findMissingFrameworkBundlePaths: (code) => {
          assertEquals(code.includes(missingFrameworkPath), true);
          return Promise.resolve([missingFrameworkPath]);
        },
        transformToESM: () => {
          transformCalls++;
          return Promise.resolve(freshCode);
        },
      }),
    });

    assertEquals(result.code, freshCode);
    assertEquals(transformCalls, 1);
    assertEquals(validatorCalls, 1);
  });

  it("retries through the transform pipeline when cached code has unresolved _vf_modules imports", async () => {
    const retryCode = "export const page = 2;";
    const setCalls: Array<{ code: string; hash: string }> = [];
    let pipelineCalls = 0;

    const result = await transformModuleCodeWithCache({
      fileContent: "export const page = 2;",
      filePath: "/project/app/page.tsx",
      projectDir: "/project",
      effectiveProjectId: "project-2",
      mode: "development",
      adapter: {} as RuntimeAdapter,
      reactVersion: "19.1.1",
      ttlSeconds: 456,
      deps: createDeps({
        getOrComputeTransform: () =>
          Promise.resolve({
            code: 'import React from "/_vf_modules/_veryfront/react.js";',
            cacheHit: true,
          }),
        validateCachedBundlesByManifestOrCode: () =>
          Promise.resolve({
            valid: true,
            failedHashes: [],
            source: "code",
          }),
        runPipeline: (_code, filePath, projectDir, options) => {
          pipelineCalls++;
          assertEquals(filePath, "/project/app/page.tsx");
          assertEquals(projectDir, "/project");
          assertEquals(options.projectId, "project-2");
          assertEquals(options.dev, true);
          assertEquals(options.ssr, true);
          assertEquals(options.reactVersion, "19.1.1");
          return Promise.resolve({ code: retryCode });
        },
        setCachedTransformAsync: (_key, code, hash) => {
          setCalls.push({ code, hash });
          return Promise.resolve();
        },
      }),
    });

    assertEquals(result.code, retryCode);
    assertEquals(pipelineCalls, 1);
    assertEquals(setCalls, [{
      code: retryCode,
      hash: await computeHash("export const page = 2;"),
    }]);
  });
});
