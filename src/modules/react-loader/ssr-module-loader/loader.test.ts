import "#veryfront/schemas/_test-setup.ts";
import "../../../transforms/plugins/__tests__/code-parser-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { clearSSRModuleCache, SSRModuleLoader } from "./index.ts";
import { globalInProgress, globalModuleCache } from "./cache/memory.ts";
import { verifiedHttpBundlePaths } from "./http-bundle-helpers.ts";
import { buildSSRModuleCacheKey } from "../../../cache/keys.ts";
import { VERSION } from "#veryfront/utils/version.ts";
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
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  clearModulePathCache,
  getModulePathCache,
  verifiedModuleDeps,
  waitForDiskCleanup,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";

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
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        VERSION,
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
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        VERSION,
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
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        VERSION,
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

  it("clears verified MDX-ESM path cache before retrying stale local dependencies", async () => {
    clearSSRModuleCache();
    clearModulePathCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-loader-verified-mdx-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "VerifiedMdxStaleCache.tsx");
    const projectId = "project-verified-mdx-stale-test";
    const contentSourceId = "preview-main";

    const mdxCacheDir = join(getMdxEsmCacheDir(), hashCodeHex(projectId), contentSourceId);
    const mdxComponentDir = join(mdxCacheDir, "components");

    try {
      await mkdir(componentsDir, { recursive: true });
      await mkdir(mdxComponentDir, { recursive: true });

      const source = "export default function VerifiedMdxStaleCache() { return null; }";
      const contentHash = hashAsLoader(source, filePath, projectDir);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";

      const filePathCacheKey = buildSSRModuleCacheKey(
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        VERSION,
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

    const mdxCacheDir = join(getMdxEsmCacheDir(), hashCodeHex(projectId), contentSourceId);
    const mdxComponentDir = join(mdxCacheDir, "components");

    try {
      await mkdir(componentsDir, { recursive: true });
      await mkdir(mdxComponentDir, { recursive: true });

      const source = "export default function ColdMdxStaleCache() { return null; }";
      const contentHash = hashAsLoader(source, filePath, projectDir);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";

      const filePathCacheKey = buildSSRModuleCacheKey(
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        VERSION,
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

    const mdxCacheDir = join(getMdxEsmCacheDir(), hashCodeHex(projectId), contentSourceId);
    const mdxComponentDir = join(mdxCacheDir, "components");

    try {
      await mkdir(componentsDir, { recursive: true });
      await mkdir(mdxComponentDir, { recursive: true });

      const source = "export default function BranchMdxStaleCache() { return null; }";
      const contentHash = hashAsLoader(source, filePath, projectDir);
      const configHash = computeConfigHashSync({ dev: true });
      const reactVersion = "default";

      const filePathCacheKey = buildSSRModuleCacheKey(
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        VERSION,
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
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}:${contentHash}`,
      );

      const vfmodDir = join(getMdxEsmCacheDir(), projectId, contentSourceId);
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
      await remove(join(getMdxEsmCacheDir(), projectId, contentSourceId), { recursive: true })
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
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        VERSION,
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
        VERSION,
        projectId,
        `${contentSourceId}:${reactVersion}:${configHash}:${filePath}`,
      );
      const contentCacheKey = buildSSRModuleCacheKey(
        VERSION,
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
        VERSION,
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
});
