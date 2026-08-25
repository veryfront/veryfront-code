import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { dirname, fromFileUrl, join, toFileUrl } from "#veryfront/compat/path/index.ts";
import { getMdxEsmCacheDir, runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import {
  buildMdxEsmPathCacheKey,
  getCycleManifestCacheDir,
  MDX_MODULE_DEV_COMPILE_VARIANT,
} from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";
import {
  clearModulePathCache,
  getLocalFs,
  getModulePathCache,
  invalidateModulePaths,
  saveModulePathCache,
  waitForDiskCleanup,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import {
  __setModuleTransformActivityObserverForTests,
  __setModuleTransformStallTimeoutForTests,
  isMissingModuleError,
  isUnresolvedTenantImport,
  loadModule,
  type ModuleLoaderConfig,
  transformModuleWithDeps,
} from "./index.ts";
import { delay, scaleMs } from "#veryfront/testing";
import { VeryfrontError } from "#veryfront/errors";
import { getTransformSemaphore } from "#veryfront/modules/react-loader/ssr-module-loader/cache/index.ts";
import {
  getMaxConcurrentTransforms,
  resetCachedTransformLimits,
} from "#veryfront/modules/react-loader/ssr-module-loader/constants.ts";
import { withModuleTransformPermit } from "./transform-permit.ts";
import { buildModuleTransformCacheVariant, getModuleCacheKey } from "./module-cache-lookup.ts";
import { CYCLE_MANIFEST_SIDECAR_SUFFIX, inspectCycleManifestCache } from "./cycle-manifest.ts";
import {
  isBuildFailure,
  isTenantBuildFailure,
  markBuildFailure,
  markTenantBuildFailure,
} from "./build-failure.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import {
  buildHttpCacheIdentity,
  hashHttpCacheIdentity,
} from "#veryfront/transforms/esm/http-cache-helpers.ts";
import { __injectCachesForTests } from "#veryfront/transforms/esm/http-cache-state.ts";
import { __setDistributedCacheAccessorForTests } from "#veryfront/transforms/esm/http-cache-wrapper.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";

/**
 * A distributed-cache stand-in keyed the way the HTTP bundle cache reads it:
 * the stored keys carry a leading namespace segment the lookup adds.
 */
function createSuffixCacheBackend(entries: Record<string, string>): CacheBackend {
  const values = new Map(Object.entries(entries));

  function suffixKey(key: string): string {
    const match = /^[^:]+:([^:]+):(.+)$/.exec(key);
    if (!match) return key;
    return `${match[1]}:${match[2]}`;
  }

  return {
    type: "memory",
    get: (key) => Promise.resolve(values.get(suffixKey(key)) ?? null),
    set: (key, value) => {
      values.set(suffixKey(key), value);
      return Promise.resolve();
    },
    del: (key) => {
      values.delete(suffixKey(key));
      return Promise.resolve();
    },
  };
}

async function withModuleLoaderFixture<T>(
  files: Record<string, string>,
  test: (fixture: { projectDir: string; tmpDir: string; config: ModuleLoaderConfig }) => Promise<T>,
): Promise<T> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-module-loader-project-" });
  const tmpDir = await Deno.makeTempDir({ prefix: "vf-module-loader-out-" });
  const adapter = await getLocalAdapter();

  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = join(projectDir, relativePath);
      await Deno.mkdir(dirname(absolutePath), { recursive: true });
      await Deno.writeTextFile(absolutePath, content);
    }

    return await test({
      projectDir,
      tmpDir,
      config: {
        projectDir,
        adapter,
        mode: "development",
        moduleCache: new Map(),
        esmCache: new Map(),
      },
    });
  } finally {
    await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
    await Deno.remove(tmpDir, { recursive: true }).catch(() => undefined);
    await Deno.remove(getCycleManifestCacheDir(tmpDir), { recursive: true }).catch(() => undefined);
  }
}

/**
 * Occupy `count` permits of the shared transform semaphore, standing in for
 * concurrent SSR component transforms elsewhere in the process. Returns a
 * releaser that must run before the test ends so later tests see a full pool.
 */
async function reserveTransformPermits(count: number): Promise<() => void> {
  const semaphore = getTransformSemaphore();
  let reserved = 0;
  try {
    for (; reserved < count; reserved++) {
      assert(
        await semaphore.tryAcquire(1000),
        `expected to reserve shared transform permit ${reserved + 1} of ${count}`,
      );
    }
  } catch (error) {
    for (let index = 0; index < reserved; index++) semaphore.release();
    throw error;
  }
  return () => {
    for (let index = 0; index < reserved; index++) semaphore.release();
  };
}

function assertTransformedImportPath(code: string, expectedPathPart: string): string {
  const match = code.match(/from\s+"file:\/\/([^"]+)"/);
  assert(match, `expected transformed import in code:\n${code}`);
  const importPath = match[1]!;
  assertStringIncludes(importPath, expectedPathPart);
  return importPath;
}

