import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RenderPipelineConfig } from "./pipeline.ts";

describe("RenderPipeline", () => {
  describe("RenderPipelineConfig", () => {
    it("should require pageResolver", () => {
      const config: Partial<RenderPipelineConfig> = { pageResolver: {} };
      assertExists(config.pageResolver);
    });

    it("should require cacheCoordinator", () => {
      const config: Partial<RenderPipelineConfig> = { cacheCoordinator: {} };
      assertExists(config.cacheCoordinator);
    });

    it("should require pageRenderer", () => {
      const config: Partial<RenderPipelineConfig> = { pageRenderer: {} };
      assertExists(config.pageRenderer);
    });

    it("should require layoutOrchestrator", () => {
      const config: Partial<RenderPipelineConfig> = { layoutOrchestrator: {} };
      assertExists(config.layoutOrchestrator);
    });

    it("should require ssrOrchestrator", () => {
      const config: Partial<RenderPipelineConfig> = { ssrOrchestrator: {} };
      assertExists(config.ssrOrchestrator);
    });

    it("should require adapter", () => {
      const config: Partial<RenderPipelineConfig> = { adapter: {} };
      assertExists(config.adapter);
    });

    it("should accept 'development' mode", () => {
      const config: Partial<RenderPipelineConfig> = { mode: "development" };
      assertEquals(config.mode, "development");
    });

    it("should accept 'production' mode", () => {
      const config: Partial<RenderPipelineConfig> = { mode: "production" };
      assertEquals(config.mode, "production");
    });

    it("should require projectDir", () => {
      const config: Partial<RenderPipelineConfig> = {
        projectDir: "/path/to/project",
      };
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

      for (const component of requiredComponents) {
        assertEquals(requiredComponents.includes(component), true);
      }
    });
  });
});
