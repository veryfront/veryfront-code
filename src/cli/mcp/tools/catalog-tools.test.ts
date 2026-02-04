/**
 * Tests for MCP catalog tools
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  vfCreateProject,
  vfListExamples,
  vfListIntegrations,
  vfListTemplates,
  vfListUsecases,
} from "./catalog-tools.ts";

describe("mcp/tools/catalog-tools", () => {
  describe("vfListExamples", () => {
    it("has correct tool name", () => {
      assertEquals(vfListExamples.name, "vf_list_examples");
    });

    it("has description", () => {
      assertExists(vfListExamples.description);
      assertEquals(vfListExamples.description.length > 0, true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfListExamples.execute, "function");
    });

    it("returns examples when executed", async () => {
      const result = await vfListExamples.execute({});
      assertEquals(Array.isArray(result), true);
      for (const example of result) {
        assertExists(example.name);
        assertExists(example.description);
      }
    });

    it("accepts template filter parameter", async () => {
      const result = await vfListExamples.execute({ template: "ai" });
      assertEquals(Array.isArray(result), true);
      if (result.length > 0) {
        assertExists(result[0].name);
        assertExists(result[0].template);
      }
    });

    it("accepts difficulty filter parameter", async () => {
      const result = await vfListExamples.execute({ difficulty: "beginner" });
      assertEquals(Array.isArray(result), true);
      if (result.length > 0) {
        assertExists(result[0].name);
        assertExists(result[0].difficulty);
      }
    });
  });

  describe("vfListTemplates", () => {
    it("has correct tool name", () => {
      assertEquals(vfListTemplates.name, "vf_list_templates");
    });

    it("has execute function", () => {
      assertEquals(typeof vfListTemplates.execute, "function");
    });

    it("returns templates when executed", async () => {
      const result = await vfListTemplates.execute({});
      assertEquals(Array.isArray(result), true);
      for (const template of result) {
        assertExists(template.name);
        assertExists(template.description);
      }
    });
  });

  describe("vfListIntegrations", () => {
    it("has correct tool name", () => {
      assertEquals(vfListIntegrations.name, "vf_list_integrations");
    });

    it("has execute function", () => {
      assertEquals(typeof vfListIntegrations.execute, "function");
    });

    it("returns integrations when executed", async () => {
      const result = await vfListIntegrations.execute({});
      assertEquals(Array.isArray(result), true);
    });

    it("filters by category when provided", async () => {
      const result = await vfListIntegrations.execute({ category: "productivity" });
      assertEquals(Array.isArray(result), true);
    });
  });

  describe("vfListUsecases", () => {
    it("has correct tool name", () => {
      assertEquals(vfListUsecases.name, "vf_list_usecases");
    });

    it("has execute function", () => {
      assertEquals(typeof vfListUsecases.execute, "function");
    });

    it("returns use cases when executed", async () => {
      const result = await vfListUsecases.execute({});
      assertEquals(Array.isArray(result), true);
    });
  });

  describe("vfCreateProject", () => {
    it("has correct tool name", () => {
      assertEquals(vfCreateProject.name, "vf_create_project");
    });

    it("has description", () => {
      assertExists(vfCreateProject.description);
    });

    it("has execute function", () => {
      assertEquals(typeof vfCreateProject.execute, "function");
    });
  });
});
