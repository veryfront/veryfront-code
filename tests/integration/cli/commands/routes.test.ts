import { assertStringIncludes } from "std/assert/assert_string_includes.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { routesCommand } from "../../../../src/cli/commands/routes.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";

describe(
  "CLI routes command",
  
  () => {
    it("prints pages and api routes", async () => {
      await withTestContext("routes-print", async (context: TestContext) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        await Deno.mkdir(join(context.projectDir, "pages", "api"), {
          recursive: true,
        });

        await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home\n");
        await Deno.writeTextFile(join(context.projectDir, "pages", "about.mdx"), "# About\n");
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "api", "hello.ts"),
          "export const GET=()=>new Response('ok')\n",
        );

        const output: string[] = [];
        const origLog = console.log;
        try {
          console.log = (msg?: any, ...rest: any[]) => {
            output.push(String(msg), ...rest.map(String));
          };
          await routesCommand(context.projectDir);
        } finally {
          console.log = origLog;
        }

        const text = output.join("\n");
        assertStringIncludes(text, "Pages:");
        assertStringIncludes(text, "/ -> pages/index.mdx");
        assertStringIncludes(text, "/about -> pages/about.mdx");
        assertStringIncludes(text, "API:");
        assertStringIncludes(text, "/api/hello");
      });
    });

    it("outputs JSON when requested", async () => {
      await withTestContext("routes-json", async (context: TestContext) => {
        await Deno.remove(join(context.projectDir, "app"), { recursive: true });

        await Deno.mkdir(join(context.projectDir, "pages", "api"), {
          recursive: true,
        });

        await Deno.writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home\n");
        await Deno.writeTextFile(join(context.projectDir, "pages", "about.mdx"), "# About\n");
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "api", "hello.ts"),
          "export const GET=()=>new Response('ok')\n",
        );

        const output: string[] = [];
        const origLog = console.log;
        try {
          console.log = (msg?: any, ...rest: any[]) => {
            output.push(String(msg), ...rest.map(String));
          };
          await routesCommand(context.projectDir, { json: true });
        } finally {
          console.log = origLog;
        }

        const text = output.join("\n");
        const parsed = JSON.parse(text) as {
          pages: Array<{ pattern: string; file: string }>;
          apis: string[];
        };
        if (!Array.isArray(parsed.pages) || !Array.isArray(parsed.apis)) {
          throw new Error("invalid json");
        }
      });
    });
  },
);
