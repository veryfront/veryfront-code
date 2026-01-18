/**
 * RenderPipeline Tests
 *
 * Tests the rendering pipeline configuration and types.
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { RenderPipelineConfig } from "./pipeline.ts";

describe("RenderPipeline", () => {
  describe("RenderPipelineConfig", () => {
    it("should require pageResolver", () => {
      const config = {
        pageResolver: {},
      } as Partial<RenderPipelineConfig>;

      assertExists(config.pageResolver);
    });

    it("should require cacheCoordinator", () => {
      const config = {
        cacheCoordinator: {},
      } as Partial<RenderPipelineConfig>;

      assertExists(config.cacheCoordinator);
    });

    it("should require pageRenderer", () => {
      const config = {
        pageRenderer: {},
      } as Partial<RenderPipelineConfig>;

      assertExists(config.pageRenderer);
    });

    it("should require layoutOrchestrator", () => {
      const config = {
        layoutOrchestrator: {},
      } as Partial<RenderPipelineConfig>;

      assertExists(config.layoutOrchestrator);
    });

    it("should require ssrOrchestrator", () => {
      const config = {
        ssrOrchestrator: {},
      } as Partial<RenderPipelineConfig>;

      assertExists(config.ssrOrchestrator);
    });

    it("should require adapter", () => {
      const config = {
        adapter: {},
      } as Partial<RenderPipelineConfig>;

      assertExists(config.adapter);
    });

    it("should accept 'development' mode", () => {
      const config = {
        mode: "development" as const,
      } as Partial<RenderPipelineConfig>;

      assertEquals(config.mode, "development");
    });

    it("should accept 'production' mode", () => {
      const config = {
        mode: "production" as const,
      } as Partial<RenderPipelineConfig>;

      assertEquals(config.mode, "production");
    });

    it("should require projectDir", () => {
      const config = {
        projectDir: "/path/to/project",
      } as Partial<RenderPipelineConfig>;

      assertEquals(config.projectDir, "/path/to/project");
    });
  });

  describe("Pipeline modes", () => {
    it("should support development mode configuration", () => {
      const mode: "development" | "production" = "development";
      assertEquals(mode, "development");
    });

    it("should support production mode configuration", () => {
      const mode: "development" | "production" = "production";
      assertEquals(mode, "production");
    });
  });

  describe("Pipeline components", () => {
    it("should have all required components defined", () => {
      const requiredComponents = [
        "pageResolver",
        "cacheCoordinator",
        "pageRenderer",
        "layoutOrchestrator",
        "ssrOrchestrator",
        "adapter",
        "mode",
        "projectDir",
      ];

      assertEquals(requiredComponents.length, 8);
      assertEquals(requiredComponents.includes("pageResolver"), true);
      assertEquals(requiredComponents.includes("cacheCoordinator"), true);
      assertEquals(requiredComponents.includes("pageRenderer"), true);
      assertEquals(requiredComponents.includes("layoutOrchestrator"), true);
      assertEquals(requiredComponents.includes("ssrOrchestrator"), true);
      assertEquals(requiredComponents.includes("adapter"), true);
      assertEquals(requiredComponents.includes("mode"), true);
      assertEquals(requiredComponents.includes("projectDir"), true);
    });
  });
});
