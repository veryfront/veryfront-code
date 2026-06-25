import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { clearProjectAgentRuntimeRegistries } from "../../../src/agent/project/agent-runtime.ts";
import { formatWorkflowDiscoveryErrors, workflowCommand } from "./command.ts";

const originalRedisUrl = Deno.env.get("REDIS_URL");
const originalRunResultPath = Deno.env.get("VERYFRONT_RUN_RESULT_PATH");

async function writeProjectFile(projectDir: string, filePath: string, content: string) {
  const path = `${projectDir}/${filePath}`;
  const dir = path.slice(0, path.lastIndexOf("/"));
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, content);
}

function restoreEnv() {
  if (originalRedisUrl === undefined) {
    Deno.env.delete("REDIS_URL");
  } else {
    Deno.env.set("REDIS_URL", originalRedisUrl);
  }

  if (originalRunResultPath === undefined) {
    Deno.env.delete("VERYFRONT_RUN_RESULT_PATH");
  } else {
    Deno.env.set("VERYFRONT_RUN_RESULT_PATH", originalRunResultPath);
  }
}

describe("workflow command", () => {
  afterEach(() => {
    restoreEnv();
    clearProjectAgentRuntimeRegistries();
  });

  afterAll(async () => {
    await stopEsbuild();
  });

  it("formats workflow load errors for non-debug logs", () => {
    const lines = formatWorkflowDiscoveryErrors([
      {
        filePath: "workflows/my-workflow.ts",
        error: "Step \"start\" must specify either 'agent' or 'tool'",
      },
    ]);

    assertEquals(lines, [
      "  - workflows/my-workflow.ts: Step \"start\" must specify either 'agent' or 'tool'",
    ]);
  });

  it("limits workflow load errors in logs", () => {
    const lines = formatWorkflowDiscoveryErrors(
      Array.from({ length: 6 }, (_, index) => ({
        filePath: `workflows/workflow-${index}.ts`,
        error: "Invalid workflow",
      })),
    );

    assertEquals(lines.length, 6);
    assertEquals(lines.at(-1), "  - 1 more workflow file failed to load");
  });

  it("runs project workflows with discovered project tool steps", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-workflow-command-" });
    const resultPath = `${projectDir}/.veryfront/result.json`;

    try {
      await writeProjectFile(
        projectDir,
        "tools/echo.ts",
        [
          'import { defineSchema } from "veryfront/schemas";',
          'import { tool } from "veryfront/tool";',
          "",
          "export default tool({",
          '  id: "echo",',
          '  description: "Echo workflow input.",',
          "  inputSchema: defineSchema((v) => v.object({ message: v.string() }))(),",
          "  execute: async (input) => ({ echoed: input.message }),",
          "});",
        ].join("\n"),
      );

      await writeProjectFile(
        projectDir,
        "workflows/echo.ts",
        [
          'import { step, workflow } from "veryfront/workflow";',
          "",
          "export default workflow({",
          '  id: "echo",',
          '  description: "Echo a message through a project-local tool.",',
          '  steps: [step("start", { tool: "echo", input: { message: "hello" } })],',
          "});",
        ].join("\n"),
      );

      Deno.env.delete("REDIS_URL");
      Deno.env.set("VERYFRONT_RUN_RESULT_PATH", resultPath);

      await workflowCommand({
        action: "run",
        name: "echo",
        input: undefined,
        debug: false,
        projectDir,
      });

      assertEquals(JSON.parse(await Deno.readTextFile(resultPath)), {
        start: { echoed: "hello" },
      });
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
