import "#veryfront/schemas/_test-setup.ts";
import { assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import type { WorkflowRun } from "../../types.ts";
import { ProcessRunExecutor } from "./process.ts";

function createRun(): WorkflowRun {
  return {
    id: "run-process-policy",
    workflowId: "workflow-1",
    status: "pending",
    input: {},
    nodeStates: {},
    currentNodes: [],
    context: { input: {} },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date(),
    sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
  };
}

describe("workflow/worker/executors/process", () => {
  it("rejects a run with no policy snapshot before spawning a process", () => {
    const executor = new ProcessRunExecutor({ entrypointPath: "unused.ts" });
    const { sourceIntegrationPolicy: _sourceIntegrationPolicy, ...missingSnapshot } = createRun();

    assertThrows(
      () =>
        executor.createRunExecution({
          executionId: "execution-1",
          run: missingSnapshot as unknown as WorkflowRun,
          managerId: "manager-1",
          timeout: 1_000,
          env: {},
        }),
      Error,
      "source integration policy snapshot",
    );
  });
});
