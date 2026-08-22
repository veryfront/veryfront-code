import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getDevServerCommand } from "./template-runtime-e2e.ts";

describe("template runtime E2E commands", () => {
  it("exports the shared harness without running the E2E flow on import", async () => {
    const controller = new AbortController();
    const timeoutMs = 7_500;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let result: Deno.CommandOutput;

    try {
      result = await new Deno.Command(Deno.execPath(), {
        args: [
          "eval",
          "--config=scripts/test.deno.json",
          "--no-check",
          `
const mod = await import("./scripts/test/template-runtime-e2e.ts");
console.log(JSON.stringify(Object.keys(mod).sort()));
`,
        ],
        signal: controller.signal,
        stdout: "piped",
        stderr: "piped",
      }).output();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `template runtime import subprocess timed out after ${timeoutMs}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    assertEquals(
      new TextDecoder().decode(result.stderr),
      "",
      "Template runtime import subprocess should not write to stderr",
    );
    assertEquals(
      result.code,
      0,
      "Template runtime import subprocess should exit successfully",
    );
    assertEquals(
      JSON.parse(new TextDecoder().decode(result.stdout)),
      [
        "assertCondition",
        "ensureCommand",
        "getDevServerCommand",
        "installDependencies",
        "packNpmPackage",
        "parseCommaSeparatedFlag",
        "runChecked",
        "scaffoldProject",
        "startDevServer",
        "stopDevServer",
        "waitForRoute",
      ],
      "Template runtime module should export only shared harness helpers on import",
    );
  });

  it("passes the selected port through Deno task without a separator", () => {
    assertEquals(
      getDevServerCommand("deno", 4321),
      {
        command: "deno",
        args: ["task", "dev", "--port", "4321"],
      },
      "Deno dev command should pass the selected port directly to the task",
    );
  });

  it("preserves the script argument separator for npm and Bun", () => {
    assertEquals(
      getDevServerCommand("node", 4321),
      {
        command: "npm",
        args: ["run", "dev", "--", "--port", "4321"],
      },
      "Node dev command should preserve npm's script argument separator",
    );
    assertEquals(
      getDevServerCommand("bun", 4321),
      {
        command: "bun",
        args: ["run", "dev", "--", "--port", "4321"],
      },
      "Bun dev command should preserve Bun's script argument separator",
    );
  });
});
