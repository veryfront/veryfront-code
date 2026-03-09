import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { VeryfrontRenderer } from "#veryfront/rendering/index.ts";
import type { BuildExecutorOptions, BuildResult } from "./build-executor.ts";

const baseConfig: VeryfrontConfig = {};

function createRenderer(): VeryfrontRenderer {
  return new VeryfrontRenderer({
    projectDir: "/path/to/project",
    mode: "development",
    adapter: createMockAdapter(),
    config: baseConfig,
  });
}

describe("BuildExecutor", () => {
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
    it("should aggregate pages from multiple sources", () => {
      const pages = { pages: 5, totalSize: 50000, ssgPaths: ["/", "/about"] };
      const app = { pages: 3, totalSize: 30000, ssgPaths: ["/api/data"] };
      const combined: BuildResult = {
        pages: pages.pages + app.pages,
        totalSize: pages.totalSize + app.totalSize,
        ssgPaths: [...pages.ssgPaths, ...app.ssgPaths],
      };
      assertEquals(combined.pages, 8);
      assertEquals(combined.totalSize, 80000);
      assertEquals(combined.ssgPaths.length, 3);
    });

    it("should handle zero pages in both sources", () => {
      const combined: BuildResult = {
        pages: 0 + 0,
        totalSize: 0 + 0,
        ssgPaths: [],
      };
      assertEquals(combined.pages, 0);
      assertEquals(combined.totalSize, 0);
      assertEquals(combined.ssgPaths.length, 0);
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