describe("module-loader/transformModuleWithDeps", () => {
  // The `.ts` cycle case compiles real TypeScript, which starts esbuild's child
  // process; stop it so the test does not leak the handle into a later suite.
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("transforms @/ alias dependencies before rewriting the import to a file URL", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.json": [
          `import { label } from "@/components/Label";`,
          `export const pageLabel = label;`,
        ].join("\n"),
        "components/Label.json": `export const label = "alias-label";`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const fsWithJsonResolve = Object.assign(Object.create(config.adapter.fs), {
          async resolveFile(basePath: string): Promise<string | null> {
            const jsonPath = `${basePath}.json`;
            return await config.adapter.fs.exists(jsonPath) ? jsonPath : null;
          },
        });
        const resolveJsonAdapter = {
          ...config.adapter,
          fs: fsWithJsonResolve,
        };
        const jsonConfig = { ...config, adapter: resolveJsonAdapter };
        const transformedPath = await transformModuleWithDeps(
          join(projectDir, "app/page.json"),
          tmpDir,
          resolveJsonAdapter,
          jsonConfig,
        );
        const transformedCode = await Deno.readTextFile(transformedPath);
        const depPath = assertTransformedImportPath(transformedCode, "/components/Label.json");

        assertStringIncludes(transformedPath, "/app/page.json");
        assertEquals((await Deno.stat(depPath)).isFile, true);
      },
    );
  });

  it("isolates progress listener failures without weakening aborts", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.json": `export const value = "ready";`,
      },
      async ({ projectDir, tmpDir, config }) => {
        let listenerCalls = 0;
        const transformedPath = await transformModuleWithDeps(
          join(projectDir, "app/page.json"),
          tmpDir,
          config.adapter,
          {
            ...config,
            onProgress: () => {
              listenerCalls++;
              throw new Error("observer failure");
            },
          },
        );

        assert(listenerCalls > 0);
        assertEquals((await Deno.stat(transformedPath)).isFile, true);

        const controller = new AbortController();
        controller.abort(new Error("render cancelled"));
        let abortedListenerCalls = 0;
        await assertRejects(
          () =>
            transformModuleWithDeps(
              join(projectDir, "app/page.json"),
              tmpDir,
              config.adapter,
              {
                ...config,
                signal: controller.signal,
                onProgress: () => {
                  abortedListenerCalls++;
                },
              },
            ),
          Error,
          "render cancelled",
        );
        assertEquals(abortedListenerCalls, 0);
      },
    );
  });

  // A dynamic import is how a module graph legitimately breaks a cycle. Before
  // dynamic specifiers were followed, this shape terminated because the cycle
  // edge was invisible; following it eagerly recurses until the worker dies.
  // The race turns a regression into a failure rather than a hung suite.
  it("does not recurse forever when a dynamic import closes a cycle", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.json": [
          `import { a } from "../lib/a.json";`,
          `export const pageValue = a;`,
        ].join("\n"),
        "lib/a.json": [
          `export const a = "cycle";`,
          `export async function later() { return await import("../app/page.json"); }`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        let timer = 0;
        const transformed = await Promise.race([
          transformModuleWithDeps(
            join(projectDir, "app/page.json"),
            tmpDir,
            config.adapter,
            config,
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("transform did not terminate")), 10_000);
          }),
        ]).finally(() => clearTimeout(timer));

        assertStringIncludes(transformed, "/app/page.json");

        // The cycle edge is left as the author wrote it, so the runtime
        // resolves it if that branch is ever taken.
        const depCode = await Deno.readTextFile(
          assertTransformedImportPath(
            await Deno.readTextFile(transformed),
            "/lib/a.json",
          ),
        );
        assertStringIncludes(depCode, `import("../app/page.json")`);
      },
    );
  });

  it("resolves a lazy .ts cycle to its hashed artifact without a mutable alias", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `import { a, later } from "../lib/a.ts";`,
          `export const pageValue = a;`,
          `export const moduleUrl = import.meta.url;`,
          `export let count = 0;`,
          `export function increment() { count += 1; }`,
          `export { later };`,
          `export default "default-cycle";`,
        ].join("\n"),
        "lib/a.ts": [
          `export const a = "cycle";`,
          "export async function later() {",
          "  return await import(/* cycle */ `../app/page.ts` /* deferred */);",
          "}",
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        let timer = 0;
        const transformed = await Promise.race([
          transformModuleWithDeps(
            join(projectDir, "app/page.ts"),
            tmpDir,
            config.adapter,
            config,
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("transform did not terminate")), 10_000);
          }),
        ]).finally(() => clearTimeout(timer));

        // The static import to lib/a resolves to its content-hashed artifact.
        const depArtifactPath = assertTransformedImportPath(
          await Deno.readTextFile(transformed),
          "/veryfront-cycle-manifests/",
        );
        assert(
          /\/veryfront-cycle-manifests\/[^/]+\/[^/]+\/artifacts\/[0-9a-z]+\.[0-9a-f]{1,8}\.js$/
            .test(
              depArtifactPath,
            ),
          depArtifactPath,
        );
        assert(
          /\/veryfront-cycle-manifests\/[^/]+\/[^/]+\/artifacts\/[0-9a-z]+\.[0-9a-f]{1,8}\.js$/
            .test(
              transformed,
            ),
          transformed,
        );

        // The deferred edge resolves at runtime to the same content-hashed root
        // artifact, without publishing the old logical `app/page.js` alias.
        const depCode = await Deno.readTextFile(depArtifactPath);
        const rootNamespace = await import(toFileUrl(transformed).href);
        const cycleNamespace = await rootNamespace.later();
        const cachedTransform = await transformModuleWithDeps(
          join(projectDir, "app/page.ts"),
          tmpDir,
          config.adapter,
          config,
        );
        assertStrictEquals(cachedTransform, transformed);
        assertStrictEquals(cycleNamespace, rootNamespace);
        assertEquals(cycleNamespace.pageValue, "cycle");
        assertEquals(cycleNamespace.default, "default-cycle");
        assertEquals(cycleNamespace.moduleUrl, toFileUrl(transformed).href);
        rootNamespace.increment();
        assertEquals(cycleNamespace.count, 1);
        assertEquals(await config.adapter.fs.exists(join(tmpDir, "app/page.js")), false);
        assert(!depCode.includes(`import("../app/page.js")`), depCode);
      },
    );
  });

  it("preserves the root module namespace across a static cycle edge", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `import * as branch from "../lib/b.ts";`,
          `export { branch };`,
          `export default "root-default";`,
          `export let count = 0;`,
          `export function increment() { count += 1; }`,
        ].join("\n"),
        "lib/b.ts": [
          `import * as root from "../app/page.ts";`,
          `export { root };`,
          `export function read() { return [root.default, root.count]; }`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        const transformed = await transformModuleWithDeps(
          join(projectDir, "app/page.ts"),
          tmpDir,
          config.adapter,
          config,
        );
        const root = await import(toFileUrl(transformed).href);
        assertEquals(
          await inspectCycleManifestCache(transformed, tmpDir, config.adapter),
          "valid-root",
        );
        const cached = await transformModuleWithDeps(
          join(projectDir, "app/page.ts"),
          tmpDir,
          config.adapter,
          config,
        );

        assertStrictEquals(cached, transformed);
        assertStrictEquals(root.branch.root, root);
        assertEquals(root.branch.read(), ["root-default", 0]);
        root.increment();
        assertEquals(root.branch.read(), ["root-default", 1]);
      },
    );
  });

  it("keeps the two compile modes on separate artifact cache entries", async () => {
    await withModuleLoaderFixture(
      { "app/page.ts": `export const page = "compile-mode";` },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const pagePath = join(projectDir, "app/page.ts");
          const diskConfig = {
            ...config,
            projectId: "compile-mode-split",
            contentSourceId: "main",
          };
          const cacheDir = join(
            getMdxEsmCacheDir(),
            encodeURIComponent(diskConfig.projectId),
            encodeURIComponent(diskConfig.contentSourceId),
          );
          await Deno.mkdir(cacheDir, { recursive: true });

          await transformModuleWithDeps(pagePath, cacheDir, diskConfig.adapter, {
            ...diskConfig,
            mode: "development",
            moduleCache: new Map(),
          });
          await transformModuleWithDeps(pagePath, cacheDir, diskConfig.adapter, {
            ...diskConfig,
            mode: "production",
            moduleCache: new Map(),
          });

          // The transform publishes the index write without awaiting it.
          await saveModulePathCache(cacheDir);

          const pathCache = await getModulePathCache(cacheDir);
          const developmentKey = buildMdxEsmPathCacheKey(
            "_vf_modules/app/page.js",
            diskConfig.reactVersion,
            MDX_MODULE_DEV_COMPILE_VARIANT,
          );
          const productionKey = buildMdxEsmPathCacheKey(
            "_vf_modules/app/page.js",
            diskConfig.reactVersion,
          );

          // A production render resolves productionKey. The development render
          // must have registered its artifact somewhere else entirely.
          assert(
            pathCache.has(developmentKey),
            "development transform did not register a compile-mode-scoped artifact",
          );
          assert(
            pathCache.has(productionKey),
            "production transform did not register an artifact on its own key",
          );
        });
      },
    );
  });

  it("does not serve a development-compiled artifact to a production render", async () => {
    await withModuleLoaderFixture(
      { "app/page.ts": `export const page = "poison-probe";` },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const pagePath = join(projectDir, "app/page.ts");
          const diskConfig = {
            ...config,
            projectId: "compile-mode-poison",
            contentSourceId: "main",
          };
          const cacheDir = join(
            getMdxEsmCacheDir(),
            encodeURIComponent(diskConfig.projectId),
            encodeURIComponent(diskConfig.contentSourceId),
          );
          await Deno.mkdir(cacheDir, { recursive: true });

          const developmentArtifact = join(cacheDir, "planted-development.mjs");
          const productionArtifact = join(cacheDir, "planted-production.mjs");
          await Deno.writeTextFile(
            developmentArtifact,
            `export const compiledFor = "development";`,
          );
          await Deno.writeTextFile(
            productionArtifact,
            `export const compiledFor = "production";`,
          );

          const pathCache = await getModulePathCache(cacheDir);
          pathCache.set(
            buildMdxEsmPathCacheKey(
              "_vf_modules/app/page.js",
              diskConfig.reactVersion,
              MDX_MODULE_DEV_COMPILE_VARIANT,
            ),
            developmentArtifact,
          );
          pathCache.set(
            buildMdxEsmPathCacheKey("_vf_modules/app/page.js", diskConfig.reactVersion),
            productionArtifact,
          );

          const resolvedForProduction = await transformModuleWithDeps(
            pagePath,
            cacheDir,
            diskConfig.adapter,
            { ...diskConfig, mode: "production", moduleCache: new Map() },
          );
          const resolvedForDevelopment = await transformModuleWithDeps(
            pagePath,
            cacheDir,
            diskConfig.adapter,
            { ...diskConfig, mode: "development", moduleCache: new Map() },
          );
          await saveModulePathCache(cacheDir);

          assertEquals(resolvedForProduction, productionArtifact);
          assertEquals(resolvedForDevelopment, developmentArtifact);
        });
      },
    );
  });

  it("does not reuse a cached cycle member across root generations", async () => {
    const pageSource = (version: string) =>
      [
        `import { later } from "../lib/a.ts";`,
        `export const version = ${JSON.stringify(version)};`,
        `export { later };`,
      ].join("\n");

    await withModuleLoaderFixture(
      {
        "app/page.ts": pageSource("first"),
        "lib/a.ts": `export async function later() { return await import("../app/page.ts"); }`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const pagePath = join(projectDir, "app/page.ts");
        const firstPath = await transformModuleWithDeps(
          pagePath,
          tmpDir,
          config.adapter,
          config,
        );

        config.moduleCache.delete(
          getModuleCacheKey(
            pagePath,
            config.projectId,
            config.projectDir,
            config.contentSourceId,
            config.reactVersion,
            config.mode,
          ),
        );
        await Deno.writeTextFile(pagePath, pageSource("second"));

        const secondPath = await transformModuleWithDeps(
          pagePath,
          tmpDir,
          config.adapter,
          config,
        );
        const secondNamespace = await import(toFileUrl(secondPath).href);
        const cycleNamespace = await secondNamespace.later();

        assertNotStrictEquals(secondPath, firstPath);
        assertEquals(secondNamespace.version, "second");
        assertEquals(cycleNamespace.version, "second");
      },
    );
  });

  it("rebuilds a cached cycle root when only a member source changes", async () => {
    const memberSource = (version: string) =>
      [
        `export const version = ${JSON.stringify(version)};`,
        `export async function later() { return await import("../app/page.ts"); }`,
      ].join("\n");

    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `import { later, version as memberVersion } from "../lib/a.ts";`,
          `export { later, memberVersion };`,
        ].join("\n"),
        "lib/a.ts": memberSource("old"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const pagePath = join(projectDir, "app/page.ts");
          const memberPath = join(projectDir, "lib/a.ts");
          const diskConfig = {
            ...config,
            projectId: "cycle-member-edit",
            contentSourceId: "main",
          };
          const cacheDir = join(
            getMdxEsmCacheDir(),
            encodeURIComponent(diskConfig.projectId),
            encodeURIComponent(diskConfig.contentSourceId),
          );
          await Deno.mkdir(cacheDir, { recursive: true });
          const firstPath = await transformModuleWithDeps(
            pagePath,
            cacheDir,
            diskConfig.adapter,
            diskConfig,
          );
          await saveModulePathCache(cacheDir);
          clearModulePathCache();
          await getModulePathCache(cacheDir);

          await Deno.writeTextFile(memberPath, memberSource("new"));
          invalidateModulePaths(["lib/a.ts"]);
          await waitForDiskCleanup();

          const secondPath = await transformModuleWithDeps(
            pagePath,
            cacheDir,
            diskConfig.adapter,
            { ...diskConfig, moduleCache: new Map() },
          );
          const second = await import(toFileUrl(secondPath).href);

          assertNotStrictEquals(secondPath, firstPath);
          assertEquals(second.memberVersion, "new");
          assertStrictEquals(await second.later(), second);

          await waitForDiskCleanup();
          const graphDirectories: string[] = [];
          for await (const entry of Deno.readDir(getCycleManifestCacheDir(cacheDir))) {
            if (entry.isDirectory) graphDirectories.push(entry.name);
          }
          assertEquals(
            graphDirectories.length,
            1,
            `expected one current cycle graph, found ${graphDirectories.join(", ")}`,
          );
        });
      },
    );
  });

  it("does not return a cycle artifact queued for invalidation cleanup", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `import { later } from "../lib/a.ts";`,
          `export { later };`,
        ].join("\n"),
        "lib/a.ts": `export async function later() { return import("../app/page.ts"); }`,
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const pagePath = join(projectDir, "app/page.ts");
          const diskConfig = {
            ...config,
            projectId: "cycle-invalidation-race",
            contentSourceId: "main",
          };
          const cacheDir = join(
            getMdxEsmCacheDir(),
            encodeURIComponent(diskConfig.projectId),
            encodeURIComponent(diskConfig.contentSourceId),
          );
          await Deno.mkdir(cacheDir, { recursive: true });
          const firstPath = await transformModuleWithDeps(
            pagePath,
            cacheDir,
            diskConfig.adapter,
            diskConfig,
          );
          const localFs = getLocalFs();
          const originalRemove = localFs.remove.bind(localFs);
          let releaseRemoval!: () => void;
          const removalReleased = new Promise<void>((resolve) => {
            releaseRemoval = resolve;
          });
          let reportRemovalStarted!: () => void;
          const removalStarted = new Promise<void>((resolve) => {
            reportRemovalStarted = resolve;
          });

          try {
            localFs.remove = async (path, options) => {
              if (path === firstPath) {
                reportRemovalStarted();
                await removalReleased;
              }
              await originalRemove(path, options);
            };

            invalidateModulePaths(["app/page.ts"]);
            await removalStarted;
            const secondPath = await transformModuleWithDeps(
              pagePath,
              cacheDir,
              diskConfig.adapter,
              diskConfig,
            );
            releaseRemoval();
            await waitForDiskCleanup();

            assertNotStrictEquals(secondPath, firstPath);
            assertEquals(await diskConfig.adapter.fs.exists(secondPath), true);
          } finally {
            releaseRemoval();
            localFs.remove = originalRemove;
          }
        });
      },
    );
  });

  it("re-resolves an ordinary cached dependency that becomes a cycle member", async () => {
    const pageSource = (version: string, importsCycle: boolean) =>
      importsCycle
        ? [
          `import { later } from "../lib/a.ts";`,
          `export const version = ${JSON.stringify(version)};`,
          `export { later };`,
        ].join("\n")
        : `export const version = ${JSON.stringify(version)};`;

    await withModuleLoaderFixture(
      {
        "app/page.ts": pageSource("old", false),
        "lib/a.ts": `export async function later() { return await import("../app/page.ts"); }`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const pagePath = join(projectDir, "app/page.ts");
        const memberPath = join(projectDir, "lib/a.ts");
        await transformModuleWithDeps(memberPath, tmpDir, config.adapter, config);

        config.moduleCache.delete(
          getModuleCacheKey(
            pagePath,
            config.projectId,
            config.projectDir,
            config.contentSourceId,
            config.reactVersion,
            config.mode,
          ),
        );
        await Deno.writeTextFile(pagePath, pageSource("new", true));

        const currentPath = await transformModuleWithDeps(
          pagePath,
          tmpDir,
          config.adapter,
          config,
        );
        const currentNamespace = await import(toFileUrl(currentPath).href);
        const cycleNamespace = await currentNamespace.later();

        assertStrictEquals(cycleNamespace, currentNamespace);
        assertEquals(cycleNamespace.version, "new");
      },
    );
  });

  it("isolates concurrent cycle closures with immutable JavaScript identity", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `import {`,
          `  aliasUrl, assetUrl, bracketUrl, filename, later,`,
          `  readSelf, resolvedAssetUrl, wrapperUrl,`,
          `} from "../lib/wrapper.js";`,
          `export {`,
          `  aliasUrl, assetUrl, bracketUrl, filename, later,`,
          `  readSelf, resolvedAssetUrl, wrapperUrl,`,
          `};`,
          `export const version = "current";`,
        ].join("\n"),
        "lib/wrapper.js": [
          `import { later } from "./a.ts";`,
          `export { later };`,
          `const meta = import.meta;`,
          `export const wrapperUrl = import.meta.url;`,
          `export const bracketUrl = import.meta["url"];`,
          `export const aliasUrl = meta.url;`,
          `export const filename = import.meta.filename;`,
          `export const assetUrl = new URL("./asset.txt", meta.url).href;`,
          `export const resolvedAssetUrl = import.meta.resolve("./asset.txt");`,
          `export function readSelf() { return Deno.readTextFile(new URL(import.meta.url)); }`,
        ].join("\n"),
        "lib/a.ts": `export async function later() { return await import("../app/page.ts"); }`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const pagePath = join(projectDir, "app/page.ts");
        const moduleCache = new Map<string, string>();
        const paths = await Promise.all(
          Array.from({ length: 8 }, () =>
            transformModuleWithDeps(
              pagePath,
              tmpDir,
              config.adapter,
              { ...config, moduleCache },
            )),
        );
        const firstPath = paths[0]!;
        for (const path of paths) assertStrictEquals(path, firstPath);

        const namespaces = await Promise.all(
          paths.map((path) => import(toFileUrl(path).href)),
        );
        const cycleNamespaces = await Promise.all(
          namespaces.map((namespace) => namespace.later()),
        );

        for (let index = 0; index < namespaces.length; index++) {
          const namespace = namespaces[index]!;
          assertStrictEquals(namespace, namespaces[0]);
          assertStrictEquals(cycleNamespaces[index], namespace);
          const wrapperUrl = namespace.wrapperUrl as string;
          const wrapperPath = fromFileUrl(wrapperUrl);
          assertStringIncludes(wrapperUrl, "/veryfront-cycle-manifests/");
          assertEquals(namespace.bracketUrl, wrapperUrl);
          assertEquals(namespace.aliasUrl, wrapperUrl);
          assertEquals(namespace.filename, wrapperPath);
          assertEquals(
            namespace.assetUrl,
            toFileUrl(join(dirname(wrapperPath), "asset.txt")).href,
          );
          assertEquals(
            namespace.resolvedAssetUrl,
            toFileUrl(join(dirname(wrapperPath), "asset.txt")).href,
          );
          assertStringIncludes(await namespace.readSelf(), `veryfront-cycle-member`);
        }
      },
    );
  });

  it("isolates concurrent source generations across a JavaScript cycle ancestor", async () => {
    const pageSource = (version: string) =>
      [
        `import { later, readSelf, wrapperVersion } from "../lib/wrapper.js";`,
        `export { later, readSelf, wrapperVersion };`,
        `export const version = ${JSON.stringify(version)};`,
      ].join("\n");
    const wrapperSource = (version: string) =>
      [
        `export { later } from "./a.ts";`,
        `export const wrapperVersion = ${JSON.stringify(version)};`,
        `export function readSelf() { return Deno.readTextFile(new URL(import.meta.url)); }`,
      ].join("\n");
    await withModuleLoaderFixture(
      {
        "app/page.ts": pageSource("disk"),
        "lib/wrapper.js": wrapperSource("disk"),
        "lib/a.ts": `export async function later() { return await import("../app/page.ts"); }`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const pagePath = join(projectDir, "app/page.ts");
        const wrapperPath = join(projectDir, "lib/wrapper.js");
        const adapterFor = (version: string) => {
          const fs = Object.assign(Object.create(config.adapter.fs), {
            readFile(path: string): Promise<string | Uint8Array> {
              if (path === pagePath) return Promise.resolve(pageSource(version));
              if (path === wrapperPath) return Promise.resolve(wrapperSource(version));
              return config.adapter.fs.readFile(path);
            },
          });
          return { ...config.adapter, fs };
        };
        const firstAdapter = adapterFor("one");
        const secondAdapter = adapterFor("two");
        const [firstPath, secondPath] = await Promise.all([
          transformModuleWithDeps(pagePath, tmpDir, firstAdapter, {
            ...config,
            adapter: firstAdapter,
            moduleCache: new Map(),
          }),
          transformModuleWithDeps(pagePath, tmpDir, secondAdapter, {
            ...config,
            adapter: secondAdapter,
            moduleCache: new Map(),
          }),
        ]);
        const [first, second] = await Promise.all([
          import(toFileUrl(firstPath).href),
          import(toFileUrl(secondPath).href),
        ]);
        const [firstCycle, secondCycle] = await Promise.all([
          first.later(),
          second.later(),
        ]);

        assertNotStrictEquals(firstPath, secondPath);
        assertStrictEquals(firstCycle, first);
        assertStrictEquals(secondCycle, second);
        assertEquals(firstCycle.version, "one");
        assertEquals(secondCycle.version, "two");
        assertEquals(first.wrapperVersion, "one");
        assertEquals(second.wrapperVersion, "two");
        assertStringIncludes(await first.readSelf(), `wrapperVersion = "one"`);
        assertStringIncludes(await second.readSelf(), `wrapperVersion = "two"`);
      },
    );
  });

  it("reuses the matching source generation from a shared disk path cache", async () => {
    const pageSource = (version: string) =>
      [
        `import { later } from "../lib/a.ts";`,
        `export { later };`,
        `export const version = ${JSON.stringify(version)};`,
      ].join("\n");
    await withModuleLoaderFixture(
      {
        "app/page.ts": pageSource("disk"),
        "lib/a.ts": `export async function later() { return await import("../app/page.ts"); }`,
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const pagePath = join(projectDir, "app/page.ts");
          const adapterFor = (version: string) => {
            const fs = Object.assign(Object.create(config.adapter.fs), {
              readFile(path: string): Promise<string | Uint8Array> {
                if (path === pagePath) return Promise.resolve(pageSource(version));
                return config.adapter.fs.readFile(path);
              },
            });
            return { ...config.adapter, fs };
          };
          const firstAdapter = adapterFor("one");
          const secondAdapter = adapterFor("two");
          const sharedConfig = {
            ...config,
            projectId: "cycle-snapshots",
            contentSourceId: "main",
          };
          const cacheDir = join(
            getMdxEsmCacheDir(),
            encodeURIComponent(sharedConfig.projectId),
            encodeURIComponent(sharedConfig.contentSourceId),
          );
          await Deno.mkdir(cacheDir, { recursive: true });
          const [firstPath, secondPath] = await Promise.all([
            transformModuleWithDeps(pagePath, cacheDir, firstAdapter, {
              ...sharedConfig,
              adapter: firstAdapter,
              moduleCache: new Map(),
            }),
            transformModuleWithDeps(pagePath, cacheDir, secondAdapter, {
              ...sharedConfig,
              adapter: secondAdapter,
              moduleCache: new Map(),
            }),
          ]);

          const againFirstPath = await transformModuleWithDeps(
            pagePath,
            cacheDir,
            firstAdapter,
            {
              ...sharedConfig,
              adapter: firstAdapter,
              moduleCache: new Map(),
            },
          );
          const againSecondPath = await transformModuleWithDeps(
            pagePath,
            cacheDir,
            secondAdapter,
            {
              ...sharedConfig,
              adapter: secondAdapter,
              moduleCache: new Map(),
            },
          );

          assertStrictEquals(againFirstPath, firstPath);
          assertStrictEquals(againSecondPath, secondPath);
          assertEquals((await import(toFileUrl(againFirstPath).href)).version, "one");
          assertEquals((await import(toFileUrl(againSecondPath).href)).version, "two");
        });
      },
    );
  });

  it("bounds source reads linearly when cached siblings share a dependency closure", async () => {
    const width = 12;
    const files: Record<string, string> = {};
    for (let index = 0; index < width; index++) {
      files[`lib/chain-${index}.ts`] = index + 1 < width
        ? `import "./chain-${index + 1}.ts"; export const value${index} = ${index};`
        : `export const value${index} = ${index};`;
      files[`lib/sibling-${index}.ts`] =
        `import "./chain-0.ts"; export const sibling${index} = ${index};`;
    }
    files["app/page.ts"] = Array.from(
      { length: width },
      (_, index) => `import "../lib/sibling-${index}.ts";`,
    ).join("\n") + `\nexport const ready = true;`;

    await withModuleLoaderFixture(
      files,
      async ({ projectDir, tmpDir, config }) => {
        for (let index = 0; index < width; index++) {
          await transformModuleWithDeps(
            join(projectDir, `lib/sibling-${index}.ts`),
            tmpDir,
            config.adapter,
            config,
          );
        }

        let projectSourceReads = 0;
        const readsByPath = new Map<string, number>();
        const countingFs = Object.assign(Object.create(config.adapter.fs), {
          async readFile(path: string): Promise<string | Uint8Array> {
            if (path.startsWith(projectDir) && path.endsWith(".ts")) {
              projectSourceReads++;
              readsByPath.set(path, (readsByPath.get(path) ?? 0) + 1);
            }
            return await config.adapter.fs.readFile(path);
          },
        });
        const countingAdapter = { ...config.adapter, fs: countingFs };
        await transformModuleWithDeps(
          join(projectDir, "app/page.ts"),
          tmpDir,
          countingAdapter,
          { ...config, adapter: countingAdapter },
        );

        assert(
          projectSourceReads <= width * 2 + 2,
          `expected linear reads for ${width * 2 + 1} sources, got ${projectSourceReads}: ${
            JSON.stringify([...readsByPath])
          }`,
        );
      },
    );
  });

  it("transforms a cold converging cycle graph once per source", async () => {
    const layerCount = 10;
    const files: Record<string, string> = {};
    for (let layer = 0; layer < layerCount; layer++) {
      for (const branch of ["a", "b"]) {
        files[`lib/${branch}-${layer}.ts`] = layer + 1 < layerCount
          ? [
            `import "./a-${layer + 1}.ts";`,
            `import "./b-${layer + 1}.ts";`,
            `export const value = "${branch}-${layer}";`,
          ].join("\n")
          : [
            `export async function later() { return await import("../app/page.ts"); }`,
            `export const value = "${branch}-${layer}";`,
          ].join("\n");
      }
    }
    files["app/page.ts"] = [
      `import "../lib/a-0.ts";`,
      `import "../lib/b-0.ts";`,
      `export const ready = true;`,
    ].join("\n");

    await withModuleLoaderFixture(
      files,
      async ({ projectDir, tmpDir, config }) => {
        const phaseCounts = new Map<string, number>();
        await transformModuleWithDeps(
          join(projectDir, "app/page.ts"),
          tmpDir,
          config.adapter,
          {
            ...config,
            onProgress: (progress) => {
              phaseCounts.set(progress.phase, (phaseCounts.get(progress.phase) ?? 0) + 1);
            },
          },
        );

        const sourceCount = layerCount * 2 + 1;
        assertEquals(phaseCounts.get("module:source-read"), sourceCount);
        assertEquals(phaseCounts.get("module:dependencies-transformed"), sourceCount);
        assertEquals(phaseCounts.get("module:persisted"), sourceCount);
      },
    );
  });

  it("shares one live namespace across converging cycle branches", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `import * as a from "../lib/a.ts";`,
          `import * as b from "../lib/b.ts";`,
          `export { a, b };`,
        ].join("\n"),
        "lib/a.ts": [
          `import { later } from "./c.ts";`,
          `export let count = 0;`,
          `export function increment() { count += 1; }`,
          `export { later };`,
        ].join("\n"),
        "lib/b.ts": [
          `import { later } from "./c.ts";`,
          `export { later };`,
        ].join("\n"),
        "lib/c.ts": `export async function later() { return await import("./a.ts"); }`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const rootPath = await transformModuleWithDeps(
          join(projectDir, "app/page.ts"),
          tmpDir,
          config.adapter,
          config,
        );
        const root = await import(toFileUrl(rootPath).href);
        const [fromA, fromB] = await Promise.all([root.a.later(), root.b.later()]);

        assertStrictEquals(fromA, root.a);
        assertStrictEquals(fromB, root.a);
        root.a.increment();
        assertEquals(fromB.count, 1);
      },
    );
  });

  it("breaks a cycle formed through a converging in-flight dependency", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `import * as a from "../lib/a.ts";`,
          `import * as b from "../lib/b.ts";`,
          `export { a, b };`,
        ].join("\n"),
        "lib/a.ts": `export { later } from "./c.ts";`,
        "lib/b.ts": `export { later } from "./c.ts"; export const branch = "b";`,
        "lib/c.ts": `export async function later() { return await import("./b.ts"); }`,
      },
      async ({ projectDir, tmpDir, config }) => {
        let timer = 0;
        const rootPath = await Promise.race([
          transformModuleWithDeps(
            join(projectDir, "app/page.ts"),
            tmpDir,
            config.adapter,
            config,
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("converging cycle deadlocked")), 2_000);
          }),
        ]).finally(() => clearTimeout(timer));
        const root = await import(toFileUrl(rootPath).href);
        const [fromA, fromB] = await Promise.all([root.a.later(), root.b.later()]);

        assertStrictEquals(fromA, root.b);
        assertStrictEquals(fromB, root.b);
      },
    );
  });

  it("loads a TypeScript cycle below an authored JavaScript root", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.js": [
          `import { later } from "../lib/b.ts";`,
          `export { later };`,
          `export const rootUrl = import.meta.url;`,
        ].join("\n"),
        "lib/b.ts": [
          `import { later } from "./c.ts";`,
          `export { later };`,
          `export const member = "b";`,
        ].join("\n"),
        "lib/c.ts": `export async function later() { return await import("./b.ts"); }`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const rootPath = await transformModuleWithDeps(
          join(projectDir, "app/page.js"),
          tmpDir,
          config.adapter,
          config,
        );
        const rootNamespace = await import(toFileUrl(rootPath).href);
        const cycleNamespace = await rootNamespace.later();

        assertStringIncludes(rootPath, "/veryfront-cycle-manifests/");
        assertEquals(rootNamespace.rootUrl, toFileUrl(rootPath).href);
        assertEquals(cycleNamespace.member, "b");
      },
    );
  });

  it("isolates concurrent JavaScript roots above a TypeScript cycle", async () => {
    const pageSource = (version: string) =>
      [
        `import { later } from "../lib/b.ts";`,
        `export { later };`,
        `export const version = ${JSON.stringify(version)};`,
        `export function readSelf() { return Deno.readTextFile(new URL(import.meta.url)); }`,
      ].join("\n");
    await withModuleLoaderFixture(
      {
        "app/page.js": pageSource("disk"),
        "lib/b.ts": `export { later } from "./c.ts";`,
        "lib/c.ts": `export async function later() { return await import("./b.ts"); }`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const pagePath = join(projectDir, "app/page.js");
        const adapterFor = (version: string) => {
          const fs = Object.assign(Object.create(config.adapter.fs), {
            readFile(path: string): Promise<string | Uint8Array> {
              return path === pagePath
                ? Promise.resolve(pageSource(version))
                : config.adapter.fs.readFile(path);
            },
          });
          return { ...config.adapter, fs };
        };
        const firstAdapter = adapterFor("one");
        const secondAdapter = adapterFor("two");

        const [firstPath, secondPath] = await Promise.all([
          transformModuleWithDeps(pagePath, tmpDir, firstAdapter, {
            ...config,
            adapter: firstAdapter,
            moduleCache: new Map(),
          }),
          transformModuleWithDeps(pagePath, tmpDir, secondAdapter, {
            ...config,
            adapter: secondAdapter,
            moduleCache: new Map(),
          }),
        ]);
        const [first, second] = await Promise.all([
          import(toFileUrl(firstPath).href),
          import(toFileUrl(secondPath).href),
        ]);

        assertNotStrictEquals(firstPath, secondPath);
        assertEquals(first.version, "one");
        assertEquals(second.version, "two");
        assertStringIncludes(await first.readSelf(), `version = "one"`);
        assertStringIncludes(await second.readSelf(), `version = "two"`);
      },
    );
  });

  it("does not reuse a former cycle member when it becomes the graph root", async () => {
    const pageSource = (version: string) =>
      [
        `import later from "../lib/a.ts";`,
        `export const version = ${JSON.stringify(version)};`,
        `export { later };`,
      ].join("\n");

    await withModuleLoaderFixture(
      {
        "app/page.ts": pageSource("first"),
        "lib/a.ts": [
          `export async function later() { return await import("../app/page.ts"); }`,
          `export default later;`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        const pagePath = join(projectDir, "app/page.ts");
        const memberPath = join(projectDir, "lib/a.ts");
        await transformModuleWithDeps(pagePath, tmpDir, config.adapter, config);

        config.moduleCache.delete(
          getModuleCacheKey(
            pagePath,
            config.projectId,
            config.projectDir,
            config.contentSourceId,
            config.reactVersion,
            config.mode,
          ),
        );
        await Deno.writeTextFile(pagePath, pageSource("second"));

        const newRootPath = await transformModuleWithDeps(
          memberPath,
          tmpDir,
          config.adapter,
          config,
        );
        const memberNamespace = await import(toFileUrl(newRootPath).href);
        const pageNamespace = await memberNamespace.later();

        assertEquals(pageNamespace.version, "second");
      },
    );
  });

  it("does not mistake authored marker text for cycle cache evidence", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": `export const authored = "//# veryfront-cycle-manifest:v1";`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const pagePath = join(projectDir, "app/page.ts");
        let sourceReads = 0;
        config.onProgress = (event) => {
          if (event.phase === "module:source-read" && event.filePath === pagePath) {
            sourceReads++;
          }
        };

        const firstPath = await transformModuleWithDeps(
          pagePath,
          tmpDir,
          config.adapter,
          config,
        );
        const secondPath = await transformModuleWithDeps(
          pagePath,
          tmpDir,
          config.adapter,
          config,
        );

        assertStrictEquals(secondPath, firstPath);
        assertEquals(sourceReads, 1);
      },
    );
  });

  it("keeps authored JavaScript reusable when its path resembles manifest storage", async () => {
    const relativePath = "_cycle-manifests/authored/artifacts/0.deadbeef.js";
    await withModuleLoaderFixture(
      { [relativePath]: `export const authored = true;` },
      async ({ projectDir, tmpDir, config }) => {
        let sourceReads = 0;
        const countingConfig: ModuleLoaderConfig = {
          ...config,
          onProgress: (progress) => {
            if (progress.phase === "module:source-read") sourceReads++;
          },
        };
        const sourcePath = join(projectDir, relativePath);
        const firstPath = await transformModuleWithDeps(
          sourcePath,
          tmpDir,
          config.adapter,
          countingConfig,
        );
        const secondPath = await transformModuleWithDeps(
          sourcePath,
          tmpDir,
          config.adapter,
          countingConfig,
        );

        assertStrictEquals(secondPath, firstPath);
        assertEquals(sourceReads, 1);
      },
    );
  });

  it("reuses an authored filename that resembles the retired cycle suffix", async () => {
    await withModuleLoaderFixture(
      {
        "lib/authored.cycle.deadbeef.js": `export const owner = "authored";`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const filePath = join(projectDir, "lib/authored.cycle.deadbeef.js");
        let sourceReads = 0;
        config.onProgress = (event) => {
          if (event.phase === "module:source-read" && event.filePath === filePath) {
            sourceReads++;
          }
        };

        const firstPath = await transformModuleWithDeps(
          filePath,
          tmpDir,
          config.adapter,
          config,
        );
        const secondPath = await transformModuleWithDeps(
          filePath,
          tmpDir,
          config.adapter,
          config,
        );

        assertStrictEquals(secondPath, firstPath);
        assertEquals(sourceReads, 1);
      },
    );
  });

  it("rebuilds a cached cycle closure when its manifest entry disappears", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `import { later } from "../lib/a.ts";`,
          `export const value = "recovered";`,
          `export { later };`,
        ].join("\n"),
        "lib/a.ts": `export async function later() { return await import("../app/page.ts"); }`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const pagePath = join(projectDir, "app/page.ts");
        const firstPath = await transformModuleWithDeps(
          pagePath,
          tmpDir,
          config.adapter,
          config,
        );
        const depPath = assertTransformedImportPath(
          await Deno.readTextFile(firstPath),
          "/veryfront-cycle-manifests/",
        );
        const depCode = await Deno.readTextFile(depPath);
        const manifestUrl = depCode.match(
          /import\("(file:\/\/[^"\n]+\/veryfront-cycle-manifests\/[^"\n]+)"\)/,
        )
          ?.[1];
        assert(manifestUrl, depCode);
        await Deno.remove(fromFileUrl(manifestUrl));

        const rebuiltPath = await transformModuleWithDeps(
          pagePath,
          tmpDir,
          config.adapter,
          config,
        );
        const rebuiltNamespace = await import(toFileUrl(rebuiltPath).href);
        const cycleNamespace = await rebuiltNamespace.later();

        assertNotStrictEquals(rebuiltPath, firstPath);
        assertEquals(cycleNamespace.value, "recovered");
      },
    );
  });

  it("rebuilds a cached cycle closure when a static member artifact disappears", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `import { later } from "../lib/a.ts";`,
          `export const value = "recovered";`,
          `export { later };`,
        ].join("\n"),
        "lib/a.ts": `export async function later() { return await import("../app/page.ts"); }`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const pagePath = join(projectDir, "app/page.ts");
        const firstPath = await transformModuleWithDeps(
          pagePath,
          tmpDir,
          config.adapter,
          config,
        );
        const memberPath = assertTransformedImportPath(
          await Deno.readTextFile(firstPath),
          "/veryfront-cycle-manifests/",
        );
        await Deno.remove(memberPath);

        const rebuiltPath = await transformModuleWithDeps(
          pagePath,
          tmpDir,
          config.adapter,
          config,
        );
        const rebuilt = await import(toFileUrl(rebuiltPath).href);

        assertNotStrictEquals(rebuiltPath, firstPath);
        assertStrictEquals(await rebuilt.later(), rebuilt);
      },
    );
  });

  it("rejects a cached cycle closure whose member bytes are corrupted", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `import { later } from "../lib/a.ts";`,
          `export const value = "original";`,
          `export { later };`,
        ].join("\n"),
        "lib/a.ts": `export async function later() { return await import("../app/page.ts"); }`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const rootPath = await transformModuleWithDeps(
          join(projectDir, "app/page.ts"),
          tmpDir,
          config.adapter,
          config,
        );
        const memberPath = assertTransformedImportPath(
          await Deno.readTextFile(rootPath),
          "/veryfront-cycle-manifests/",
        );
        await Deno.writeTextFile(memberPath, `export const corrupted = true;`);

        assertEquals(
          await inspectCycleManifestCache(rootPath, tmpDir, config.adapter),
          "invalid",
        );
      },
    );
  });

  it("rebuilds when both a cycle entry and its cache evidence disappear", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `import { later } from "../lib/a.ts";`,
          `export const value = "recovered";`,
          `export { later };`,
        ].join("\n"),
        "lib/a.ts": `export async function later() { return await import("../app/page.ts"); }`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const pagePath = join(projectDir, "app/page.ts");
        const firstPath = await transformModuleWithDeps(
          pagePath,
          tmpDir,
          config.adapter,
          config,
        );
        const depPath = assertTransformedImportPath(
          await Deno.readTextFile(firstPath),
          "/veryfront-cycle-manifests/",
        );
        const depCode = await Deno.readTextFile(depPath);
        const manifestUrl = depCode.match(
          /import\("(file:\/\/[^"\n]+\/veryfront-cycle-manifests\/[^"\n]+)"\)/,
        )
          ?.[1];
        assert(manifestUrl, depCode);
        await Deno.remove(fromFileUrl(manifestUrl));
        await Deno.remove(`${firstPath}${CYCLE_MANIFEST_SIDECAR_SUFFIX}`);

        const rebuiltPath = await transformModuleWithDeps(
          pagePath,
          tmpDir,
          config.adapter,
          config,
        );
        const rebuiltNamespace = await import(toFileUrl(rebuiltPath).href);
        const cycleNamespace = await rebuiltNamespace.later();

        assertNotStrictEquals(rebuiltPath, firstPath);
        assertStrictEquals(cycleNamespace, rebuiltNamespace);
        assertEquals(cycleNamespace.value, "recovered");
      },
    );
  });

  it("rebuilds a cached cycle closure when its manifest entry is corrupted", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `import { later } from "../lib/a.ts";`,
          `export const value = "original";`,
          `export { later };`,
        ].join("\n"),
        "lib/a.ts": `export async function later() { return await import("../app/page.ts"); }`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const pagePath = join(projectDir, "app/page.ts");
        const firstPath = await transformModuleWithDeps(
          pagePath,
          tmpDir,
          config.adapter,
          config,
        );
        const depPath = assertTransformedImportPath(
          await Deno.readTextFile(firstPath),
          "/veryfront-cycle-manifests/",
        );
        const depCode = await Deno.readTextFile(depPath);
        const manifestUrl = depCode.match(
          /import\("(file:\/\/[^"\n]+\/veryfront-cycle-manifests\/[^"\n]+)"\)/,
        )
          ?.[1];
        assert(manifestUrl, depCode);
        await Deno.writeTextFile(
          fromFileUrl(manifestUrl),
          `export const value = "corrupted"; export default "wrong";`,
        );

        const rebuiltPath = await transformModuleWithDeps(
          pagePath,
          tmpDir,
          config.adapter,
          config,
        );
        const rebuiltNamespace = await import(toFileUrl(rebuiltPath).href);
        const cycleNamespace = await rebuiltNamespace.later();

        assertNotStrictEquals(rebuiltPath, firstPath);
        assertStrictEquals(cycleNamespace, rebuiltNamespace);
        assertEquals(cycleNamespace.value, "original");
      },
    );
  });

  it("keeps an unrelated cached leaf reusable after a cyclic graph", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `import { later } from "../lib/a.ts";`,
          `import { shared } from "../lib/shared.ts";`,
          `export const value = shared;`,
          `export { later };`,
        ].join("\n"),
        "lib/a.ts": `export async function later() { return await import("../app/page.ts"); }`,
        "lib/shared.ts": `export const shared = "shared";`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const pagePath = join(projectDir, "app/page.ts");
        const sharedPath = join(projectDir, "lib/shared.ts");
        await transformModuleWithDeps(pagePath, tmpDir, config.adapter, config);

        let sharedSourceReads = 0;
        config.onProgress = (event) => {
          if (event.phase === "module:source-read" && event.filePath === sharedPath) {
            sharedSourceReads++;
          }
        };
        await transformModuleWithDeps(sharedPath, tmpDir, config.adapter, config);
        await transformModuleWithDeps(sharedPath, tmpDir, config.adapter, config);

        assertEquals(sharedSourceReads, 0);
      },
    );
  });

  it("resolves relative imports before rewriting them to file URLs", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.json": [
          `import { value } from "../lib/value.json";`,
          `export const pageValue = value;`,
        ].join("\n"),
        "lib/value.json": `export const value = "relative-value";`,
      },
      async ({ projectDir, tmpDir, config }) => {
        const transformedPath = await transformModuleWithDeps(
          join(projectDir, "app/page.json"),
          tmpDir,
          config.adapter,
          config,
        );
        const transformedCode = await Deno.readTextFile(transformedPath);
        const depPath = assertTransformedImportPath(transformedCode, "/lib/value.json");

        assertStringIncludes(transformedPath, "/app/page.json");
        assertEquals((await Deno.stat(depPath)).isFile, true);
      },
    );
  });

  it("bounds dependency transforms by the shared configurable transform semaphore", async () => {
    const semaphore = getTransformSemaphore();
    const configuredLimit = getMaxConcurrentTransforms();
    assert(configuredLimit > 0, "test expects SSR_MAX_CONCURRENT_TRANSFORMS to be enabled");

    // Occupy most of the operator-configured pool the way concurrent SSR
    // component transforms would. The loader must bound itself by what remains:
    // a scheduler that ignored SSR_MAX_CONCURRENT_TRANSFORMS or drew from a
    // parallel hard-coded pool would overshoot `expectedBound` and leave shared
    // permits available at saturation.
    const expectedBound = Math.min(4, configuredLimit);
    const dependencyCount = expectedBound + 5;
    const files: Record<string, string> = {
      "app/page.json": Array.from(
        { length: dependencyCount },
        (_, index) => `import "../lib/dep-${index}.json";`,
      ).join("\n"),
    };
    for (let index = 0; index < dependencyCount; index++) {
      files[`lib/dep-${index}.json`] = `export const value = ${index};`;
    }

    const releaseReserved = await reserveTransformPermits(configuredLimit - expectedBound);
    try {
      await withModuleLoaderFixture(
        files,
        async ({ projectDir, tmpDir, config }) => {
          // Every transform stalls while holding its permit until the pool is
          // saturated, so the observed maximum is the scheduler's true bound
          // rather than an accident of transform latency.
          let maxActiveTransforms = 0;
          let sharedPermitsAvailableAtSaturation = -1;
          let saturate: (() => void) | undefined;
          const saturated = new Promise<void>((resolve) => {
            saturate = resolve;
          });
          __setModuleTransformActivityObserverForTests((activeCount) => {
            maxActiveTransforms = Math.max(maxActiveTransforms, activeCount);
            if (activeCount >= expectedBound && sharedPermitsAvailableAtSaturation === -1) {
              sharedPermitsAvailableAtSaturation = semaphore.available;
              saturate?.();
            }
            return saturated;
          });

          try {
            await transformModuleWithDeps(
              join(projectDir, "app/page.json"),
              tmpDir,
              config.adapter,
              config,
            );
          } finally {
            __setModuleTransformActivityObserverForTests(undefined);
          }

          assertEquals(
            maxActiveTransforms,
            expectedBound,
            "dependency transforms must be bounded by the shared pool's remaining capacity",
          );
          assertEquals(
            sharedPermitsAvailableAtSaturation,
            0,
            "saturation must exhaust the shared transform semaphore, proving one pool",
          );
        },
      );
    } finally {
      releaseReserved();
    }
  });

  it("applies the per-project transform limit to dependency transforms", async () => {
    const previousLimit = Deno.env.get("SSR_TRANSFORM_PER_PROJECT_LIMIT");
    Deno.env.set("SSR_TRANSFORM_PER_PROJECT_LIMIT", "1");
    resetCachedTransformLimits();

    const dependencyCount = 6;
    const files: Record<string, string> = {
      "app/page.json": Array.from(
        { length: dependencyCount },
        (_, index) => `import "../lib/dep-${index}.json";`,
      ).join("\n"),
    };
    for (let index = 0; index < dependencyCount; index++) {
      files[`lib/dep-${index}.json`] = `export const value = ${index};`;
    }

    let maxActiveTransforms = 0;
    __setModuleTransformActivityObserverForTests((activeCount) => {
      maxActiveTransforms = Math.max(maxActiveTransforms, activeCount);
      return delay(100);
    });
    try {
      await withModuleLoaderFixture(
        files,
        async ({ projectDir, tmpDir, config }) => {
          config.mode = "production";
          config.projectId = "bounded-dependency-project";
          await transformModuleWithDeps(
            join(projectDir, "app/page.json"),
            tmpDir,
            config.adapter,
            config,
          );
        },
      );
      assertEquals(
        maxActiveTransforms,
        1,
        "one project must not exceed its configured transform capacity",
      );
    } finally {
      __setModuleTransformActivityObserverForTests(undefined);
      if (previousLimit === undefined) {
        Deno.env.delete("SSR_TRANSFORM_PER_PROJECT_LIMIT");
      } else {
        Deno.env.set("SSR_TRANSFORM_PER_PROJECT_LIMIT", previousLimit);
      }
      resetCachedTransformLimits();
    }
  });

  it("keeps a permit waiter alive while a holder reports transform progress", async () => {
    const configuredLimit = getMaxConcurrentTransforms();
    assert(configuredLimit > 0, "test expects SSR_MAX_CONCURRENT_TRANSFORMS to be enabled");
    const releaseReserved = await reserveTransformPermits(configuredLimit - 1);
    const stallWindowMs = scaleMs(400);
    __setModuleTransformStallTimeoutForTests(stallWindowMs);

    let holderStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      holderStarted = resolve;
    });
    try {
      const holder = withModuleTransformPermit(
        {
          projectId: "progress-holder-project",
          dev: true,
        },
        async (reportProgress) => {
          holderStarted?.();
          for (let index = 0; index < 3; index++) {
            await delay(stallWindowMs / 2);
            reportProgress();
          }
        },
      );
      await started;

      let waiterRan = false;
      const waiter = withModuleTransformPermit(
        {
          projectId: "progress-waiter-project",
          dev: true,
        },
        () => {
          waiterRan = true;
          return Promise.resolve();
        },
      );

      await Promise.all([holder, waiter]);
      assertEquals(waiterRan, true);
    } finally {
      __setModuleTransformStallTimeoutForTests(undefined);
      releaseReserved();
    }
  });

  it("completes a nested fan-out wider than the transform permit pool", async () => {
    // Regression: scheduling that holds a concurrency permit across the
    // recursive dependency fan-out lets importers exhaust the pool and starve
    // their own children into acquisition timeouts. Shrink the shared pool by
    // reserving permits so the importer tier alone is wider than what remains.
    const semaphore = getTransformSemaphore();
    const configuredLimit = getMaxConcurrentTransforms();
    assert(configuredLimit > 0, "test expects SSR_MAX_CONCURRENT_TRANSFORMS to be enabled");
    const effectivePool = Math.min(8, configuredLimit);
    const dependencyCount = effectivePool + 1;
    const files: Record<string, string> = {
      "app/page.json": Array.from(
        { length: dependencyCount },
        (_, index) => `import "../lib/dep-${index}.json";`,
      ).join("\n"),
    };
    for (let index = 0; index < dependencyCount; index++) {
      files[`lib/dep-${index}.json`] = [
        `import "./leaf-${index}.json";`,
        `export const value = ${index};`,
      ].join("\n");
      files[`lib/leaf-${index}.json`] = `export const leaf = ${index};`;
    }

    const releaseReserved = await reserveTransformPermits(configuredLimit - effectivePool);
    // A regressed scheduler fails via a stuck-pool timeout; keep that fast
    // while staying far above the runtime of a healthy batch of transforms.
    __setModuleTransformStallTimeoutForTests(10_000);
    try {
      await withModuleLoaderFixture(
        files,
        async ({ projectDir, tmpDir, config }) => {
          const transformedPath = await transformModuleWithDeps(
            join(projectDir, "app/page.json"),
            tmpDir,
            config.adapter,
            config,
          );

          // Match path components portably; the transformed path uses the
          // platform's separators.
          assertStringIncludes(transformedPath, join("app", "page"));
          assertEquals((await Deno.stat(transformedPath)).isFile, true);
        },
      );
    } finally {
      __setModuleTransformStallTimeoutForTests(undefined);
      releaseReserved();
      assertEquals(
        semaphore.available,
        configuredLimit,
        "the fan-out must return every shared transform permit",
      );
    }
  });

  it("keeps queued transforms alive while the pool makes progress", async () => {
    // A wide cold graph queues far more transforms than there are permits, so
    // the last waiters wait much longer than one stall window. As long as
    // permits keep cycling, no waiter may time out: expiry is a liveness
    // window that re-arms on progress, not one absolute deadline shared by
    // every waiter from the initial fan-out.
    const configuredLimit = getMaxConcurrentTransforms();
    assert(configuredLimit > 0, "test expects SSR_MAX_CONCURRENT_TRANSFORMS to be enabled");
    const effectivePool = Math.min(2, configuredLimit);
    const dependencyCount = 12;
    const files: Record<string, string> = {
      "app/page.json": Array.from(
        { length: dependencyCount },
        (_, index) => `import "../lib/dep-${index}.json";`,
      ).join("\n"),
    };
    for (let index = 0; index < dependencyCount; index++) {
      files[`lib/dep-${index}.json`] = `export const value = ${index};`;
    }

    const releaseReserved = await reserveTransformPermits(configuredLimit - effectivePool);
    // Each transform holds its permit noticeably shorter than the stall
    // window, but the whole queue takes several windows to drain: with two
    // permits and thirteen transforms the last waiter outlives the window
    // multiple times over and only survives because completions re-arm it.
    __setModuleTransformStallTimeoutForTests(scaleMs(400));
    __setModuleTransformActivityObserverForTests(() => delay(150));
    try {
      await withModuleLoaderFixture(
        files,
        async ({ projectDir, tmpDir, config }) => {
          const transformedPath = await transformModuleWithDeps(
            join(projectDir, "app/page.json"),
            tmpDir,
            config.adapter,
            config,
          );
          assertEquals(
            (await Deno.stat(transformedPath)).isFile,
            true,
            "a slow but moving pool must drain the whole graph without timeouts",
          );
        },
      );
    } finally {
      __setModuleTransformActivityObserverForTests(undefined);
      __setModuleTransformStallTimeoutForTests(undefined);
      releaseReserved();
    }
  });

  it("fails a transform whose permit wait sees no progress at all", async () => {
    // The liveness window must still be a real failure bound: when every
    // permit is held by wedged work and nothing cycles for a whole window,
    // waiting longer cannot help and the waiter must surface a timeout.
    const semaphore = getTransformSemaphore();
    const configuredLimit = getMaxConcurrentTransforms();
    assert(configuredLimit > 0, "test expects SSR_MAX_CONCURRENT_TRANSFORMS to be enabled");

    const releaseReserved = await reserveTransformPermits(configuredLimit);
    assertEquals(semaphore.available, 0, "the whole pool must be wedged for this test");
    __setModuleTransformStallTimeoutForTests(scaleMs(400));
    try {
      await withModuleLoaderFixture(
        { "app/page.json": `export const value = 1;` },
        async ({ projectDir, tmpDir, config }) => {
          const error = await assertRejects(() =>
            transformModuleWithDeps(
              join(projectDir, "app/page.json"),
              tmpDir,
              config.adapter,
              config,
            )
          );
          assert(
            error instanceof VeryfrontError,
            "a stuck permit wait must fail with a registry error",
          );
          assertEquals(
            error.slug,
            "timeout-error",
            "a stuck permit wait must be classified as a timeout",
          );
        },
      );
    } finally {
      __setModuleTransformStallTimeoutForTests(undefined);
      releaseReserved();
    }
  });

  it("does not hold transform permits for followers of an in-flight transform", async () => {
    // Two module graphs share one cold dependency. The second caller must
    // attach to the first caller's in-flight compute without consuming a
    // permit: followers holding permits while a single leader computes can
    // occupy the entire pool with waiting.
    const semaphore = getTransformSemaphore();
    const configuredLimit = getMaxConcurrentTransforms();
    assert(configuredLimit > 0, "test expects SSR_MAX_CONCURRENT_TRANSFORMS to be enabled");

    const files: Record<string, string> = {
      "app/page-a.json": `import "../lib/shared.json";`,
      "app/page-b.json": `import "../lib/shared.json";`,
      "lib/shared.json": `export const shared = true;`,
    };

    // Leave exactly one permit: the leader takes it, and any follower that
    // wrongly queued for a permit becomes visible in `semaphore.waiting`.
    const releaseReserved = await reserveTransformPermits(configuredLimit - 1);
    try {
      await withModuleLoaderFixture(
        files,
        async ({ projectDir, tmpDir, config }) => {
          let maxActiveTransforms = 0;
          let stallLeader = true;
          let leaderStalled: (() => void) | undefined;
          const leaderHoldsPermit = new Promise<void>((resolve) => {
            leaderStalled = resolve;
          });
          let releaseLeader: (() => void) | undefined;
          const leaderReleased = new Promise<void>((resolve) => {
            releaseLeader = resolve;
          });
          __setModuleTransformActivityObserverForTests((activeCount) => {
            maxActiveTransforms = Math.max(maxActiveTransforms, activeCount);
            if (!stallLeader) return;
            stallLeader = false;
            leaderStalled?.();
            return leaderReleased;
          });

          let permitQueueDepthDuringLeaderStall = -1;
          try {
            // The shared dependency transforms before either root module, so
            // the first observer activation is its leader holding the permit.
            const firstRoot = transformModuleWithDeps(
              join(projectDir, "app/page-a.json"),
              tmpDir,
              config.adapter,
              config,
            );
            await leaderHoldsPermit;

            const secondRoot = transformModuleWithDeps(
              join(projectDir, "app/page-b.json"),
              tmpDir,
              config.adapter,
              config,
            );
            // Give the second graph time to reach the shared dependency's
            // in-flight compute while the leader still holds the only permit.
            await delay(250);
            permitQueueDepthDuringLeaderStall = semaphore.waiting;
            releaseLeader?.();

            const [firstPath, secondPath] = await Promise.all([firstRoot, secondRoot]);
            assertEquals((await Deno.stat(firstPath)).isFile, true);
            assertEquals((await Deno.stat(secondPath)).isFile, true);
          } finally {
            releaseLeader?.();
            __setModuleTransformActivityObserverForTests(undefined);
          }

          assertEquals(
            permitQueueDepthDuringLeaderStall,
            0,
            "a follower of an in-flight transform must not queue for a permit",
          );
          assertEquals(
            maxActiveTransforms,
            1,
            "the shared dependency must be computed once, by a single permit holder",
          );
        },
      );
    } finally {
      releaseReserved();
    }
  });
});

