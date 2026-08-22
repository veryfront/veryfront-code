import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getDevServerCommand } from "./template-runtime-e2e.ts";

describe("template runtime E2E commands", () => {
  it("exports the shared harness without running the E2E flow on import", async () => {
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        "--config=scripts/test.deno.json",
        "--no-check",
        `
const mod = await import("./scripts/test/template-runtime-e2e.ts");
console.log(JSON.stringify(Object.keys(mod).sort()));
`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();

    assertEquals(new TextDecoder().decode(result.stderr), "");
    assertEquals(result.code, 0);
    assertEquals(JSON.parse(new TextDecoder().decode(result.stdout)), [
      "assertCondition",
      "ensureCommand",
      "getDevServerCommand",
      "installDependencies",
      "packNpmPackage",
      "runChecked",
      "scaffoldProject",
      "startDevServer",
      "stopDevServer",
      "waitForRoute",
    ]);
  });

  it("passes the selected port through Deno task without a separator", () => {
    assertEquals(getDevServerCommand("deno", 4321), {
      command: "deno",
      args: ["task", "dev", "--port", "4321"],
    });
  });

  it("preserves the script argument separator for npm and Bun", () => {
    assertEquals(getDevServerCommand("node", 4321), {
      command: "npm",
      args: ["run", "dev", "--", "--port", "4321"],
    });
    assertEquals(getDevServerCommand("bun", 4321), {
      command: "bun",
      args: ["run", "dev", "--", "--port", "4321"],
    });
  });
});
