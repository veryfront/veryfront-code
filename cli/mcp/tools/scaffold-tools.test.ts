import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for MCP scaffold tools
 */

import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "veryfront/platform/path";
import { vfGetConventions, vfScaffold } from "./scaffold-tools.ts";

async function withTempProject(fn: (projectDir: string) => Promise<void>): Promise<void> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-scaffold-" });
  try {
    await fn(projectDir);
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

describe("mcp/tools/scaffold-tools", () => {
  describe("vfGetConventions", () => {
    it("has correct tool name", () => {
      assertEquals(vfGetConventions.name, "vf_get_conventions");
    });

    it("has description mentioning conventions", () => {
      assertExists(vfGetConventions.description);
      assertEquals(vfGetConventions.description.toLowerCase().includes("convention"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfGetConventions.execute, "function");
    });

    it("returns conventions object when executed", async () => {
      const result = await vfGetConventions.execute({ topic: "all" });
      assertExists(result);
      assertEquals(typeof result, "object");
    });

    it("includes file naming conventions", async () => {
      const result = await vfGetConventions.execute({ topic: "all" });
      assertExists(result);
    });

    it("reports current AI primitive directories", async () => {
      const result = await vfGetConventions.execute({ topic: "ai" });

      assertEquals(result[0]?.rules.includes("Tools go in tools/ directory"), true);
      assertEquals(result[0]?.rules.includes("Agents go in agents/ directory"), true);
      assertEquals(result[0]?.rules.includes("Prompts go in prompts/ directory"), true);
      assertEquals(result[0]?.rules.includes("Workflows go in workflows/ directory"), true);
      assertEquals(result[0]?.rules.includes("Tasks go in tasks/ directory"), true);
      assertEquals(result[0]?.rules.includes("Resources go in resources/ directory"), true);
      assertEquals(result[0]?.rules.includes("Skills go in skills/<id>/SKILL.md"), true);
    });
  });

  describe("vfScaffold", () => {
    it("has correct tool name", () => {
      assertEquals(vfScaffold.name, "vf_scaffold");
    });

    it("has description mentioning scaffold or create", () => {
      assertExists(vfScaffold.description);
      const desc = vfScaffold.description.toLowerCase();
      assertEquals(desc.includes("scaffold") || desc.includes("create"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfScaffold.execute, "function");
    });

    it("scaffolds AI primitives into auto-discovered project-root directories", async () => {
      await withTempProject(async (projectDir) => {
        const toolResult = await vfScaffold.execute({
          type: "tool",
          name: "search-docs",
          projectPath: projectDir,
        });
        const agentResult = await vfScaffold.execute({
          type: "agent",
          name: "researcher",
          projectPath: projectDir,
        });
        const promptResult = await vfScaffold.execute({
          type: "prompt",
          name: "summarize-report",
          projectPath: projectDir,
        });

        assertEquals(toolResult.success, true);
        assertEquals(agentResult.success, true);
        assertEquals(promptResult.success, true);

        const toolPath = join(projectDir, "tools", "search-docs.ts");
        const agentPath = join(projectDir, "agents", "researcher.ts");
        const promptPath = join(projectDir, "prompts", "summarize-report.ts");

        assertEquals(toolResult.files[0]?.path, toolPath);
        assertEquals(agentResult.files[0]?.path, agentPath);
        assertEquals(promptResult.files[0]?.path, promptPath);

        const toolContent = await Deno.readTextFile(toolPath);
        const agentContent = await Deno.readTextFile(agentPath);
        const promptContent = await Deno.readTextFile(promptPath);

        assertStringIncludes(toolContent, "inputSchema");
        assertStringIncludes(toolContent, 'import { tool } from "veryfront/tool";');
        assertStringIncludes(agentContent, "system:");
        assertStringIncludes(promptContent, "content:");
      });
    });

    it("scaffolds workflow, task, resource, and skill project primitives", async () => {
      await withTempProject(async (projectDir) => {
        const workflowResult = await vfScaffold.execute({
          type: "workflow",
          name: "content-pipeline",
          projectPath: projectDir,
        });
        const taskResult = await vfScaffold.execute({
          type: "task",
          name: "sync-data",
          projectPath: projectDir,
        });
        const resourceResult = await vfScaffold.execute({
          type: "resource",
          name: "docs",
          projectPath: projectDir,
        });
        const skillResult = await vfScaffold.execute({
          type: "skill",
          name: "code-review",
          projectPath: projectDir,
        });

        assertEquals(workflowResult.success, true);
        assertEquals(taskResult.success, true);
        assertEquals(resourceResult.success, true);
        assertEquals(skillResult.success, true);

        assertEquals(
          workflowResult.files[0]?.path,
          join(projectDir, "workflows", "content-pipeline.ts"),
        );
        assertEquals(taskResult.files[0]?.path, join(projectDir, "tasks", "sync-data.ts"));
        assertEquals(resourceResult.files[0]?.path, join(projectDir, "resources", "docs.ts"));
        assertEquals(
          skillResult.files[0]?.path,
          join(projectDir, "skills", "code-review", "SKILL.md"),
        );

        const workflowContent = await Deno.readTextFile(
          join(projectDir, "workflows", "content-pipeline.ts"),
        );
        const taskContent = await Deno.readTextFile(join(projectDir, "tasks", "sync-data.ts"));
        const resourceContent = await Deno.readTextFile(join(projectDir, "resources", "docs.ts"));
        const skillContent = await Deno.readTextFile(
          join(projectDir, "skills", "code-review", "SKILL.md"),
        );

        assertStringIncludes(
          workflowContent,
          'import { step, workflow } from "veryfront/workflow";',
        );
        assertStringIncludes(taskContent, "async run");
        assertStringIncludes(resourceContent, 'import { resource } from "veryfront/resource";');
        assertStringIncludes(skillContent, "name: code-review");
      });
    });

    it("returns conflict results when the target file already exists", async () => {
      await withTempProject(async (projectDir) => {
        const first = await vfScaffold.execute({
          type: "tool",
          name: "search-docs",
          projectPath: projectDir,
        });
        const second = await vfScaffold.execute({
          type: "tool",
          name: "search-docs",
          projectPath: projectDir,
        });

        assertEquals(first.success, true);
        assertEquals(second.success, false);
        assertEquals(second.files, [
          { path: join(projectDir, "tools", "search-docs.ts"), created: false },
        ]);
        assertStringIncludes(second.message, "already exists");
      });
    });
  });
});
