import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { makeTempDir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import * as esbuild from "veryfront/extensions/bundler";
import { transformToESM } from "#veryfront/transforms/esm-transform.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../../release-assets/constants.ts";
import {
  clearReactVersionCache,
  createDependencyPinningSource,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import {
  _clearNpmVersionCache,
  _pendingResolutions,
  _setClockForTest,
  _setDependencyResolutionPosterForTest,
} from "#veryfront/transforms/esm/npm-registry-client.ts";
import { destroyTransformCache } from "#veryfront/transforms/esm/transform-cache.ts";
import {
  type ModuleTransformCacheDeps,
  transformModuleCodeWithCache,
} from "./module-transform-cache.ts";

const CHANGED_PIN_KEY = "on:34n9smy47dk9";

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
    runPipeline: () => {
      throw new Error("runPipeline was not configured");
    },
    ...overrides,
  };
}

describe("module-loader/module-transform-cache", () => {
  afterAll(async () => {
    await esbuild.stop();
  });

  it("forwards module-loading cancellation into the SSR transform", async () => {
    const callerController = new AbortController();
    const transformController = new AbortController();
    let observedSignal: AbortSignal | undefined;

    await transformModuleCodeWithCache({
      fileContent: "export const page = 1;",
      filePath: "/project/app/page.tsx",
      projectDir: "/project",
      effectiveProjectId: "project-1",
      mode: "production",
      adapter: {} as RuntimeAdapter,
      signal: callerController.signal,
      deps: createDeps({
        getOrComputeTransform: async (_key, compute) => ({
          code: await compute(undefined, transformController.signal),
          cacheHit: false,
        }),
        transformToESM: (_code, _filePath, _projectDir, _adapter, options) => {
          observedSignal = options.abortSignal;
          return Promise.resolve("export const page = 1;");
        },
      }),
    });

    assertEquals(observedSignal, transformController.signal);
  });

  it("isolates outer transform cache keys by React, runtime, and dependency-pin state", async () => {
    const cacheKeys: string[] = [];
    const deps = createDeps({
      getOrComputeTransform: async (
        key,
        compute,
        _ttl,
        _progress,
        _signal,
        _validator,
        getObservations,
      ) => {
        cacheKeys.push(key);
        return {
          code: await compute(),
          cacheHit: false,
          dependencyResolutionObservations: getObservations?.(),
        };
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
    await transformModuleCodeWithCache({
      ...baseInput,
      mode: "development",
      reactVersion: "19.0.0",
      dependencyPinningCacheKey: CHANGED_PIN_KEY,
    });
    await transformModuleCodeWithCache({
      ...baseInput,
      mode: "development",
      reactVersion: "19.0.0",
      dependencyPinningCacheKey: CHANGED_PIN_KEY,
      moduleServerOrigin: "https://a.example",
    });
    await transformModuleCodeWithCache({
      ...baseInput,
      mode: "development",
      reactVersion: "19.0.0",
      dependencyPinningCacheKey: CHANGED_PIN_KEY,
      moduleServerOrigin: "https://b.example",
    });

    assertEquals(new Set(cacheKeys).size, 6);
  });

  it("preserves the legacy outer transform identity when pinning is off", async () => {
    const cacheKeys: string[] = [];
    const deps = createDeps({
      getOrComputeTransform: async (key, compute) => {
        cacheKeys.push(key);
        return { code: await compute(), cacheHit: false };
      },
      transformToESM: (code) => Promise.resolve(code),
    });
    const baseInput = {
      fileContent: "export const page = 1;",
      filePath: "/project/app/page.tsx",
      projectDir: "/project",
      effectiveProjectId: "project-1",
      mode: "production" as const,
      adapter: {} as RuntimeAdapter,
      deps,
    };

    await transformModuleCodeWithCache(baseInput);
    await transformModuleCodeWithCache({
      ...baseInput,
      dependencyPinningCacheKey: "off",
      moduleServerOrigin: "https://app.example",
    });

    assertEquals(cacheKeys.length, 2);
    assertEquals(cacheKeys[1], cacheKeys[0]);
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

  it("replays SSR bare dependency metadata across outer hits and current authority", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-outer-ssr-retry-" });
    const filePath = join(projectDir, "page.ts");
    const packageJsonPath = join(projectDir, "package.json");
    const fileContent = `import value from "redis"; export default value;`;
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    const attempts: Array<{
      specifiers: string[];
      expectedDeclarations: Readonly<Record<string, string | null>>;
    }> = [];
    let now = 0;
    let outerEntry:
      | {
        code: string;
        cacheHit: boolean;
        dependencyResolutionObservations?: ReadonlyArray<{
          packageName: string;
          declaration: string | null;
        }>;
      }
      | undefined;

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      destroyTransformCache();
      _clearNpmVersionCache();
      _setClockForTest(() => now);
      _setDependencyResolutionPosterForTest(
        (_projectId, specifiers, _target, expectedDeclarations) => {
          attempts.push({ specifiers: [...specifiers], expectedDeclarations });
          return Promise.reject(new Error("platform unavailable"));
        },
      );
      await writeTextFile(filePath, fileContent);
      await writeTextFile(
        packageJsonPath,
        JSON.stringify({
          dependencies: { "redis": "^1.0.0" },
        }),
      );

      const dependencyPinningSource = createDependencyPinningSource({
        projectDir,
        projectId: "outer-ssr-retry-project",
        isLocalProject: false,
        dependencyWritebackTarget: { kind: "main" },
      });
      const snapshotA = await getDependencyPinningSnapshot(
        dependencyPinningSource,
      );
      const deps = createDeps({
        getOrComputeTransform: async (
          _key,
          compute,
          _ttl,
          _onProgress,
          _signal,
          validator,
          getObservations,
        ) => {
          if (outerEntry && await validator?.(outerEntry)) {
            return { ...outerEntry, cacheHit: true };
          }
          const code = await compute();
          outerEntry = {
            code,
            cacheHit: true,
            dependencyResolutionObservations: getObservations?.(),
          };
          return { ...outerEntry, cacheHit: false };
        },
        transformToESM,
        validateCachedBundlesByManifestOrCode: () =>
          Promise.resolve({
            valid: true,
            failedHashes: [],
            source: "code",
          }),
      });
      const input = {
        fileContent,
        filePath,
        projectDir,
        effectiveProjectId: "outer-ssr-retry-project",
        mode: "production" as const,
        adapter: {} as RuntimeAdapter,
        dependencyPinningCacheKey: snapshotA.cacheKey,
        dependencyPinningDependencies: snapshotA.dependencies,
        dependencyPinningSource,
        deps,
      };

      await transformModuleCodeWithCache(input);
      await _pendingResolutions();
      assertEquals(attempts, [{
        specifiers: ["redis@^1.0.0"],
        expectedDeclarations: {
          "redis": "^1.0.0",
        },
      }]);
      assertEquals(outerEntry?.dependencyResolutionObservations, [{
        packageName: "redis",
        declaration: "^1.0.0",
      }]);

      await transformModuleCodeWithCache(input);
      await _pendingResolutions();
      assertEquals(attempts.length, 1);

      now = 60_000;
      await transformModuleCodeWithCache(input);
      await _pendingResolutions();
      assertEquals(attempts.length, 2);

      await new Promise((resolve) => setTimeout(resolve, 5));
      await writeTextFile(
        packageJsonPath,
        JSON.stringify({
          dependencies: { "redis": "^2.0.0" },
        }),
      );
      const snapshotB = await getDependencyPinningSnapshot(
        dependencyPinningSource,
      );
      assertEquals(snapshotB.cacheKey === snapshotA.cacheKey, false);

      now = 120_000;
      await transformModuleCodeWithCache(input);
      await _pendingResolutions();
      assertEquals(attempts.length, 2);
    } finally {
      await _pendingResolutions();
      _clearNpmVersionCache();
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
      clearReactVersionCache();
      destroyTransformCache();
      await remove(projectDir, { recursive: true });
    }
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
      hash: hashCodeHex(retryCode).slice(0, 16),
    }]);
  });
});
