import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { join, toFileUrl } from "#veryfront/compat/path/index.ts";
import * as esbuild from "veryfront/extensions/bundler";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import {
  makeTempDir,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { tokenizeAllVeryFrontPaths } from "#veryfront/cache";
import { __injectCachesForTests } from "#veryfront/transforms/esm/transform-cache.ts";
import { buildMdxEsmModuleRecoveryCacheKey } from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";
import { SSRCacheManager } from "./ssr-cache-manager.ts";
import { getMdxEsmSsrCacheDir } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import {
  createMdxModuleRecoveryPayload,
  serializeMdxModuleRecoveryPayload,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/recovery-payload.ts";
import { createSSRImportMapIdentity } from "./import-map-identity.ts";
import { createDependencyHashCache } from "#veryfront/cache/dependency-graph.ts";

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

describe("SSRCacheManager", { sanitizeResources: false, sanitizeOps: false }, () => {
  afterAll(async () => {
    await esbuild.stop();
  });

  it("uses full SHA-256 identities for both small and large module content", async () => {
    const manager = new SSRCacheManager({
      projectDir: "/project",
      projectId: "project",
      contentSourceId: "preview",
      adapter: denoAdapter,
      dev: true,
    });
    const small = "export const value = 1;";
    const large = small.repeat(1_000);

    assertEquals(await manager.hashContentAsync(small), await computeHash(small));
    assertEquals(await manager.hashContentAsync(large), await computeHash(large));
    assertEquals((await manager.hashContentAsync(small)).length, 64);
  });

  it("changes the outer cache identity when a TSX dependency graph changes", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-ssr-graph-identity-" });
    const pagePath = join(projectDir, "app", "page.tsx");
    const childPath = join(projectDir, "app", "Child.tsx");
    const pageSource = [
      `import Child from "./Child";`,
      `export default function Page() { return <main><Child /></main>; }`,
    ].join("\n");
    const manager = new SSRCacheManager({
      projectDir,
      projectId: "graph-identity-project",
      contentSourceId: "preview-main",
      adapter: denoAdapter,
      dev: true,
    });

    try {
      await mkdir(join(projectDir, "app"), { recursive: true });
      await writeTextFile(pagePath, pageSource);
      await writeTextFile(
        childPath,
        `export default function Child() { return <span>one</span>; }`,
      );

      const sourceHash = await manager.hashContentAsync(pageSource);
      const first = await manager.getSourceGraphCacheIdentity(
        pagePath,
        sourceHash,
        createDependencyHashCache(),
      );
      await writeTextFile(
        childPath,
        `export default function Child() { return <span>two</span>; }`,
      );
      const second = await manager.getSourceGraphCacheIdentity(
        pagePath,
        sourceHash,
        createDependencyHashCache(),
      );

      assertEquals(first.cacheable, true);
      assertEquals(second.cacheable, true);
      if (!first.cacheable || !second.cacheable) {
        throw new Error("Expected cacheable dependency graph identities");
      }
      assertNotEquals(first.hash, second.hash);
      assertNotEquals(first.dependencyHash, second.dependencyHash);
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("isolates SSR module cache identities by import-map fingerprint", async () => {
    const mapAIdentity = await createSSRImportMapIdentity({
      imports: { package: "https://modules.example/map-a.ts" },
      scopes: {},
    });
    const mapBIdentity = await createSSRImportMapIdentity({
      imports: { package: "https://modules.example/map-b.ts" },
      scopes: {},
    });
    const createManager = (importMapIdentity = mapAIdentity) =>
      new SSRCacheManager({
        projectDir: "/project",
        projectId: "project",
        contentSourceId: "release-1",
        adapter: denoAdapter,
        dev: false,
        importMapIdentity,
      });

    const mapAKey = createManager(mapAIdentity).getCacheKey("/project/pages/index.tsx");
    const mapARepeatKey = createManager(mapAIdentity).getCacheKey("/project/pages/index.tsx");
    const mapBKey = createManager(mapBIdentity).getCacheKey("/project/pages/index.tsx");
    const standaloneKey = new SSRCacheManager({
      projectDir: "/project",
      projectId: "project",
      contentSourceId: "release-1",
      adapter: denoAdapter,
      dev: false,
    }).getCacheKey("/project/pages/index.tsx");

    assertEquals(mapAKey, mapARepeatKey);
    assertEquals(mapAKey === mapBKey, false);
    assertEquals(mapAKey === standaloneKey, false);
  });

  it("separates SSR module cache identity by API base URL", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-ssr-cache-manager-" });
    const baseOptions = {
      projectDir,
      projectId: "project-a",
      contentSourceId: "preview-main",
      adapter: denoAdapter,
      dev: true,
      reactVersion: "19.1.1",
    };

    try {
      const registryA = new SSRCacheManager({
        ...baseOptions,
        apiBaseUrl: "https://registry-a.example.com/api",
      });
      const registryB = new SSRCacheManager({
        ...baseOptions,
        apiBaseUrl: "https://registry-b.example.com/api",
      });

      assertNotEquals(registryA.getConfigHash(), registryB.getConfigHash());
      assertNotEquals(
        registryA.getCacheKey("/project/pages/index.tsx"),
        registryB.getCacheKey("/project/pages/index.tsx"),
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("recovers missing vfmod dependencies for redis cache entries", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-ssr-cache-manager-" });
    const distributedCache = new FakeDistributedCache();
    const projectId = `project-${crypto.randomUUID()}`;
    const contentSourceId = `preview-${crypto.randomUUID()}`;
    const vfmodDir = getMdxEsmSsrCacheDir(projectId, contentSourceId);
    const childPayload = createMdxModuleRecoveryPayload(
      projectId,
      contentSourceId,
      "_vf_modules/child.js",
      tokenizeAllVeryFrontPaths(`export default "recovered";`),
    );
    const childPath = join(vfmodDir, childPayload.fileName);
    const stablePath = join(projectDir, "stable.mjs");

    try {
      __injectCachesForTests({ cacheBackend: distributedCache });
      await writeTextFile(stablePath, `export default "stable";`);

      await distributedCache.set(
        buildMdxEsmModuleRecoveryCacheKey(projectId, contentSourceId, childPayload.fileName),
        serializeMdxModuleRecoveryPayload(childPayload),
      );

      const cacheManager = new SSRCacheManager({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const statCounts = new Map<string, number>();
      const fs = cacheManager.getFs();
      const originalStat = fs.stat.bind(fs);
      fs.stat = async (path) => {
        statCounts.set(path, (statCounts.get(path) ?? 0) + 1);
        return await originalStat(path);
      };

      const isValid = await cacheManager.validateCachedCode(
        [
          `import stable from "file://${stablePath}";`,
          `import child from "file://${childPath}";`,
          `export default [stable, child];`,
        ].join("\n"),
        join(projectDir, "pages", "index.tsx"),
        "redis-cache",
        {
          checkLocalPaths: true,
          checkInvalidEsmShPath: true,
        },
      );

      assertEquals(isValid, true);
      assertEquals(await readTextFile(childPath), `export default "recovered";`);
      assertEquals(statCounts.get(stablePath), 1);
      assertEquals(statCounts.get(childPath), 2);
    } finally {
      __injectCachesForTests(null);
      await remove(vfmodDir, { recursive: true }).catch(() => {});
      await remove(projectDir, { recursive: true });
    }
  });

  it("rejects redis cache entries with missing legacy .cache TSX imports", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-ssr-cache-manager-" });
    const projectId = `project-${crypto.randomUUID()}`;
    const contentSourceId = `preview-${crypto.randomUUID()}`;

    try {
      const cacheManager = new SSRCacheManager({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const isValid = await cacheManager.validateCachedCode(
        `import child from "file:///app/.cache/markdown.tsx"; export default child;`,
        join(projectDir, "pages", "index.tsx"),
        "redis-cache",
        {
          checkLocalPaths: true,
          checkInvalidEsmShPath: true,
        },
      );

      assertEquals(isValid, false);
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("accepts cache entries that reference existing compiled framework sources", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-ssr-cache-manager-" });
    const embeddedSourcePath = join(
      projectDir,
      "dist",
      "framework-src",
      "react",
      "runtime",
      "core.ts.src",
    );

    try {
      await mkdir(join(projectDir, "dist", "framework-src", "react", "runtime"), {
        recursive: true,
      });
      await writeTextFile(embeddedSourcePath, `export const core = "compiled";`);

      const cacheManager = new SSRCacheManager({
        projectDir,
        projectId: `project-${crypto.randomUUID()}`,
        contentSourceId: `preview-${crypto.randomUUID()}`,
        adapter: denoAdapter,
        dev: true,
      });

      const isValid = await cacheManager.validateCachedCode(
        `import { core } from "${toFileUrl(embeddedSourcePath).href}"; export default core;`,
        join(projectDir, "pages", "index.tsx"),
        "memory-cache",
        {
          checkLocalPaths: true,
          checkInvalidEsmShPath: false,
        },
      );

      assertEquals(isValid, true);
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("rejects redis cache entries with nested legacy .cache TSX imports inside vfmods", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-ssr-cache-manager-" });
    const projectId = `project-${crypto.randomUUID()}`;
    const contentSourceId = `preview-${crypto.randomUUID()}`;
    const vfmodDir = getMdxEsmSsrCacheDir(projectId, contentSourceId);
    const childPath = join(vfmodDir, "vfmod-child.mjs");

    try {
      await mkdir(vfmodDir, { recursive: true });
      await writeTextFile(
        childPath,
        `import child from "file:///app/.cache/markdown.tsx"; export default child;`,
      );

      const cacheManager = new SSRCacheManager({
        projectDir,
        projectId,
        contentSourceId,
        adapter: denoAdapter,
        dev: true,
      });

      const isValid = await cacheManager.validateCachedCode(
        `import child from "file://${childPath}"; export default child;`,
        join(projectDir, "pages", "index.tsx"),
        "redis-cache",
        {
          checkLocalPaths: true,
          checkInvalidEsmShPath: true,
        },
      );

      assertEquals(isValid, false);
    } finally {
      await remove(vfmodDir, { recursive: true }).catch(() => {});
      await remove(projectDir, { recursive: true });
    }
  });

  it("rejects only real unresolved _vf_modules imports", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-ssr-cache-manager-" });
    const cacheManager = new SSRCacheManager({
      projectDir,
      projectId: `project-${crypto.randomUUID()}`,
      contentSourceId: `preview-${crypto.randomUUID()}`,
      adapter: denoAdapter,
      dev: true,
    });

    try {
      const importLookingTextIsValid = await cacheManager.validateCachedCode(
        [
          `const text = 'from "/_vf_modules/react@18.3.1/some-module.js"';`,
          `// import x from "/_vf_modules/commented.js";`,
          `export default text;`,
        ].join("\n"),
        join(projectDir, "pages", "index.tsx"),
        "redis-cache",
        {
          checkLocalPaths: false,
          checkInvalidEsmShPath: true,
        },
      );

      assertEquals(importLookingTextIsValid, true);

      const realImportIsInvalid = await cacheManager.validateCachedCode(
        [
          `import x from "/_vf_modules/react@18.3.1/some-module.js";`,
          `export default x;`,
        ].join("\n"),
        join(projectDir, "pages", "index.tsx"),
        "redis-cache",
        {
          checkLocalPaths: false,
          checkInvalidEsmShPath: true,
        },
      );

      assertEquals(realImportIsInvalid, false);
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });
});
