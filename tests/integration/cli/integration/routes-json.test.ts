import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseCliArgs } from "#cli/shared/args";
import { handleRoutesCommand } from "#cli/commands/routes/handler";
import { setJsonMode } from "#cli/shared/json-output";

async function captureConsole(run: () => Promise<void>): Promise<string> {
  const output: string[] = [];
  const originalLog = console.log;
  try {
    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    };
    await run();
  } finally {
    console.log = originalLog;
  }
  return output.join("\n");
}

async function withRoutesProject(run: (projectDir: string) => Promise<void>): Promise<void> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-routes-handler-" });
  try {
    await Deno.mkdir(`${projectDir}/app/api/health`, { recursive: true });
    await Deno.writeTextFile(
      `${projectDir}/app/page.tsx`,
      "export default function Home(){return <h1>Home</h1>}\n",
    );
    await Deno.writeTextFile(
      `${projectDir}/app/api/health/route.ts`,
      "export const GET=()=>new Response('ok')\n",
    );
    await run(projectDir);
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

describe("routes handler JSON integration", () => {
  it("discovers real app routes, emits JSON, and suppresses the human header", async () => {
    await withRoutesProject(async (projectDir) => {
      let output = "";
      try {
        setJsonMode(true);
        output = await captureConsole(() =>
          handleRoutesCommand(parseCliArgs(["routes", "--project-dir", projectDir, "--json"]))
        );
      } finally {
        setJsonMode(false);
      }

      assertStringIncludes(output, '"success": true');
      assertStringIncludes(output, '"command": "routes"');
      assertStringIncludes(output, '"pattern": "/"');
      assertStringIncludes(output, '"pattern": "/api/health"');
      assertEquals(output.includes("Veryfront"), false);
    });
  });
});
