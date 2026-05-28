import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "#veryfront/testing/deno-compat.ts";

import { getTemplate } from "../../../cli/templates/index.ts";
import type { TemplateName } from "../../../cli/templates/types.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { createTestDenoConfig } from "../../_helpers/import-maps.ts";

const STARTER_TEMPLATES: TemplateName[] = [
  "minimal",
  "ai-agent",
  "docs-agent",
  "multi-agent-system",
  "agentic-workflow",
  "coding-agent",
  "saas-starter",
];

async function scaffoldTemplate(projectDir: string, templateName: TemplateName): Promise<void> {
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

describe("starter templates smoke", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  for (const templateName of STARTER_TEMPLATES) {
    it(`renders ${templateName} root route`, async () => {
      await withTestContext(`starter-template-${templateName}`, async (context) => {
        await writeTextFile(join(context.projectDir, "deno.json"), createTestDenoConfig());
        await scaffoldTemplate(context.projectDir, templateName);

        const port = await context.allocatePort();
        const server = await context.startDevServer({ port, enableHMR: false });

        const response = await fetch(`http://127.0.0.1:${server.port}/`);
        assertEquals(
          response.status,
          200,
          `${templateName} should render / successfully`,
        );

        const html = await response.text();
        assertEquals(
          html.includes("Module not found"),
          false,
          `${templateName} should not render a module resolution error`,
        );
        assertEquals(
          html.includes("Internal Server Error"),
          false,
          `${templateName} should not render a server error`,
        );
      });
    });
  }
});
