import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { WorkflowRun } from "../../types.ts";
import { ProcessRunExecutor } from "./process.ts";

function createRun(id: string): WorkflowRun {
  return {
    id,
    workflowId: "workflow-process-test",
    status: "running",
    input: {},
    nodeStates: {},
    currentNodes: [],
    context: { input: {} },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date(),
  };
}

async function waitForTerminalStatus(
  executor: ProcessRunExecutor,
  executionId: string,
): Promise<"succeeded" | "failed"> {
  const deadline = Date.now() + 6_000;

  while (Date.now() < deadline) {
    const execution = await executor.getRunExecutionStatus(executionId);
    assertExists(execution);
    if (execution.status === "succeeded" || execution.status === "failed") {
      return execution.status;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Process execution did not reach a terminal status");
}

describe("ProcessRunExecutor", () => {
  const executors: ProcessRunExecutor[] = [];

  afterEach(async () => {
    await Promise.all(executors.splice(0).map((executor) => executor.destroy()));
  });

  it("drains child output when debug logging is disabled", async () => {
    const script = [
      "const chunk = new Uint8Array(65536);",
      "for (let i = 0; i < 32; i++) await Deno.stdout.write(chunk);",
    ].join("");
    const executor = new ProcessRunExecutor({
      command: Deno.execPath(),
      args: ["eval"],
      entrypointPath: script,
      debug: false,
    });
    executors.push(executor);

    const executionId = "execution-with-output";
    await executor.createRunExecution({
      executionId,
      run: createRun("run-with-output"),
      managerId: "manager-process-test",
      timeout: 1_000,
      env: {},
    });

    assertEquals(await waitForTerminalStatus(executor, executionId), "succeeded");
  });
});
