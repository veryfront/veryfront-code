import "#veryfront/schemas/_test-setup.ts";
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

import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { DAGExecutor } from "./index.ts";
import type {
  Checkpoint,
  LoopExecutionContext,
  WorkflowContext,
  WorkflowNode,
  WorkflowRun,
} from "../../types.ts";
import { StepExecutor, type StepResult } from "../step-executor.ts";
import { CheckpointManager } from "../checkpoint-manager.ts";
import type { WorkflowBackend } from "../../backends/types.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

class MockStepExecutor extends StepExecutor {
  constructor(
    private results: Map<string, { success: boolean; output?: unknown; error?: string }> =
      new Map(),
    private onExecute?: (
      node: WorkflowNode,
      context: WorkflowContext,
      abortSignal?: AbortSignal,
    ) => StepResult | Promise<StepResult>,
  ) {
    super();
  }

  override async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    abortSignal?: AbortSignal,
  ): Promise<StepResult> {
    if (this.onExecute) return await this.onExecute(node, context, abortSignal);

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
    override save(runId: string, checkpoint: Checkpoint): Promise<boolean> {
      saved.push({ runId, nodeId: checkpoint.nodeId });
      return Promise.resolve(true);
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
    sourceIntegrationPolicy: overrides.sourceIntegrationPolicy ??
      UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
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
      assertEquals("contextPatch" in result, false);
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

    it("isolates sibling context while a compound node is running", async () => {
      let releaseReader!: () => void;
      const loopAdvanced = new Promise<void>((resolve) => {
        releaseReader = resolve;
      });

      const isolatedStepExecutor = new MockStepExecutor(new Map(), async (node, context) => {
        if (node.id === "reader") {
          await loopAdvanced;
          return {
            success: true,
            output: { sawWriter: "writer" in context },
            executionTime: 1,
          };
        }

        return { success: true, output: "written", executionTime: 1 };
      });
      const isolatedExecutor = new DAGExecutor({ stepExecutor: isolatedStepExecutor });
      const nodes: WorkflowNode[] = [
        {
          id: "loop",
          dependsOn: [],
          config: {
            type: "loop",
            maxIterations: 2,
            while: (_context: WorkflowContext, loop: LoopExecutionContext) => {
              if (loop.iteration === 1) {
                releaseReader();
                return false;
              }
              return true;
            },
            steps: [{ id: "writer", config: { type: "step" } as any }],
          } as any,
        },
        { id: "reader", dependsOn: [], config: { type: "step" } as any },
      ];

      const result = await isolatedExecutor.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(result.nodeStates["reader"]!.output, { sawWriter: false });
      assertEquals(result.context.writer, "written");
    });

    it("isolates a mid-flight mutation from a sibling and merges both updates deterministically", async () => {
      let releaseObserver!: () => void;
      const mutatorAdvanced = new Promise<void>((resolve) => {
        releaseObserver = resolve;
      });

      const batchExecutor = new MockStepExecutor(new Map(), async (node, context) => {
        if (node.id === "observer") {
          // Block until the sibling compound node has mutated its OWN snapshot,
          // then report whether that mutation leaked into this node's snapshot.
          await mutatorAdvanced;
          return {
            success: true,
            output: { sawWriter: "writer" in context },
            executionTime: 1,
          };
        }
        // The compound node's inner step mutates its snapshot context mid-batch.
        return { success: true, output: "written", executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: batchExecutor });

      // Two independent nodes (dependsOn: []) land in the same batch. The mutator
      // is a compound (loop) node that writes into its snapshot before releasing
      // the observer; the observer must still see the untouched batch-start view.
      const nodes: WorkflowNode[] = [
        {
          id: "mutator",
          dependsOn: [],
          config: {
            type: "loop",
            maxIterations: 2,
            while: (_context: WorkflowContext, loop: LoopExecutionContext) => {
              if (loop.iteration === 1) {
                releaseObserver();
                return false;
              }
              return true;
            },
            steps: [{ id: "writer", config: { type: "step" } as any }],
          } as any,
        },
        { id: "observer", dependsOn: [], config: { type: "step" } as any },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      // Isolation: the observer ran against the batch-start snapshot, so the
      // mutator's mid-flight write was invisible to it.
      assertEquals(result.nodeStates["observer"]!.output, { sawWriter: false });
      // Deterministic merge-back: after the batch settles, BOTH siblings'
      // context updates are present in the merged context.
      assertEquals(result.context.writer, "written");
      assertEquals(result.context.observer, { sawWriter: false });
    });

    it("isolates nested context mutations between sibling nodes", async () => {
      let releaseObserver!: () => void;
      const mutated = new Promise<void>((resolve) => releaseObserver = resolve);
      const nestedExecutor = new MockStepExecutor(new Map(), async (node, context) => {
        if (node.id === "mutator") {
          (context.shared as { count: number }).count = 1;
          releaseObserver();
          return { success: true, output: "mutated", executionTime: 1 };
        }

        await mutated;
        return {
          success: true,
          output: (context.shared as { count: number }).count,
          executionTime: 1,
        };
      });
      const exec = new DAGExecutor({ stepExecutor: nestedExecutor });

      const run = createTestRun({ context: { input: {}, shared: { count: 0 } } });
      const result = await exec.execute(
        [
          { id: "mutator", dependsOn: [], config: { type: "step" } as any },
          { id: "observer", dependsOn: [], config: { type: "step" } as any },
        ],
        run,
      );

      assertEquals(result.completed, true);
      assertEquals(result.nodeStates.observer?.output, 0);
      assertEquals(result.context.shared, { count: 1 });
      assertEquals(run.context.shared, { count: 0 });
    });

    it("does not leak a rejected node's nested context mutation", async () => {
      let releaseObserver!: () => void;
      const mutated = new Promise<void>((resolve) => releaseObserver = resolve);
      const rejectingExecutor = new MockStepExecutor(new Map(), async (node, context) => {
        if (node.id === "rejecting-mutator") {
          (context.shared as { count: number }).count = 99;
          releaseObserver();
          throw new Error("reject after mutation");
        }

        await mutated;
        return {
          success: true,
          output: (context.shared as { count: number }).count,
          executionTime: 1,
        };
      });
      const exec = new DAGExecutor({ stepExecutor: rejectingExecutor });

      const result = await exec.execute(
        [
          {
            id: "rejecting-mutator",
            dependsOn: [],
            config: { type: "step" } as any,
          },
          { id: "observer", dependsOn: [], config: { type: "step" } as any },
        ],
        createTestRun({ context: { input: {}, shared: { count: 0 } } }),
      );

      assertEquals(result.completed, false);
      assertEquals(result.nodeStates.observer?.output, 0);
      assertEquals(result.context.shared, { count: 0 });
    });

    it("merges same-key writes in node declaration order", async () => {
      let releaseFirst!: () => void;
      const secondFinished = new Promise<void>((resolve) => releaseFirst = resolve);
      const orderedExecutor = new MockStepExecutor(new Map(), async (node, context) => {
        if (node.id === "first") {
          await secondFinished;
          context.shared = "first";
        } else {
          context.shared = "second";
          releaseFirst();
        }
        return { success: true, output: node.id, executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: orderedExecutor });

      const result = await exec.execute(
        [
          { id: "first", dependsOn: [], config: { type: "step" } as any },
          { id: "second", dependsOn: [], config: { type: "step" } as any },
        ],
        createTestRun({ context: { input: {}, shared: "initial" } }),
      );

      assertEquals(result.completed, true);
      assertEquals(result.context.shared, "second");
    });

    it("does not let parallel or branch nodes restore stale sibling context", async () => {
      const staleExecutor = new MockStepExecutor(new Map(), (node, context) => {
        if (node.id === "writer") context.shared = "fresh";
        return { success: true, output: node.id, executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: staleExecutor });

      for (
        const config of [
          {
            type: "parallel",
            nodes: [{ id: "child", config: { type: "step" } as any }],
          },
          {
            type: "branch",
            condition: () => true,
            then: [{ id: "child", config: { type: "step" } as any }],
          },
        ]
      ) {
        const result = await exec.execute(
          [
            { id: "writer", dependsOn: [], config: { type: "step" } as any },
            { id: "compound", dependsOn: [], config: config as any },
          ],
          createTestRun({ context: { input: {}, shared: "stale" } }),
        );

        assertEquals(result.completed, true);
        assertEquals(result.context.shared, "fresh");
        assertEquals(result.context.child, "child");
      }
    });

    it("propagates top-level context deletions", async () => {
      const deletingExecutor = new MockStepExecutor(new Map(), (_node, context) => {
        delete context.removed;
        return { success: true, output: "deleted", executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: deletingExecutor });

      const result = await exec.execute(
        [{ id: "delete", config: { type: "step" } as any }],
        createTestRun({ context: { input: {}, removed: "value" } }),
      );

      assertEquals(result.completed, true);
      assertEquals(Object.hasOwn(result.context, "removed"), false);
    });

    it("propagates context deletions out of a branch", async () => {
      const deletingExecutor = new MockStepExecutor(new Map(), (_node, context) => {
        delete context.removed;
        return { success: true, output: "deleted", executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: deletingExecutor });

      const result = await exec.execute(
        [{
          id: "branch",
          config: {
            type: "branch",
            condition: () => true,
            then: [{ id: "delete-child", config: { type: "step" } as any }],
          } as any,
        }],
        createTestRun({ context: { input: {}, removed: "value" } }),
      );

      assertEquals(result.completed, true);
      assertEquals(Object.hasOwn(result.context, "removed"), false);
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

    it("discards context mutations from a failed node result", async () => {
      const failedExecutor = new MockStepExecutor(new Map(), (_node, context) => {
        (context.shared as { count: number }).count = 99;
        delete context.removed;
        return { success: false, error: "failed after mutation", executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: failedExecutor });

      const result = await exec.execute(
        [{ id: "failed-mutator", config: { type: "step" } as any }],
        createTestRun({ context: { input: {}, shared: { count: 0 }, removed: true } }),
      );

      assertEquals(result.completed, false);
      assertEquals(result.context.shared, { count: 0 });
      assertEquals(result.context.removed, true);
    });

    it("discards the complete context patch from a failed compound node", async () => {
      const failedCompoundExecutor = new MockStepExecutor(new Map(), (node, context) => {
        if (node.id === "successful-child") {
          (context.shared as { count: number }).count = 1;
          return { success: true, output: "partial output", executionTime: 1 };
        }
        return { success: false, error: "child failed", executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: failedCompoundExecutor });

      const result = await exec.execute(
        [{
          id: "failed-parallel",
          config: {
            type: "parallel",
            nodes: [
              { id: "successful-child", dependsOn: [], config: { type: "step" } as any },
              { id: "failed-child", dependsOn: [], config: { type: "step" } as any },
            ],
          } as any,
        }],
        createTestRun({ context: { input: {}, shared: { count: 0 } } }),
      );

      assertEquals(result.completed, false);
      assertEquals(result.context.shared, { count: 0 });
      assertEquals(Object.hasOwn(result.context, "successful-child"), false);
      assertEquals(result.nodeStates["successful-child"]?.status, "completed");
    });

    it("rejects workflow context that cannot be cloned", async () => {
      const run = createTestRun({
        context: { input: {}, callback: () => undefined },
      });

      const error = await assertRejects(
        () => executor.execute([{ id: "step", config: { type: "step" } as any }], run),
        Error,
        "Workflow context must contain only structured-cloneable values",
      );

      assertEquals((error as { slug?: string }).slug, "invalid-argument");
    });

    it("rejects a node output that cannot be cloned", async () => {
      const invalidOutputExecutor = new MockStepExecutor(new Map(), () => ({
        success: true,
        output: () => undefined,
        executionTime: 1,
      }));
      const exec = new DAGExecutor({ stepExecutor: invalidOutputExecutor });

      const error = await assertRejects(
        () => exec.execute([{ id: "step", config: { type: "step" } as any }], createTestRun()),
        Error,
        "Workflow context changes must contain only structured-cloneable values",
      );

      assertEquals((error as { slug?: string }).slug, "invalid-argument");
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

    it("should not execute a branch after cancellation during its condition", async () => {
      const controller = new AbortController();
      const cancellationError = new Error("workflow cancelled");
      let conditionStarted!: () => void;
      const started = new Promise<void>((resolve) => conditionStarted = resolve);
      let resolveCondition!: (value: boolean) => void;
      const condition = new Promise<boolean>((resolve) => resolveCondition = resolve);
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nodes: WorkflowNode[] = [{
        id: "branch-cancelled",
        config: {
          type: "branch",
          condition: () => {
            conditionStarted();
            return condition;
          },
          then: [{ id: "must-not-run", config: { type: "step" } as any }],
        } as any,
      }];

      const execution = exec.execute(nodes, createTestRun(), undefined, controller.signal);
      await started;
      controller.abort(cancellationError);
      resolveCondition(true);

      await assertRejects(() => execution, Error, cancellationError.message);
      assertEquals(executed, []);
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

  describe("composite resume (H8)", () => {
    it("should not re-run completed children of a parallel node on resume", async () => {
      let stepARuns = 0;
      const trackingExecutor = new MockStepExecutor(new Map(), (node, context) => {
        if (node.id === "p-step") {
          stepARuns++;
          delete context.removed;
        }
        return { success: true, output: node.id, executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: trackingExecutor });

      const nodes: WorkflowNode[] = [
        {
          id: "par1",
          dependsOn: [],
          config: {
            type: "parallel",
            nodes: [
              { id: "p-step", dependsOn: [], config: { type: "step" } as any },
              {
                id: "p-wait",
                dependsOn: [],
                config: { type: "wait", waitType: "approval", message: "approve?" } as any,
              },
            ],
          } as any,
        },
      ];

      // First run: should suspend on the wait node, p-step runs once.
      const run = createTestRun({
        context: { input: { topic: "test" }, removed: "delete before waiting" },
      });
      const first = await exec.execute(nodes, run);
      assertEquals(first.waiting, true);
      // The node that actually suspended is reported, not its enclosing
      // composite -- an approval is built from that node's `input`.
      assertEquals(first.waitingNode, "p-wait");
      assertEquals(stepARuns, 1);
      assertEquals(first.nodeStates["p-step"]!.status, "completed");
      assertEquals(Object.hasOwn(first.context, "removed"), false);

      // Resume: mark the wait node completed (approval granted) and re-run with
      // the accumulated nodeStates from the first run. The real executor derives
      // startFromNode from the checkpoint (CheckpointManager.findNextNode scans
      // the top-level nodes), so it is always a top-level id -- never the
      // reported waiting node.
      const resumedStates = {
        ...first.nodeStates,
        "p-wait": {
          ...first.nodeStates["p-wait"]!,
          status: "completed" as const,
          completedAt: new Date(),
        },
      };
      const resumeRun = createTestRun({
        nodeStates: resumedStates,
        context: { ...first.context },
      });

      const second = await exec.execute(nodes, resumeRun, "par1");
      assertEquals(second.completed, true);
      // p-step must NOT have run a second time.
      assertEquals(stepARuns, 1);
      assertEquals(Object.hasOwn(second.context, "removed"), false);
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

    it("should pass each item as processor input and preserve ordered outputs", async () => {
      const items = [{ value: "a" }, { value: "b" }, { value: "c" }];
      const seenInputs: unknown[] = [];
      const trackingExecutor = new MockStepExecutor(new Map(), (node) => {
        const input = (node.config as { input?: unknown }).input;
        seenInputs.push(input);
        return { success: true, output: { processed: input }, executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: trackingExecutor, maxConcurrency: 1 });
      const nodes: WorkflowNode[] = [
        {
          id: "map-inputs",
          dependsOn: [],
          config: {
            type: "map",
            items,
            processor: { id: "proc", config: { type: "step" } as any },
          } as any,
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      const expected = items.map((item) => ({ processed: item }));
      assertEquals(result.completed, true);
      assertEquals(seenInputs, items);
      assertEquals(result.nodeStates["map-inputs"]!.output, expected);
      assertEquals(result.context["map-inputs"], expected);
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

    it("records failed loop output in node state without committing context", async () => {
      const failingExecutor = new MockStepExecutor(
        new Map([["bad-step", { success: false, error: "bad step" }]]),
      );
      const exec = new DAGExecutor({ stepExecutor: failingExecutor });
      const nodes: WorkflowNode[] = [
        {
          id: "loop-error",
          dependsOn: [],
          config: {
            type: "loop",
            maxIterations: 3,
            while: () => true,
            steps: [{ id: "bad-step", config: { type: "step" } as any }],
          } as any,
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      const state = result.nodeStates["loop-error"]!;
      const output = state.output as { exitReason: string; iterations: number };
      assertEquals(result.completed, false);
      assertEquals(state.status, "failed");
      assertEquals(state.error, 'Node "bad-step" failed: bad step');
      assertEquals(output.exitReason, "error");
      assertEquals(output.iterations, 0);
      assertEquals(result.context["loop-error"], undefined);
    });
  });

  describe("loop node sibling isolation", () => {
    it("does not re-execute a step declared before the loop", async () => {
      const executed: string[] = [];
      const trackingExecutor = new MockStepExecutor(new Map(), (node) => {
        executed.push(node.id);
        return { success: true, output: node.id, executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: trackingExecutor });

      const nodes: WorkflowNode[] = [
        { id: "before", dependsOn: [], config: { type: "step" } as any },
        {
          id: "the-loop",
          dependsOn: ["before"],
          config: {
            type: "loop",
            maxIterations: 2,
            while: (_context: WorkflowContext, loop: LoopExecutionContext) => loop.iteration < 2,
            steps: [{ id: "inner", config: { type: "step" } as any }],
          } as any,
        },
        { id: "after", dependsOn: ["the-loop"], config: { type: "step" } as any },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      // A loop iteration patches the parent's node states against its own child
      // graph only. Diffing that against the parent map would report every
      // completed sibling as deleted, which re-schedules them.
      assertEquals(executed.filter((id) => id === "before").length, 1);
      assertEquals(executed, ["before", "inner", "inner", "after"]);
    });

    it("keeps a preceding sibling's node state after the loop completes", async () => {
      const nodes: WorkflowNode[] = [
        { id: "before", dependsOn: [], config: { type: "step" } as any },
        {
          id: "the-loop",
          dependsOn: ["before"],
          config: {
            type: "loop",
            maxIterations: 1,
            while: (_context: WorkflowContext, loop: LoopExecutionContext) => loop.iteration < 1,
            steps: [{ id: "inner", config: { type: "step" } as any }],
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertExists(result.nodeStates["before"]);
      assertEquals(result.nodeStates["before"]!.status, "completed");
      assertExists(result.nodeStates["inner"]);
    });

    it("keeps a preceding sibling's node state when the loop suspends on a wait", async () => {
      const nodes: WorkflowNode[] = [
        { id: "before", dependsOn: [], config: { type: "step" } as any },
        {
          id: "the-loop",
          dependsOn: ["before"],
          config: {
            type: "loop",
            maxIterations: 2,
            while: () => true,
            steps: [
              { id: "inner", dependsOn: [], config: { type: "step" } as any },
              {
                id: "inner-wait",
                dependsOn: ["inner"],
                config: { type: "wait", waitType: "approval", message: "approve?" } as any,
              },
            ],
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.waiting, true);
      assertExists(result.nodeStates["before"]);
      assertEquals(result.nodeStates["before"]!.status, "completed");
    });

    it("removes child node states from previous dynamic loop iterations", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "the-loop",
          config: {
            type: "loop",
            maxIterations: 2,
            while: (_context: WorkflowContext, loop: LoopExecutionContext) => loop.iteration < 2,
            steps: (_context: WorkflowContext, loop: LoopExecutionContext) => [
              {
                id: loop.iteration === 0 ? "old-child" : "current-child",
                config: { type: "step" } as any,
              },
            ],
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(result.nodeStates["old-child"], undefined);
      assertExists(result.nodeStates["current-child"]);
      assertEquals(result.nodeStates["current-child"]!.status, "completed");
    });
  });

  describe("run-scoped step hooks", () => {
    it("threads the durable run id down to the step hooks with worker ownership", async () => {
      const seen: Array<[string, string | undefined]> = [];
      class RunIdCapturingExecutor extends StepExecutor {
        override execute(
          node: WorkflowNode,
          _context: WorkflowContext,
          _abortSignal?: AbortSignal,
          runId?: string,
        ): Promise<StepResult> {
          seen.push([node.id, runId]);
          return Promise.resolve({ success: true, output: node.id, executionTime: 1 });
        }
      }

      const exec = new DAGExecutor({ stepExecutor: new RunIdCapturingExecutor() });
      const nodes: WorkflowNode[] = [{ id: "only", config: { type: "step" } as any }];

      await exec.execute(nodes, createTestRun({ id: "run-42" }), undefined, undefined, {
        runId: "run-42",
        workerId: "worker-1",
      });

      assertEquals(seen, [["only", "run-42"]]);
    });

    it("threads the durable run id without worker ownership", async () => {
      const seen: Array<[string, string | undefined]> = [];
      class RunIdCapturingExecutor extends StepExecutor {
        override execute(
          node: WorkflowNode,
          _context: WorkflowContext,
          _abortSignal?: AbortSignal,
          runId?: string,
        ): Promise<StepResult> {
          seen.push([node.id, runId]);
          return Promise.resolve({ success: true, output: node.id, executionTime: 1 });
        }
      }

      const exec = new DAGExecutor({ stepExecutor: new RunIdCapturingExecutor() });
      const nodes: WorkflowNode[] = [{ id: "only", config: { type: "step" } as any }];

      await exec.execute(nodes, createTestRun({ id: "durable-run" }));

      assertEquals(seen, [["only", "durable-run"]]);
    });

    it("threads the durable run id into child graphs without worker ownership", async () => {
      const seen: Array<[string, string | undefined]> = [];
      class RunIdCapturingExecutor extends StepExecutor {
        override execute(
          node: WorkflowNode,
          _context: WorkflowContext,
          _abortSignal?: AbortSignal,
          runId?: string,
        ): Promise<StepResult> {
          seen.push([node.id, runId]);
          return Promise.resolve({ success: true, output: node.id, executionTime: 1 });
        }
      }

      const exec = new DAGExecutor({ stepExecutor: new RunIdCapturingExecutor() });
      const nodes: WorkflowNode[] = [{
        id: "group",
        config: {
          type: "parallel",
          nodes: [{ id: "child", config: { type: "step" } as any }],
        } as any,
      }];

      await exec.execute(nodes, createTestRun({ id: "durable-run" }));

      assertEquals(seen, [["child", "durable-run"]]);
    });
  });

  describe("nested wait reporting", () => {
    const nestedWait = {
      id: "inner-wait",
      config: { type: "wait", waitType: "approval", message: "approve?" } as any,
    };

    it("reports the inner node when a wait is nested in a branch", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "gate",
          dependsOn: [],
          config: {
            type: "branch",
            condition: () => true,
            then: [nestedWait],
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.waiting, true);
      // The approval is built from nodeStates[waitingNode].input, and a
      // composite's state carries no input -- so reporting the composite means
      // no approval is ever created.
      assertEquals(result.waitingNode, "inner-wait");
      assertExists(result.nodeStates["inner-wait"]!.input);
    });

    it("reports the inner node when a wait is nested in a parallel", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "group",
          dependsOn: [],
          config: { type: "parallel", nodes: [nestedWait] } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "inner-wait");
    });

    it("reports the inner node when a wait is nested in a sub-workflow", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "sub",
          dependsOn: [],
          config: {
            type: "subWorkflow",
            workflow: { id: "child", steps: [nestedWait] },
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "inner-wait");
      assertExists(result.nodeStates["inner-wait"]!.input);
    });

    it("still reports a top-level wait as itself", async () => {
      const nodes: WorkflowNode[] = [
        { id: "top-wait", dependsOn: [], config: nestedWait.config },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "top-wait");
    });

    it("re-enters an enclosing composite after a nested wait is approved", async () => {
      const order: string[] = [];
      const trackingExecutor = new MockStepExecutor(new Map(), (node) => {
        order.push(node.id);
        return { success: true, output: node.id, executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: trackingExecutor });
      const nodes: WorkflowNode[] = [
        {
          id: "gate",
          dependsOn: [],
          config: {
            type: "branch",
            condition: () => true,
            then: [nestedWait],
          } as any,
        },
        { id: "after", config: { type: "step" } as any },
      ];

      const first = await exec.execute(nodes, createTestRun());
      assertEquals(first.waiting, true);
      assertEquals(first.waitingNode, "inner-wait");
      assertEquals(first.nodeStates["gate"]!.status, "running");

      const second = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            ...first.nodeStates,
            "inner-wait": {
              ...first.nodeStates["inner-wait"]!,
              status: "completed",
              completedAt: new Date(),
            },
          },
          context: first.context,
        }),
      );

      assertEquals(second.completed, true);
      assertEquals(order, ["after"]);
      assertEquals(second.nodeStates["gate"]!.status, "completed");
      assertEquals(second.nodeStates["after"]!.status, "completed");
    });
  });

  describe("recovery from a worker that died mid-node", () => {
    it("re-runs a step left in running state, rather than stranding it", async () => {
      const executed: string[] = [];
      const persistedAttempts: number[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
        onRecoveryScheduled: ({ nodeId, nodeStates }) => {
          persistedAttempts.push(nodeStates[nodeId]?.attempt ?? 0);
        },
      });

      const nodes: WorkflowNode[] = [
        { id: "first", dependsOn: [], config: { type: "step" } as any },
        { id: "second", dependsOn: ["first"], config: { type: "step" } as any },
      ];

      // What a dead worker leaves behind: the node it was executing is recorded
      // as running and never reaches a terminal state.
      const run = createTestRun({
        status: "running",
        nodeStates: {
          first: { nodeId: "first", status: "completed", output: "first", attempt: 1 },
          second: { nodeId: "second", status: "running", attempt: 1, startedAt: new Date() },
        },
      });

      const result = await exec.execute(nodes, run);

      assertEquals(result.completed, true);
      assertEquals(persistedAttempts, [2]);
      assertEquals(executed, ["second"]);
      assertEquals(result.nodeStates["second"]!.status, "completed");
    });

    it("does not re-run recovered work when recovery state cannot be persisted", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
        onRecoveryScheduled: () => false,
      });

      const nodes: WorkflowNode[] = [
        { id: "side-effect", dependsOn: [], config: { type: "step" } as any },
      ];
      const run = createTestRun({
        status: "running",
        nodeStates: {
          "side-effect": {
            nodeId: "side-effect",
            status: "running",
            attempt: 1,
            startedAt: new Date(),
          },
        },
      });

      await assertRejects(
        () => exec.execute(nodes, run),
        Error,
        "execution ownership changed",
      );
      assertEquals(executed, []);
    });

    it("never re-runs a node whose retry budget was already spent", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });

      const nodes: WorkflowNode[] = [
        {
          id: "flaky",
          dependsOn: [],
          config: { type: "step", retry: { maxAttempts: 2 } } as any,
        },
      ];

      // Recovered twice already and died again each time. The
      // step executor restarts its own retry loop at 1 and overwrites the
      // recorded attempt, so scheduling this again would let repeated worker
      // deaths re-run it forever -- duplicating any external side effect.
      const run = createTestRun({
        status: "running",
        nodeStates: {
          flaky: { nodeId: "flaky", status: "running", attempt: 3, startedAt: new Date() },
        },
      });

      const result = await exec.execute(nodes, run);

      assertEquals(executed, []);
      assertEquals(result.completed, false);
      assertEquals(result.nodeStates["flaky"]!.status, "failed");
      assertEquals(typeof result.error, "string");
    });

    it("stops after one recovery for a node with no retry configured", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });

      const nodes: WorkflowNode[] = [
        { id: "once", dependsOn: [], config: { type: "step" } as any },
      ];

      // attempt 2 on a node allowing 1: it was recovered once already and the
      // worker died again. A default node gets one recovery, not unlimited ones.
      const run = createTestRun({
        status: "running",
        nodeStates: {
          once: { nodeId: "once", status: "running", attempt: 2, startedAt: new Date() },
        },
      });

      const result = await exec.execute(nodes, run);

      assertEquals(executed, []);
      assertEquals(result.completed, false);
      assertEquals(result.nodeStates["once"]!.status, "failed");
    });

    it("leaves a wait parked on its decision alone", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });

      const nodes: WorkflowNode[] = [
        {
          id: "approve",
          dependsOn: [],
          config: { type: "wait", waitType: "approval", message: "m" } as any,
        },
      ];

      // Nothing executes while a wait is parked, so there is no interrupted
      // attempt to recover -- re-running it would raise a second approval for a
      // decision already pending. A loop or branch child graph hits this too:
      // its synthetic run is always "running" even while its wait is parked.
      const run = createTestRun({
        status: "running",
        nodeStates: {
          approve: {
            nodeId: "approve",
            status: "running",
            attempt: 1,
            startedAt: new Date(),
            input: { type: "approval", message: "m" },
          },
        },
      });

      const result = await exec.execute(nodes, run);

      assertEquals(executed, []);
      assertEquals(result.nodeStates["approve"]!.status, "running");
    });

    it("leaves a composite parked on a nested wait alone", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });

      const nodes: WorkflowNode[] = [
        {
          id: "gate",
          dependsOn: [],
          config: {
            type: "branch",
            condition: () => true,
            then: [
              { id: "inner", dependsOn: [], config: { type: "step" } as any },
              {
                id: "inner-wait",
                dependsOn: ["inner"],
                config: { type: "wait", waitType: "approval", message: "m" } as any,
              },
            ],
          } as any,
        },
      ];

      const first = await exec.execute(nodes, createTestRun());
      assertEquals(first.waiting, true);
      assertEquals(executed, ["inner"]);
      // The composite is recorded as running while its child waits. That is a
      // parked run, not a dead worker, and must not restart the branch.
      assertEquals(first.nodeStates["gate"]!.status, "running");
    });
  });

  describe("loop resume (H9)", () => {
    it("should not re-run completed steps of an in-flight loop iteration on resume", async () => {
      let incrRuns = 0;
      const trackingExecutor = new MockStepExecutor(new Map(), (node) => {
        if (node.id === "l-incr") incrRuns++;
        return { success: true, output: node.id, executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: trackingExecutor });

      const nodes: WorkflowNode[] = [
        {
          id: "loop1",
          dependsOn: [],
          config: {
            type: "loop",
            maxIterations: 1,
            while: () => true,
            steps: [
              { id: "l-incr", dependsOn: [], config: { type: "step" } as any },
              {
                id: "l-wait",
                dependsOn: ["l-incr"],
                config: { type: "wait", waitType: "approval", message: "approve?" } as any,
              },
            ],
          } as any,
        },
      ];

      // First run: increments once, then suspends on the wait.
      const run = createTestRun();
      const first = await exec.execute(nodes, run);
      assertEquals(first.waiting, true);
      assertEquals(first.waitingNode, "l-wait");
      assertEquals(incrRuns, 1);
      assertEquals(first.nodeStates["l-incr"]!.status, "completed");

      // Resume: approve the wait and re-run from the loop node, carrying the
      // accumulated state. The pre-wait step must NOT run again for this
      // iteration.
      const resumedStates = {
        ...first.nodeStates,
        "l-wait": {
          ...first.nodeStates["l-wait"]!,
          status: "completed" as const,
          completedAt: new Date(),
        },
      };
      const resumeRun = createTestRun({
        nodeStates: resumedStates,
        context: { ...first.context },
      });

      const second = await exec.execute(nodes, resumeRun, "loop1");
      // The in-flight iteration's l-incr must NOT have run a second time.
      assertEquals(
        incrRuns,
        1,
        `expected exactly 1 increment (no double-run on resume), got ${incrRuns}`,
      );
      assertEquals(second.completed, true);
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

  describe("composite node execution policy", () => {
    const retryAfterTimeout = {
      maxAttempts: 2,
      backoff: "fixed",
      initialDelay: 0,
      maxDelay: 0,
    } as const;

    it("applies timeout and retry to a branch node", async () => {
      let attempts = 0;
      const nodes: WorkflowNode[] = [{
        id: "branch-policy",
        config: {
          type: "branch",
          timeout: 5,
          retry: retryAfterTimeout,
          condition: async () => {
            attempts++;
            if (attempts === 1) await new Promise((resolve) => setTimeout(resolve, 15));
            return false;
          },
          then: [],
        } as any,
      }];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(attempts, 2);
      assertEquals(result.nodeStates["branch-policy"]!.attempt, 2);
    });

    it("reruns a failed branch child before a parent retry can succeed", async () => {
      let childRuns = 0;
      const trackingExecutor = new MockStepExecutor(new Map(), (node) => {
        if (node.id !== "retrying-branch-child") {
          return { success: true, output: node.id, executionTime: 1 };
        }

        childRuns++;
        return childRuns === 1
          ? { success: false, error: "transient child failure", executionTime: 1 }
          : { success: true, output: "recovered", executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: trackingExecutor });
      const nodes: WorkflowNode[] = [{
        id: "retrying-branch",
        config: {
          type: "branch",
          condition: () => true,
          then: [{ id: "retrying-branch-child", config: { type: "step" } as any }],
          retry: {
            maxAttempts: 2,
            backoff: "fixed",
            initialDelay: 0,
            maxDelay: 0,
            retryIf: () => true,
          },
        } as any,
      }];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(childRuns, 2);
      assertEquals(result.nodeStates["retrying-branch"]!.attempt, 2);
      assertEquals(result.nodeStates["retrying-branch-child"]!.status, "completed");
      assertEquals(result.context["retrying-branch-child"], "recovered");
    });

    it("keeps the selected branch stable across a parent retry", async () => {
      let conditionCalls = 0;
      let stableChildRuns = 0;
      let retryingChildRuns = 0;
      let elseChildRuns = 0;
      const trackingExecutor = new MockStepExecutor(new Map(), (node) => {
        if (node.id === "branch-stable-child") {
          stableChildRuns++;
          return { success: true, output: "stable", executionTime: 1 };
        }
        if (node.id === "branch-retrying-child") {
          retryingChildRuns++;
          return retryingChildRuns === 1
            ? { success: false, error: "transient child failure", executionTime: 1 }
            : { success: true, output: "recovered", executionTime: 1 };
        }

        elseChildRuns++;
        return { success: true, output: "wrong branch", executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: trackingExecutor });
      const nodes: WorkflowNode[] = [{
        id: "stable-retrying-branch",
        config: {
          type: "branch",
          condition: (context: WorkflowContext) => {
            conditionCalls++;
            return context["branch-stable-child"] === undefined;
          },
          then: [
            { id: "branch-stable-child", config: { type: "step" } as any },
            { id: "branch-retrying-child", config: { type: "step" } as any },
          ],
          else: [{ id: "branch-else-child", config: { type: "step" } as any }],
          retry: {
            maxAttempts: 2,
            backoff: "fixed",
            initialDelay: 0,
            maxDelay: 0,
            retryIf: () => true,
          },
        } as any,
      }];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(conditionCalls, 1);
      assertEquals(stableChildRuns, 1);
      assertEquals(retryingChildRuns, 2);
      assertEquals(elseChildRuns, 0);
      assertEquals(result.context["branch-stable-child"], "stable");
      assertEquals(result.context["branch-retrying-child"], "recovered");
    });

    it("preserves successful parallel child context across a parent retry", async () => {
      let stableChildRuns = 0;
      let retryingChildRuns = 0;
      const trackingExecutor = new MockStepExecutor(new Map(), (node) => {
        if (node.id === "stable-child") {
          stableChildRuns++;
          return { success: true, output: "stable", executionTime: 1 };
        }

        retryingChildRuns++;
        return retryingChildRuns === 1
          ? { success: false, error: "transient child failure", executionTime: 1 }
          : { success: true, output: "recovered", executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: trackingExecutor });
      const nodes: WorkflowNode[] = [{
        id: "retrying-parallel",
        config: {
          type: "parallel",
          nodes: [
            { id: "stable-child", dependsOn: [], config: { type: "step" } as any },
            { id: "retrying-child", dependsOn: [], config: { type: "step" } as any },
          ],
          retry: {
            maxAttempts: 2,
            backoff: "fixed",
            initialDelay: 0,
            maxDelay: 0,
            retryIf: () => true,
          },
        } as any,
      }];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(stableChildRuns, 1);
      assertEquals(retryingChildRuns, 2);
      assertEquals(result.context["stable-child"], "stable");
      assertEquals(result.context["retrying-child"], "recovered");
    });

    it("applies timeout and retry to a parallel node without overlapping attempts", async () => {
      let attempts = 0;
      let active = 0;
      let maxActive = 0;
      let completedChildren = 0;
      const signals: AbortSignal[] = [];
      const trackingExecutor = new MockStepExecutor(
        new Map(),
        async (_node, _context, abortSignal) => {
          attempts++;
          active++;
          maxActive = Math.max(maxActive, active);
          if (abortSignal) signals.push(abortSignal);
          if (attempts === 1) await new Promise((resolve) => setTimeout(resolve, 15));
          active--;
          return { success: true, output: attempts, executionTime: 1 };
        },
      );
      const exec = new DAGExecutor({
        stepExecutor: trackingExecutor,
        onNodeComplete: (nodeId) => {
          if (nodeId === "parallel-child") completedChildren++;
        },
      });
      const nodes: WorkflowNode[] = [{
        id: "parallel-policy",
        config: {
          type: "parallel",
          timeout: 5,
          retry: retryAfterTimeout,
          nodes: [{ id: "parallel-child", config: { type: "step" } as any }],
        } as any,
      }];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(attempts, 2);
      assertEquals(maxActive, 1);
      assertEquals(signals.length, 2);
      assertEquals(signals[0]!.aborted, true);
      assertEquals(completedChildren, 1);
      assertEquals(result.nodeStates["parallel-policy"]!.attempt, 2);
    });

    it("applies timeout and retry to a map node", async () => {
      let attempts = 0;
      const nodes: WorkflowNode[] = [{
        id: "map-policy",
        config: {
          type: "map",
          timeout: 5,
          retry: retryAfterTimeout,
          items: async () => {
            attempts++;
            if (attempts === 1) await new Promise((resolve) => setTimeout(resolve, 15));
            return [];
          },
          processor: { id: "map-child", config: { type: "step" } as any },
        } as any,
      }];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(attempts, 2);
      assertEquals(result.nodeStates["map-policy"]!.attempt, 2);
    });

    it("applies timeout and retry to a loop node", async () => {
      let attempts = 0;
      const nodes: WorkflowNode[] = [{
        id: "loop-policy",
        config: {
          type: "loop",
          timeout: 5,
          retry: retryAfterTimeout,
          maxIterations: 1,
          while: async () => {
            attempts++;
            if (attempts === 1) await new Promise((resolve) => setTimeout(resolve, 15));
            return false;
          },
          steps: [],
        } as any,
      }];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(attempts, 2);
      assertEquals(result.nodeStates["loop-policy"]!.attempt, 2);
    });

    it("applies timeout and retry to a subworkflow node", async () => {
      let attempts = 0;
      const nodes: WorkflowNode[] = [{
        id: "subworkflow-policy",
        config: {
          type: "subWorkflow",
          timeout: 5,
          retry: retryAfterTimeout,
          input: async () => {
            attempts++;
            if (attempts === 1) await new Promise((resolve) => setTimeout(resolve, 15));
            return { attempt: attempts };
          },
          workflow: { id: "policy-child-workflow", steps: [] },
        } as any,
      }];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(attempts, 2);
      assertEquals(result.nodeStates["subworkflow-policy"]!.attempt, 2);
    });

    it("does not retry a timed-out composite attempt that never settles", async () => {
      const operation = Promise.withResolvers<boolean>();
      let attempts = 0;
      const exec = new DAGExecutor({
        stepExecutor,
        cancellationGracePeriod: 5,
      });
      const nodes: WorkflowNode[] = [{
        id: "non-cooperative-branch",
        config: {
          type: "branch",
          timeout: 5,
          retry: retryAfterTimeout,
          condition: () => {
            attempts++;
            return operation.promise;
          },
          then: [],
        } as any,
      }];

      let result;
      let watchdogId: ReturnType<typeof setTimeout> | undefined;
      try {
        result = await Promise.race([
          exec.execute(nodes, createTestRun()),
          new Promise<never>((_, reject) =>
            watchdogId = setTimeout(
              () => reject(new Error("Composite execution did not stop after timeout")),
              100,
            )
          ),
        ]);
      } finally {
        if (watchdogId !== undefined) clearTimeout(watchdogId);
        operation.resolve(false);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      assertEquals(result.completed, false);
      assertEquals(result.error?.includes("timed out after 5ms"), true);
      assertEquals(attempts, 1);
      assertEquals(result.nodeStates["non-cooperative-branch"]!.attempt, 1);
    });
  });
});
