import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#std/path.ts";
import { planScaffold, scaffoldProjectFile } from "./engine.ts";

async function withTempProject(fn: (projectDir: string) => Promise<void>): Promise<void> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-scaffold-engine-" });
  try {
    await fn(projectDir);
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

describe("scaffold engine", () => {
  it("plans app-router route files", () => {
    const projectDir = "/project";

    assertEquals(
      planScaffold({ projectDir, type: "page", name: "docs/intro" }).files[0]?.path,
      "/project/app/docs/intro/page.tsx",
    );
    assertEquals(
      planScaffold({ projectDir, type: "api", name: "users/[id]" }).files[0]?.path,
      "/project/app/users/[id]/route.ts",
    );
    assertEquals(
      planScaffold({ projectDir, type: "layout", name: "admin" }).files[0]?.path,
      "/project/app/admin/layout.tsx",
    );
  });

  it("plans pages-router route files", () => {
    const projectDir = "/project";
    const router = "pages-router";

    assertEquals(
      planScaffold({ projectDir, router, type: "page", name: "docs/intro" }).files[0]?.path,
      "/project/pages/docs/intro.mdx",
    );
    assertEquals(
      planScaffold({ projectDir, router, type: "api", name: "users/[id]" }).files[0]?.path,
      "/project/pages/api/users/[id].ts",
    );
    assertEquals(
      planScaffold({ projectDir, router, type: "layout", name: "main" }).files[0]?.path,
      "/project/layouts/Main.mdx",
    );
  });

  it("plans component and AI primitive files", () => {
    const projectDir = "/project";

    assertEquals(
      planScaffold({ projectDir, type: "component", name: "user-card" }).files[0]?.path,
      "/project/components/UserCard.tsx",
    );
    assertEquals(
      planScaffold({ projectDir, type: "tool", name: "search-docs" }).files[0]?.path,
      "/project/tools/search-docs.ts",
    );
    assertEquals(
      planScaffold({ projectDir, type: "agent", name: "researcher" }).files[0]?.path,
      "/project/agents/researcher.ts",
    );
    assertEquals(
      planScaffold({ projectDir, type: "prompt", name: "summarize-report" }).files[0]?.path,
      "/project/prompts/summarize-report.ts",
    );
    assertEquals(
      planScaffold({ projectDir, type: "workflow", name: "content-pipeline" }).files[0]?.path,
      "/project/workflows/content-pipeline.ts",
    );
    assertEquals(
      planScaffold({ projectDir, type: "task", name: "sync-data" }).files[0]?.path,
      "/project/tasks/sync-data.ts",
    );
    assertEquals(
      planScaffold({ projectDir, type: "resource", name: "docs" }).files[0]?.path,
      "/project/resources/docs.ts",
    );
    assertEquals(
      planScaffold({ projectDir, type: "skill", name: "code-review" }).files[0]?.path,
      "/project/skills/code-review/SKILL.md",
    );
  });

  it("writes planned files and reports created files", async () => {
    await withTempProject(async (projectDir) => {
      const result = await scaffoldProjectFile({
        projectDir,
        type: "tool",
        name: "search-docs",
      });
      const filePath = join(projectDir, "tools", "search-docs.ts");

      assertEquals(result.success, true);
      assertEquals(result.files, [{ path: filePath, created: true }]);

      const content = await Deno.readTextFile(filePath);
      assertStringIncludes(content, "inputSchema");
      assertStringIncludes(content, 'import { tool } from "veryfront/tool";');
      assertStringIncludes(content, "execute: ({ input }) =>");
      assertEquals(content.includes("execute: async"), false);
    });
  });

  it("uses the slug as the generated agent id", async () => {
    await withTempProject(async (projectDir) => {
      const result = await scaffoldProjectFile({
        projectDir,
        type: "agent",
        name: "research-agent",
      });
      const filePath = join(projectDir, "agents", "research-agent.ts");

      assertEquals(result.success, true);

      const content = await Deno.readTextFile(filePath);
      assertStringIncludes(content, 'id: "research-agent"');
      assertStringIncludes(content, "specialized in research-agent");
    });
  });

  it("reports conflicts before overwriting files", async () => {
    await withTempProject(async (projectDir) => {
      const first = await scaffoldProjectFile({ projectDir, type: "agent", name: "assistant" });
      const second = await scaffoldProjectFile({ projectDir, type: "agent", name: "assistant" });

      assertEquals(first.success, true);
      assertEquals(second.success, false);
      assertEquals(second.files, [{
        path: join(projectDir, "agents", "assistant.ts"),
        created: false,
      }]);
      assertStringIncludes(second.message, "already exists");
    });
  });

  it("writes workflow, task, resource, and skill scaffold content", async () => {
    await withTempProject(async (projectDir) => {
      const workflowResult = await scaffoldProjectFile({
        projectDir,
        type: "workflow",
        name: "content-pipeline",
      });
      const taskResult = await scaffoldProjectFile({
        projectDir,
        type: "task",
        name: "sync-data",
      });
      const resourceResult = await scaffoldProjectFile({
        projectDir,
        type: "resource",
        name: "docs",
      });
      const skillResult = await scaffoldProjectFile({
        projectDir,
        type: "skill",
        name: "code-review",
      });

      assertEquals(workflowResult.success, true);
      assertEquals(taskResult.success, true);
      assertEquals(resourceResult.success, true);
      assertEquals(skillResult.success, true);

      const workflowContent = await Deno.readTextFile(
        join(projectDir, "workflows", "content-pipeline.ts"),
      );
      const taskContent = await Deno.readTextFile(join(projectDir, "tasks", "sync-data.ts"));
      const resourceContent = await Deno.readTextFile(join(projectDir, "resources", "docs.ts"));
      const skillContent = await Deno.readTextFile(
        join(projectDir, "skills", "code-review", "SKILL.md"),
      );

      assertStringIncludes(workflowContent, 'import { step, workflow } from "veryfront/workflow";');
      assertStringIncludes(workflowContent, 'id: "content-pipeline"');
      assertStringIncludes(taskContent, "async run");
      assertStringIncludes(taskContent, "schedulable: false");
      assertStringIncludes(resourceContent, 'import { resource } from "veryfront/resource";');
      assertStringIncludes(resourceContent, "paramsSchema");
      assertStringIncludes(skillContent, "name: code-review");
      assertStringIncludes(skillContent, "# Code Review");
    });
  });
});
