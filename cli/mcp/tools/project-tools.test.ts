import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for MCP project tools
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join } from "veryfront/platform/path";
import {
  vfGetComponentTree,
  vfGetProjectContext,
  vfListLocalProjects,
  vfListRoutes,
} from "./project-tools.ts";

async function createProject(files: Record<string, string>): Promise<string> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-mcp-project-tools-" });

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(projectDir, relativePath);
    await Deno.mkdir(dirname(filePath), { recursive: true });
    await Deno.writeTextFile(filePath, content);
  }

  return projectDir;
}

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

    it("detects AI projects from the standardized AG-UI route", async () => {
      const projectDir = await createProject({
        "package.json": JSON.stringify({ name: "ag-ui-project" }),
        "app/api/ag-ui/route.ts": 'export const POST = () => new Response("ok");\n',
      });

      try {
        const result = await vfGetProjectContext.execute({ projectPath: projectDir });

        assertEquals(result.hasAI, true);
        assertEquals(result.features.includes("ai"), true);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("does not preserve legacy chat route detection", async () => {
      const projectDir = await createProject({
        "package.json": JSON.stringify({ name: "legacy-chat-project" }),
        [join("app", "api", "chat", "route.ts")]: 'export const POST = () => new Response("ok");\n',
      });

      try {
        const result = await vfGetProjectContext.execute({ projectPath: projectDir });

        assertEquals(result.hasAI, false);
        assertEquals(result.features.includes("ai"), false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
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

    it("classifies local projects with AG-UI routes as AI projects", async () => {
      const projectDir = await createProject({
        "package.json": JSON.stringify({ name: "local-ag-ui-project" }),
        "veryfront.config.ts": "export default {};\n",
        "app/api/ag-ui/route.ts": 'export const POST = () => new Response("ok");\n',
      });

      try {
        const result = await vfListLocalProjects.execute({ directory: projectDir });

        assertEquals(result.length, 1);
        assertEquals(result[0]?.hasAI, true);
        assertEquals(result[0]?.template, "ai-agent");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("does not classify local projects with only legacy chat routes as AI projects", async () => {
      const projectDir = await createProject({
        "package.json": JSON.stringify({ name: "local-legacy-chat-project" }),
        "veryfront.config.ts": "export default {};\n",
        [join("app", "api", "chat", "route.ts")]: 'export const POST = () => new Response("ok");\n',
      });

      try {
        const result = await vfListLocalProjects.execute({ directory: projectDir });

        assertEquals(result.length, 1);
        assertEquals(result[0]?.hasAI, false);
        assertEquals(result[0]?.template, "minimal");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
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
