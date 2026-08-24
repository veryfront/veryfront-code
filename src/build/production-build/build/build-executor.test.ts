import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { VeryfrontRenderer } from "#veryfront/rendering/index.ts";
import * as React from "react";
import * as esbuild from "veryfront/extensions/bundler";
import "#veryfront/html/styles-builder/__tests__/css-processor-setup.ts";
import {
  __injectReactDOMServerForTests,
  __setServerModuleLoaderForTests,
  resetReactCache,
} from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import type { BuildExecutorOptions, BuildResult } from "./build-executor.ts";
import { executeBuild } from "./build-executor.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { makeTempDir, remove, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import {
  clearReactVersionCache,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { DEPENDENCY_PINNING_ROLLOUT_PERCENT_ENV } from "#veryfront/transforms/esm/dependency-pinning-cohort.ts";

const baseConfig: VeryfrontConfig = {};

async function updateMtime(path: string, atime: Date, mtime: Date): Promise<void> {
  const deno =
    (globalThis as { Deno?: { utime?: (path: string, atime: Date, mtime: Date) => Promise<void> } })
      .Deno;
  if (deno?.utime) {
    await deno.utime(path, atime, mtime);
    return;
  }
  const fs = await import("node:fs/promises");
  await fs.utimes(path, atime, mtime);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    deleteEnv(name);
  } else {
    setEnv(name, value);
  }
}

function createRenderer(): VeryfrontRenderer {
  return new VeryfrontRenderer({
    projectDir: "/path/to/project",
    mode: "development",
    adapter: createMockAdapter(),
    config: baseConfig,
  });
}

