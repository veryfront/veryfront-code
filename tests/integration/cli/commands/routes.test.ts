import { assertStringIncludes } from "@veryfront/testing/assert";
import { join } from "@veryfront/compat/path";
import { describe, it } from "@veryfront/testing/bdd";
import { mkdir, remove, writeTextFile } from "@veryfront/compat/fs.ts";
import { routesCommand } from "../../../../src/cli/commands/routes.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";

async function setupPagesRouter(context: TestContext): Promise<void> {
  await remove(join(context.projectDir, "app"), { recursive: true });

  await mkdir(join(context.projectDir, "pages", "api"), { recursive: true });

  await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home\n");
  await writeTextFile(join(context.projectDir, "pages", "about.mdx"), "# About\n");
  await writeTextFile(
    join(context.projectDir, "pages", "api", "hello.ts"),
    "export const GET=()=>new Response('ok')\n",
  );
}

async function captureConsoleLog(run: () => Promise<void>): Promise<string> {
  const output: string[] = [];
  const origLog = console.log;

  try {
    console.log = (msg?: any, ...rest: any[]) => {
      output.push(String(msg), ...rest.map(String));
    };
    await run();
  } finally {
    console.log = origLog;
  }

  return output.join("\n");
}

describe("CLI routes command", () => {
  it("prints pages and api routes", async () => {
    await withTestContext("routes-print", async (context: TestContext) => {
      await setupPagesRouter(context);

      const text = await captureConsoleLog(async () => {
        await routesCommand(context.projectDir);
      });

      assertStringIncludes(text, "Pages:");
      assertStringIncludes(text, "/ -> pages/index.mdx");
      assertStringIncludes(text, "/about -> pages/about.mdx");
      assertStringIncludes(text, "API:");
      assertStringIncludes(text, "/api/hello");
    });
  });

  it("outputs JSON when requested", async () => {
    await withTestContext("routes-json", async (context: TestContext) => {
      await setupPagesRouter(context);

      const text = await captureConsoleLog(async () => {
        await routesCommand(context.projectDir, { json: true });
      });

      const parsed = JSON.parse(text) as {
        pages: Array<{ pattern: string; file: string }>;
        apis: string[];
      };

      if (!Array.isArray(parsed.pages) || !Array.isArray(parsed.apis)) {
        throw new Error("invalid json");
      }
    });
  });
});
