import "#veryfront/schemas/_test-setup.ts";
/**
 * DAG Executor Tests
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import { step } from "../dsl/step.ts";
import { dependsOn } from "../dsl/workflow.ts";
import type { WorkflowContext, WorkflowNode, WorkflowRun } from "../types.ts";
import { DAGExecutor } from "./dag-executor.ts";
import { StepExecutor } from "./step-executor.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import {
  getActiveSourceIntegrationPolicy,
  runWithExactSourceIntegrationPolicy,
} from "#veryfront/integrations/source-policy-context.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

function createMockStepExecutor(
  executionOrder: string[] = [],
  failingNodes: Set<string> = new Set(),
): StepExecutor {
  const executor = new StepExecutor({});

  executor.execute = (node: WorkflowNode, _context: WorkflowContext) => {
    executionOrder.push(node.id);

    if (failingNodes.has(node.id)) {
      return Promise.resolve({
        success: false,
        error: "Step failed",
        executionTime: 10,
      });
    }

    return Promise.resolve({
      success: true,
      output: { result: `output-${node.id}` },
      executionTime: 10,
    });
  };

  return executor;
}

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

describe("DAGExecutor", () => {
  let executor: DAGExecutor;

  beforeEach(() => {
    executor = new DAGExecutor({
      stepExecutor: createMockStepExecutor(),
    });
  });

  it("restores and narrows the run policy for direct DAG consumers", async () => {
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
    let observedPolicy: unknown;
    const stepExecutor = createMockStepExecutor();
    stepExecutor.execute = () => {
      observedPolicy = getActiveSourceIntegrationPolicy();
      return Promise.resolve({ success: true, output: {}, executionTime: 0 });
    };
    executor = new DAGExecutor({ stepExecutor });

    await runWithExactSourceIntegrationPolicy(
      activePolicy,
      () =>
        executor.execute(
          [step("observe", { agent: "a" })],
          { ...createTestRun(), sourceIntegrationPolicy: persistedPolicy },
        ),
    );

    assertEquals(observedPolicy, expectedPolicy);
  });

  describe("Topological Sorting", () => {
    it("should execute nodes in dependency order", async () => {
      const executionOrder: string[] = [];

      executor = new DAGExecutor({
        stepExecutor: createMockStepExecutor(executionOrder),
      });

      const nodes: WorkflowNode[] = [
        dependsOn(step("c", { agent: "a" }), "b"),
        dependsOn(step("b", { agent: "a" }), "a"),
        step("a", { agent: "a" }),
      ];

      await executor.execute(nodes, createTestRun());

      const aIndex = executionOrder.indexOf("a");
      const bIndex = executionOrder.indexOf("b");
      const cIndex = executionOrder.indexOf("c");

      assertEquals(aIndex < bIndex, true, "a should execute before b");
      assertEquals(bIndex < cIndex, true, "b should execute before c");
    });

    it("should execute independent nodes in parallel", async () => {
      const startTimes: Record<string, number> = {};
      const stepExecutor = createMockStepExecutor();

      stepExecutor.execute = async (node: WorkflowNode, _context: WorkflowContext) => {
        startTimes[node.id] = Date.now();
        await delay(50);
        return {
          success: true,
          output: {},
          executionTime: 50,
        };
      };

      executor = new DAGExecutor({
        stepExecutor,
        maxConcurrency: 10,
      });

      const nodes: WorkflowNode[] = [
        { ...step("parallel-1", { agent: "a" }), dependsOn: [] },
        { ...step("parallel-2", { agent: "a" }), dependsOn: [] },
        { ...step("parallel-3", { agent: "a" }), dependsOn: [] },
      ];

      await executor.execute(nodes, createTestRun());

      const times = Object.values(startTimes);
      const maxDiff = Math.max(...times) - Math.min(...times);
      assertEquals(maxDiff < 30, true, "Independent nodes should start nearly simultaneously");
    });
  });

  describe("Cycle Detection", () => {
    it("should detect direct cycles", async () => {
      const nodes: WorkflowNode[] = [
        { ...step("a", { agent: "x" }), dependsOn: ["b"] },
        { ...step("b", { agent: "x" }), dependsOn: ["a"] },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertEquals(result.error?.toLowerCase().includes("cycle"), true);
    });

    it("should detect indirect cycles", async () => {
      const nodes: WorkflowNode[] = [
        { ...step("a", { agent: "x" }), dependsOn: ["c"] },
        { ...step("b", { agent: "x" }), dependsOn: ["a"] },
        { ...step("c", { agent: "x" }), dependsOn: ["b"] },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertEquals(result.error?.toLowerCase().includes("cycle"), true);
    });
  });

  describe("Error Handling", () => {
    it("should handle step failures", async () => {
      executor = new DAGExecutor({
        stepExecutor: createMockStepExecutor([], new Set(["failing"])),
      });

      const nodes: WorkflowNode[] = [step("ok", { agent: "a" }), step("failing", { agent: "a" })];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertEquals(result.error?.includes("failing"), true);
    });

    it("should skip dependent nodes when dependency fails", async () => {
      const executed: string[] = [];

      executor = new DAGExecutor({
        stepExecutor: createMockStepExecutor(executed, new Set(["failing"])),
      });

      const nodes: WorkflowNode[] = [
        step("failing", { agent: "a" }),
        dependsOn(step("dependent", { agent: "a" }), "failing"),
      ];

      await executor.execute(nodes, createTestRun());

      assertEquals(executed.includes("failing"), true);
      assertEquals(executed.includes("dependent"), false, "Dependent should be skipped");
    });
  });

  describe("Resume from Checkpoint", () => {
    it("should skip already completed nodes", async () => {
      const executed: string[] = [];

      executor = new DAGExecutor({
        stepExecutor: createMockStepExecutor(executed),
      });

      const nodes: WorkflowNode[] = [
        step("step1", { agent: "a" }),
        step("step2", { agent: "a" }),
        step("step3", { agent: "a" }),
      ];

      const run: WorkflowRun = {
        ...createTestRun(),
        nodeStates: {
          step1: {
            nodeId: "step1",
            status: "completed",
            output: { done: true },
            attempt: 1,
          },
        },
      };

      await executor.execute(nodes, run);

      assertEquals(executed.includes("step1"), false, "step1 should be skipped");
      assertEquals(executed.includes("step2"), true);
      assertEquals(executed.includes("step3"), true);
    });
  });
});