describe("BuildExecutor", () => {
  afterAll(async () => {
    await esbuild.stop();
  });

  describe("BuildExecutorOptions", () => {
    it("should require adapter", () => {
      const options: Partial<BuildExecutorOptions> = { adapter: createMockAdapter() };
      assertExists(options.adapter);
    });

    it("should require projectDir", () => {
      const options: Partial<BuildExecutorOptions> = { projectDir: "/path/to/project" };
      assertEquals(options.projectDir, "/path/to/project");
    });

    it("should require outputDir", () => {
      const options: Partial<BuildExecutorOptions> = { outputDir: "/path/to/output" };
      assertEquals(options.outputDir, "/path/to/output");
    });

    it("should require renderer", () => {
      const options: Partial<BuildExecutorOptions> = { renderer: createRenderer() };
      assertExists(options.renderer);
    });

    it("should require config", () => {
      const options: Partial<BuildExecutorOptions> = { config: baseConfig };
      assertExists(options.config);
    });

    it("should require enablePrefetch boolean", () => {
      const options: Partial<BuildExecutorOptions> = { enablePrefetch: true };
      assertEquals(options.enablePrefetch, true);
    });

    it("should allow null chunkManifest", () => {
      const options: Partial<BuildExecutorOptions> = { chunkManifest: null };
      assertEquals(options.chunkManifest, null);
    });

    it("should require baseUrl", () => {
      const options: Partial<BuildExecutorOptions> = { baseUrl: "http://localhost:3000" };
      assertEquals(options.baseUrl, "http://localhost:3000");
    });

    it("should require dryRun boolean", () => {
      const options: Partial<BuildExecutorOptions> = { dryRun: false };
      assertEquals(options.dryRun, false);
    });
  });

  describe("BuildResult", () => {
    it("should have pages count", () => {
      const result: BuildResult = { pages: 10, totalSize: 0, ssgPaths: [] };
      assertEquals(result.pages, 10);
    });

    it("should have totalSize", () => {
      const result: BuildResult = { pages: 0, totalSize: 1024000, ssgPaths: [] };
      assertEquals(result.totalSize, 1024000);
    });

    it("should have ssgPaths array", () => {
      const result: BuildResult = {
        pages: 0,
        totalSize: 0,
        ssgPaths: ["/", "/about", "/blog"],
      };

      assertEquals(result.ssgPaths, ["/", "/about", "/blog"]);
    });

    it("should allow empty ssgPaths", () => {
      const result: BuildResult = { pages: 0, totalSize: 0, ssgPaths: [] };
      assertEquals(result.ssgPaths.length, 0);
    });

    it("should support typical build result", () => {
      const result: BuildResult = {
        pages: 25,
        totalSize: 2500000,
        ssgPaths: ["/", "/about", "/contact", "/blog", "/blog/post-1", "/blog/post-2"],
      };

      assertEquals(result.pages, 25);
      assertEquals(result.totalSize, 2500000);
      assertEquals(result.ssgPaths.length, 6);
    });
  });

  describe("Build configuration", () => {
    it("should support dryRun mode", () => {
      const options: Partial<BuildExecutorOptions> = { dryRun: true };
      assertEquals(options.dryRun, true);
    });

    it("should support prefetch enabled", () => {
      const options: Partial<BuildExecutorOptions> = { enablePrefetch: true };
      assertEquals(options.enablePrefetch, true);
    });

    it("should support prefetch disabled", () => {
      const options: Partial<BuildExecutorOptions> = { enablePrefetch: false };
      assertEquals(options.enablePrefetch, false);
    });

    it("should support empty baseUrl", () => {
      const options: Partial<BuildExecutorOptions> = { baseUrl: "" };
      assertEquals(options.baseUrl, "");
    });
  });

  describe("BuildResult aggregation", () => {
    it("sums the pages and app route stats it renders", async () => {
      const adapter = createMockAdapter();
      const appDir = "/project/app";
      adapter.fs.files.set(
        `${appDir}/app-only/page.tsx`,
        "export default function Page() { return null; }",
      );
      __setServerModuleLoaderForTests((_url, label) => {
        if (label === "React") return Promise.resolve({ default: React });
        throw new Error(`Unexpected module load: ${label}`);
      });
      __injectReactDOMServerForTests({
        renderToString: () => "<main>app</main>",
        renderToStaticMarkup: () => "<main>app</main>",
      });

      try {
        const renderer = {
          renderPage: () =>
            Promise.resolve({
              html:
                '<html><head><script type="importmap">{"imports":{}}</script></head><body></body></html>',
            }),
        } as unknown as VeryfrontRenderer;

        const result = await executeBuild(
          [{ slug: "index", path: "/", file: "pages/index.tsx" }],
          [{
            path: "/app-only",
            pageFile: `${appDir}/app-only/page.tsx`,
            segments: ["app-only"],
            segmentDirs: [appDir, `${appDir}/app-only`],
          }],
          {
            adapter,
            projectDir: "/project",
            outputDir: "/output",
            renderer,
            config: baseConfig,
            enablePrefetch: false,
            chunkManifest: null,
            baseUrl: "",
            dryRun: false,
          },
        );
        const pageHtml = adapter.fs.files.get("/output/index.html");
        const appHtml = adapter.fs.files.get("/output/app-only/index.html");
        assertExists(pageHtml);
        assertExists(appHtml);
        const expectedTotalSize = new TextEncoder().encode(pageHtml).length +
          new TextEncoder().encode(appHtml).length;

        assertEquals(result.pages, 2, "executeBuild must sum pages and app route stats");
        assertEquals(
          result.ssgPaths,
          ["/", "/app-only"],
          "ssgPaths must concatenate both sources",
        );
        assertEquals(
          result.totalSize,
          expectedTotalSize,
          "totalSize must sum the bytes of both sources",
        );
      } finally {
        resetReactCache();
        __setServerModuleLoaderForTests(null);
      }
    });
  });

  describe("build-wide dependency snapshot", () => {
    it("uses one immutable package snapshot across the route fanout", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-build-snapshot-" });
      const packageJsonPath = `${projectDir}/package.json`;
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const originalRolloutPercent = getHostEnv(DEPENDENCY_PINNING_ROLLOUT_PERCENT_ENV);
      const observed: Array<{
        cacheKey?: string;
        dependencies?: Readonly<Record<string, string>>;
      }> = [];

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        setEnv(DEPENDENCY_PINNING_ROLLOUT_PERCENT_ENV, "100");
        clearReactVersionCache();
        await writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { react: "18.3.1", lodash: "1.0.0" } }),
        );
        const snapshotA = await getDependencyPinningSnapshot(projectDir);
        const renderer = {
          renderPage: async (
            _slug: string,
            options?: {
              dependencyPinningCacheKey?: string;
              dependencyPinningDependencies?: Readonly<Record<string, string>>;
            },
          ) => {
            observed.push({
              cacheKey: options?.dependencyPinningCacheKey,
              dependencies: options?.dependencyPinningDependencies,
            });
            if (observed.length === 1) {
              await writeTextFile(
                packageJsonPath,
                JSON.stringify({
                  dependencies: { react: "19.2.4", lodash: "2.0.0" },
                }),
              );
              const future = new Date(Date.now() + 2_000);
              await updateMtime(packageJsonPath, future, future);
              await getDependencyPinningSnapshot(projectDir);
            }
            return {
              html:
                '<html><head><script type="importmap">{"imports":{}}</script></head><body></body></html>',
            };
          },
        } as unknown as VeryfrontRenderer;

        const result = await executeBuild(
          [
            { slug: "first", path: "/first", file: "pages/first.tsx" },
            { slug: "second", path: "/second", file: "pages/second.tsx" },
          ],
          [],
          {
            adapter: createMockAdapter(),
            projectDir,
            outputDir: "/output",
            renderer,
            config: baseConfig,
            enablePrefetch: false,
            chunkManifest: null,
            baseUrl: "",
            dryRun: true,
            isLocalProject: true,
          },
        );

        assertEquals(result.pages, 2, "executeBuild reports every page it rendered");
        assertEquals(observed.length, 2);
        assertEquals(
          observed.every(
            (value) =>
              value.cacheKey === snapshotA.cacheKey &&
              value.dependencies?.lodash === "1.0.0",
          ),
          true,
        );
        assertEquals(observed[0]?.dependencies, observed[1]?.dependencies);
        assertEquals(Object.isFrozen(observed[0]?.dependencies), true);
      } finally {
        restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
        restoreEnv(DEPENDENCY_PINNING_ROLLOUT_PERCENT_ENV, originalRolloutPercent);
        clearReactVersionCache();
        await remove(projectDir, { recursive: true });
      }
    });

    it("captures direct executor pins from an adapter-backed project source", async () => {
      const projectDir = "/virtual/build-project";
      const packageJsonPath = `${projectDir}/package.json`;
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const originalRolloutPercent = getHostEnv(DEPENDENCY_PINNING_ROLLOUT_PERCENT_ENV);
      const adapter = createMockAdapter();
      const stableMtime = new Date(1_000);
      const stat = adapter.fs.stat.bind(adapter.fs);
      adapter.fs.stat = async (path) => ({
        ...await stat(path),
        mtime: stableMtime,
      });
      let observedCacheKey: string | undefined;
      let observedDependencies: Readonly<Record<string, string>> | undefined;

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        setEnv(DEPENDENCY_PINNING_ROLLOUT_PERCENT_ENV, "100");
        clearReactVersionCache();
        await adapter.fs.writeFile(
          packageJsonPath,
          JSON.stringify({
            dependencies: {
              react: "18.3.1",
              lodash: "1.0.0",
            },
          }),
        );
        const renderer = {
          renderPage: (
            _slug: string,
            options?: {
              dependencyPinningCacheKey?: string;
              dependencyPinningDependencies?: Readonly<Record<string, string>>;
            },
          ) => {
            observedCacheKey = options?.dependencyPinningCacheKey;
            observedDependencies = options?.dependencyPinningDependencies;
            return Promise.resolve({
              html:
                '<html><head><script type="importmap">{"imports":{}}</script></head><body></body></html>',
            });
          },
        } as unknown as VeryfrontRenderer;

        const result = await executeBuild(
          [{ slug: "index", path: "/", file: "pages/index.tsx" }],
          [],
          {
            adapter,
            projectDir,
            outputDir: "/output",
            renderer,
            config: {
              react: { version: "19.2.4" },
            } as VeryfrontConfig,
            enablePrefetch: false,
            chunkManifest: null,
            baseUrl: "",
            dryRun: true,
            isLocalProject: false,
          },
        );

        assertEquals(result.pages, 1, "executeBuild reports every page it rendered");
        assertEquals(observedCacheKey?.startsWith("on:"), true);
        assertEquals(observedDependencies?.react, "19.2.4");
        assertEquals(observedDependencies?.lodash, "1.0.0");
      } finally {
        restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
        restoreEnv(DEPENDENCY_PINNING_ROLLOUT_PERCENT_ENV, originalRolloutPercent);
        clearReactVersionCache();
      }
    });
  });

  describe("BuildExecutorOptions completeness", () => {
    it("should support full options", () => {
      const options: BuildExecutorOptions = {
        adapter: createMockAdapter(),
        projectDir: "/project",
        outputDir: "/output",
        renderer: createRenderer(),
        config: baseConfig,
        enablePrefetch: true,
        chunkManifest: null,
        baseUrl: "https://example.com",
        dryRun: false,
      };

      assertExists(options.adapter);
      assertEquals(options.projectDir, "/project");
      assertEquals(options.outputDir, "/output");
      assertExists(options.renderer);
      assertExists(options.config);
      assertEquals(options.enablePrefetch, true);
      assertEquals(options.chunkManifest, null);
      assertEquals(options.baseUrl, "https://example.com");
      assertEquals(options.dryRun, false);
    });
  });
});
