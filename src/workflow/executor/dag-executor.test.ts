import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import {
  getActiveSourceIntegrationPolicy,
  runWithExactSourceIntegrationPolicy,
} from "#veryfront/integrations/source-policy-context.ts";
import type { WorkflowContext, WorkflowNode, WorkflowRun } from "../types.ts";
import { DAGExecutor as FacadeDAGExecutor } from "./dag-executor.ts";
import { DAGExecutor as ModularDAGExecutor } from "./dag/index.ts";
import { StepExecutor, type StepResult } from "./step-executor.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

function createTestRun(): WorkflowRun {
  return {
    id: "run-1",
    workflowId: "test",
    status: "running",
    input: {},
    nodeStates: {},
    currentNodes: [],
    context: { input: {} },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date(),
    sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
  };
}

class PolicyCapturingStepExecutor extends StepExecutor {
  observedPolicy: unknown;

  override execute(
    _node: WorkflowNode,
    _context: WorkflowContext,
  ): Promise<StepResult> {
    this.observedPolicy = getActiveSourceIntegrationPolicy();
    return Promise.resolve({ success: true, output: {}, executionTime: 0 });
  }
}

describe("DAGExecutor compatibility facade", () => {
  it("re-exports the modular DAGExecutor constructor unchanged", () => {
    assertEquals(FacadeDAGExecutor, ModularDAGExecutor);
  });

  it("restores and narrows run policy through the public facade", async () => {
    const persistedPolicy = normalizeSourceIntegrationPolicy({
      allow: {
        confluence: { allowedTools: ["get_page", "search_content"] },
      },
    });
    const activePolicy = normalizeSourceIntegrationPolicy({
      allow: {
        confluence: { allowedTools: ["get_page"] },
        github: {},
      },
    });
    const expectedPolicy = normalizeSourceIntegrationPolicy({
      allow: {
        confluence: { allowedTools: ["get_page"] },
      },
    });
    const stepExecutor = new PolicyCapturingStepExecutor();
    const executor = new FacadeDAGExecutor({ stepExecutor });

    await runWithExactSourceIntegrationPolicy(
      activePolicy,
      () =>
        executor.execute(
          [{ id: "observe", config: { type: "step" } as never }],
          { ...createTestRun(), sourceIntegrationPolicy: persistedPolicy },
        ),
    );

    assertEquals(stepExecutor.observedPolicy, expectedPolicy);
  });
});
