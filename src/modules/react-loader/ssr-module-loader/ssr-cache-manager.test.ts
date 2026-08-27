import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join, toFileUrl } from "#veryfront/compat/path/index.ts";
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
import { getMdxEsmCacheDir, runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { buildTmpDirPath } from "./tmp-paths.ts";
import { FileSnapshotChangedError } from "#veryfront/platform/adapters/file-snapshot-error.ts";
import { symlink } from "#veryfront/platform/compat/fs.ts";
import { ensureCachedVeryfrontEsmPackageScope } from "./esm-package-scope.ts";
import { ESM_CACHE_INIT_FAILED, VeryfrontError } from "#veryfront/errors";

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

describe("SSRCacheManager", () => {
  it("declares all generated JavaScript as ESM before returning temp paths", async () => {
    const cacheDir = await makeTempDir({ prefix: "vf-ssr-package-scope-" });
    const projectDir = await makeTempDir({ prefix: "vf-ssr-project-" });
    const projectId = `project-${crypto.randomUUID()}`;
    const contentSourceId = `preview-${crypto.randomUUID()}`;

    try {
      await runWithCacheDir(cacheDir, async () => {
        const managers = [
          new SSRCacheManager({
            projectDir,
            projectId,
            contentSourceId,
            adapter: denoAdapter,
            dev: true,
          }),
          new SSRCacheManager({
            projectDir,
            projectId,
            contentSourceId,
            adapter: denoAdapter,
            dev: true,
          }),
        ];
        const projectPath = join(projectDir, "app", "page.tsx");
        const frameworkPath = join(
          projectDir,
          "node_modules",
          "veryfront",
          "esm",
          "src",
          "react",
          "router",
          "index.js",
        );

        const [firstPath, secondPath] = await Promise.all(
          managers.map((manager) => manager.getTempPath(frameworkPath)),
        );
        assertEquals(firstPath, secondPath);
        const projectTempPath = await managers[0]!.getTempPath(projectPath);
        assertEquals(projectTempPath.endsWith(".mjs"), true);

        const tmpDir = buildTmpDirPath(
          getMdxEsmCacheDir(),
          projectId,
          contentSourceId,
        );
        assertEquals(
          await managers[0]!.getFs().exists(join(tmpDir, "package.json")),
          false,
          "the cache root must stay available for mirrored project package.json imports",
        );
        assertEquals(
          JSON.parse(
            await readTextFile(join(tmpDir, "node_modules", "veryfront", "esm", "package.json")),
          ),
          {
            private: true,
            type: "module",
          },
        );
      });
    } finally {
      await remove(cacheDir, { recursive: true });
      await remove(projectDir, { recursive: true });
    }
  });

  it("retries a transient package-scope snapshot race", async () => {
    const tmpDir = await makeTempDir({ prefix: "vf-ssr-package-scope-race-" });

    try {
      const manager = new SSRCacheManager({
        projectDir: tmpDir,
        projectId: `project-${crypto.randomUUID()}`,
        contentSourceId: `preview-${crypto.randomUUID()}`,
        adapter: denoAdapter,
        dev: true,
      });
      const fs = manager.getFs();
      const scopeDir = join(tmpDir, "node_modules", "veryfront", "esm");
      await mkdir(scopeDir, { recursive: true });
      await writeTextFile(
        join(scopeDir, "package.json"),
        `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
      );
      const readSnapshot = fs.readFileSnapshotWithinLimit?.bind(fs);
      if (!readSnapshot) throw new Error("Snapshot reads must be available in this test");
      let attempts = 0;
      const flakyFs = Object.create(fs) as typeof fs;
      Object.defineProperty(flakyFs, "readFileSnapshotWithinLimit", {
        value: (path: string, root: string, limit: number) => {
          attempts++;
          if (attempts <= 6) {
            throw new FileSnapshotChangedError("Concurrent writer still owns the manifest");
          }
          return readSnapshot(path, root, limit);
        },
      });

      await ensureCachedVeryfrontEsmPackageScope(flakyFs, tmpDir);
      assertEquals(attempts, 7);
    } finally {
      await remove(tmpDir, { recursive: true });
    }
  });

  it("retries a stable partial package-scope manifest from a concurrent creator", async () => {
    const tmpDir = await makeTempDir({ prefix: "vf-ssr-package-scope-partial-" });

    try {
      const manager = new SSRCacheManager({
        projectDir: tmpDir,
        projectId: `project-${crypto.randomUUID()}`,
        contentSourceId: `preview-${crypto.randomUUID()}`,
        adapter: denoAdapter,
        dev: true,
      });
      const fs = manager.getFs();
      const scopeDir = join(tmpDir, "node_modules", "veryfront", "esm");
      const frameworkManifestPath = join(scopeDir, "package.json");
      const manifest = `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`;
      await mkdir(scopeDir, { recursive: true });
      await writeTextFile(frameworkManifestPath, manifest);

      const readSnapshot = fs.readFileSnapshotWithinLimit?.bind(fs);
      const lstat = fs.lstat?.bind(fs);
      if (!readSnapshot || !lstat) throw new Error("Snapshot reads must be available in this test");
      let partialReads = 0;
      const partialFs = Object.create(fs) as typeof fs;
      Object.defineProperty(partialFs, "lstat", {
        value: async (path: string) => {
          const stat = await lstat(path);
          return path === frameworkManifestPath && partialReads < 2
            ? { ...stat, size: partialReads }
            : stat;
        },
      });
      Object.defineProperty(partialFs, "readFileSnapshotWithinLimit", {
        value: (path: string, root: string, limit: number) => {
          if (path === frameworkManifestPath && partialReads < 2) {
            partialReads++;
            return Promise.resolve(new TextEncoder().encode(manifest.slice(0, partialReads)));
          }
          return readSnapshot(path, root, limit);
        },
      });

      await ensureCachedVeryfrontEsmPackageScope(partialFs, tmpDir);
      assertEquals(partialReads, 2);
    } finally {
      await remove(tmpDir, { recursive: true });
    }
  });

  it("does not call mutable method bind while checking the package scope", async () => {
    const tmpDir = await makeTempDir({ prefix: "vf-ssr-package-scope-no-bind-" });

    try {
      const manager = new SSRCacheManager({
        projectDir: tmpDir,
        projectId: `project-${crypto.randomUUID()}`,
        contentSourceId: `preview-${crypto.randomUUID()}`,
        adapter: denoAdapter,
        dev: true,
      });
      const fs = manager.getFs();
      const lstat = fs.lstat;
      if (!lstat) throw new Error("lstat must be available in this test");
      Object.defineProperty(lstat, "bind", {
        configurable: true,
        value: () => {
          throw new Error("method bind must not be used during package-scope checks");
        },
      });

      await ensureCachedVeryfrontEsmPackageScope(fs, tmpDir);
    } finally {
      await remove(tmpDir, { recursive: true });
    }
  });

  it("falls back to an exact bounded read when snapshot reads are unavailable", async () => {
    const tmpDir = await makeTempDir({ prefix: "vf-ssr-package-scope-fallback-" });

    try {
      const manager = new SSRCacheManager({
        projectDir: tmpDir,
        projectId: `project-${crypto.randomUUID()}`,
        contentSourceId: `preview-${crypto.randomUUID()}`,
        adapter: denoAdapter,
        dev: true,
      });
      const fs = manager.getFs();
      const scopeDir = join(tmpDir, "node_modules", "veryfront", "esm");
      await mkdir(scopeDir, { recursive: true });
      const manifest = `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`;
      await writeTextFile(join(scopeDir, "package.json"), manifest);
      if (!fs.readFileBytesWithinLimit) {
        throw new Error("Exact bounded reads must be available in this test");
      }

      let snapshotAttempts = 0;
      const fallbackFs = Object.create(fs) as typeof fs;
      Object.defineProperty(fallbackFs, "readFileSnapshotWithinLimit", {
        value: () => {
          snapshotAttempts++;
          throw new DOMException("snapshot reads unavailable", "NotSupportedError");
        },
      });

      await ensureCachedVeryfrontEsmPackageScope(fallbackFs, tmpDir);
      assertEquals(snapshotAttempts, 1);
    } finally {
      await remove(tmpDir, { recursive: true });
    }
  });

  it("classifies package-scope filesystem failures with the stable cache slug", async () => {
    const tmpDir = await makeTempDir({ prefix: "vf-ssr-package-scope-failure-" });
    const cause = new Error("cache is read-only");

    try {
      const manager = new SSRCacheManager({
        projectDir: tmpDir,
        projectId: `project-${crypto.randomUUID()}`,
        contentSourceId: `preview-${crypto.randomUUID()}`,
        adapter: denoAdapter,
        dev: true,
      });
      const failingFs = Object.create(manager.getFs()) as ReturnType<typeof manager.getFs>;
      Object.defineProperty(failingFs, "createFileBytesExclusive", {
        value: () => Promise.reject(cause),
      });

      const error = await assertRejects(
        () => ensureCachedVeryfrontEsmPackageScope(failingFs, tmpDir),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, ESM_CACHE_INIT_FAILED.slug);
      assertEquals(error.cause, cause);
    } finally {
      await remove(tmpDir, { recursive: true });
    }
  });

  it("does not overwrite a conflicting cached framework package scope", async () => {
    const cacheDir = await makeTempDir({ prefix: "vf-ssr-package-scope-" });
    const projectDir = await makeTempDir({ prefix: "vf-ssr-project-" });
    const projectId = `project-${crypto.randomUUID()}`;
    const contentSourceId = `preview-${crypto.randomUUID()}`;
    const conflictingManifest = '{"private":true,"type":"module","name":"injected"}\n';

    try {
      await runWithCacheDir(cacheDir, async () => {
        const tmpDir = buildTmpDirPath(
          getMdxEsmCacheDir(),
          projectId,
          contentSourceId,
        );
        const scopeDir = join(tmpDir, "node_modules", "veryfront", "esm");
        const manifestPath = join(scopeDir, "package.json");
        await mkdir(scopeDir, { recursive: true });
        await writeTextFile(manifestPath, conflictingManifest);

        const manager = new SSRCacheManager({
          projectDir,
          projectId,
          contentSourceId,
          adapter: denoAdapter,
          dev: true,
        });

        const error = await assertRejects(
          () => manager.getTempPath(join(projectDir, "app", "page.tsx")),
          Error,
          "generated ESM cache",
        );
        assertInstanceOf(error, VeryfrontError);
        assertEquals(error.slug, "esm-cache-init-failed");
        assertEquals(await readTextFile(manifestPath), conflictingManifest);
      });
    } finally {
      await remove(cacheDir, { recursive: true });
      await remove(projectDir, { recursive: true });
    }
  });

  it("revalidates the framework package scope on process-local cache hits", async () => {
    const cacheDir = await makeTempDir({ prefix: "vf-ssr-package-scope-" });
    const projectDir = await makeTempDir({ prefix: "vf-ssr-project-" });
    const projectId = `project-${crypto.randomUUID()}`;
    const contentSourceId = `preview-${crypto.randomUUID()}`;

    try {
      await runWithCacheDir(cacheDir, async () => {
        const manager = new SSRCacheManager({
          projectDir,
          projectId,
          contentSourceId,
          adapter: denoAdapter,
          dev: true,
        });
        const sourcePath = join(projectDir, "app", "page.tsx");
        await manager.getTempPath(sourcePath);

        const tmpDir = buildTmpDirPath(
          getMdxEsmCacheDir(),
          projectId,
          contentSourceId,
        );
        const manifestPath = join(
          tmpDir,
          "node_modules",
          "veryfront",
          "esm",
          "package.json",
        );
        await writeTextFile(manifestPath, '{"type":"commonjs"}\n');

        await assertRejects(
          () => manager.getTempPath(sourcePath),
          Error,
          "generated ESM cache",
        );
      });
    } finally {
      await remove(cacheDir, { recursive: true });
      await remove(projectDir, { recursive: true });
    }
  });

  it("rejects pre-existing symlinked framework package scope parents", async () => {
    const cacheDir = await makeTempDir({ prefix: "vf-ssr-package-scope-" });
    const projectDir = await makeTempDir({ prefix: "vf-ssr-project-" });

    try {
      await runWithCacheDir(cacheDir, async () => {
        for (const linkedSegment of ["node_modules", "veryfront", "esm"]) {
          const projectId = `project-${crypto.randomUUID()}`;
          const contentSourceId = `preview-${crypto.randomUUID()}`;
          const tmpDir = buildTmpDirPath(
            getMdxEsmCacheDir(),
            projectId,
            contentSourceId,
          );
          const nodeModulesDir = join(tmpDir, "node_modules");
          const veryfrontDir = join(nodeModulesDir, "veryfront");
          const esmDir = join(veryfrontDir, "esm");
          const linkedPath = linkedSegment === "node_modules"
            ? nodeModulesDir
            : linkedSegment === "veryfront"
            ? veryfrontDir
            : esmDir;
          const linkedParent = linkedSegment === "node_modules"
            ? tmpDir
            : linkedSegment === "veryfront"
            ? nodeModulesDir
            : veryfrontDir;
          const outsideDir = await makeTempDir({ prefix: "vf-ssr-symlink-target-" });

          try {
            await mkdir(linkedParent, { recursive: true });
            await symlink(outsideDir, linkedPath);

            const manager = new SSRCacheManager({
              projectDir,
              projectId,
              contentSourceId,
              adapter: denoAdapter,
              dev: true,
            });
            await assertRejects(
              () => manager.getTempPath(join(projectDir, "app", "page.tsx")),
              Error,
              "generated ESM cache",
              `A symlinked ${linkedSegment} cache directory must fail closed`,
            );
            assertEquals(
              await manager.getFs().exists(join(outsideDir, "package.json")),
              false,
            );
          } finally {
            await remove(linkedPath, { recursive: true }).catch(() => {});
            await remove(outsideDir, { recursive: true });
          }
        }
      });
    } finally {
      await remove(cacheDir, { recursive: true });
      await remove(projectDir, { recursive: true });
    }
  });

  it("rejects pre-existing symlinked ancestors below the cache boundary", async () => {
    const cacheDir = await makeTempDir({ prefix: "vf-ssr-package-scope-" });
    const projectDir = await makeTempDir({ prefix: "vf-ssr-project-" });

    try {
      await runWithCacheDir(cacheDir, async () => {
        for (const linkedSegment of ["runtime-version", "project-hash"]) {
          const projectId = `project-${crypto.randomUUID()}`;
          const contentSourceId = `preview-${crypto.randomUUID()}`;
          const tmpDir = buildTmpDirPath(
            getMdxEsmCacheDir(),
            projectId,
            contentSourceId,
          );
          const projectHashDir = dirname(tmpDir);
          const runtimeVersionDir = dirname(projectHashDir);
          const linkedPath = linkedSegment === "runtime-version"
            ? runtimeVersionDir
            : projectHashDir;
          const linkedParent = dirname(linkedPath);
          const outsideDir = await makeTempDir({ prefix: "vf-ssr-symlink-target-" });

          try {
            await mkdir(linkedParent, { recursive: true });
            await symlink(outsideDir, linkedPath);

            const manager = new SSRCacheManager({
              projectDir,
              projectId,
              contentSourceId,
              adapter: denoAdapter,
              dev: true,
            });
            await assertRejects(
              () => manager.getTempPath(join(projectDir, "app", "page.tsx")),
              Error,
              "generated ESM cache",
              `A symlinked ${linkedSegment} cache directory must fail closed`,
            );
            assertEquals(
              await manager.getFs().exists(
                join(outsideDir, "node_modules", "veryfront", "esm", "package.json"),
              ),
              false,
            );
          } finally {
            await remove(linkedPath, { recursive: true }).catch(() => {});
            await remove(outsideDir, { recursive: true });
          }
        }
      });
    } finally {
      await remove(cacheDir, { recursive: true });
      await remove(projectDir, { recursive: true });
    }
  });

  it("separates hosted preview and production transform cache identities", () => {
    const baseOptions = {
      projectDir: "/project",
      projectId: "project-a",
      contentSourceId: "shared-content-source",
      adapter: denoAdapter,
      dev: false,
      reactVersion: "19.1.1",
    };
    const preview = new SSRCacheManager({ ...baseOptions, mode: "preview" });
    const production = new SSRCacheManager({ ...baseOptions, mode: "production" });

    assertNotEquals(preview.getConfigHash(), production.getConfigHash());
    assertNotEquals(
      preview.getCacheKey("/project/pages/index.tsx"),
      production.getCacheKey("/project/pages/index.tsx"),
    );
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

  it("separates SSR module cache identity by server external packages", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-ssr-cache-manager-" });
    const baseOptions = {
      projectDir,
      projectId: "project-a",
      contentSourceId: "preview-main",
      adapter: denoAdapter,
      dev: true,
    };

    try {
      const noExternals = new SSRCacheManager(baseOptions);
      const externalReact = new SSRCacheManager({
        ...baseOptions,
        serverExternalPackages: ["react"],
      });
      const externalReactDom = new SSRCacheManager({
        ...baseOptions,
        serverExternalPackages: ["react", "react-dom"],
      });
      const reorderedExternals = new SSRCacheManager({
        ...baseOptions,
        serverExternalPackages: ["react-dom", "react"],
      });

      assertNotEquals(noExternals.getConfigHash(), externalReact.getConfigHash());
      assertNotEquals(externalReact.getConfigHash(), externalReactDom.getConfigHash());
      assertEquals(externalReactDom.getConfigHash(), reorderedExternals.getConfigHash());
      assertNotEquals(
        externalReact.getCacheKey("/project/pages/index.tsx"),
        externalReactDom.getCacheKey("/project/pages/index.tsx"),
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
    const childPath = join(vfmodDir, "vfmod-child.mjs");
    const stablePath = join(projectDir, "stable.mjs");

    try {
      __injectCachesForTests({ cacheBackend: distributedCache });
      await writeTextFile(stablePath, `export default "stable";`);

      await distributedCache.set(
        buildMdxEsmModuleRecoveryCacheKey(projectId, contentSourceId, "vfmod-child.mjs"),
        tokenizeAllVeryFrontPaths(`export default "recovered";`),
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

  it("rejects redis cache entries holding esm.sh/_vf_modules URLs", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-ssr-cache-manager-" });
    const cacheManager = new SSRCacheManager({
      projectDir,
      projectId: `project-${crypto.randomUUID()}`,
      contentSourceId: `preview-${crypto.randomUUID()}`,
      adapter: denoAdapter,
      dev: true,
    });
    const poisonedCode = [
      `import x from "https://esm.sh/_vf_modules/react@18.3.1/index.js";`,
      `export default x;`,
    ].join("\n");

    try {
      assertEquals(
        await cacheManager.validateCachedCode(
          poisonedCode,
          join(projectDir, "pages", "index.tsx"),
          "redis-cache",
          {
            checkLocalPaths: false,
            checkInvalidEsmShPath: true,
          },
        ),
        false,
        "redis entries holding esm.sh/_vf_modules URLs must be re-transformed",
      );

      assertEquals(
        await cacheManager.validateCachedCode(
          poisonedCode,
          join(projectDir, "pages", "index.tsx"),
          "redis-cache",
          {
            checkLocalPaths: false,
            checkInvalidEsmShPath: false,
          },
        ),
        true,
        "the esm.sh/_vf_modules check must be gated by checkInvalidEsmShPath",
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("classifies content sources as production or preview", () => {
    const cases: Array<{ contentSourceId?: string; dev: boolean; expected: boolean }> = [
      { contentSourceId: "preview-main", dev: false, expected: false },
      { contentSourceId: "preview", dev: false, expected: false },
      { contentSourceId: "preview-draft", dev: false, expected: false },
      { contentSourceId: "preview-main", dev: true, expected: false },
      { contentSourceId: "release-1", dev: true, expected: true },
      { contentSourceId: "production", dev: true, expected: true },
      { contentSourceId: "production-eu", dev: true, expected: true },
      { contentSourceId: "prod-eu", dev: true, expected: true },
      { contentSourceId: "local-main", dev: true, expected: false },
      { contentSourceId: "local-main", dev: false, expected: true },
      { contentSourceId: undefined, dev: true, expected: false },
      { contentSourceId: undefined, dev: false, expected: true },
    ];

    for (const { contentSourceId, dev, expected } of cases) {
      const cacheManager = new SSRCacheManager({
        projectDir: "/project",
        projectId: "project-a",
        contentSourceId,
        adapter: denoAdapter,
        dev,
      });

      assertEquals(
        cacheManager.isProductionContentSource(),
        expected,
        `contentSourceId ${contentSourceId ?? "(none)"} with dev=${dev} must classify as ${
          expected ? "production" : "non-production"
        }`,
      );
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
