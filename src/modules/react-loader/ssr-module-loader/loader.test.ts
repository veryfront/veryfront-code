import "#veryfront/schemas/_test-setup.ts";
import "../../../transforms/plugins/__tests__/code-parser-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { BUILD_FAILED, VeryfrontError } from "#veryfront/errors";
import { FakeTime } from "#std/testing/time";
import { join } from "#veryfront/compat/path";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { clearSSRModuleCache, clearSSRModuleCacheForProject, SSRModuleLoader } from "./index.ts";
import { __ssrModuleLoaderInternals } from "./loader.ts";
import {
  failedComponents,
  globalCrossProjectCache,
  globalInProgress,
  globalModuleCache,
} from "./cache/memory.ts";
import {
  TRANSFORM_IN_PROGRESS_STALE_EVICTION_MS,
  TRANSFORM_IN_PROGRESS_WAIT_TIMEOUT_MS,
} from "./constants.ts";
import { verifiedHttpBundlePaths } from "./http-bundle-helpers.ts";
import { buildSSRModuleCacheKey, isKeyForProject } from "../../../cache/keys.ts";
import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";
import { computeConfigHashSync } from "../../../cache/config-hash.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { makeTempDir, mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { injectNodePositions } from "#veryfront/transforms/plugins/babel-node-positions.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { __injectCachesForTests } from "#veryfront/transforms/esm/transform-cache.ts";
import { tokenizeAllVeryFrontPaths } from "#veryfront/cache";
import {
  buildMdxEsmModuleRecoveryCacheKey,
  buildMdxEsmPathCacheKey,
} from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import type { ModuleCacheEntry } from "./types.ts";
import {
  clearModulePathCache,
  getMdxEsmSsrCacheDir,
  getModulePathCache,
  verifiedModuleDeps,
  waitForDiskCleanup,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";

const CANONICAL_PIN_KEY = "on:z7bg3qnfgtcb";

/** Hash source as the loader sees it (after node position injection for .tsx in dev/preview) */
function hashAsLoader(source: string, filePath: string, projectDir: string): string {
  const rel = filePath.startsWith(projectDir)
    ? filePath.slice(projectDir.length).replace(/^\/+/, "")
    : filePath;
  return hashCodeHex(injectNodePositions(source, { filePath: rel }));
}

class FakeDistributedCache implements CacheBackend {
  readonly type = "redis" as const;
  private values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

function createProxyProjectAdapter(files: Record<string, string>): RuntimeAdapter {
  const normalize = (path: string) => path.replace(/^\/app\/+/, "");

  return {
    id: "deno",
    name: "proxy-project-test",
    capabilities: denoAdapter.capabilities,
    fs: {
      async readFile(path: string): Promise<string> {
        const normalized = normalize(path);
        const content = files[normalized];
        if (content == null) throw new Error(`File not found: ${path}`);
        return content;
      },
      async writeFile(): Promise<void> {
        throw new Error("writeFile is not supported in this test adapter");
      },
      async exists(path: string): Promise<boolean> {
        return files[normalize(path)] != null;
      },
      async *readDir(): AsyncIterableIterator<never> {},
      async stat(path: string) {
        const content = files[normalize(path)];
        if (content == null) throw new Error(`File not found: ${path}`);
        return {
          size: content.length,
          mtime: new Date(0),
          isDirectory: false,
          isFile: true,
          isSymlink: false,
        };
      },
      async mkdir(): Promise<void> {},
      async remove(): Promise<void> {},
      async makeTempDir(prefix: string): Promise<string> {
        return await makeTempDir({ prefix });
      },
      watch: denoAdapter.fs.watch.bind(denoAdapter.fs),
      async resolveFile(): Promise<string | null> {
        return null;
      },
    },
    env: denoAdapter.env,
    server: denoAdapter.server,
    serve: denoAdapter.serve.bind(denoAdapter),
  };
}

describe("SSRModuleLoader", { sanitizeResources: false, sanitizeOps: false }, () => {
  it("does not count request cancellation as a component failure", async () => {
    clearSSRModuleCache();
    const controller = new AbortController();
    const reason = new DOMException("render cancelled", "AbortError");
    controller.abort(reason);
    const loader = new SSRModuleLoader({
      projectDir: "/project",
      projectId: "cancelled-project",
      contentSourceId: "local-main",
      adapter: denoAdapter,
      dev: true,
      signal: controller.signal,
    });

    await assertRejects(
      () => loader.loadRawModule("/project/Page.tsx", "export default () => null"),
      Error,
      "render cancelled",
    );
    assertEquals(failedComponents.size, 0);
  });

  it("normalizes an aborted host signal without a reason", async () => {
    clearSSRModuleCache();
    const signal = {
      aborted: true,
      reason: undefined,
      throwIfAborted: () => {
        throw undefined;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as AbortSignal;
    const loader = new SSRModuleLoader({
      projectDir: "/project",
      projectId: "cancelled-host-project",
      contentSourceId: "local-main",
      adapter: denoAdapter,
      dev: true,
      signal,
    });

    const error = await assertRejects(
      () => loader.loadRawModule("/project/Page.tsx", "export default () => null"),
      DOMException,
      "The operation was aborted",
    );
    assert(error instanceof DOMException);
    assertEquals(error.name, "AbortError");
    assertEquals(failedComponents.size, 0);
  });

  it("isolates cache by projectId", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "Widget.tsx");

    try {
      await mkdir(componentsDir, { recursive: true });

      const sourceA = "export default function WidgetA() { return null; }";
      const sourceB = "export default function WidgetB() { return null; }";

      await writeTextFile(filePath, sourceA);

      const loaderA = new SSRModuleLoader({
        projectDir,
        projectId: "project-a",
        contentSourceId: "local-main",
        adapter: denoAdapter,
        dev: true,
      });

      const loaderB = new SSRModuleLoader({
        projectDir,
        projectId: "project-b",
        contentSourceId: "local-main",
        adapter: denoAdapter,
        dev: true,
      });

      const componentA = await loaderA.loadModule(filePath, sourceA);
      const componentB = await loaderB.loadModule(filePath, sourceB);

      assertEquals(componentA.name, "WidgetA");
      assertEquals(componentB.name, "WidgetB");
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("uses the writer's origin-aware MDX cache variant for lookup and invalidation", () => {
    const originA = __ssrModuleLoaderInternals.getMdxEsmCacheVariant({
      dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      moduleServerOrigin: "https://a.example",
    });
    const originB = __ssrModuleLoaderInternals.getMdxEsmCacheVariant({
      dependencyPinningCacheKey: CANONICAL_PIN_KEY,
      moduleServerOrigin: "https://b.example",
    });

    assert(originA?.startsWith(`${CANONICAL_PIN_KEY}:origin:`));
    assert(originB?.startsWith(`${CANONICAL_PIN_KEY}:origin:`));
    assert(originA !== originB);
    assertEquals(
      __ssrModuleLoaderInternals.getMdxEsmCacheVariant({
        dependencyPinningCacheKey: "off",
        moduleServerOrigin: "https://a.example",
      }),
      undefined,
    );
    const externalA = __ssrModuleLoaderInternals.getMdxEsmCacheVariant({
      serverExternalPackages: ["knex", "@prisma/client"],
    });
    const externalB = __ssrModuleLoaderInternals.getMdxEsmCacheVariant({
      serverExternalPackages: ["@prisma/client", "knex"],
    });
    assertEquals(externalB, externalA);
    assert(externalA?.startsWith("on:server-externals-"));
  });

  it("invalidates stale cache entries with missing local dependencies and retransforms", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-p1-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "CacheInvalTest.tsx");
    const projectId = "project-p1-test";
    const contentSourceId = "local-main";

    try {
      await mkdir(componentsDir, { recursive: true });

      const source = "export default function CacheInvalTest() { return null; }";
      const contentHash = hashAsLoader(source, filePath, projectDir);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";

      const filePathCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
      );

      const uniqueId = crypto.randomUUID().slice(0, 8);
      const brokenTempPath = join(projectDir, `broken-${uniqueId}.mjs`);
      const missingDependencyPath = join(projectDir, `this-file-does-not-exist-${uniqueId}.mjs`);
      await writeTextFile(
        brokenTempPath,
        `import { missing } from "file://${missingDependencyPath}";\nexport default function CacheInvalTest() { return null; }`,
      );

      const fakeEntry = { tempPath: brokenTempPath, contentHash };
      globalModuleCache.set(contentCacheKey, fakeEntry);
      globalModuleCache.set(filePathCacheKey, fakeEntry);

      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const component = await loader.loadModule(filePath, source);
      assertEquals(component.name, "CacheInvalTest");

      assertEquals(
        globalModuleCache.has(filePathCacheKey),
        true,
        "Cache entry should be refreshed after invalidating the stale module",
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("rebuilds a verified stale cache entry when dynamic import finds a missing local dependency", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-verified-stale-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "VerifiedStaleCache.tsx");
    const projectId = "project-verified-stale-test";
    const contentSourceId = "preview-main";

    try {
      await mkdir(componentsDir, { recursive: true });

      const source = "export default function VerifiedStaleCache() { return null; }";
      const contentHash = hashAsLoader(source, filePath, projectDir);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";

      const filePathCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
      );

      const staleTempPath = join(projectDir, `verified-stale-${crypto.randomUUID()}.mjs`);
      const missingDependencyPath = join(
        projectDir,
        `missing-framework-core-${crypto.randomUUID()}.mjs`,
      );
      await writeTextFile(
        staleTempPath,
        [
          `import { missing } from "file://${missingDependencyPath}";`,
          `export default function VerifiedStaleCache() {`,
          `  return missing;`,
          `}`,
        ].join("\n"),
      );

      const staleEntry = { tempPath: staleTempPath, contentHash };
      globalModuleCache.set(contentCacheKey, staleEntry);
      globalModuleCache.set(filePathCacheKey, staleEntry);
      verifiedHttpBundlePaths.set(`${staleTempPath}:${contentHash}`, true);

      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const component = await loader.loadModule(filePath, source);
      assertEquals(component.name, "VerifiedStaleCache");

      const rebuiltEntry = globalModuleCache.get(contentCacheKey);
      assert(
        !!rebuiltEntry && rebuiltEntry.tempPath !== staleTempPath,
        "Expected verified stale cache entry to be replaced with retransformed output",
      );
      assertEquals(
        verifiedHttpBundlePaths.get(`${staleTempPath}:${contentHash}`),
        undefined,
        "Expected stale verification marker to be cleared",
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("rebuilds a verified stale cache entry when the cached output file is missing", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-missing-output-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "MissingCachedOutput.tsx");
    const projectId = "project-missing-cached-output-test";
    const contentSourceId = "preview-main";

    try {
      await mkdir(componentsDir, { recursive: true });

      const source = "export default function MissingCachedOutput() { return null; }";
      const contentHash = hashAsLoader(source, filePath, projectDir);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";

      const filePathCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
      );

      const staleTempPath = join(projectDir, `missing-cached-output-${crypto.randomUUID()}.mjs`);
      const staleEntry = { tempPath: staleTempPath, contentHash };
      globalModuleCache.set(contentCacheKey, staleEntry);
      globalModuleCache.set(filePathCacheKey, staleEntry);
      verifiedHttpBundlePaths.set(`${staleTempPath}:${contentHash}`, true);

      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const component = await loader.loadModule(filePath, source);
      assertEquals(component.name, "MissingCachedOutput");

      const rebuiltEntry = globalModuleCache.get(contentCacheKey);
      assert(
        !!rebuiltEntry && rebuiltEntry.tempPath !== staleTempPath,
        "Expected missing verified cache output to be replaced with retransformed output",
      );
      assertEquals(
        verifiedHttpBundlePaths.get(`${staleTempPath}:${contentHash}`),
        undefined,
        "Expected stale verification marker to be cleared",
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("invalidates stale cache indexes when cached output cannot be inspected", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-unreadable-output-" });
    const filePath = join(projectDir, "UnreadableCachedOutput.tsx");
    const projectId = "project-unreadable-cached-output-test";
    const contentSourceId = "preview-main";
    const source = "export default function UnreadableCachedOutput() { return null; }";
    const contentHash = hashAsLoader(source, filePath, projectDir);
    const configHash = computeConfigHashSync({ dev: true });
    const reactVersion = "default";
    const filePathCacheKey = buildSSRModuleCacheKey(
      RUNTIME_VERSION,
      projectId,
      `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
    );
    const contentCacheKey = buildSSRModuleCacheKey(
      RUNTIME_VERSION,
      projectId,
      `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
    );
    const staleEntry = {
      tempPath: join(projectDir, "unreadable-cache-output.mjs"),
      contentHash,
    };
    globalModuleCache.set(contentCacheKey, staleEntry);
    globalModuleCache.set(filePathCacheKey, staleEntry);
    verifiedHttpBundlePaths.set(`${staleEntry.tempPath}:${contentHash}`, true);

    const loader = new SSRModuleLoader({
      projectDir,
      projectId,
      contentSourceId,
      adapter: denoAdapter,
      dev: true,
    });
    const cacheManager = (loader as unknown as {
      cache: { fs: FileSystem; getFs(): FileSystem };
    }).cache;
    const originalFs = cacheManager.getFs();
    cacheManager.fs = {
      stat: () => Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" })),
    } as unknown as FileSystem;

    try {
      await assertRejects(
        () => loader.loadModule(filePath, source),
        Error,
        "permission denied",
      );
      assertEquals(globalModuleCache.get(contentCacheKey), undefined);
      assertEquals(globalModuleCache.get(filePathCacheKey), undefined);
      assertEquals(verifiedHttpBundlePaths.get(`${staleEntry.tempPath}:${contentHash}`), undefined);
    } finally {
      cacheManager.fs = originalFs;
      await remove(projectDir, { recursive: true });
    }
  });

  it("preserves an operational cache error when MDX invalidation also fails", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-invalidation-failure-" });
    const filePath = join(projectDir, "InvalidationFailure.tsx");
    const projectId = "project-invalidation-failure-test";
    const contentSourceId = "preview-main";
    const source = "export default function InvalidationFailure() { return null; }";
    const contentHash = hashAsLoader(source, filePath, projectDir);
    const configHash = computeConfigHashSync({ dev: true });
    const reactVersion = "default";
    const filePathCacheKey = buildSSRModuleCacheKey(
      RUNTIME_VERSION,
      projectId,
      `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
    );
    const contentCacheKey = buildSSRModuleCacheKey(
      RUNTIME_VERSION,
      projectId,
      `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
    );
    const staleEntry = {
      tempPath: join(projectDir, "unreadable-cache-output.mjs"),
      contentHash,
    };
    globalModuleCache.set(contentCacheKey, staleEntry);
    globalModuleCache.set(filePathCacheKey, staleEntry);
    verifiedHttpBundlePaths.set(`${staleEntry.tempPath}:${contentHash}`, true);

    const loader = new SSRModuleLoader({
      projectDir,
      projectId,
      contentSourceId,
      adapter: denoAdapter,
      dev: true,
    });
    const mutableLoader = loader as unknown as {
      cache: { fs: FileSystem; getFs(): FileSystem };
      invalidateMdxEsmCacheEntry(
        filePath: string,
        cacheEntry: ModuleCacheEntry,
      ): Promise<void>;
    };
    const originalFs = mutableLoader.cache.getFs();
    mutableLoader.cache.fs = {
      stat: () => Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" })),
    } as unknown as FileSystem;
    mutableLoader.invalidateMdxEsmCacheEntry = () =>
      Promise.reject(new Error("invalidation failed"));

    try {
      await assertRejects(
        () => loader.loadModule(filePath, source),
        Error,
        "permission denied",
      );
      assertEquals(globalModuleCache.get(filePathCacheKey), undefined);
      assertEquals(globalModuleCache.get(contentCacheKey), undefined);
      assertEquals(verifiedHttpBundlePaths.get(`${staleEntry.tempPath}:${contentHash}`), undefined);
    } finally {
      mutableLoader.cache.fs = originalFs;
      await remove(projectDir, { recursive: true });
    }
  });

  it("clears verified MDX-ESM path cache before retrying stale local dependencies", async () => {
    clearSSRModuleCache();
    clearModulePathCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-verified-mdx-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "VerifiedMdxStaleCache.tsx");
    const projectId = "project-verified-mdx-stale-test";
    const contentSourceId = "preview-main";

    const mdxCacheDir = getMdxEsmSsrCacheDir(projectId, contentSourceId);
    const mdxComponentDir = join(mdxCacheDir, "components");

    try {
      await mkdir(componentsDir, { recursive: true });
      await mkdir(mdxComponentDir, { recursive: true });

      const source = "export default function VerifiedMdxStaleCache() { return null; }";
      const contentHash = hashAsLoader(source, filePath, projectDir);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";

      const filePathCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
      );

      const staleTempPath = join(mdxComponentDir, `verified-mdx-stale-${crypto.randomUUID()}.js`);
      const missingDependencyPath = join(
        mdxComponentDir,
        `missing-runtime-core-${crypto.randomUUID()}.js`,
      );
      await writeTextFile(
        staleTempPath,
        [
          `import { missing } from "file://${missingDependencyPath}";`,
          `export default function VerifiedMdxStaleCache() {`,
          `  return missing;`,
          `}`,
        ].join("\n"),
      );

      const mdxPathCacheKey = buildMdxEsmPathCacheKey(
        "_vf_modules/components/VerifiedMdxStaleCache.js",
      );
      const mdxPathCache = await getModulePathCache(mdxCacheDir);
      mdxPathCache.set(mdxPathCacheKey, staleTempPath);
      verifiedModuleDeps.set(`${staleTempPath}:${mdxPathCacheKey}`, true);

      const staleEntry = { tempPath: staleTempPath, contentHash };
      globalModuleCache.set(contentCacheKey, staleEntry);
      globalModuleCache.set(filePathCacheKey, staleEntry);
      verifiedHttpBundlePaths.set(`${staleTempPath}:${contentHash}`, true);

      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const component = await loader.loadModule(filePath, source);
      assertEquals(component.name, "VerifiedMdxStaleCache");
      assert(
        mdxPathCache.get(mdxPathCacheKey) !== staleTempPath,
        "Expected stale MDX-ESM path-cache entry to be cleared before retry",
      );
    } finally {
      await waitForDiskCleanup();
      clearModulePathCache();
      await remove(mdxCacheDir, { recursive: true }).catch(() => {});
      await remove(projectDir, { recursive: true });
    }
  });

  it("persists MDX-ESM path cache invalidation when stale SSR cache is hit cold", async () => {
    clearSSRModuleCache();
    clearModulePathCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-cold-mdx-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "ColdMdxStaleCache.tsx");
    const projectId = "project-cold-mdx-stale-test";
    const contentSourceId = "preview-main";

    const mdxCacheDir = getMdxEsmSsrCacheDir(projectId, contentSourceId);
    const mdxComponentDir = join(mdxCacheDir, "components");

    try {
      await mkdir(componentsDir, { recursive: true });
      await mkdir(mdxComponentDir, { recursive: true });

      const source = "export default function ColdMdxStaleCache() { return null; }";
      const contentHash = hashAsLoader(source, filePath, projectDir);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";

      const filePathCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
      );

      const staleTempPath = join(mdxComponentDir, `cold-mdx-stale-${crypto.randomUUID()}.js`);
      const missingDependencyPath = join(
        mdxComponentDir,
        `missing-cold-runtime-${crypto.randomUUID()}.js`,
      );
      await writeTextFile(
        staleTempPath,
        [
          `import { missing } from "file://${missingDependencyPath}";`,
          `export default function ColdMdxStaleCache() {`,
          `  return missing;`,
          `}`,
        ].join("\n"),
      );

      const mdxPathCacheKey = buildMdxEsmPathCacheKey(
        "_vf_modules/components/ColdMdxStaleCache.js",
      );
      await writeTextFile(
        join(mdxCacheDir, "_index.json"),
        JSON.stringify({ [mdxPathCacheKey]: staleTempPath }),
      );
      clearModulePathCache();

      const staleEntry = { tempPath: staleTempPath, contentHash };
      globalModuleCache.set(contentCacheKey, staleEntry);
      globalModuleCache.set(filePathCacheKey, staleEntry);
      verifiedHttpBundlePaths.set(`${staleTempPath}:${contentHash}`, true);

      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const component = await loader.loadModule(filePath, source);
      assertEquals(component.name, "ColdMdxStaleCache");

      await waitForDiskCleanup();
      clearModulePathCache();
      const reloadedMdxPathCache = await getModulePathCache(mdxCacheDir);
      assertEquals(
        reloadedMdxPathCache.get(mdxPathCacheKey),
        undefined,
        "Expected stale MDX-ESM path-cache entry to stay cleared after reload",
      );
    } finally {
      await waitForDiskCleanup();
      clearModulePathCache();
      await remove(mdxCacheDir, { recursive: true }).catch(() => {});
      await remove(projectDir, { recursive: true });
    }
  });

  it("persists stale MDX-ESM invalidation with slash-containing content source ids", async () => {
    clearSSRModuleCache();
    clearModulePathCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-branch-mdx-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "BranchMdxStaleCache.tsx");
    const projectId = "project-branch-mdx-stale-test";
    const contentSourceId = "preview-feature/refactor";

    const mdxCacheDir = getMdxEsmSsrCacheDir(projectId, contentSourceId);
    const mdxComponentDir = join(mdxCacheDir, "components");

    try {
      await mkdir(componentsDir, { recursive: true });
      await mkdir(mdxComponentDir, { recursive: true });

      const source = "export default function BranchMdxStaleCache() { return null; }";
      const contentHash = hashAsLoader(source, filePath, projectDir);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";

      const filePathCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
      );

      const staleTempPath = join(mdxComponentDir, `branch-mdx-stale-${crypto.randomUUID()}.js`);
      const missingDependencyPath = join(
        mdxComponentDir,
        `missing-branch-runtime-${crypto.randomUUID()}.js`,
      );
      await writeTextFile(
        staleTempPath,
        [
          `import { missing } from "file://${missingDependencyPath}";`,
          `export default function BranchMdxStaleCache() {`,
          `  return missing;`,
          `}`,
        ].join("\n"),
      );

      const mdxPathCacheKey = buildMdxEsmPathCacheKey(
        "_vf_modules/components/BranchMdxStaleCache.js",
      );
      await writeTextFile(
        join(mdxCacheDir, "_index.json"),
        JSON.stringify({ [mdxPathCacheKey]: staleTempPath }),
      );
      clearModulePathCache();

      const staleEntry = { tempPath: staleTempPath, contentHash };
      globalModuleCache.set(contentCacheKey, staleEntry);
      globalModuleCache.set(filePathCacheKey, staleEntry);
      verifiedHttpBundlePaths.set(`${staleTempPath}:${contentHash}`, true);

      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const component = await loader.loadModule(filePath, source);
      assertEquals(component.name, "BranchMdxStaleCache");

      await waitForDiskCleanup();
      clearModulePathCache();
      const reloadedMdxPathCache = await getModulePathCache(mdxCacheDir);
      assertEquals(
        reloadedMdxPathCache.get(mdxPathCacheKey),
        undefined,
        "Expected slash-containing content source stale path-cache entry to stay cleared",
      );
    } finally {
      await waitForDiskCleanup();
      clearModulePathCache();
      await remove(mdxCacheDir, { recursive: true }).catch(() => {});
      await remove(projectDir, { recursive: true });
    }
  });

  it("recovers missing vfmod dependencies before invalidating cached SSR modules", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-recover-vfmod-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "RecoveredViaCache.tsx");
    const projectId = "project-recover-vfmod";
    const contentSourceId = "preview-main";
    const distributedCache = new FakeDistributedCache();

    try {
      __injectCachesForTests({ cacheBackend: distributedCache });
      await mkdir(componentsDir, { recursive: true });

      const source = "export default function RecoveredViaCache() { return null; }";
      const contentHash = hashAsLoader(source, filePath, projectDir);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";

      const filePathCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
      );

      const vfmodDir = getMdxEsmSsrCacheDir(projectId, contentSourceId);
      const childPath = join(vfmodDir, "vfmod-child.mjs");
      const cachedTempPath = join(projectDir, `recover-vfmod-${crypto.randomUUID()}.mjs`);

      await distributedCache.set(
        buildMdxEsmModuleRecoveryCacheKey(projectId, contentSourceId, "vfmod-child.mjs"),
        tokenizeAllVeryFrontPaths(`export default null;`),
      );

      await writeTextFile(
        cachedTempPath,
        [
          `import child from "file://${childPath}";`,
          `export default function RecoveredViaCache() {`,
          `  return child;`,
          `}`,
        ].join("\n"),
      );

      const fakeEntry = { tempPath: cachedTempPath, contentHash };
      globalModuleCache.set(contentCacheKey, fakeEntry);
      globalModuleCache.set(filePathCacheKey, fakeEntry);

      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const component = await loader.loadModule(filePath, source);
      assertEquals(component.name, "RecoveredViaCache");
      assertEquals(globalModuleCache.has(filePathCacheKey), true);
    } finally {
      __injectCachesForTests(null);
      await remove(getMdxEsmSsrCacheDir(projectId, contentSourceId), { recursive: true })
        .catch(() => {});
      await remove(projectDir, { recursive: true });
    }
  });

  it("keeps cache when import fails with a non-module-resolution error", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-non-resolution-error-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "CacheRetainOnRuntimeError.tsx");
    const projectId = "project-runtime-error-test";
    const contentSourceId = "local-main";

    try {
      await mkdir(componentsDir, { recursive: true });

      const source = "export default function CacheRetainOnRuntimeError() { return null; }";
      const contentHash = hashAsLoader(source, filePath, projectDir);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";

      const filePathCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
      );

      const runtimeErrorTempPath = join(projectDir, `runtime-error-${crypto.randomUUID()}.mjs`);
      await writeTextFile(
        runtimeErrorTempPath,
        `throw new Error("intentional-runtime-error");\nexport default function CacheRetainOnRuntimeError() { return null; }`,
      );

      const fakeEntry = { tempPath: runtimeErrorTempPath, contentHash };
      globalModuleCache.set(contentCacheKey, fakeEntry);
      globalModuleCache.set(filePathCacheKey, fakeEntry);
      verifiedHttpBundlePaths.set(`${runtimeErrorTempPath}:${contentHash}`, true);

      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      try {
        await loader.loadModule(filePath, source);
        assert(false, "Expected loadModule to throw runtime error");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        assert(msg.includes("intentional-runtime-error"), `Unexpected error message: ${msg}`);
      }

      assertEquals(
        globalModuleCache.has(filePathCacheKey),
        true,
        "Cache entry should remain for non-module-resolution import failures",
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("retains cache when import succeeds", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-retain-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "Good.tsx");

    try {
      await mkdir(componentsDir, { recursive: true });

      const source = "export default function Good() { return null; }";
      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId: "project-retain-test",
        contentSourceId: "local-main",
        adapter: denoAdapter,
        dev: true,
      });

      const component = await loader.loadModule(filePath, source);
      assertEquals(component.name, "Good");

      const matchingKeys = [...globalModuleCache.keys()].filter((k) =>
        k.includes("project-retain-test")
      );
      assert(
        matchingKeys.length > 0,
        "Expected cache entries to be retained after successful import",
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("throws missing dependency error before dynamic import when local import is unavailable", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-missing-dep-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "NeedsMissingDependency.tsx");

    try {
      await mkdir(componentsDir, { recursive: true });

      const source = [
        `import Missing from "./does-not-exist.js";`,
        `export default function NeedsMissingDependency() {`,
        `  return Missing;`,
        `}`,
      ].join("\n");

      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId: "project-missing-dep-test",
        contentSourceId: "local-main",
        adapter: denoAdapter,
        dev: true,
      });

      try {
        await loader.loadModule(filePath, source);
        assert(false, "Expected loadModule to throw for missing dependency");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        assert(
          msg.includes("missing dependencies") &&
            msg.includes("./does-not-exist.js"),
          `Expected missing dependency details in error, got: ${msg}`,
        );
      }
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("loads project-relative dependencies through the runtime adapter for proxy project paths", async () => {
    clearSSRModuleCache();

    const projectDir = "/app";
    const filePath = "/app/app/layout.tsx";
    const adapter = createProxyProjectAdapter({
      "app/runtime-registry.ts": `export const registered = true;`,
    });

    const loader = new SSRModuleLoader({
      projectDir,
      projectId: "project-proxy-adapter-deps",
      contentSourceId: "release-1",
      adapter,
      dev: true,
    });

    const component = await loader.loadModule(
      filePath,
      [
        `import "./runtime-registry.ts";`,
        `export default function RootLayout() {`,
        `  return null;`,
        `}`,
      ].join("\n"),
    );

    assertEquals(component.name, "RootLayout");
  });

  it("finishes an in-flight load when project invalidation revokes cache publication", async () => {
    clearSSRModuleCache();

    const projectDir = "/app";
    const filePath = "/app/app/page.tsx";
    const projectId = "project-invalidated-transform";
    const baseAdapter = createProxyProjectAdapter({
      "app/dependency.ts": `export const dependencyValue = "ready";`,
    });
    let releaseDependencyRead!: () => void;
    const dependencyReadReleased = new Promise<void>((resolve) => {
      releaseDependencyRead = resolve;
    });
    let signalDependencyRead!: () => void;
    const dependencyReadStarted = new Promise<void>((resolve) => {
      signalDependencyRead = resolve;
    });
    let blockedDependencyRead = false;
    const adapter: RuntimeAdapter = {
      ...baseAdapter,
      fs: {
        ...baseAdapter.fs,
        async readFile(path: string): Promise<string> {
          if (path.endsWith("/dependency.ts") && !blockedDependencyRead) {
            blockedDependencyRead = true;
            signalDependencyRead();
            await dependencyReadReleased;
          }
          return await baseAdapter.fs.readFile(path);
        },
      },
    };
    const source = [
      `import { dependencyValue } from "./dependency.ts";`,
      `export default function Page() {`,
      `  return dependencyValue;`,
      `}`,
    ].join("\n");
    const loader = new SSRModuleLoader({
      projectDir,
      projectId,
      contentSourceId: "release-1",
      adapter,
      dev: true,
    });

    try {
      const leaderLoad = loader.loadRawModule(filePath, source);
      await dependencyReadStarted;
      const followerLoad = loader.loadRawModule(filePath, source);
      await new Promise((resolve) => setTimeout(resolve, 0));
      clearSSRModuleCacheForProject(projectId);
      releaseDependencyRead();

      const modules = await Promise.all([leaderLoad, followerLoad]);
      for (const module of modules) {
        assertEquals((module.default as () => string)(), "ready");
      }
    } finally {
      releaseDependencyRead();
      clearSSRModuleCache();
    }
  });

  it("invalidates stale cache entries with unresolved _vf_modules imports and retransforms", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-unresolved-vf-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "RebuildAfterStaleCache.tsx");
    const projectId = "project-unresolved-vf-test";
    const contentSourceId = "local-main";

    try {
      await mkdir(componentsDir, { recursive: true });

      const source = "export default function RebuildAfterStaleCache() { return null; }";
      const contentHash = hashAsLoader(source, filePath, projectDir);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";

      const filePathCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
      );

      const staleTempPath = join(projectDir, `stale-unresolved-${crypto.randomUUID()}.mjs`);
      await writeTextFile(
        staleTempPath,
        [
          `import x from "/_vf_modules/react@18.3.1/some-module.js";`,
          `export default function Stale() { return x; }`,
        ].join("\n"),
      );

      const staleEntry = { tempPath: staleTempPath, contentHash };
      globalModuleCache.set(contentCacheKey, staleEntry);
      globalModuleCache.set(filePathCacheKey, staleEntry);

      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const component = await loader.loadModule(filePath, source);
      assertEquals(component.name, "RebuildAfterStaleCache");

      const rebuiltEntry = globalModuleCache.get(contentCacheKey);
      assert(
        !!rebuiltEntry && rebuiltEntry.tempPath !== staleTempPath,
        "Expected stale cache entry to be replaced with retransformed output",
      );
      assertEquals(
        verifiedHttpBundlePaths.get(`${staleTempPath}:${contentHash}`),
        undefined,
        "Expected stale verification marker to be cleared",
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("retries transform when stale in-progress promise rejects", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-stale-in-progress-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "RetryAfterInProgressError.tsx");
    const projectId = "project-stale-in-progress";
    const contentSourceId = "local-main";

    try {
      await mkdir(componentsDir, { recursive: true });

      const source = "export default function RetryAfterInProgressError() { return null; }";
      await writeTextFile(filePath, source);

      const contentHash = hashAsLoader(source, filePath, projectDir);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";
      const contentCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
      );

      const staleInProgress = Promise.reject(new Error("stale in-progress transform failed"));
      staleInProgress.catch(() => {});
      globalInProgress.set(contentCacheKey, staleInProgress);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const component = await loader.loadModule(filePath, source);
      assertEquals(component.name, "RetryAfterInProgressError");
      assertEquals(globalInProgress.has(contentCacheKey), false);
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("returns a dependency error to followers already waiting on its leader", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-retained-follower-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "RetainedFollower.tsx");
    const projectId = "project-retained-follower";
    const contentSourceId = "local-main";
    const source = "export default function RetainedFollower() { return null; }";
    const dependencyError = new Error("dependency failed");
    let finishTransform!: () => void;
    let rejectLeader!: (error: Error) => void;
    let retained: Promise<ModuleCacheEntry> | null = null;
    let follower: Promise<React.ComponentType<Record<string, unknown>>> | undefined;
    let contentCacheKey = "";

    try {
      await mkdir(componentsDir, { recursive: true });
      await writeTextFile(filePath, source);

      const contentHash = hashAsLoader(source, filePath, projectDir);
      const leader = new Promise<ModuleCacheEntry>((_, reject) => {
        rejectLeader = reject;
      });
      leader.catch(() => {});
      const transformSettlement = new Promise<void>((resolve) => {
        finishTransform = resolve;
      });

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });
      contentCacheKey = (loader as unknown as {
        cache: { getCacheKey(value: string): string };
      }).cache.getCacheKey(`${filePath}:${contentHash}`);
      globalInProgress.set(contentCacheKey, leader);
      __ssrModuleLoaderInternals.registerInProgressTransformObservers(contentCacheKey, leader);

      follower = loader.loadModule(filePath, source);
      let attempts = 0;
      while (
        __ssrModuleLoaderInternals.inProgressTransformObserverCount(leader) === 0 &&
        attempts++ < 100
      ) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      assertEquals(__ssrModuleLoaderInternals.inProgressTransformObserverCount(leader), 1);

      retained = __ssrModuleLoaderInternals.retainInProgressTransformUntilSettled(
        contentCacheKey,
        leader,
        transformSettlement,
        dependencyError,
      );
      assert(retained);
      rejectLeader(dependencyError);

      let followerError: unknown;
      void follower.catch((error) => followerError = error);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertStrictEquals(followerError, dependencyError);
      assertStrictEquals(globalInProgress.get(contentCacheKey), retained);
    } finally {
      rejectLeader?.(dependencyError);
      finishTransform?.();
      await retained?.catch(() => {});
      await follower?.catch(() => {});
      if (contentCacheKey) globalInProgress.delete(contentCacheKey);
      clearSSRModuleCache();
      await remove(projectDir, { recursive: true });
    }
  });

  it("allows one rejected shared transform retry per caller", () => {
    assertEquals(
      __ssrModuleLoaderInternals.shouldRetryRejectedInProgressTransform(1),
      true,
    );
    assertEquals(
      __ssrModuleLoaderInternals.shouldRetryRejectedInProgressTransform(2),
      false,
    );
  });

  it("starts a module transform before recursive dependencies settle", async () => {
    const events: string[] = [];
    let finishTransform!: (value: string) => void;

    const result = await __ssrModuleLoaderInternals.runTransformAndDependencies(
      async () => {
        events.push("transform:start");
        return await new Promise<string>((resolve) => {
          finishTransform = resolve;
        });
      },
      async () => {
        events.push("dependencies:start");
        assertEquals(events, ["transform:start", "dependencies:start"]);
        finishTransform("compiled");
        return await Promise.resolve("resolved");
      },
    );

    assertEquals(result, { transformed: "compiled", dependencies: "resolved" });
  });

  it("returns a dependency error without draining a stalled transform", async () => {
    const dependencyError = new Error("dependency failed");
    let finishTransform!: () => void;
    let failedTransformSettlement: Promise<void> | undefined;
    let observedDependencyError: unknown;
    let resultSettled = false;

    const result = __ssrModuleLoaderInternals.runTransformAndDependencies(
      () =>
        new Promise<void>((resolve) => {
          finishTransform = resolve;
        }),
      () => Promise.reject(dependencyError),
      (error, transformSettlement) => {
        observedDependencyError = error;
        failedTransformSettlement = transformSettlement;
      },
    );
    void result.then(
      () => resultSettled = true,
      () => resultSettled = true,
    );
    const rejected = assertRejects(
      () => result,
      Error,
      "dependency failed",
    );

    try {
      await Promise.resolve();
      await Promise.resolve();
      assertEquals(resultSettled, true);
      const error = await rejected;
      assertStrictEquals(error, dependencyError);
      assertStrictEquals(observedDependencyError, dependencyError);
      assert(failedTransformSettlement);
    } finally {
      finishTransform();
    }
    await failedTransformSettlement;
  });

  it("retains a failed leader until its abandoned transform releases capacity", async () => {
    const key = "test:retained-failed-transform";
    const dependencyError = new Error("dependency failed");
    const leader = new Promise<ModuleCacheEntry>(() => {});
    let finishTransform!: () => void;
    const transformSettlement = new Promise<void>((resolve) => {
      finishTransform = resolve;
    });
    globalInProgress.set(key, leader);

    const retained = __ssrModuleLoaderInternals.retainInProgressTransformUntilSettled(
      key,
      leader,
      transformSettlement,
      dependencyError,
    );

    try {
      assert(retained);
      assertStrictEquals(globalInProgress.get(key), retained);
      let retainedSettled = false;
      void retained.catch(() => retainedSettled = true);
      await Promise.resolve();
      assertEquals(retainedSettled, false);

      finishTransform();
      const error = await assertRejects(
        () => retained,
        Error,
        "dependency failed",
      );
      assertStrictEquals(error, dependencyError);
      assertEquals(globalInProgress.has(key), false);
    } finally {
      globalInProgress.delete(key);
      finishTransform();
    }
  });

  it("bounds a caller wait without evicting the shared transform", async () => {
    using time = new FakeTime();
    const key = "test:shared-transform-wait";
    const pending = new Promise<ModuleCacheEntry>(() => {});
    globalInProgress.set(key, pending);

    try {
      const wait = __ssrModuleLoaderInternals.waitForInProgressTransform(
        pending,
        "/app/SlowPage.tsx",
      );
      const waitRejected = assertRejects(
        () => wait,
        Error,
        "Timed out waiting for in-progress SSR transform",
      );
      await time.tickAsync(TRANSFORM_IN_PROGRESS_WAIT_TIMEOUT_MS);
      await waitRejected;
      assertEquals(globalInProgress.get(key), pending);
    } finally {
      globalInProgress.delete(key);
    }
  });

  it("cancels an in-progress transform only after its final observer detaches", async () => {
    const key = "test:observed-shared-transform";
    const pending = new Promise<ModuleCacheEntry>(() => {});
    globalInProgress.set(key, pending);
    const sharedSignal = __ssrModuleLoaderInternals.registerInProgressTransformObservers(
      key,
      pending,
    );
    const firstController = new AbortController();
    const secondController = new AbortController();

    try {
      const first = __ssrModuleLoaderInternals.waitForInProgressTransform(
        pending,
        "/app/SharedLayout.tsx",
        firstController.signal,
      );
      const second = __ssrModuleLoaderInternals.waitForInProgressTransform(
        pending,
        "/app/SharedLayout.tsx",
        secondController.signal,
      );

      firstController.abort(new DOMException("first render cancelled", "AbortError"));
      await assertRejects(() => first, Error, "first render cancelled");
      assertEquals(sharedSignal.aborted, false);
      assertEquals(globalInProgress.get(key), pending);

      secondController.abort(new DOMException("second render cancelled", "AbortError"));
      await assertRejects(() => second, Error, "second render cancelled");
      assertEquals(sharedSignal.aborted, true);
      assertEquals(globalInProgress.has(key), false);
    } finally {
      globalInProgress.delete(key);
    }
  });

  it("evicts only the exact transform that exceeds the stale safety window", async () => {
    using time = new FakeTime();
    const key = "test:stale-transform-eviction";
    const stale = new Promise<ModuleCacheEntry>(() => {});
    const replacement = new Promise<ModuleCacheEntry>(() => {});
    globalInProgress.set(key, stale);
    const timer = __ssrModuleLoaderInternals.scheduleStaleInProgressTransformEviction(
      key,
      stale,
      "/app/StalledPage.tsx",
    );

    try {
      await time.tickAsync(TRANSFORM_IN_PROGRESS_STALE_EVICTION_MS - 1);
      assertEquals(globalInProgress.get(key), stale);

      globalInProgress.set(key, replacement);
      await time.tickAsync(1);
      assertEquals(globalInProgress.get(key), replacement);
    } finally {
      clearTimeout(timer);
      globalInProgress.delete(key);
    }
  });

  it("allows retry after the current transform exceeds the stale safety window", async () => {
    using time = new FakeTime();
    const key = "test:current-stale-transform-eviction";
    const stale = new Promise<ModuleCacheEntry>(() => {});
    globalInProgress.set(key, stale);
    const timer = __ssrModuleLoaderInternals.scheduleStaleInProgressTransformEviction(
      key,
      stale,
      "/app/StalledPage.tsx",
    );

    try {
      await time.tickAsync(TRANSFORM_IN_PROGRESS_STALE_EVICTION_MS);
      assertEquals(globalInProgress.has(key), false);
    } finally {
      clearTimeout(timer);
      globalInProgress.delete(key);
    }
  });

  it("does not let an evicted loader leader overwrite replacement cache entries", () => {
    const inProgressKey = "test:late-loader-publication";
    const contentCacheKey = "test:late-loader-content";
    const filePathCacheKey = "test:late-loader-path";
    const oldLeader = new Promise<ModuleCacheEntry>(() => {});
    const replacementLeader = new Promise<ModuleCacheEntry>(() => {});
    const replacementEntry = { tempPath: "/cache/replacement.mjs", contentHash: "replacement" };
    const oldEntry = { tempPath: "/cache/old.mjs", contentHash: "old" };
    const timer = setTimeout(() => {}, 60_000);
    let distributedWrites = 0;

    globalInProgress.set(inProgressKey, replacementLeader);
    globalModuleCache.set(contentCacheKey, replacementEntry);
    globalModuleCache.set(filePathCacheKey, replacementEntry);

    try {
      const published = __ssrModuleLoaderInternals.publishTransformCacheIfCurrent({
        inProgressKey,
        transformPromise: oldLeader,
        staleEvictionTimer: timer,
        contentCacheKey,
        filePathCacheKey,
        entry: oldEntry,
        publishDistributed: () => distributedWrites++,
      });

      assertEquals(published, false);
      assertEquals(distributedWrites, 0);
      assertEquals(globalModuleCache.get(contentCacheKey), replacementEntry);
      assertEquals(globalModuleCache.get(filePathCacheKey), replacementEntry);
    } finally {
      clearTimeout(timer);
      globalInProgress.delete(inProgressKey);
      globalModuleCache.delete(contentCacheKey);
      globalModuleCache.delete(filePathCacheKey);
    }
  });

  it("preserves a terminal cross-project fetch failure on a cold load", async () => {
    clearSSRModuleCache();
    globalCrossProjectCache.clear();

    const projectDir = "/app";
    const filePath = "/app/app/page.tsx";
    const projectId = "project-cold-cross-project-terminal";
    const specifier = "acme-ui@1.2.3/@/components/Button.tsx";
    const source = [
      `import Button from "${specifier}";`,
      `export default function Page() {`,
      `  return Button;`,
      `}`,
    ].join("\n");

    // The failure `http-cache.ts` raises once its retries are exhausted. In
    // production it originates deeper — inside `transformToESM` on the fetched
    // cross-project source — but that call is not injectable from here, so it
    // is injected synthetically at the registry fetch, the nearest stubbable
    // boundary. What matters for this test is that a terminal failure escapes
    // `transformCrossProjectImportFlow`, which rethrows untouched either way.
    const fetchError = BUILD_FAILED.create({
      detail: "Failed to fetch https://esm.sh/marked: AbortError",
      context: { phase: "http-module-fetch" },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("acme-ui@1.2.3")) return Promise.reject(fetchError);
      return originalFetch(input, init);
    }) as typeof fetch;

    const loader = new SSRModuleLoader({
      projectDir,
      projectId,
      contentSourceId: "release-1",
      adapter: createProxyProjectAdapter({ "app/page.tsx": source }),
      apiBaseUrl: "https://registry.example.test/api",
      dev: true,
    });

    try {
      const error = await assertRejects(
        () => loader.loadRawModule(filePath, source),
        VeryfrontError,
        "Failed to fetch https://esm.sh/marked: AbortError",
      );

      assertStrictEquals(error, fetchError);
      // The cold path used to swallow this into `missingDependencies`, finish
      // the transform, and publish a module whose cross-project specifier was
      // never rewritten. Nothing may reach the cache when the fetch is terminal.
      // Scoped to this project's keys rather than asserting on total cache size,
      // so a late write from an earlier test cannot turn this into a flake.
      assertEquals(
        [...globalModuleCache.keys()].filter((key) => isKeyForProject(key, projectId)),
        [],
      );
      assertEquals(
        [...globalCrossProjectCache.keys()].filter((key) => key.includes(projectId)),
        [],
      );
    } finally {
      globalThis.fetch = originalFetch;
      clearSSRModuleCache();
      globalCrossProjectCache.clear();
    }
  });
});