describe("module-loader/loadModule build-failure tagging", () => {
  it("ignores inherited build-failure tags", () => {
    const buildFailureTag = Symbol.for("veryfront.module-loader.build-failure");
    const tenantBuildFailureTag = Symbol.for("veryfront.module-loader.tenant-build-failure");
    const previousBuildDescriptor = Object.getOwnPropertyDescriptor(
      Error.prototype,
      buildFailureTag,
    );
    const previousTenantDescriptor = Object.getOwnPropertyDescriptor(
      Error.prototype,
      tenantBuildFailureTag,
    );
    Object.defineProperty(Error.prototype, buildFailureTag, { configurable: true, value: true });
    Object.defineProperty(Error.prototype, tenantBuildFailureTag, {
      configurable: true,
      value: true,
    });

    try {
      const frameworkError = new Error("framework failed");
      assertEquals(isBuildFailure(frameworkError), false);
      assertEquals(isTenantBuildFailure(frameworkError), false);

      const tenantError = new Error("tenant failed");
      assertStrictEquals(markTenantBuildFailure(tenantError), tenantError);
      assertEquals(isBuildFailure(tenantError), true);
      assertEquals(isTenantBuildFailure(tenantError), true);

      const accessorTagError = new Error("framework failed");
      let buildGetterRead = false;
      let tenantGetterRead = false;
      Object.defineProperty(accessorTagError, buildFailureTag, {
        configurable: true,
        get() {
          buildGetterRead = true;
          return true;
        },
      });
      Object.defineProperty(accessorTagError, tenantBuildFailureTag, {
        configurable: true,
        get() {
          tenantGetterRead = true;
          return true;
        },
      });

      assertEquals(isBuildFailure(accessorTagError), false);
      assertEquals(isTenantBuildFailure(accessorTagError), false);
      assertEquals(buildGetterRead, false);
      assertEquals(tenantGetterRead, false);
    } finally {
      if (previousBuildDescriptor) {
        Object.defineProperty(Error.prototype, buildFailureTag, previousBuildDescriptor);
      } else {
        delete (Error.prototype as { [buildFailureTag]?: unknown })[buildFailureTag];
      }
      if (previousTenantDescriptor) {
        Object.defineProperty(Error.prototype, tenantBuildFailureTag, previousTenantDescriptor);
      } else {
        delete (Error.prototype as { [tenantBuildFailureTag]?: unknown })[tenantBuildFailureTag];
      }
    }
  });

  it("rejects prototype-polluted accessor tag descriptors", () => {
    const buildFailureTag = Symbol.for("veryfront.module-loader.build-failure");
    const tenantBuildFailureTag = Symbol.for("veryfront.module-loader.tenant-build-failure");
    const previousDescriptorValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    const previousHasOwnProperty = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "hasOwnProperty",
    );
    assert(previousHasOwnProperty);
    const frameworkError = new Error("framework failed");
    Object.defineProperty(frameworkError, buildFailureTag, {
      configurable: true,
      get: undefined,
      set: undefined,
    });
    Object.defineProperty(frameworkError, tenantBuildFailureTag, {
      configurable: true,
      get: undefined,
      set: undefined,
    });
    Object.defineProperty(Object.prototype, "hasOwnProperty", {
      ...previousHasOwnProperty,
      value: () => true,
    });
    Object.defineProperty(Object.prototype, "value", { configurable: true, value: true });

    try {
      assertEquals(isBuildFailure(frameworkError), false);
      assertEquals(isTenantBuildFailure(frameworkError), false);
    } finally {
      if (previousDescriptorValue) {
        Object.defineProperty(Object.prototype, "value", previousDescriptorValue);
      } else {
        delete (Object.prototype as { value?: unknown }).value;
      }
      Object.defineProperty(Object.prototype, "hasOwnProperty", previousHasOwnProperty);
    }
  });

  it("ignores poisoned Reflect descriptor lookups when reading build-failure tags", () => {
    const previousDescriptor = Object.getOwnPropertyDescriptor(
      Reflect,
      "getOwnPropertyDescriptor",
    );
    assert(previousDescriptor);
    Object.defineProperty(Reflect, "getOwnPropertyDescriptor", {
      ...previousDescriptor,
      value: () => ({
        configurable: true,
        enumerable: false,
        value: true,
        writable: false,
      }),
    });

    try {
      const frameworkError = new Error("framework failed");
      assertEquals(isBuildFailure(frameworkError), false);
      assertEquals(isTenantBuildFailure(frameworkError), false);
    } finally {
      Object.defineProperty(Reflect, "getOwnPropertyDescriptor", previousDescriptor);
    }
  });

  it("uses the definition intrinsic captured during module initialization", () => {
    const tenantBuildFailureTag = Symbol.for("veryfront.module-loader.tenant-build-failure");
    const defineProperty = Object.defineProperty;
    const previous = Object.getOwnPropertyDescriptor(Object, "defineProperty");
    if (!previous || typeof previous.value !== "function") {
      throw new Error("Expected Object.defineProperty descriptor");
    }
    defineProperty(Object, "defineProperty", {
      ...previous,
      value: (target: object, tag: PropertyKey, descriptor: PropertyDescriptor) => {
        defineProperty(target, tenantBuildFailureTag, { configurable: true, value: true });
        return defineProperty(target, tag, descriptor);
      },
    });

    try {
      const frameworkError = new Error("framework failed");
      assertStrictEquals(markBuildFailure(frameworkError), frameworkError);
      assertEquals(isBuildFailure(frameworkError), true);
      assertEquals(isTenantBuildFailure(frameworkError), false);

      const tenantError = new Error("tenant failed");
      assertStrictEquals(markTenantBuildFailure(tenantError), tenantError);
      assertEquals(isBuildFailure(tenantError), true);
      assertEquals(isTenantBuildFailure(tenantError), true);
    } finally {
      defineProperty(Object, "defineProperty", previous);
    }
  });

  // Compiling a real page module starts esbuild's child process; stop it so the
  // test does not leak the handle rather than opting out of the sanitizer.
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  // A page whose module ran and threw is an application bug the project's own
  // error page should present. A page that never compiled is a developer-facing
  // build failure. Only the loader can tell them apart, so it tags the error.
  it("tags a failure from the transform step", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import logo from "@/assets/logo.svg";`,
          `export default function Page() { return logo; }`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.tsx"), config),
            Error,
          );

          assertEquals(isBuildFailure(error), true);
          assertEquals(
            isTenantBuildFailure(error),
            false,
            "an asset-import compile failure is framework-owned: the transform seam must not attribute it to the tenant",
          );
        });
      },
    );
  });

  it("does not tag a module that compiled and threw at module scope", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `throw new Error("Missing API key");`,
          `export const value = "unreachable";`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.ts"), config),
            Error,
            "Missing API key",
          );

          assertEquals(isBuildFailure(error), false);
        });
      },
    );
  });

  // A relative import that resolves to nothing is dropped by
  // `resolveModuleDependencies` and survives into the built module as authored,
  // so the failure only surfaces at `import()` time as ERR_MODULE_NOT_FOUND —
  // after the self-heal rebuild has already retried it. That rejection used to
  // leave `loadModule` untagged, so a tenant typo in an import path was
  // reported at error level forever.
  it("tags a missing local static import as a tenant build failure", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { label } from "./missing";`,
          `export default function Page() { return label; }`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.tsx"), config),
            Error,
          );

          assertEquals(isMissingModuleError(error), true);
          assertEquals(isBuildFailure(error), true);
          assertEquals(isTenantBuildFailure(error), true);
        });
      },
    );
  });

  it("tags a missing bare side-effect import as a tenant build failure", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import "./missing";`,
          `export default function Page() { return null; }`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.tsx"), config),
            Error,
          );

          assertEquals(isMissingModuleError(error), true);
          assertEquals(isBuildFailure(error), true);
          assertEquals(isTenantBuildFailure(error), true);
        });
      },
    );
  });

  it("tags a missing project alias import as a tenant build failure", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { label } from "@/components/Missing";`,
          `export default function Page() { return label; }`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.tsx"), config),
            Error,
          );

          assertEquals(isMissingModuleError(error), true);
          assertEquals(isBuildFailure(error), true);
          assertEquals(isTenantBuildFailure(error), true);
        });
      },
    );
  });

  it("tags a missing project alias import with an explicit source extension", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { label } from "@/components/Missing.tsx";`,
          `export default function Page() { return label; }`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.tsx"), config),
            Error,
          );

          assertEquals(isMissingModuleError(error), true);
          assertEquals(isBuildFailure(error), true);
          assertEquals(isTenantBuildFailure(error), true);
        });
      },
    );
  });

  it("tags missing side-effect imports in every legal declaration position", async () => {
    for (
      const source of [
        `const ready = true; import "./missing"; export default ready;`,
        `import /* preload */ "./missing"; export default null;`,
      ]
    ) {
      await withModuleLoaderFixture(
        { "app/page.tsx": source },
        async ({ projectDir, tmpDir, config }) => {
          await runWithCacheDir(tmpDir, async () => {
            const error = await assertRejects(
              () => loadModule(join(projectDir, "app/page.tsx"), config),
              Error,
            );

            assertEquals(isMissingModuleError(error), true);
            assertEquals(isBuildFailure(error), true);
            assertEquals(isTenantBuildFailure(error), true);
          });
        },
      );
    }
  });

  it("classifies retry failures from only the rebuilt dependency graph", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { label } from "./late";`,
          `export default function Page() { return label; }`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        let createdLateDependency = false;
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () =>
              loadModule(join(projectDir, "app/page.tsx"), {
                ...config,
                onProgress: ({ phase, filePath }) => {
                  if (
                    createdLateDependency ||
                    phase !== "module:persisted" ||
                    filePath !== join(projectDir, "app/page.tsx")
                  ) return;

                  createdLateDependency = true;
                  Deno.writeTextFileSync(
                    join(projectDir, "app/late.ts"),
                    [
                      `import "./framework-missing";`,
                      `export const label = "late";`,
                    ].join("\n"),
                  );
                },
              }),
            Error,
          );

          assertEquals(createdLateDependency, true);
          assertEquals(isMissingModuleError(error), true);
          assertEquals(isBuildFailure(error), true);
          // The first transform dropped `./late`, but the rebuild resolved it.
          // Classification must come from the dependency's separate bare
          // side-effect failure, not stale evidence from build one.
          assertEquals(isTenantBuildFailure(error), true);
        });
      },
    );
  });

  // A transform cache hit skips dependency resolution, and the retry path
  // invalidates only the root module's cache entry — so on the rebuild the
  // dependency holding the typo is served from cache and contributes no
  // evidence. Combined with clearing the set before the rebuild, that would
  // leave a dependency-level typo permanently unattributed, including on the
  // very first load. The cache-hit branch replays each module's recorded
  // specifiers to close it. Both loads must classify identically.
  it("attributes a typo in a cached dependency on every load", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { label } from "./dep";`,
          `export default function Page() { return label; }`,
        ].join("\n"),
        "app/dep.tsx": [
          `import { gone } from "./gone";`,
          `export const label = gone;`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const pagePath = join(projectDir, "app/page.tsx");

          const first = await assertRejects(() => loadModule(pagePath, config), Error);
          assertEquals(isBuildFailure(first), true);
          assertEquals(isTenantBuildFailure(first), true);

          // Same config, so `config.moduleCache` is warm for `app/dep.tsx`.
          const second = await assertRejects(() => loadModule(pagePath, config), Error);
          assertEquals(isBuildFailure(second), true);
          // Identical failure must not get weaker attribution just because a
          // dependency happened to be cached.
          assertEquals(isTenantBuildFailure(second), true);
        });
      },
    );
  });

  it("attributes a typo below a cached dependency on every load", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { label } from "./dep";`,
          `export default function Page() { return label; }`,
        ].join("\n"),
        "app/dep.tsx": [
          `import { nested } from "./nested";`,
          `export const label = nested;`,
        ].join("\n"),
        "app/nested.tsx": [
          `import { gone } from "./gone";`,
          `export const nested = gone;`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const pagePath = join(projectDir, "app/page.tsx");

          const first = await assertRejects(() => loadModule(pagePath, config), Error);
          assertEquals(isBuildFailure(first), true);
          assertEquals(isTenantBuildFailure(first), true);

          const second = await assertRejects(() => loadModule(pagePath, config), Error);
          assertEquals(isBuildFailure(second), true);
          assertEquals(isTenantBuildFailure(second), true);
        });
      },
    );
  });

  it("attributes a typo replayed from a disk-cached dependency", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { label } from "./dep";`,
          `export default function Page() { return label; }`,
        ].join("\n"),
        "app/dep.tsx": [
          `import { gone } from "./gone";`,
          `export const label = gone;`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const pagePath = join(projectDir, "app/page.tsx");
          const diskConfig = {
            ...config,
            projectId: "disk-cache-project",
            contentSourceId: "main",
          };

          const first = await assertRejects(() => loadModule(pagePath, diskConfig), Error);
          assertEquals(isTenantBuildFailure(first), true);

          // Mode is part of the process-local cache key but not the persisted
          // MDX path-cache key. Switching it gives this simulated new worker an
          // empty evidence memo while reusing the dependency from _index.json.
          const restartedConfig = {
            ...diskConfig,
            mode: "production" as const,
            moduleCache: new Map<string, string>(),
          };
          const second = await assertRejects(() => loadModule(pagePath, restartedConfig), Error);
          assertEquals(isBuildFailure(second), true);
          assertEquals(isTenantBuildFailure(second), true);
        });
      },
    );
  });

  it("ignores legacy disk cache entries that predate unresolved-import sidecars", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { label } from "./dep";`,
          `export default function Page() { return label; }`,
        ].join("\n"),
        "app/dep.tsx": [
          `import { gone } from "./gone";`,
          `export const label = gone;`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const diskConfig = {
            ...config,
            projectId: "legacy-cache-project",
            contentSourceId: "main",
          };
          const legacyCacheDir = join(
            getMdxEsmCacheDir(),
            encodeURIComponent(diskConfig.projectId),
            encodeURIComponent(diskConfig.contentSourceId),
          );
          await Deno.mkdir(join(legacyCacheDir, "app"), { recursive: true });
          const legacyDepArtifact = join(legacyCacheDir, "app/dep.legacy.js");
          await Deno.writeTextFile(
            legacyDepArtifact,
            [`import { gone } from "./gone";`, `export const label = gone;`].join("\n"),
          );
          const legacyPathKey = `mdx-esm-ec841873:19.1.1:_vf_modules/app/dep.js`;
          assertEquals(
            legacyPathKey === buildMdxEsmPathCacheKey("_vf_modules/app/dep.js", "19.1.1"),
            false,
          );
          await Deno.writeTextFile(
            join(legacyCacheDir, "_index.json"),
            JSON.stringify({ [legacyPathKey]: legacyDepArtifact }),
          );

          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.tsx"), diskConfig),
            Error,
          );
          assertEquals(isBuildFailure(error), true);
          assertEquals(isTenantBuildFailure(error), true);
        });
      },
    );
  });

  it("attributes an executed dynamic dependency that failed to transform", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.ts": [
          `const dependency = await import("./broken");`,
          `export const value = dependency.value;`,
        ].join("\n"),
        "app/broken.ts": `export const value: = "broken";`,
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.ts"), config),
            Error,
          );

          assertEquals(isMissingModuleError(error), true);
          assertEquals(isBuildFailure(error), true);
          assertEquals(isTenantBuildFailure(error), true);
        });
      },
    );
  });

  // The same seam must not launder a framework fault. A module whose imports
  // all resolve, and which then throws while executing, is an application
  // error: it must come back out of `loadModule` untagged on both predicates.
  // Asserting this through the real fixture rather than on a hand-built error
  // is the point — a constructed Error never enters `loadModule`, so it would
  // pass identically if the classification branch were deleted or inverted.
  it("leaves a resolvable import that throws at module scope untagged", async () => {
    await withModuleLoaderFixture(
      {
        "app/page.tsx": [
          `import { boom } from "./dep";`,
          `export default function Page() { return boom; }`,
        ].join("\n"),
        "app/dep.tsx": [
          `throw new Error("dependency exploded at module scope");`,
          `export const boom = "unreachable";`,
        ].join("\n"),
      },
      async ({ projectDir, tmpDir, config }) => {
        await runWithCacheDir(tmpDir, async () => {
          const error = await assertRejects(
            () => loadModule(join(projectDir, "app/page.tsx"), config),
            Error,
            "dependency exploded at module scope",
          );

          assertEquals(isMissingModuleError(error), false);
          assertEquals(isBuildFailure(error), false);
          assertEquals(isTenantBuildFailure(error), false);
        });
      },
    );
  });
});

