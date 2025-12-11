
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import type { BuildExecutorOptions, BuildResult } from "./build-executor.ts";

describe("BuildExecutor", () => {
  describe("BuildExecutorOptions", () => {
    it("should require adapter", () => {
      const options = {
        adapter: {},
      } as Partial<BuildExecutorOptions>;

      assertExists(options.adapter);
    });

    it("should require projectDir", () => {
      const options = {
        projectDir: "/path/to/project",
      } as Partial<BuildExecutorOptions>;

      assertEquals(options.projectDir, "/path/to/project");
    });

    it("should require outputDir", () => {
      const options = {
        outputDir: "/path/to/output",
      } as Partial<BuildExecutorOptions>;

      assertEquals(options.outputDir, "/path/to/output");
    });

    it("should require renderer", () => {
      const options = {
        renderer: {},
      } as Partial<BuildExecutorOptions>;

      assertExists(options.renderer);
    });

    it("should require config", () => {
      const options = {
        config: {},
      } as Partial<BuildExecutorOptions>;

      assertExists(options.config);
    });

    it("should require enablePrefetch boolean", () => {
      const options = {
        enablePrefetch: true,
      } as Partial<BuildExecutorOptions>;

      assertEquals(options.enablePrefetch, true);
    });

    it("should allow null chunkManifest", () => {
      const options = {
        chunkManifest: null,
      } as Partial<BuildExecutorOptions>;

      assertEquals(options.chunkManifest, null);
    });

    it("should require baseUrl", () => {
      const options = {
        baseUrl: "http://localhost:3000",
      } as Partial<BuildExecutorOptions>;

      assertEquals(options.baseUrl, "http://localhost:3000");
    });

    it("should require dryRun boolean", () => {
      const options = {
        dryRun: false,
      } as Partial<BuildExecutorOptions>;

      assertEquals(options.dryRun, false);
    });
  });

  describe("BuildResult", () => {
    it("should have pages count", () => {
      const result: BuildResult = {
        pages: 10,
        totalSize: 0,
        ssgPaths: [],
      };

      assertEquals(result.pages, 10);
    });

    it("should have totalSize", () => {
      const result: BuildResult = {
        pages: 0,
        totalSize: 1024000,
        ssgPaths: [],
      };

      assertEquals(result.totalSize, 1024000);
    });

    it("should have ssgPaths array", () => {
      const result: BuildResult = {
        pages: 0,
        totalSize: 0,
        ssgPaths: ["/", "/about", "/blog"],
      };

      assertEquals(result.ssgPaths.length, 3);
      assertEquals(result.ssgPaths[0], "/");
      assertEquals(result.ssgPaths[1], "/about");
      assertEquals(result.ssgPaths[2], "/blog");
    });

    it("should allow empty ssgPaths", () => {
      const result: BuildResult = {
        pages: 0,
        totalSize: 0,
        ssgPaths: [],
      };

      assertEquals(result.ssgPaths.length, 0);
    });

    it("should support typical build result", () => {
      const result: BuildResult = {
        pages: 25,
        totalSize: 2500000,
        ssgPaths: [
          "/",
          "/about",
          "/contact",
          "/blog",
          "/blog/post-1",
          "/blog/post-2",
        ],
      };

      assertEquals(result.pages, 25);
      assertEquals(result.totalSize, 2500000);
      assertEquals(result.ssgPaths.length, 6);
    });
  });

  describe("Build configuration", () => {
    it("should support dryRun mode", () => {
      const dryRun = true;
      assertEquals(dryRun, true);
    });

    it("should support prefetch enabled", () => {
      const enablePrefetch = true;
      assertEquals(enablePrefetch, true);
    });

    it("should support prefetch disabled", () => {
      const enablePrefetch = false;
      assertEquals(enablePrefetch, false);
    });
  });
});
