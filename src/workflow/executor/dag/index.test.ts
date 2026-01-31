/****
 * DAG Executor Tests
 *
 * Tests DAGExecutor with mock step executors to validate:
 * - Sequential and parallel node execution
 * - Branch, wait, loop, map, subWorkflow node types
 * - Error handling and cycle detection
 * - Checkpoint management
 * - Skip conditions
 *
 * @module ai/workflow/executor/dag/index.test
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { DAGExecutor } from "./index.ts";
import type { Checkpoint, WorkflowContext, WorkflowNode, WorkflowRun } from "../../types.ts";
import { StepExecutor, type StepResult } from "../step-executor.ts";
import { CheckpointManager } from "../checkpoint-manager.ts";
import type { WorkflowBackend } from "../../backends/types.ts";

class MockStepExecutor extends StepExecutor {
  constructor(
    private results: Map<string, { success: boolean; output?: unknown; error?: string }> =
      new Map(),
    private onExecute?: (
      node: WorkflowNode,
      context: WorkflowContext,
    ) => StepResult | Promise<StepResult>,
  ) {
    super();
  }

  override async execute(node: WorkflowNode, context: WorkflowContext): Promise<StepResult> {
    if (this.onExecute) return await this.onExecute(node, context);

    const result = this.results.get(node.id) ?? { success: true, output: { result: node.id } };
    return {
      success: result.success,
      output: result.output,
      error: result.error,
      executionTime: 10,
    };
  }
}

function createMockStepExecutor(
  results: Map<string, { success: boolean; output?: unknown; error?: string }> = new Map(),
): StepExecutor {
  return new MockStepExecutor(results);
}

function createMockCheckpointManager(): CheckpointManager & {
  saved: Array<{ runId: string; nodeId: string }>;
} {
  const saved: Array<{ runId: string; nodeId: string }> = [];
  const backend: WorkflowBackend = {
    createRun: () => Promise.resolve(),
    getRun: () => Promise.resolve(null),
    updateRun: () => Promise.resolve(),
    listRuns: () => Promise.resolve([]),
    saveCheckpoint: () => Promise.resolve(),
    getLatestCheckpoint: () => Promise.resolve(null),
    savePendingApproval: () => Promise.resolve(),
    getPendingApprovals: () => Promise.resolve([]),
    updateApproval: () => Promise.resolve(),
    destroy: () => Promise.resolve(),
  };

  const manager = new (class extends CheckpointManager {
    override save(runId: string, checkpoint: Checkpoint): Promise<void> {
      saved.push({ runId, nodeId: checkpoint.nodeId });
      return Promise.resolve();
    }
  })({ backend });

  return Object.assign(manager, { saved });
}

function createTestRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "test-run",
    workflowId: "wf-1",
    status: "running",
    input: { topic: "test" },
    nodeStates: {},
    currentNodes: [],
    context: { input: { topic: "test" } },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date(),
    ...overrides,
  };
}

describe("DAGExecutor", () => {
  let stepExecutor: StepExecutor;
  let executor: DAGExecutor;

  beforeEach(() => {
    stepExecutor = createMockStepExecutor();
    executor = new DAGExecutor({ stepExecutor });
  });

  describe("simple sequential execution", () => {
    it("should execute a single step node", async () => {
      const nodes: WorkflowNode[] = [{ id: "step1", config: { type: "step" } as any }];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
      assertEquals(result.waiting, false);
      assertExists(result.nodeStates["step1"]);
      assertEquals(result.nodeStates["step1"]!.status, "completed");
    });

    it("should execute sequential nodes in order", async () => {
      const order: string[] = [];
      const trackingExecutor = new MockStepExecutor(new Map(), (node) => {
        order.push(node.id);
        return { success: true, output: node.id, executionTime: 1 };
      });

      const exec = new DAGExecutor({ stepExecutor: trackingExecutor });
      const nodes: WorkflowNode[] = [
        { id: "a", config: { type: "step" } as any },
        { id: "b", config: { type: "step" } as any },
        { id: "c", config: { type: "step" } as any },
      ];

      const result = await exec.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
      assertEquals(order, ["a", "b", "c"]);
    });
  });

  describe("parallel execution with explicit dependencies", () => {
    it("should execute independent nodes in parallel", async () => {
      const nodes: WorkflowNode[] = [
        { id: "a", dependsOn: [], config: { type: "step" } as any },
        { id: "b", dependsOn: [], config: { type: "step" } as any },
        { id: "c", dependsOn: ["a", "b"], config: { type: "step" } as any },
      ];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
      assertEquals(result.nodeStates["a"]!.status, "completed");
      assertEquals(result.nodeStates["b"]!.status, "completed");
      assertEquals(result.nodeStates["c"]!.status, "completed");
    });
  });

  describe("error handling", () => {
    it("should stop on node failure and report error", async () => {
      const failExecutor = createMockStepExecutor(
        new Map([["fail-node", { success: false, error: "Something broke" }]]),
      );
      const exec = new DAGExecutor({ stepExecutor: failExecutor });

      const nodes: WorkflowNode[] = [
        { id: "fail-node", config: { type: "step" } as any },
        { id: "after", config: { type: "step" } as any },
      ];

      const result = await exec.execute(nodes, createTestRun());
      assertEquals(result.completed, false);
      assertEquals(result.waiting, false);
      assertExists(result.error);
      assertEquals(result.error!.includes("fail-node"), true);
    });

    it("should handle step execution rejection", async () => {
      const rejectExecutor = new MockStepExecutor(new Map(), () => {
        return Promise.reject(new Error("Unexpected crash"));
      });

      const exec = new DAGExecutor({ stepExecutor: rejectExecutor });
      const nodes: WorkflowNode[] = [{
        id: "crasher",
        dependsOn: [],
        config: { type: "step" } as any,
      }];

      const result = await exec.execute(nodes, createTestRun());
      assertEquals(result.completed, false);
      assertExists(result.error);
      assertEquals(result.error!.includes("Unexpected crash"), true);
    });
  });

  describe("cycle detection", () => {
    it("should detect and report cycles", async () => {
      const nodes: WorkflowNode[] = [
        { id: "a", dependsOn: ["b"], config: { type: "step" } as any },
        { id: "b", dependsOn: ["a"], config: { type: "step" } as any },
      ];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, false);
      assertExists(result.error);
      assertEquals(result.error!.includes("cycles"), true);
    });
  });

  describe("skip conditions", () => {
    it("should skip a node when skip condition is true", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "skipped",
          dependsOn: [],
          config: { type: "step", skip: () => true } as any,
        },
        { id: "after", config: { type: "step" } as any },
      ];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
      assertEquals(result.nodeStates["skipped"]!.status, "skipped");
      assertEquals(result.nodeStates["after"]!.status, "completed");
    });
  });

  describe("already completed nodes", () => {
    it("should skip already-completed nodes when resuming", async () => {
      const order: string[] = [];
      const trackingExecutor = new MockStepExecutor(new Map(), (node) => {
        order.push(node.id);
        return { success: true, output: node.id, executionTime: 1 };
      });

      const exec = new DAGExecutor({ stepExecutor: trackingExecutor });
      const nodes: WorkflowNode[] = [
        { id: "done", dependsOn: [], config: { type: "step" } as any },
        { id: "next", config: { type: "step" } as any },
      ];

      const run = createTestRun({
        nodeStates: {
          done: { nodeId: "done", status: "completed", attempt: 1, completedAt: new Date() },
        },
      });

      const result = await exec.execute(nodes, run);
      assertEquals(result.completed, true);
      assertEquals(order.includes("done"), false);
      assertEquals(order.includes("next"), true);
    });
  });

  describe("branch node", () => {
    it("should execute then-branch when condition is true", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "branch1",
          dependsOn: [],
          config: {
            type: "branch",
            condition: () => true,
            then: [{ id: "then-step", config: { type: "step" } as any }],
            else: [{ id: "else-step", config: { type: "step" } as any }],
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
      assertEquals(result.nodeStates["branch1"]!.status, "completed");
    });

    it("should handle empty branch", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "branch-empty",
          dependsOn: [],
          config: {
            type: "branch",
            condition: () => false,
            then: [],
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
      assertEquals(result.nodeStates["branch-empty"]!.status, "completed");
    });
  });

  describe("wait node", () => {
    it("should return waiting state for wait node", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "wait1",
          dependsOn: [],
          config: {
            type: "wait",
            waitType: "approval",
            message: "Please approve",
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, false);
      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "wait1");
    });
  });

  describe("parallel node", () => {
    it("should execute parallel sub-nodes", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "par1",
          dependsOn: [],
          config: {
            type: "parallel",
            nodes: [
              { id: "p-a", dependsOn: [], config: { type: "step" } as any },
              { id: "p-b", dependsOn: [], config: { type: "step" } as any },
            ],
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
      assertEquals(result.nodeStates["par1"]!.status, "completed");
    });
  });

  describe("map node", () => {
    it("should execute map over items", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "map1",
          dependsOn: [],
          config: {
            type: "map",
            items: ["a", "b", "c"],
            processor: { id: "proc", config: { type: "step" } as any },
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
      assertEquals(result.nodeStates["map1"]!.status, "completed");
    });

    it("should handle empty items array", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "map-empty",
          dependsOn: [],
          config: {
            type: "map",
            items: [],
            processor: { id: "proc", config: { type: "step" } as any },
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
      assertEquals(result.nodeStates["map-empty"]!.output, []);
    });

    it("should handle items as function", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "map-fn",
          dependsOn: [],
          config: {
            type: "map",
            items: () => [1, 2],
            processor: { id: "proc", config: { type: "step" } as any },
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
    });
  });

  describe("loop node", () => {
    it("should loop until condition is false", async () => {
      let iteration = 0;
      const nodes: WorkflowNode[] = [
        {
          id: "loop1",
          dependsOn: [],
          config: {
            type: "loop",
            maxIterations: 5,
            while: () => {
              iteration++;
              return iteration <= 3;
            },
            steps: [{ id: "loop-step", config: { type: "step" } as any }],
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
      assertEquals(result.nodeStates["loop1"]!.status, "completed");
      const output = result.nodeStates["loop1"]!.output as any;
      assertEquals(output.exitReason, "condition");
      assertEquals(output.iterations, 3);
    });

    it("should exit on max iterations", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "loop-max",
          dependsOn: [],
          config: {
            type: "loop",
            maxIterations: 2,
            while: () => true,
            steps: [{ id: "ls", config: { type: "step" } as any }],
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
      const output = result.nodeStates["loop-max"]!.output as any;
      assertEquals(output.iterations, 2);
    });
  });

  describe("subWorkflow node", () => {
    it("should execute a sub-workflow definition", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "sub1",
          dependsOn: [],
          config: {
            type: "subWorkflow",
            workflow: {
              id: "sub-wf",
              steps: [{ id: "sub-step", config: { type: "step" } as any }],
            },
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
      assertEquals(result.nodeStates["sub1"]!.status, "completed");
    });

    it("should throw for string workflow reference", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "sub-str",
          dependsOn: [],
          config: {
            type: "subWorkflow",
            workflow: "workflow-id-string",
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, false);
      assertExists(result.error);
    });

    it("should apply output transform", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "sub-out",
          dependsOn: [],
          config: {
            type: "subWorkflow",
            workflow: {
              id: "sub-wf-out",
              steps: [{ id: "inner", config: { type: "step" } as any }],
            },
            output: (_ctx: WorkflowContext) => ({ transformed: true }),
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
      assertEquals((result.nodeStates["sub-out"]!.output as any).transformed, true);
    });
  });

  describe("unknown node type", () => {
    it("should error on unknown node type", async () => {
      const nodes: WorkflowNode[] = [{
        id: "unknown",
        dependsOn: [],
        config: { type: "foobar" } as any,
      }];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, false);
      assertExists(result.error);
      assertEquals(result.error!.includes("Unknown node type"), true);
    });
  });

  describe("checkpoint management", () => {
    it("should save checkpoints for checkpointed nodes", async () => {
      const cpManager = createMockCheckpointManager();
      const exec = new DAGExecutor({ stepExecutor, checkpointManager: cpManager });

      const nodes: WorkflowNode[] = [
        {
          id: "cp-node",
          dependsOn: [],
          config: { type: "step", checkpoint: true } as any,
        },
      ];

      await exec.execute(nodes, createTestRun());
      assertEquals(cpManager.saved.length, 1);
      assertEquals(cpManager.saved[0]!.nodeId, "cp-node");
    });

    it("should not save checkpoint for non-checkpointed nodes", async () => {
      const cpManager = createMockCheckpointManager();
      const exec = new DAGExecutor({ stepExecutor, checkpointManager: cpManager });

      const nodes: WorkflowNode[] = [{
        id: "no-cp",
        dependsOn: [],
        config: { type: "step" } as any,
      }];

      await exec.execute(nodes, createTestRun());
      assertEquals(cpManager.saved.length, 0);
    });
  });

  describe("callbacks", () => {
    it("should invoke onNodeStart and onNodeComplete callbacks", async () => {
      const started: string[] = [];
      const completed: string[] = [];

      const exec = new DAGExecutor({
        stepExecutor,
        onNodeStart: (id) => started.push(id),
        onNodeComplete: (id) => completed.push(id),
      });

      const nodes: WorkflowNode[] = [{
        id: "cb-node",
        dependsOn: [],
        config: { type: "step" } as any,
      }];

      await exec.execute(nodes, createTestRun());
      assertEquals(started, ["cb-node"]);
      assertEquals(completed, ["cb-node"]);
    });
  });

  describe("startFromNode", () => {
    it("should start execution from a specific node", async () => {
      const order: string[] = [];
      const trackingExecutor = new MockStepExecutor(new Map(), (node) => {
        order.push(node.id);
        return { success: true, output: node.id, executionTime: 1 };
      });

      const exec = new DAGExecutor({ stepExecutor: trackingExecutor });
      const nodes: WorkflowNode[] = [
        { id: "b", dependsOn: [], config: { type: "step" } as any },
        { id: "a", dependsOn: ["b"], config: { type: "step" } as any },
      ];

      await exec.execute(nodes, createTestRun(), "b");
      assertEquals(order[0], "b");
    });
  });

  describe("maxConcurrency", () => {
    it("should respect maxConcurrency config", async () => {
      const exec = new DAGExecutor({ stepExecutor, maxConcurrency: 1 });

      const nodes: WorkflowNode[] = [
        { id: "a", dependsOn: [], config: { type: "step" } as any },
        { id: "b", dependsOn: [], config: { type: "step" } as any },
      ];

      const result = await exec.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
    });
  });
});
