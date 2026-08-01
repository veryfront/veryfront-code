import "#veryfront/schemas/_test-setup.ts";
import "../../../transforms/plugins/__tests__/code-parser-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { join } from "#veryfront/compat/path";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";
import {
  clearSSRModuleCache,
  clearSSRModuleCacheForProject,
  createSSRImportMapIdentity,
  SSRModuleLoader,
} from "./index.ts";
import type { SSRImportMapIdentity } from "./import-map-identity.ts";
import { __ssrModuleLoaderInternals } from "./loader.ts";
import { globalInProgress, globalModuleCache } from "./cache/memory.ts";
import {
  TRANSFORM_IN_PROGRESS_STALE_EVICTION_MS,
  TRANSFORM_IN_PROGRESS_WAIT_TIMEOUT_MS,
} from "./constants.ts";
import { verifiedHttpBundlePaths } from "./http-bundle-helpers.ts";
import { buildSSRModuleCacheKey } from "../../../cache/keys.ts";
import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";
import { computeConfigHashSync } from "../../../cache/config-hash.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import {
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { injectNodePositions } from "#veryfront/transforms/plugins/babel-node-positions.ts";
import type {
  CacheRevisionMutation,
  CacheRevisionSnapshot,
  RevisionedCacheBackend,
} from "#veryfront/cache/types.ts";
import { buildRevisionedCacheKey } from "#veryfront/cache/backend.ts";
import { __injectCachesForTests } from "#veryfront/transforms/esm/transform-cache.ts";
import {
  buildMdxEsmModuleRecoveryCacheKey,
  buildMdxEsmPathCacheKey,
} from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ModuleCacheEntry } from "./types.ts";
import {
  clearModulePathCache,
  getMdxEsmSsrCacheDir,
  getModulePathCache,
  verifiedModuleDeps,
  waitForDiskCleanup,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { SSRCacheManager } from "./ssr-cache-manager.ts";
import { createDependencyHashCache } from "#veryfront/cache/dependency-graph.ts";
import {
  createMdxModuleRecoveryPayload,
  serializeMdxModuleRecoveryPayload,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/recovery-payload.ts";

const CANONICAL_PIN_KEY = "on:3m96ohlm0kf87";
const PINNED_DEPENDENCIES = Object.freeze({ lodash: "1.0.0" });
const CHANGED_PINNED_DEPENDENCIES = Object.freeze({ lodash: "2.0.0" });

/** Hash source as the loader sees it (after node position injection for .tsx in dev/preview) */
function hashAsLoader(source: string, filePath: string, projectDir: string): Promise<string> {
  const rel = filePath.startsWith(projectDir)
    ? filePath.slice(projectDir.length).replace(/^\/+/, "")
    : filePath;
  return computeHash(injectNodePositions(source, { filePath: rel }));
}

async function getLoaderCacheKeys(options: {
  source: string;
  filePath: string;
  projectDir: string;
  projectId: string;
  contentSourceId: string;
}): Promise<{
  contentHash: string;
  contentCacheKey: string;
  filePathCacheKey: string;
}> {
  const manager = new SSRCacheManager({
    projectDir: options.projectDir,
    projectId: options.projectId,
    contentSourceId: options.contentSourceId,
    adapter: denoAdapter,
    dev: true,
  });
  const contentHash = await hashAsLoader(
    options.source,
    options.filePath,
    options.projectDir,
  );
  const graphIdentity = await manager.getSourceGraphCacheIdentity(
    options.filePath,
    contentHash,
    createDependencyHashCache(),
  );
  if (!graphIdentity.cacheable) {
    throw new Error("Expected a cacheable test module dependency graph", {
      cause: graphIdentity.error,
    });
  }

  return {
    contentHash,
    contentCacheKey: manager.getCacheKey(
      `${options.filePath}:${graphIdentity.hash}`,
    ),
    filePathCacheKey: manager.getCacheKey(options.filePath),
  };
}

class FakeDistributedCache implements RevisionedCacheBackend {
  readonly type = "distributed" as const;
  private values = new Map<string, { value: string | null; revision: string }>();
  private nextRevision = 0;

  get(key: string): Promise<string | null> {
    return Promise.reject(new Error(`ordinary get must not be used: ${key}`));
  }

  set(key: string): Promise<void> {
    return Promise.reject(new Error(`ordinary set must not be used: ${key}`));
  }

  del(key: string): Promise<void> {
    return Promise.reject(new Error(`ordinary del must not be used: ${key}`));
  }

  getWithRevision(key: string): Promise<CacheRevisionSnapshot> {
    const record = this.values.get(key);
    return Promise.resolve({ value: record?.value ?? null, revision: record?.revision ?? "0" });
  }

  compareExchange(
    key: string,
    expectedRevision: string,
    mutation: CacheRevisionMutation,
  ): Promise<boolean> {
    const current = this.values.get(key);
    if ((current?.revision ?? "0") !== expectedRevision) return Promise.resolve(false);
    this.values.set(key, {
      value: mutation.kind === "set" ? mutation.value : null,
      revision: String(++this.nextRevision),
    });
    return Promise.resolve(true);
  }

  async seedWithCompareExchange(key: string, value: string): Promise<void> {
    const snapshot = await this.getWithRevision(key);
    const stored = await this.compareExchange(key, snapshot.revision, {
      kind: "set",
      value,
      expiresAtMs: Date.now() + 60_000,
    });
    if (!stored) throw new Error("revisioned test seed lost its compare-exchange");
  }
}

function createProxyProjectAdapter(files: Record<string, string>): RuntimeAdapter {
  const normalize = (path: string) => path.replace(/^\/app\/+/, "");
  const notFound = (path: string): Error & { code: string } => {
    const error = new Error(`File not found: ${path}`) as Error & { code: string };
    error.code = "ENOENT";
    return error;
  };

  return {
    id: "deno",
    name: "proxy-project-test",
    capabilities: denoAdapter.capabilities,
    fs: {
      async readFile(path: string): Promise<string> {
        const normalized = normalize(path);
        const content = files[normalized];
        if (content == null) throw notFound(path);
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
        if (content == null) throw notFound(path);
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

function createReadGateAdapter(
  gatedPath: string,
  onBlocked: () => void,
  waitUntilReleased: Promise<void>,
): RuntimeAdapter {
  const base = new DenoAdapter();
  let blocked = false;
  const fs = new Proxy(base.fs, {
    get(target, property, receiver) {
      if (property === "readFile") {
        return async (path: string): Promise<string> => {
          if (path === gatedPath && !blocked) {
            blocked = true;
            onBlocked();
            await waitUntilReleased;
          }
          return await target.readFile(path);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return {
    id: base.id,
    name: base.name,
    capabilities: base.capabilities,
    fs,
    env: base.env,
    server: base.server,
    shell: base.shell,
    serve: base.serve,
    shutdown: () => base.shutdown(),
  };
}

describe("SSRModuleLoader", { sanitizeResources: false, sanitizeOps: false }, () => {
  it("accepts only atomic factory-created import-map identities", async () => {
    const baseOptions = {
      projectDir: "/project",
      projectId: "project-a",
      contentSourceId: "preview-main",
      adapter: denoAdapter,
      dev: true,
    } as const;
    const validIdentity = await createSSRImportMapIdentity({
      imports: { package: "https://modules.example/map-a.ts" },
      scopes: {},
    });

    assertThrows(
      () =>
        new SSRModuleLoader({
          ...baseOptions,
          importMapIdentity: {
            importMap: validIdentity.importMap,
          } as SSRImportMapIdentity,
        }),
      TypeError,
      "createImportMapIdentity",
    );
    assertThrows(
      () =>
        new SSRModuleLoader({
          ...baseOptions,
          importMapIdentity: {
            ...validIdentity,
            fingerprint: "b".repeat(64),
          },
        }),
      TypeError,
      "createImportMapIdentity",
    );

    new SSRModuleLoader({ ...baseOptions, importMapIdentity: validIdentity });
    new SSRModuleLoader(baseOptions);
  });

  it("rejects invalid dependency snapshots before constructing cache-backed state", () => {
    const baseOptions = {
      projectDir: "/project",
      projectId: "project-a",
      contentSourceId: "preview-main",
      adapter: denoAdapter,
      dev: true,
    } as const;

    for (
      const invalidSnapshot of [
        {
          dependencyPinningCacheKey: "malformed",
          dependencyPinningDependencies: PINNED_DEPENDENCIES,
        },
        {
          dependencyPinningCacheKey: CANONICAL_PIN_KEY,
        },
        {
          dependencyPinningCacheKey: CANONICAL_PIN_KEY,
          dependencyPinningDependencies: CHANGED_PINNED_DEPENDENCIES,
        },
      ] as const
    ) {
      assertThrows(
        () =>
          new SSRModuleLoader({
            ...baseOptions,
            ...invalidSnapshot,
          }),
        Error,
        "dependency pinning snapshot",
      );
    }
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
      await writeTextFile(filePath, source);
      const { contentHash, contentCacheKey, filePathCacheKey } = await getLoaderCacheKeys({
        source,
        filePath,
        projectDir,
        projectId,
        contentSourceId,
      });

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
      await writeTextFile(filePath, source);
      const { contentHash, contentCacheKey, filePathCacheKey } = await getLoaderCacheKeys({
        source,
        filePath,
        projectDir,
        projectId,
        contentSourceId,
      });

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
      await writeTextFile(filePath, source);
      const { contentHash, contentCacheKey, filePathCacheKey } = await getLoaderCacheKeys({
        source,
        filePath,
        projectDir,
        projectId,
        contentSourceId,
      });

      const staleTempPath = join(projectDir, `missing-cached-output-${crypto.randomUUID()}.mjs`);
      const staleEntry = { tempPath: staleTempPath, contentHash };
      globalModuleCache.set(contentCacheKey, staleEntry);
      globalModuleCache.set(filePathCacheKey, staleEntry);
      verifiedHttpBundlePaths.set(`${staleTempPath}:${contentHash}`, true);

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

    const mdxCacheDir = getMdxEsmSsrCacheDir(projectId, contentSourceId);
    const mdxComponentDir = join(mdxCacheDir, "components");

    try {
      await mkdir(componentsDir, { recursive: true });
      await mkdir(mdxComponentDir, { recursive: true });

      const source = "export default function VerifiedMdxStaleCache() { return null; }";
      await writeTextFile(filePath, source);
      const { contentHash, contentCacheKey, filePathCacheKey } = await getLoaderCacheKeys({
        source,
        filePath,
        projectDir,
        projectId,
        contentSourceId,
      });

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
      await writeTextFile(filePath, source);
      const { contentHash, contentCacheKey, filePathCacheKey } = await getLoaderCacheKeys({
        source,
        filePath,
        projectDir,
        projectId,
        contentSourceId,
      });

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
      await writeTextFile(filePath, source);
      const { contentHash, contentCacheKey, filePathCacheKey } = await getLoaderCacheKeys({
        source,
        filePath,
        projectDir,
        projectId,
        contentSourceId,
      });

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
      await writeTextFile(filePath, source);
      const { contentHash, contentCacheKey, filePathCacheKey } = await getLoaderCacheKeys({
        source,
        filePath,
        projectDir,
        projectId,
        contentSourceId,
      });

      const vfmodDir = getMdxEsmSsrCacheDir(projectId, contentSourceId);
      const recoveredChildCode = `export default null;`;
      const childPayload = createMdxModuleRecoveryPayload(
        projectId,
        contentSourceId,
        "_vf_modules/child.js",
        recoveredChildCode,
      );
      const childPath = join(vfmodDir, childPayload.fileName);
      const cachedTempPath = join(projectDir, `recover-vfmod-${crypto.randomUUID()}.mjs`);

      await distributedCache.seedWithCompareExchange(
        buildRevisionedCacheKey(
          buildMdxEsmModuleRecoveryCacheKey(projectId, contentSourceId, childPayload.fileName),
        ),
        serializeMdxModuleRecoveryPayload(childPayload),
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
      assertEquals(await readTextFile(childPath), recoveredChildCode);
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
      await writeTextFile(filePath, source);
      const { contentHash, contentCacheKey, filePathCacheKey } = await getLoaderCacheKeys({
        source,
        filePath,
        projectDir,
        projectId,
        contentSourceId,
      });

      const runtimeErrorTempPath = join(projectDir, `runtime-error-${crypto.randomUUID()}.mjs`);
      await writeTextFile(
        runtimeErrorTempPath,
        `throw new Error("intentional-runtime-error");\nexport default function CacheRetainOnRuntimeError() { return null; }`,
      );

      const fakeEntry = { tempPath: runtimeErrorTempPath, contentHash };
      globalModuleCache.set(contentCacheKey, fakeEntry);
      globalModuleCache.set(filePathCacheKey, fakeEntry);
      verifiedHttpBundlePaths.set(`${runtimeErrorTempPath}:${contentHash}`, true);

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
    const projectId = "project-retain-test";
    const contentSourceId = "local-main";

    try {
      await mkdir(componentsDir, { recursive: true });

      const source = "export default function Good() { return null; }";
      await writeTextFile(filePath, source);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const component = await loader.loadModule(filePath, source);
      assertEquals(component.name, "Good");

      const filePathCacheKey = buildSSRModuleCacheKey(
        RUNTIME_VERSION,
        projectId,
        `${contentSourceId}:default:${computeConfigHashSync({ dev: true })}:${filePath}`,
      );
      assert(
        globalModuleCache.has(filePathCacheKey),
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

  it("isolates dependency failures between concurrent loads on one loader", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({
      prefix: "vf-ssr-loader-validator-isolation-",
    });
    const componentsDir = join(projectDir, "components");
    const goodPath = join(componentsDir, "Good.tsx");
    const childPath = join(componentsDir, "Child.tsx");
    const missingPath = join(componentsDir, "Missing.tsx");
    let releaseChildRead!: () => void;
    const childReadRelease = new Promise<void>((resolve) => {
      releaseChildRead = resolve;
    });
    let reportChildReadStarted!: () => void;
    const childReadStarted = new Promise<void>((resolve) => {
      reportChildReadStarted = resolve;
    });

    try {
      await mkdir(componentsDir, { recursive: true });
      const childSource = "export default function Child() { return null; }";
      const goodSource = [
        `import Child from "./Child.tsx";`,
        `export default function Good() { return Child; }`,
      ].join("\n");
      const missingSource = [
        `import MissingDependency from "./does-not-exist.ts";`,
        `export default function Missing() { return MissingDependency; }`,
      ].join("\n");
      await Promise.all([
        writeTextFile(childPath, childSource),
        writeTextFile(goodPath, goodSource),
        writeTextFile(missingPath, missingSource),
      ]);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId: "project-validator-isolation",
        contentSourceId: "local-main",
        adapter: createReadGateAdapter(
          childPath,
          reportChildReadStarted,
          childReadRelease,
        ),
        dev: true,
      });

      const goodLoad = loader.loadModule(goodPath, goodSource);
      await childReadStarted;
      await assertRejects(
        () => loader.loadModule(missingPath, missingSource),
        Error,
        "./does-not-exist.ts",
      );

      releaseChildRead();
      const good = await goodLoad;
      assertEquals(good.name, "Good");
    } finally {
      releaseChildRead();
      await remove(projectDir, { recursive: true });
    }
  });

  it("rejects circular local dependencies without waiting for singleflight timeout", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({
      prefix: "vf-ssr-loader-cycle-",
    });
    const componentsDir = join(projectDir, "components");
    const firstPath = join(componentsDir, "First.tsx");
    const secondPath = join(componentsDir, "Second.tsx");
    const firstSource = [
      `import Second from "./Second.tsx";`,
      `export default function First() { return Second; }`,
    ].join("\n");
    const secondSource = [
      `import First from "./First.tsx";`,
      `export default function Second() { return First; }`,
    ].join("\n");

    try {
      await mkdir(componentsDir, { recursive: true });
      await Promise.all([
        writeTextFile(firstPath, firstSource),
        writeTextFile(secondPath, secondSource),
      ]);

      const loader = new SSRModuleLoader({
        projectDir,
        projectId: "project-cycle-test",
        contentSourceId: "local-main",
        adapter: denoAdapter,
        dev: true,
      });
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const loadWithDeadline = Promise.race([
        loader.loadModule(firstPath, firstSource),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Cycle detection timed out")),
            2_000,
          );
        }),
      ]);

      try {
        await assertRejects(
          () => loadWithDeadline,
          Error,
          "Circular SSR module dependency detected",
        );
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
      assertEquals(globalInProgress.size, 0);
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
      await writeTextFile(filePath, source);
      const { contentHash, contentCacheKey, filePathCacheKey } = await getLoaderCacheKeys({
        source,
        filePath,
        projectDir,
        projectId,
        contentSourceId,
      });

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

      const { contentCacheKey } = await getLoaderCacheKeys({
        source,
        filePath,
        projectDir,
        projectId,
        contentSourceId,
      });

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
        retainInMemory: true,
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

  it("does not retain cache pointers for an uncacheable dependency scan", () => {
    const inProgressKey = "test:uncacheable-loader-publication";
    const contentCacheKey = "test:uncacheable-loader-content";
    const filePathCacheKey = "test:uncacheable-loader-path";
    const leader = Promise.resolve({
      tempPath: "/cache/uncacheable.mjs",
      contentHash: "uncacheable",
    });
    const entry = { tempPath: "/cache/uncacheable.mjs", contentHash: "uncacheable" };
    const timer = setTimeout(() => {}, 60_000);

    globalInProgress.set(inProgressKey, leader);

    try {
      const published = __ssrModuleLoaderInternals.publishTransformCacheIfCurrent({
        inProgressKey,
        transformPromise: leader,
        staleEvictionTimer: timer,
        contentCacheKey,
        filePathCacheKey,
        entry,
        retainInMemory: false,
      });

      assertEquals(published, true);
      assertEquals(globalModuleCache.get(contentCacheKey), undefined);
      assertEquals(globalModuleCache.get(filePathCacheKey), undefined);
    } finally {
      clearTimeout(timer);
      globalInProgress.delete(inProgressKey);
      globalModuleCache.delete(contentCacheKey);
      globalModuleCache.delete(filePathCacheKey);
    }
  });
});