// The retry seam sees `ERR_MODULE_NOT_FOUND` for four different causes and may
// only downgrade one of them. `isMissingModuleError` cannot tell them apart, so
// the discrimination is driven by the specifiers the resolver recorded dropping.
describe("module-loader/isUnresolvedTenantImport", () => {
  const REBUILT = "/tmp/out/veryfront-modules/proj-a/app/page.7f3c1d92.js";

  // The runtime names the missing target first and then appends the importer's
  // own location. At this seam the importer is always the rebuilt artifact, so
  // every real message mentions REBUILT somewhere — which is exactly why the
  // predicate may only inspect the first quoted token.
  const missing = () =>
    Object.assign(
      new TypeError(
        'Module not found "file:///tmp/out/veryfront-modules/proj-a/app/missing".\n' +
          `    at file://${REBUILT}:1:23`,
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

  it("classifies a dropped tenant specifier as tenant source", () => {
    assertEquals(isUnresolvedTenantImport(missing(), new Set(["./missing"])), true);
  });

  it("classifies a dropped project alias after its SSR rewrite", () => {
    const aliasMissing = Object.assign(
      new TypeError(
        'Module not found "file:///tmp/out/veryfront-modules/proj-a/_vf_modules/components/Foo.js".\n' +
          `    at file://${REBUILT}:1:23`,
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertEquals(
      isUnresolvedTenantImport(aliasMissing, new Set(["@/components/Foo"]), REBUILT),
      true,
    );
  });

  it("classifies an explicit project alias source extension after its SSR rewrite", () => {
    const aliasMissing = Object.assign(
      new TypeError(
        'Module not found "file:///tmp/out/veryfront-modules/proj-a/_vf_modules/components/Missing.js".\n' +
          `    at file://${REBUILT}:1:23`,
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertEquals(
      isUnresolvedTenantImport(aliasMissing, new Set(["@/components/Missing.tsx"]), REBUILT),
      true,
    );
  });

  it("does not classify an unrelated missing target alongside a dropped specifier", () => {
    const unrelated = Object.assign(
      new TypeError(
        'Module not found "file:///tmp/out/veryfront-modules/proj-a/app/cycle-alias".\n' +
          `    at file://${REBUILT}:1:23`,
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertEquals(isUnresolvedTenantImport(unrelated, new Set(["./missing"]), REBUILT), false);
  });

  // A resolved cycle target is never recorded as dropped. A later framework
  // failure on that branch must therefore not be reported as a tenant warning.
  it("does not classify a failure when the resolver dropped nothing", () => {
    assertEquals(isUnresolvedTenantImport(missing(), new Set()), false);
  });

  // Bundle misses are framework infrastructure with dedicated recovery on the
  // outer branch, which the inner catch does not re-check. Exclude them even
  // when the tenant separately has an unresolved import.
  it("does not classify an HTTP-bundle miss even alongside a dropped specifier", () => {
    const bundleError = Object.assign(
      new TypeError(
        'Module not found "file:///tmp/veryfront-http-bundle/http-2b1f9c4e.mjs".',
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertEquals(isUnresolvedTenantImport(bundleError, new Set(["./missing"])), false);
  });

  // The missing module can be the rebuilt artifact itself rather than one of
  // its dependencies: a racing cache sweep or a failing cache volume can evict
  // it between persist and import. That is repeated cache eviction — framework
  // infrastructure — and must stay at error severity even when the tenant
  // separately has an unresolved import.
  it("does not classify an evicted rebuilt artifact, even alongside a dropped specifier", () => {
    const evicted = Object.assign(
      new TypeError(`Module not found "file://${REBUILT}?t=1&rebuilt=1".`),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertEquals(isUnresolvedTenantImport(evicted, new Set(["./missing"]), REBUILT), false);
    assertEquals(isUnresolvedTenantImport(evicted, new Set(["./missing"])), false);
  });

  // The regression this pins: the importer line also names the rebuilt
  // artifact, so a whole-message `includes` would classify a tenant typo as
  // framework and silently undo the fix.
  it("still classifies a dropped specifier whose importer is the rebuilt artifact", () => {
    const error = missing();

    assertEquals(error.message.includes(REBUILT), true);
    assertEquals(isUnresolvedTenantImport(error, new Set(["./missing"]), REBUILT), true);
  });

  // Node quotes the missing target with single quotes and leaves the importer
  // unquoted: `Cannot find module '/…/missing' imported from /…/page.js`.
  // A double-quote-only match returns "" there, which silently disables the
  // eviction guard on the Node runtime while every Deno test still passes.
  it("reads a single-quoted Node target so the eviction guard still fires", () => {
    const evictedOnNode = Object.assign(
      new Error(`Cannot find module '${REBUILT}' imported from ${REBUILT}`),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertEquals(isUnresolvedTenantImport(evictedOnNode, new Set(["./missing"]), REBUILT), false);
  });

  it("classifies a single-quoted Node target that is a dropped specifier", () => {
    const nodeMissing = Object.assign(
      new Error(
        `Cannot find module '/tmp/out/veryfront-modules/proj-a/app/missing' ` +
          `imported from ${REBUILT}`,
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertEquals(isUnresolvedTenantImport(nodeMissing, new Set(["./missing"]), REBUILT), true);
  });

  it("does not classify a failure that is not a resolution failure", () => {
    assertEquals(
      isUnresolvedTenantImport(new TypeError("x is not a function"), new Set(["./missing"])),
      false,
    );
  });

  // The runtime reports the *resolved* path, which for a dropped relative
  // specifier lands inside the build's own temp directory. A "does the message
  // mention our temp dir?" heuristic would therefore reject the one case this
  // predicate exists to catch. Pinned so nobody reintroduces it.
  it("classifies a dropped specifier whose resolved path is inside the build temp dir", () => {
    const tmpDir = "/tmp/out";
    const error = missing();

    assertEquals(error.message.includes(tmpDir), true);
    assertEquals(isUnresolvedTenantImport(error, new Set(["./missing"])), true);
  });
});

describe("module-loader/loadModule", () => {
  it("loads a module from an encoded dependency-pin cache directory", async () => {
    await withModuleLoaderFixture(
      { "app/page.ts": `export const value = "pinned";` },
      async ({ projectDir, tmpDir, config }) => {
        const filePath = join(projectDir, "app/page.ts");
        const dependencyPinningCacheKey = "on:z7bg3qnfgtcb";
        const moduleServerOrigin = "https://preview.example.test";
        const cacheVariant = buildModuleTransformCacheVariant(
          dependencyPinningCacheKey,
          moduleServerOrigin,
        );
        assert(cacheVariant);
        const artifactPath = join(
          tmpDir,
          "_pins",
          encodeURIComponent(cacheVariant),
          "app/page.pinned.mjs",
        );
        await Deno.mkdir(dirname(artifactPath), { recursive: true });
        // A sentinel the on-disk source cannot produce, so the assertion below
        // separates "served from the pinned cache entry" from "re-transformed
        // from source with the cache ignored".
        await Deno.writeTextFile(artifactPath, `export const value = "from-pinned-cache";`);
        config.moduleCache.set(
          getModuleCacheKey(
            filePath,
            undefined,
            projectDir,
            undefined,
            undefined,
            "development",
            dependencyPinningCacheKey,
            moduleServerOrigin,
          ),
          artifactPath,
        );

        await runWithCacheDir(tmpDir, async () => {
          const loaded = await loadModule(filePath, {
            ...config,
            dependencyPinningCacheKey,
            moduleServerOrigin,
          });

          assertEquals(
            loaded.value,
            "from-pinned-cache",
            "the encoded dependency-pin cache artifact must be served instead of a fresh transform",
          );
        });
      },
    );
  });

  // The recovery seam is reached through a hard-coded dynamic import of
  // #veryfront/transforms/esm/http-cache.ts, so it has to be driven for real:
  // plant an artifact that imports an HTTP bundle which is absent from disk but
  // present in the distributed cache, and let the import failure trigger it.
  it("recovers an evicted HTTP bundle and retries the import", async () => {
    await withModuleLoaderFixture(
      { "app/page.ts": `export const value = "unused";` },
      async ({ projectDir, tmpDir, config }) => {
        const filePath = join(projectDir, "app/page.ts");
        const url = "https://esm.sh/evicted@1";
        const hash = await hashHttpCacheIdentity(
          await buildHttpCacheIdentity(url, { importMap: { imports: {}, scopes: {} } }),
        );
        const bundleCode = "export const recovered = true;\n";

        await runWithCacheDir(tmpDir, async () => {
          const bundlePath = join(getHttpBundleCacheDir(), `http-${hash}.mjs`);
          const artifactPath = join(tmpDir, "page.http-bundle.mjs");
          await Deno.writeTextFile(
            artifactPath,
            `export { recovered } from ${JSON.stringify(toFileUrl(bundlePath).href)};\n`,
          );
          config.moduleCache.set(
            getModuleCacheKey(
              filePath,
              undefined,
              projectDir,
              undefined,
              undefined,
              "development",
            ),
            artifactPath,
          );

          __injectCachesForTests({ cachedPaths: new Map<string, string>() });
          __setDistributedCacheAccessorForTests(() =>
            Promise.resolve(createSuffixCacheBackend({
              [`code:${hash}`]: bundleCode,
              [`hash:${hash}`]: url,
            }))
          );

          try {
            const loaded = await loadModule(filePath, config);

            assertEquals(
              loaded.recovered,
              true,
              "an import that failed on an evicted HTTP bundle must be retried after recovery",
            );
            assertEquals(
              await Deno.readTextFile(bundlePath),
              bundleCode,
              "the evicted bundle must be restored to the HTTP bundle cache dir the error named",
            );
          } finally {
            __setDistributedCacheAccessorForTests(null);
            __injectCachesForTests(null);
          }
        });
      },
    );
  });

  it("reuses the content-addressed module identity across repeated loads", async () => {
    await withModuleLoaderFixture(
      { "app/page.ts": `export const value = "stable";` },
      async ({ projectDir, tmpDir, config }) => {
        const filePath = join(projectDir, "app/page.ts");
        const productionConfig = { ...config, mode: "production" as const };
        const artifactPath = join(tmpDir, "page.stable.mjs");
        await Deno.writeTextFile(artifactPath, `export const value = "stable";`);
        productionConfig.moduleCache.set(
          getModuleCacheKey(filePath, undefined, projectDir, undefined, undefined, "production"),
          artifactPath,
        );

        await runWithCacheDir(tmpDir, async () => {
          const first = await loadModule(filePath, productionConfig);
          const loadedAt = Date.now();
          while (Date.now() === loadedAt) {
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
          const second = await loadModule(filePath, productionConfig);

          assertStrictEquals(second, first);
        });
      },
    );
  });

  it("loads a new module identity when the cached content artifact changes", async () => {
    await withModuleLoaderFixture(
      { "app/page.ts": `export const value = "stable";` },
      async ({ projectDir, tmpDir, config }) => {
        const filePath = join(projectDir, "app/page.ts");
        const productionConfig = { ...config, mode: "production" as const };
        const cacheKey = getModuleCacheKey(
          filePath,
          undefined,
          projectDir,
          undefined,
          undefined,
          "production",
        );
        const stablePath = join(tmpDir, "page.stable.mjs");
        await Deno.writeTextFile(stablePath, `export const value = "stable";`);
        productionConfig.moduleCache.set(cacheKey, stablePath);

        await runWithCacheDir(tmpDir, async () => {
          const first = await loadModule(filePath, productionConfig);
          const changedPath = join(tmpDir, "page.changed.mjs");
          await Deno.writeTextFile(changedPath, `export const value = "changed";`);
          productionConfig.moduleCache.set(cacheKey, changedPath);
          const changed = await loadModule(filePath, productionConfig);

          assertNotStrictEquals(changed, first);
          assertEquals(changed.value, "changed");
        });
      },
    );
  });
});

describe("module-loader/isMissingModuleError (#2077)", () => {
  it("matches Node/Deno ERR_MODULE_NOT_FOUND by code", () => {
    const error = Object.assign(new Error("boom"), { code: "ERR_MODULE_NOT_FOUND" });
    assertEquals(isMissingModuleError(error), true);
  });

  it("matches the 'Cannot find module' message variant", () => {
    const error = new Error(
      "Cannot find module '/app/.cache/veryfront-mdx-esm/local-main/app/page.7b827689.js' " +
        "imported from /node_modules/veryfront/esm/src/rendering/orchestrator/module-loader/index.js",
    );
    assertEquals(isMissingModuleError(error), true);
  });

  it("matches the 'Module not found' message variant", () => {
    assertEquals(isMissingModuleError(new Error('Module not found "file:///x/page.abc.js"')), true);
  });

  it("does not match unrelated import failures", () => {
    assertEquals(isMissingModuleError(new Error("SyntaxError: Unexpected token")), false);
    assertEquals(isMissingModuleError(new TypeError("x is not a function")), false);
  });

  it("returns false for non-Error values", () => {
    assertEquals(isMissingModuleError("Cannot find module"), false);
    assertEquals(isMissingModuleError(null), false);
    assertEquals(isMissingModuleError(undefined), false);
  });
});
