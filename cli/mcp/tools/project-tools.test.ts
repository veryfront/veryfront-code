/**
 * Tests for MCP project tools
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  vfGetComponentTree,
  vfGetProjectContext,
  vfListLocalProjects,
  vfListRoutes,
} from "./project-tools.ts";

describe("mcp/tools/project-tools", () => {
  describe("vfListRoutes", () => {
    it("has correct tool name", () => {
      assertEquals(vfListRoutes.name, "vf_list_routes");
    });

    it("has description mentioning routes", () => {
      assertExists(vfListRoutes.description);
      assertEquals(vfListRoutes.description.toLowerCase().includes("route"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfListRoutes.execute, "function");
    });

    it("returns array of routes when executed", async () => {
      const result = await vfListRoutes.execute({});
      assertEquals(Array.isArray(result), true);
    });

    it("accepts type filter parameter", async () => {
      const pagesResult = await vfListRoutes.execute({ type: "pages" });
      assertEquals(Array.isArray(pagesResult), true);

      const apiResult = await vfListRoutes.execute({ type: "api" });
      assertEquals(Array.isArray(apiResult), true);
    });
  });

  describe("vfGetProjectContext", () => {
    it("has correct tool name", () => {
      assertEquals(vfGetProjectContext.name, "vf_get_project_context");
    });

    it("has description", () => {
      assertExists(vfGetProjectContext.description);
    });

    it("has execute function", () => {
      assertEquals(typeof vfGetProjectContext.execute, "function");
    });

    it("returns project context object when executed", async () => {
      const result = await vfGetProjectContext.execute({});
      assertExists(result);
      assertEquals(typeof result, "object");
    });
  });

  describe("vfListLocalProjects", () => {
    it("has correct tool name", () => {
      assertEquals(vfListLocalProjects.name, "vf_list_local_projects");
    });

    it("has description mentioning projects", () => {
      assertExists(vfListLocalProjects.description);
      assertEquals(vfListLocalProjects.description.toLowerCase().includes("project"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfListLocalProjects.execute, "function");
    });

    it("returns array of projects when executed", async () => {
      const result = await vfListLocalProjects.execute({});
      assertEquals(Array.isArray(result), true);
    });
  });

  describe("vfGetComponentTree", () => {
    it("has correct tool name", () => {
      assertEquals(vfGetComponentTree.name, "vf_get_component_tree");
    });

    it("has description mentioning components", () => {
      assertExists(vfGetComponentTree.description);
      assertEquals(vfGetComponentTree.description.toLowerCase().includes("component"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfGetComponentTree.execute, "function");
    });

    it("requires route parameter", async () => {
      const result = await vfGetComponentTree.execute({ route: "/" });
      assertExists(result);
    });
  });
});
