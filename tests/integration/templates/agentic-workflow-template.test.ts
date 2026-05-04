import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "#veryfront/testing/deno-compat.ts";

import { getTemplate } from "../../../cli/templates/index.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { createTestDenoConfig } from "../../_helpers/import-maps.ts";

async function scaffoldTemplate(
  projectDir: string,
  templateName: "agentic-workflow",
): Promise<void> {
  const files = await getTemplate(templateName);
  if (!files) {
    throw new Error(`Template ${templateName} was not found`);
  }

  for (const file of files) {
    const targetPath = join(projectDir, file.path);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeTextFile(targetPath, file.content);
  }
}

describe("agentic-workflow template integration", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  it("renders the dashboard and workflow detail routes without workflow executor import errors", async () => {
    await withTestContext("agentic-workflow-template", async (context) => {
      await writeTextFile(join(context.projectDir, "deno.json"), createTestDenoConfig());
      await scaffoldTemplate(context.projectDir, "agentic-workflow");

      const port = await context.allocatePort();
      const server = await context.startDevServer({ port, enableHMR: false });

      const dashboardResponse = await fetch(`http://127.0.0.1:${server.port}/`);
      assertEquals(dashboardResponse.status, 200);
      const dashboardHtml = await dashboardResponse.text();
      assert(dashboardHtml.includes("Content Pipeline"));
      assert(dashboardHtml.includes("Recent Runs"));
      assert(!dashboardHtml.includes("workflow-executor.ts"));
      assert(!dashboardHtml.includes("Module not found"));

      const detailResponse = await fetch(`http://127.0.0.1:${server.port}/workflows/test-run`);
      assertEquals(detailResponse.status, 200);
      const detailHtml = await detailResponse.text();
      assert(detailHtml.includes("Loading workflow") || detailHtml.includes("Workflow not found"));
      assert(!detailHtml.includes("workflow-executor.ts"));
      assert(!detailHtml.includes("Module not found"));
    });
  });
});
