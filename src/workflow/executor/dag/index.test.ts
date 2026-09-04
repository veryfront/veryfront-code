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

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { DAGExecutor } from "./index.ts";
import type {
  Checkpoint,
  LoopExecutionContext,
  NodeState,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowRun,
} from "../../types.ts";
import { StepExecutor, type StepResult } from "../step-executor.ts";
import { CheckpointManager } from "../checkpoint-manager.ts";
import type { WorkflowBackend } from "../../backends/types.ts";
import { MemoryBackend } from "../../backends/memory.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { INVALID_ARGUMENT, VeryfrontError } from "#veryfront/errors";
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/logger.ts";
import { serializeWorkflowContext } from "../../context-serialization.ts";
import {
  loop,
  map,
  parallel,
  step,
  subWorkflow,
  waitForApproval,
  waitForEvent,
} from "../../dsl/index.ts";

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

function deepCheckpointValue(depth: number, leaf: unknown): unknown {
  let value: unknown = { leaf };
  for (let index = 0; index < depth; index++) value = { nested: value };
  return value;
}

function deepCheckpointLeaf(value: unknown, depth: number): unknown {
  let cursor = value;
  for (let index = 0; index < depth; index++) {
    cursor = (cursor as { nested: unknown }).nested;
  }
  return (cursor as { leaf: unknown }).leaf;
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

    it("executes a reverse-declared dependency chain in topological order", async () => {
      const order: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          order.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nodes: WorkflowNode[] = [
        { id: "c", dependsOn: ["b"], config: { type: "step" } as never },
        { id: "b", dependsOn: ["a"], config: { type: "step" } as never },
        { id: "a", dependsOn: [], config: { type: "step" } as never },
      ];

      await exec.execute(nodes, createTestRun());

      assertEquals(order, ["a", "b", "c"]);
    });
  });

  describe("graph admission", () => {
    it("rejects duplicate node IDs before executing either declaration", async () => {
      let executions = 0;
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), () => {
          executions++;
          return { success: true, output: {}, executionTime: 1 };
        }),
      });
      const nodes: WorkflowNode[] = [
        { id: "duplicate", dependsOn: [], config: { type: "step" } as never },
        { id: "duplicate", dependsOn: [], config: { type: "step" } as never },
      ];

      await assertRejects(
        () => exec.execute(nodes, createTestRun()),
        VeryfrontError,
        'duplicate node ID "duplicate"',
      );
      assertEquals(executions, 0);
    });

    it("rejects duplicate dependencies before executing the graph", async () => {
      let executions = 0;
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), () => {
          executions++;
          return { success: true, output: {}, executionTime: 1 };
        }),
      });
      const nodes: WorkflowNode[] = [
        { id: "root", dependsOn: [], config: { type: "step" } as never },
        {
          id: "dependent",
          dependsOn: ["root", "root"],
          config: { type: "step" } as never,
        },
      ];

      await assertRejects(
        () => exec.execute(nodes, createTestRun()),
        VeryfrontError,
        'node "dependent" contains duplicate dependency "root"',
      );
      assertEquals(executions, 0);
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
      let persistedDeletes: string[] = [];
      const deletingExecutor = new MockStepExecutor(new Map(), (_node, context) => {
        delete context.removed;
        return { success: true, output: "deleted", executionTime: 1 };
      });
      const exec = new DAGExecutor({
        stepExecutor: deletingExecutor,
        onNodeStatesChanged: ({ contextPatch }) => {
          persistedDeletes = contextPatch.delete;
        },
      });

      const result = await exec.execute(
        [{ id: "delete", config: { type: "step" } as any }],
        createTestRun({ context: { input: {}, removed: "value" } }),
      );

      assertEquals(result.completed, true);
      assertEquals(Object.hasOwn(result.context, "removed"), false);
      assertEquals(persistedDeletes, ["removed"]);
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

    it("namespaces composite descendants for every mapped item", async () => {
      const nodes = [
        map("batch", {
          items: [{ id: 1 }, { id: 2 }],
          processor: parallel("processor", [
            waitForEvent("ready", { eventName: "item.ready" }),
          ]),
        }),
      ];

      const first = await executor.execute(nodes, createTestRun());

      assertEquals(first.waiting, true);
      assertEquals(first.waitingNode, "batch_0/ready");
      assertEquals(first.nodeStates["batch_0/ready"]?.status, "running");
      assertEquals(first.nodeStates["processor/ready"], undefined);

      const resumed = await executor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          context: first.context,
          nodeStates: {
            ...first.nodeStates,
            "batch_0/ready": {
              ...first.nodeStates["batch_0/ready"]!,
              status: "completed",
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(resumed.waiting, true);
      assertEquals(resumed.waitingNode, "batch_1/ready");
      assertEquals(resumed.nodeStates["batch_1/ready"]?.status, "running");
      assertEquals(resumed.nodeStates["processor/ready"], undefined);
    });

    it("namespaces workflow-definition descendants for every mapped item", async () => {
      const processor: WorkflowDefinition = {
        id: "processor",
        steps: [
          waitForEvent("ready", { eventName: "item.ready" }),
        ],
      };
      const nodes = [
        map("batch", {
          items: [{ id: 1 }, { id: 2 }],
          processor,
        }),
      ];

      const first = await executor.execute(nodes, createTestRun());

      assertEquals(first.waiting, true);
      assertEquals(first.waitingNode, "batch_0/ready");
      assertEquals(first.nodeStates["batch_0/ready"]?.status, "running");
      assertEquals(first.nodeStates.ready, undefined);

      const resumed = await executor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          context: first.context,
          nodeStates: {
            ...first.nodeStates,
            "batch_0/ready": {
              ...first.nodeStates["batch_0/ready"]!,
              status: "completed",
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(resumed.waiting, true);
      assertEquals(resumed.waitingNode, "batch_1/ready");
      assertEquals(resumed.nodeStates["batch_1/ready"]?.status, "running");
      assertEquals(resumed.nodeStates.ready, undefined);
    });

    it("namespaces generated workflow-definition descendants for every mapped item", async () => {
      const processor: WorkflowDefinition = {
        id: "processor",
        steps: () => [
          waitForEvent("ready", { eventName: "item.ready" }),
        ],
      };
      const nodes = [
        map("batch", {
          items: [{ id: 1 }, { id: 2 }],
          processor,
        }),
      ];

      const first = await executor.execute(nodes, createTestRun());

      assertEquals(first.waiting, true);
      assertEquals(first.waitingNode, "batch_0/ready");
      assertEquals(first.nodeStates["batch_0/ready"]?.status, "running");
      assertEquals(first.nodeStates.ready, undefined);

      const resumed = await executor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          context: first.context,
          nodeStates: {
            ...first.nodeStates,
            "batch_0/ready": {
              ...first.nodeStates["batch_0/ready"]!,
              status: "completed",
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(resumed.waiting, true);
      assertEquals(resumed.waitingNode, "batch_1/ready");
      assertEquals(resumed.nodeStates["batch_1/ready"]?.status, "running");
      assertEquals(resumed.nodeStates.ready, undefined);
    });

    it("rejects generated child ids that collide with declared parent nodes", async () => {
      const nodes = [
        map("batch", {
          items: [{ id: 1 }],
          processor: waitForApproval("review", { message: "Review mapped item" }),
        }),
        waitForApproval("batch_0", { message: "Independent parent review" }),
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertStringIncludes(result.error ?? "", 'generated child id "batch_0"');
      assertEquals(result.nodeStates["batch_0"], undefined);
    });

    it("rejects mapped descendant ids that collide with declared parent nodes", async () => {
      const nodes = [
        map("batch", {
          items: [{ id: 1 }],
          processor: parallel("processor", [
            waitForEvent("ready", { eventName: "item.ready" }),
          ]),
        }),
        waitForEvent("batch_0/ready", { eventName: "independent.ready" }),
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertStringIncludes(result.error ?? "", 'generated child id "batch_0/ready"');
      assertEquals(result.nodeStates["batch_0/ready"], undefined);
    });

    it("rejects generated workflow-definition descendants that collide with parent nodes", async () => {
      const processor: WorkflowDefinition = {
        id: "processor",
        steps: () => [
          waitForEvent("ready", { eventName: "item.ready" }),
        ],
      };
      const nodes = [
        map("batch", {
          items: [{ id: 1 }],
          processor,
        }),
        waitForEvent("batch_0/ready", { eventName: "independent.ready" }),
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertStringIncludes(result.error ?? "", 'generated child id "batch_0/ready"');
      assertEquals(result.nodeStates["batch_0/ready"], undefined);
    });

    it("namespaces nested sub-workflow waits inside workflow-definition processors", async () => {
      const nodes = [
        map("batch", {
          items: [{ id: 1 }, { id: 2 }],
          processor: {
            id: "processor",
            steps: [
              subWorkflow("nested", {
                workflow: {
                  id: "nested-processor",
                  steps: [waitForEvent("ready", { eventName: "item.ready" })],
                },
              }),
            ],
          },
        }),
      ];

      const first = await executor.execute(nodes, createTestRun());

      assertEquals(first.waiting, true);
      assertEquals(first.waitingNode, "batch_0/ready");
      assertEquals(first.nodeStates["batch_0/ready"]?.status, "running");
      assertEquals(first.nodeStates.ready, undefined);

      const resumed = await executor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          context: first.context,
          nodeStates: {
            ...first.nodeStates,
            "batch_0/ready": {
              ...first.nodeStates["batch_0/ready"]!,
              status: "completed",
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(resumed.waiting, true);
      assertEquals(resumed.waitingNode, "batch_1/ready");
      assertEquals(resumed.nodeStates["batch_1/ready"]?.status, "running");
      assertEquals(resumed.nodeStates.ready, undefined);
    });
  });

  describe("loop node", () => {
    it("rejects namespaced child ids that collide with declared parent nodes", async () => {
      const nodes = [
        loop("poll", {
          while: () => true,
          maxIterations: 1,
          steps: [waitForApproval("review", { message: "Review loop iteration" })],
        }),
        waitForApproval("poll/review", { message: "Independent parent review" }),
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertStringIncludes(result.error ?? "", 'generated child id "poll/review"');
      assertEquals(result.nodeStates["poll/review"], undefined);
    });

    it("rejects nested child ids that collide with ancestor graph nodes", async () => {
      const nodes = [
        {
          ...waitForApproval("container/poll/review", { message: "Independent ancestor review" }),
          dependsOn: [],
        },
        {
          ...parallel("container", [
            loop("poll", {
              while: () => true,
              maxIterations: 1,
              steps: [waitForApproval("review", { message: "Nested loop review" })],
            }),
          ]),
          dependsOn: [],
        },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertStringIncludes(
        result.nodeStates.container?.error ?? "",
        'generated child id "container/poll/review"',
      );
    });

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
      assertEquals(
        output.exitReason,
        "maxIterations",
        "a loop that exhausts its iteration budget must report maxIterations, not condition",
      );
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
    it("rejects a sibling node that collides with loop bookkeeping", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "repeat",
          dependsOn: [],
          config: {
            type: "loop",
            maxIterations: 1,
            while: () => false,
            steps: () => [],
          } as any,
        },
        {
          id: "repeat_loop_state",
          dependsOn: ["repeat"],
          config: { type: "step" } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertStringIncludes(result.error ?? "", 'reserves internal context key "repeat_loop_state"');
      assertEquals(result.errorCause instanceof VeryfrontError, true);
      assertEquals(result.context.repeat_loop_state, undefined);
    });

    it("does not delete a pre-existing user value when no loop state was written", async () => {
      let observed: unknown;
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (_node, context) => {
          observed = context.repeat_loop_state;
          return { success: true, output: "done", executionTime: 1 };
        }),
      });
      const nodes: WorkflowNode[] = [
        loop("producer", {
          maxIterations: 1,
          while: () => false,
          steps: [],
          onComplete: () => ({ repeat_loop_state: null }),
        }),
        {
          ...loop("repeat", {
            maxIterations: 1,
            while: () => false,
            steps: () => [],
          }),
          dependsOn: ["producer"],
        },
        { id: "after", dependsOn: ["repeat"], config: { type: "step" } as any },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(observed, null);
      assertEquals(result.context.repeat_loop_state, null);
    });

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

    it("persists a suspended iteration's child states without a value JSON rewrites", async () => {
      // `WorkflowContext` is JSON-representable by contract, and the loop was
      // writing `NodeState` straight into it, timestamps included. That made
      // the framework break the rule it asks of a step: the persistence check
      // reported the loop's own `startedAt` as a user-authored lossy value,
      // naming a path no step wrote and telling the reader to return a plain
      // object from it. It also meant a resumed iteration read a string where
      // the suspending one wrote a `Date`.
      const nodes: WorkflowNode[] = [
        {
          id: "the-loop",
          dependsOn: [],
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
      const loopState = result.context["the-loop_loop_state"] as {
        iterationNodeStates: Record<string, { startedAt?: unknown }>;
      };
      const inner = loopState.iterationNodeStates["inner"];
      assertExists(inner);
      assertEquals(typeof inner.startedAt, "string");

      const warnings: LogEntry[] = [];
      const unsubscribe = __subscribeLogRecordEmitter((entry) => {
        if (entry.level === "warn" && entry.component === "workflow-context") {
          warnings.push(entry);
        }
      });
      try {
        serializeWorkflowContext(result.context);
      } finally {
        unsubscribe();
      }

      assertEquals(warnings, []);
    });

    it("runs a step declared after a wait in the same iteration once the wait resolves", async () => {
      // The loop keeps its own per-iteration snapshot in `<id>_loop_state`,
      // taken when it suspended. The approval that resumes the run patches the
      // authoritative top-level nodeStates, not that snapshot -- so without
      // reconciling the two, the loop replays its iteration with the wait
      // still "running", nothing becomes ready, and the child graph reports
      // completed with the dependent step never scheduled.
      const order: string[] = [];
      const trackingExecutor = new MockStepExecutor(new Map(), (node) => {
        order.push(node.id);
        return { success: true, output: node.id, executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: trackingExecutor });
      const nodes: WorkflowNode[] = [
        {
          id: "the-loop",
          dependsOn: [],
          config: {
            type: "loop",
            maxIterations: 1,
            while: (_context: WorkflowContext, loop: LoopExecutionContext) => loop.iteration < 1,
            steps: [
              {
                id: "inner-wait",
                dependsOn: [],
                config: { type: "wait", waitType: "approval", message: "approve?" } as any,
              },
              { id: "after-wait", dependsOn: ["inner-wait"], config: { type: "step" } as any },
            ],
          } as any,
        },
      ];

      const first = await exec.execute(nodes, createTestRun());
      assertEquals(first.waiting, true);
      assertEquals(order, []);

      // What ApprovalManager.processDecision persists before calling resume:
      // the decision lands on the top-level node state, never on the loop's
      // private snapshot.
      const second = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            ...first.nodeStates,
            "inner-wait": {
              nodeId: "inner-wait",
              status: "completed",
              output: { approved: true },
              attempt: 1,
              startedAt: new Date(),
              completedAt: new Date(),
            },
          },
          context: first.context,
        }),
      );

      assertEquals(second.completed, true);
      assertEquals(order, ["after-wait"]);
      assertEquals(second.nodeStates["after-wait"]!.status, "completed");
    });

    it("resumes a legacy static-loop decision under its persisted child IDs", async () => {
      const order: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          order.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nodes = [
        loop("the-loop", {
          maxIterations: 1,
          while: (_context, iteration) => iteration.iteration < 1,
          steps: [
            waitForApproval("inner-wait", { message: "approve?" }),
            { ...step("after-wait", { tool: "noop" }), dependsOn: ["inner-wait"] },
          ],
        }),
      ];
      const completedDecision: NodeState = {
        nodeId: "inner-wait",
        status: "completed",
        output: { approved: true },
        attempt: 1,
        startedAt: new Date(),
        completedAt: new Date(),
      };
      const run = createTestRun({
        status: "waiting",
        nodeStates: {
          "the-loop": { nodeId: "the-loop", status: "running", attempt: 1 },
          "inner-wait": completedDecision,
        },
        context: {
          input: { topic: "test" },
          "the-loop_loop_state": {
            iteration: 0,
            previousResults: [],
            iterationNodeStates: {
              "inner-wait": {
                nodeId: "inner-wait",
                status: "running",
                attempt: 1,
                startedAt: new Date().toISOString(),
              },
            },
          },
        },
      });

      const result = await exec.execute(nodes, run);

      assertEquals(result.completed, true);
      assertEquals(order, ["after-wait"]);
      assertEquals(result.nodeStates["inner-wait"], completedDecision);
      assertEquals(result.nodeStates["the-loop/inner-wait"], undefined);
    });

    it("does not treat generated map states in a current loop as legacy IDs", async () => {
      const exec = new DAGExecutor({ stepExecutor: createMockStepExecutor() });
      const nodes = [
        loop("the-loop", {
          maxIterations: 1,
          while: (_context, iteration) => iteration.iteration < 1,
          steps: [
            map("mapped-review", {
              items: [{ id: 1 }],
              processor: waitForApproval("review-template", { message: "approve?" }),
            }),
          ],
        }),
      ];

      const first = await exec.execute(nodes, createTestRun());
      assertEquals(first.waiting, true);
      assertEquals(first.waitingNode, "the-loop/mapped-review_0");

      const completedDecision: NodeState = {
        nodeId: "the-loop/mapped-review_0",
        status: "completed",
        output: { approved: true },
        attempt: 1,
        startedAt: new Date(),
        completedAt: new Date(),
      };
      const second = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            ...first.nodeStates,
            "the-loop/mapped-review_0": completedDecision,
          },
          context: first.context,
        }),
      );

      assertEquals(second.completed, true);
      assertEquals(second.waiting, false);
      assertEquals(second.nodeStates["the-loop/mapped-review_0"], completedDecision);
      assertEquals(second.nodeStates["mapped-review_0"], undefined);
    });

    it("resumes a legacy map-in-loop decision under generated local IDs", async () => {
      const exec = new DAGExecutor({ stepExecutor: createMockStepExecutor() });
      const nodes = [
        loop("the-loop", {
          maxIterations: 1,
          while: (_context, iteration) => iteration.iteration < 1,
          steps: [
            map("mapped-review", {
              items: [{ id: 1 }],
              processor: waitForApproval("review-template", { message: "approve?" }),
            }),
          ],
        }),
      ];
      const completedDecision: NodeState = {
        nodeId: "mapped-review_0",
        status: "completed",
        output: { approved: true },
        attempt: 1,
        startedAt: new Date(),
        completedAt: new Date(),
      };
      const result = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            "the-loop": { nodeId: "the-loop", status: "running", attempt: 1 },
            "mapped-review": {
              nodeId: "mapped-review",
              status: "running",
              attempt: 1,
            },
            "mapped-review_0": completedDecision,
          },
          context: {
            input: { topic: "test" },
            "the-loop_loop_state": {
              iteration: 0,
              previousResults: [],
              iterationNodeStates: {
                "mapped-review": {
                  nodeId: "mapped-review",
                  status: "running",
                  attempt: 1,
                },
                "mapped-review_0": {
                  nodeId: "mapped-review_0",
                  status: "running",
                  attempt: 1,
                },
              },
            },
          },
        }),
      );

      assertEquals(result.completed, true);
      assertEquals(result.waiting, false);
      assertEquals(result.nodeStates["mapped-review_0"], completedDecision);
      assertEquals(result.nodeStates["the-loop/mapped-review_0"], undefined);
    });

    it("reports every parked wait from a resumed iteration whose record may need recovery", async () => {
      const order: string[] = [];
      const trackingExecutor = new MockStepExecutor(new Map(), (node) => {
        order.push(node.id);
        return { success: true, output: node.id, executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: trackingExecutor });
      const nodes: WorkflowNode[] = [
        {
          id: "the-loop",
          dependsOn: [],
          config: {
            type: "loop",
            maxIterations: 1,
            while: (_context: WorkflowContext, loop: LoopExecutionContext) => loop.iteration < 1,
            steps: [
              {
                id: "inner-wait",
                dependsOn: [],
                config: { type: "wait", waitType: "approval", message: "approve?" } as any,
              },
              { id: "after-wait", dependsOn: ["inner-wait"], config: { type: "step" } as any },
            ],
          } as any,
        },
      ];

      const first = await exec.execute(nodes, createTestRun());
      assertEquals(first.waiting, true);

      const nodeStates = { ...first.nodeStates };
      delete nodeStates["inner-wait"];
      const second = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates,
          context: first.context,
        }),
      );

      assertEquals(second.completed, false, "an unfinished child graph cannot report success");
      assertEquals(second.waiting, true);
      assertEquals(second.waitingNode, "inner-wait");
      assertEquals(order, [], "a dependent of the unresolved wait must not execute");
      assertEquals(second.error, undefined);
    });

    it("removes child node states from previous dynamic loop iterations", async () => {
      const persistedDeletes: string[][] = [];
      const deletingExecutor = new DAGExecutor({
        stepExecutor,
        onNodeStatesChanged: ({ nodeStatePatch }) => {
          persistedDeletes.push(nodeStatePatch.delete);
        },
      });
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

      const result = await deletingExecutor.execute(
        nodes,
        createTestRun({
          nodeStates: {
            "the-loop/old-child": {
              nodeId: "the-loop/old-child",
              status: "completed",
              attempt: 1,
            },
          },
        }),
      );

      assertEquals(result.completed, true);
      assertEquals(result.nodeStates["the-loop/old-child"], undefined);
      assertExists(result.nodeStates["the-loop/current-child"]);
      assertEquals(result.nodeStates["the-loop/current-child"]!.status, "completed");
      assertEquals(
        persistedDeletes.some((deleted) => deleted.includes("the-loop/old-child")),
        true,
        "durable node-state patches must carry dynamic child deletions",
      );
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
      dependsOn: [],
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
      const secondWait: WorkflowNode = {
        ...nestedWait,
        id: "inner-wait-2",
        config: {
          ...nestedWait.config,
          eventName: "second.ready",
        } as any,
      };
      const nodes: WorkflowNode[] = [
        {
          id: "group",
          dependsOn: [],
          config: { type: "parallel", nodes: [nestedWait, secondWait] } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "inner-wait");
      assertEquals(result.waitingNodes?.map((wait) => wait.nodeId), [
        "inner-wait",
        "inner-wait-2",
      ]);
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

    it("reports every stalled wait with its exact runtime config", async () => {
      const firstConfig = {
        type: "wait" as const,
        waitType: "approval" as const,
        message: "First review",
        approvers: ["alice"],
      };
      const secondConfig = {
        type: "wait" as const,
        waitType: "event" as const,
        eventName: "second.ready",
        timeout: "1h",
      };
      const nodes: WorkflowNode[] = [
        { id: "first", dependsOn: [], config: firstConfig },
        { id: "second", dependsOn: [], config: secondConfig },
      ];

      const result = await executor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            first: { nodeId: "first", status: "running", attempt: 1 },
            second: { nodeId: "second", status: "running", attempt: 1 },
          },
        }),
      );

      assertEquals(result.stalledWaitNode, "first");
      assertEquals(result.stalledWaitNodes, [
        { nodeId: "first", waitConfig: firstConfig },
        { nodeId: "second", waitConfig: secondConfig },
      ]);
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

  describe("durable node-state boundaries", () => {
    it("publishes root nodes as running before side effects and settled afterward", async () => {
      const observations: Array<Record<string, NodeState>> = [];
      const executed: string[] = [];
      const trackingExecutor = new MockStepExecutor(new Map(), (node) => {
        const latest = observations.at(-1);
        assertExists(latest);
        assertEquals(latest.outer?.status, "running");
        executed.push(node.id);
        return { success: true, output: node.id, executionTime: 1 };
      });
      const exec = new DAGExecutor({
        stepExecutor: trackingExecutor,
        onNodeStatesChanged: ({ nodeStates }) => {
          observations.push(structuredClone(nodeStates));
        },
      });
      const nodes: WorkflowNode[] = [
        {
          id: "outer",
          dependsOn: [],
          config: {
            type: "parallel",
            nodes: [{ id: "inner", dependsOn: [], config: { type: "step" } }],
          } as any,
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(executed, ["inner"]);
      assertEquals(observations.length, 2);
      assertEquals(Object.keys(observations[0]!).sort(), ["outer"]);
      assertEquals(Object.keys(observations[1]!).sort(), ["inner", "outer"]);
      assertEquals(observations[0]!.outer?.status, "running");
      assertEquals(observations[1]!.outer?.status, "completed");
      assertEquals(observations[1]!.outer?.attempt, observations[0]!.outer?.attempt);
      assertEquals(observations[1]!.outer?.startedAt, observations[0]!.outer?.startedAt);
    });

    it("names the entering batch in currentNodes and drops settled nodes from it", async () => {
      const boundaries: string[][] = [];
      const exec = new DAGExecutor({
        stepExecutor: createMockStepExecutor(),
        onNodeStatesChanged: ({ currentNodes }) => {
          boundaries.push([...currentNodes]);
        },
      });
      const nodes: WorkflowNode[] = [
        { id: "first", dependsOn: [], config: { type: "step" } as any },
        { id: "second", dependsOn: ["first"], config: { type: "step" } as any },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(boundaries, [["first"], [], ["second"], []]);
    });

    it("keeps a parked wait in currentNodes when its batch settles", async () => {
      const boundaries: string[][] = [];
      const exec = new DAGExecutor({
        stepExecutor: createMockStepExecutor(),
        onNodeStatesChanged: ({ currentNodes }) => {
          boundaries.push([...currentNodes]);
        },
      });
      const nodes: WorkflowNode[] = [
        { id: "work", dependsOn: [], config: { type: "step" } as any },
        {
          id: "gate",
          dependsOn: [],
          config: { type: "wait", waitType: "approval", message: "approve" } as any,
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "gate");
      assertEquals(boundaries, [["work", "gate"], ["gate"]]);
    });

    it("keeps a composite enclosing a parked wait in currentNodes when it settles", async () => {
      const boundaries: string[][] = [];
      const exec = new DAGExecutor({
        stepExecutor: createMockStepExecutor(),
        onNodeStatesChanged: ({ currentNodes }) => {
          boundaries.push([...currentNodes]);
        },
      });
      const nodes: WorkflowNode[] = [
        {
          id: "par",
          dependsOn: [],
          config: {
            type: "parallel",
            nodes: [
              { id: "work", dependsOn: [], config: { type: "step" } },
              {
                id: "gate",
                dependsOn: [],
                config: { type: "wait", waitType: "approval", message: "approve" },
              },
            ],
          } as any,
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "gate");
      assertEquals(boundaries, [["par"], ["par"]]);
    });

    it("keeps a failed node in currentNodes when its batch settles", async () => {
      const boundaries: Array<{
        currentNodes: string[];
        nodeStates: Record<string, NodeState>;
      }> = [];
      const exec = new DAGExecutor({
        stepExecutor: createMockStepExecutor(
          new Map([
            ["ok", { success: true, output: "ok" }],
            ["boom", { success: false, error: "step exploded" }],
          ]),
        ),
        onNodeStatesChanged: ({ currentNodes, nodeStates }) => {
          boundaries.push({
            currentNodes: [...currentNodes],
            nodeStates: structuredClone(nodeStates),
          });
        },
      });
      const nodes: WorkflowNode[] = [
        { id: "ok", dependsOn: [], config: { type: "step" } as any },
        { id: "boom", dependsOn: [], config: { type: "step" } as any },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertEquals(result.error, 'Node "boom" failed: step exploded');
      assertEquals(boundaries.map(({ currentNodes }) => currentNodes), [["ok", "boom"], ["boom"]]);
      assertEquals(boundaries[1]!.nodeStates.ok?.status, "completed");
      assertEquals(boundaries[1]!.nodeStates.boom?.status, "failed");
    });

    it("keeps every failed node and parked wait of a failing batch in currentNodes", async () => {
      const boundaries: string[][] = [];
      const exec = new DAGExecutor({
        stepExecutor: createMockStepExecutor(
          new Map([
            ["ok", { success: true, output: "ok" }],
            ["boom", { success: false, error: "first failure" }],
            ["bang", { success: false, error: "second failure" }],
          ]),
        ),
        onNodeStatesChanged: ({ currentNodes }) => {
          boundaries.push([...currentNodes]);
        },
      });
      const nodes: WorkflowNode[] = [
        { id: "ok", dependsOn: [], config: { type: "step" } as any },
        { id: "boom", dependsOn: [], config: { type: "step" } as any },
        {
          id: "gate",
          dependsOn: [],
          config: { type: "wait", waitType: "approval", message: "approve" } as any,
        },
        { id: "bang", dependsOn: [], config: { type: "step" } as any },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertEquals(result.error, 'Node "boom" failed: first failure');
      assertEquals(boundaries, [["ok", "boom", "gate", "bang"], ["boom", "gate", "bang"]]);
    });

    it("publishes completed node state with the context produced by that node", async () => {
      const boundaries: Array<{
        nodeStates: Record<string, NodeState>;
        context?: WorkflowContext;
      }> = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(
          new Map([
            ["first", { success: true, output: "first-output" }],
            ["second", { success: true, output: "second-output" }],
          ]),
        ),
        onNodeStatesChanged: (input) => {
          boundaries.push(structuredClone(input));
        },
      });
      const nodes: WorkflowNode[] = [
        { id: "first", dependsOn: [], config: { type: "step" } as any },
        { id: "second", dependsOn: ["first"], config: { type: "step" } as any },
      ];

      await exec.execute(nodes, createTestRun());

      const firstSettled = boundaries.find((boundary) =>
        boundary.nodeStates.first?.status === "completed" &&
        boundary.nodeStates.second === undefined
      );
      assertExists(firstSettled);
      assertEquals(firstSettled.context?.first, "first-output");
      const secondRunning = boundaries.find((boundary) =>
        boundary.nodeStates.second?.status === "running"
      );
      assertEquals(secondRunning?.context?.first, "first-output");
    });

    it("resumes dependents from a completed boundary with its matching context", async () => {
      const nodes: WorkflowNode[] = [
        { id: "first", dependsOn: [], config: { type: "step" } as any },
        { id: "second", dependsOn: ["first"], config: { type: "step" } as any },
      ];
      let persisted: {
        nodeStates: Record<string, NodeState>;
        context: WorkflowContext;
      } | undefined;
      let firstExecutions = 0;
      const crashing = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          if (node.id === "first") firstExecutions++;
          return { success: true, output: `${node.id}-output`, executionTime: 1 };
        }),
        onNodeStatesChanged: (input) => {
          if (
            input.nodeStates.first?.status === "completed" &&
            input.nodeStates.second === undefined
          ) {
            persisted = structuredClone(input);
            throw new Error("simulated worker crash after durable boundary");
          }
        },
      });

      await assertRejects(
        () => crashing.execute(nodes, createTestRun()),
        Error,
        "simulated worker crash",
      );
      assertExists(persisted);
      assertEquals(persisted.context.first, "first-output");

      let secondInput: unknown;
      const resumed = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node, context) => {
          if (node.id === "first") firstExecutions++;
          if (node.id === "second") secondInput = context.first;
          return { success: true, output: `${node.id}-output`, executionTime: 1 };
        }),
      });
      const result = await resumed.execute(
        nodes,
        createTestRun({
          nodeStates: persisted.nodeStates,
          context: persisted.context,
        }),
      );

      assertEquals(result.completed, true);
      assertEquals(firstExecutions, 1);
      assertEquals(secondInput, "first-output");
    });

    it("does not execute a side effect when the running boundary loses ownership", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
        onNodeStatesChanged: () => false,
      });

      await assertRejects(
        () =>
          exec.execute(
            [{ id: "side-effect", dependsOn: [], config: { type: "step" } as any }],
            createTestRun(),
          ),
        Error,
        "execution ownership changed",
      );
      assertEquals(executed, []);
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
        onNodeStatesChanged: ({ nodeStates }) => {
          // The admission boundary, where the recovered node is recorded
          // running with its raised attempt; the settle boundary records it
          // completed and is not a recovery charge.
          const second = nodeStates["second"];
          if (second?.status === "running") persistedAttempts.push(second.attempt);
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
      // Recovery state is persisted by the batch-entry boundary write, the one
      // durable admission commit. When that fence is refused, the recovered
      // node must not execute.
      const executed: string[] = [];
      const publishes: Array<Record<string, NodeState>> = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
        onNodeStatesChanged: ({ nodeStates }) => {
          publishes.push(structuredClone(nodeStates));
          return false;
        },
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
      assertEquals(publishes.length, 1);
      assertEquals(
        publishes[0]!["side-effect"]!.attempt,
        2,
        "the raised attempt must exist only in the write the fence refused",
      );
    });

    it("charges a recovered composite child durably before it executes", async () => {
      // A recovered child of a parallel composite runs against a synthetic run
      // that persists nothing, so its raised attempt reached the backend only
      // after the child side effect had already run -- repeated worker deaths
      // re-ran the child past its retry budget (veryfront-issue-inbox#754).
      const order: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          order.push(`exec:${node.id}`);
          return { success: true, output: node.id, executionTime: 1 };
        }),
        onChildRecoveryAdmitted: ({ runId, nodeStatePatch }) => {
          const keys = Object.keys(nodeStatePatch.set).sort();
          const attempt = nodeStatePatch.set["outer/inner"]?.attempt;
          order.push(`admit:${keys.join(",")}@${attempt}:${runId}`);
        },
      });
      const nodes = [
        parallel("outer", [step("inner", { tool: "noop" })]),
      ];
      const run = createTestRun({
        nodeStates: {
          outer: { nodeId: "outer", status: "running", attempt: 1, startedAt: new Date() },
          "outer/inner": {
            nodeId: "outer/inner",
            status: "running",
            attempt: 1,
            startedAt: new Date(),
          },
        },
      });

      const result = await exec.execute(nodes, run);

      assertEquals(result.completed, true);
      // The merge patch carries only the recovered child, charged to the root
      // run id, and lands before the child executes.
      assertEquals(order, ["admit:outer/inner@2:test-run", "exec:outer/inner"]);
    });

    it("does not execute a recovered child the merge fence refused", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
        onChildRecoveryAdmitted: () => false,
      });
      const nodes = [
        parallel("outer", [step("inner", { tool: "noop" })]),
      ];
      const run = createTestRun({
        nodeStates: {
          outer: { nodeId: "outer", status: "running", attempt: 1, startedAt: new Date() },
          "outer/inner": {
            nodeId: "outer/inner",
            status: "running",
            attempt: 1,
            startedAt: new Date(),
          },
        },
      });

      await assertRejects(() => exec.execute(nodes, run), Error, "ownership changed");
      assertEquals(executed, []);
    });

    it("charges a recovered map child durably before it executes", async () => {
      // Map children live in the root node-state map like parallel children
      // (the strategy passes the parent map through and merges back), so a
      // recovered map child must be durably charged at admission too.
      const order: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          order.push(`exec:${node.id}`);
          return { success: true, output: node.id, executionTime: 1 };
        }),
        onChildRecoveryAdmitted: ({ nodeStatePatch }) => {
          order.push(`admit:${Object.keys(nodeStatePatch.set).sort().join(",")}`);
        },
      });
      const nodes = [
        map("mapper", {
          items: [{ id: 1 }],
          processor: step("inner", { tool: "noop" }),
        }),
      ];
      const run = createTestRun({
        nodeStates: {
          mapper: { nodeId: "mapper", status: "running", attempt: 1, startedAt: new Date() },
          mapper_0: { nodeId: "mapper_0", status: "running", attempt: 1, startedAt: new Date() },
        },
      });

      const result = await exec.execute(nodes, run);

      assertEquals(result.completed, true);
      assertEquals(order, ["admit:mapper_0", "exec:mapper_0"]);
    });

    it("stops instead of failing the composite when a child checkpoint is fenced out", async () => {
      // A fenced-out checkpoint append means another worker owns the run row.
      // Inside a composite that must abort the execution, not fall through to
      // composite retry or record a failed state the new owner would read.
      const executedNodes: string[] = [];
      const backend = {
        saveCheckpoint: () => Promise.resolve(),
        getLatestCheckpoint: () => Promise.resolve(null),
      } as unknown as WorkflowBackend;
      const fencedOut = new (class extends CheckpointManager {
        override save(): Promise<boolean> {
          return Promise.resolve(false);
        }
      })({ backend });
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executedNodes.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
        checkpointManager: fencedOut,
      });
      const inner = step("inner", { tool: "noop" });
      (inner.config as { checkpoint?: boolean }).checkpoint = true;
      const nodes = [parallel("outer", [inner])];
      const run = createTestRun();

      const error = await assertRejects(
        () =>
          exec.execute(nodes, run, undefined, undefined, {
            runId: "test-run",
            workerId: "run-execution:worker-a",
          }),
        Error,
        "ownership changed",
      );

      assertEquals(executedNodes, ["outer/inner"]);
      assertEquals(
        (error as { context?: { ownershipLost?: boolean } }).context?.ownershipLost,
        true,
      );
    });

    it("stops when a composite child throws an ownership-loss error from another module copy", async () => {
      const { VeryfrontError: DuplicateVeryfrontError } = await import(
        "../../../errors/types.ts?ownership-loss-regression"
      );
      const ownershipLost = new DuplicateVeryfrontError("ownership changed", {
        slug: "orchestration-error",
        category: "AGENT",
        status: 500,
        title: "Multi-agent orchestration error",
        context: { ownershipLost: true },
      });
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          if (node.id === "outer/inner") throw ownershipLost;
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nodes = [parallel("outer", [step("inner", { tool: "noop" })])];

      const error = await assertRejects(
        () => exec.execute(nodes, createTestRun()),
        Error,
        "ownership changed",
      );

      assertEquals(error, ownershipLost);
    });

    it("does not merge-write recovery for loop iteration children", async () => {
      // A loop iteration's children live in the loop node's private iteration
      // snapshot, not the root node-state map. Merge-writing their keys into
      // the root map would strand stale entries no later publish deletes.
      const admitted: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => ({
          success: true,
          output: node.id,
          executionTime: 1,
        })),
        onChildRecoveryAdmitted: ({ nodeStatePatch }) => {
          admitted.push(...Object.keys(nodeStatePatch.set));
        },
      });
      const nodes = [
        loop("the-loop", {
          maxIterations: 1,
          while: (_context, iteration) => iteration.iteration < 1,
          steps: [step("inner", { tool: "noop" })],
        }),
      ];
      const run = createTestRun({
        nodeStates: {
          "the-loop": { nodeId: "the-loop", status: "running", attempt: 1, startedAt: new Date() },
        },
        context: {
          input: { topic: "test" },
          "the-loop_loop_state": {
            iteration: 0,
            previousResults: [],
            iterationNodeStates: {
              inner: {
                nodeId: "inner",
                status: "running",
                attempt: 1,
                startedAt: new Date().toISOString(),
              },
            },
          },
        },
      });

      const result = await exec.execute(nodes, run);

      assertEquals(result.completed, true);
      assertEquals(admitted, []);
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

    it("persists only the run's own node states, never a child graph's", async () => {
      // The hook is wired to a fenced write that replaces the run's whole
      // node-state map. A loop iteration's child run carries only that
      // iteration's children, so persisting one under the real run id would
      // erase every top-level node -- and a workflow whose completed nodes read
      // as pending re-runs from the start, duplicating exactly the side effects
      // this recovery path exists to protect.
      const persisted: Array<{ runId: string; keys: string[] }> = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => ({
          success: true,
          output: node.id,
          executionTime: 1,
        })),
        onNodeStatesChanged: ({ runId, nodeStates }) => {
          persisted.push({ runId, keys: Object.keys(nodeStates).sort() });
        },
      });

      const nodes: WorkflowNode[] = [
        { id: "before", dependsOn: [], config: { type: "step" } as any },
        {
          id: "loop",
          dependsOn: ["before"],
          config: {
            type: "loop",
            maxIterations: 2,
            while: (_context: WorkflowContext, loop: { iteration: number }) => loop.iteration < 1,
            steps: [
              {
                id: "inner-parallel",
                dependsOn: [],
                config: {
                  type: "parallel",
                  nodes: [{ id: "leaf", dependsOn: [], config: { type: "step" } }],
                },
              },
            ],
          } as any,
        },
      ];

      // A worker died inside the loop: the loop node and the composite in its
      // in-flight iteration are both recorded running, the iteration's states
      // living in their own keyspace under the loop's persisted state.
      const run = createTestRun({
        status: "running",
        nodeStates: {
          before: { nodeId: "before", status: "completed", attempt: 1 },
          loop: { nodeId: "loop", status: "running", attempt: 1, startedAt: new Date() },
        },
        context: {
          input: { topic: "test" },
          loop_loop_state: {
            iteration: 0,
            previousResults: [],
            iterationNodeStates: {
              "inner-parallel": {
                nodeId: "inner-parallel",
                status: "running",
                attempt: 1,
                startedAt: new Date(),
              },
            },
          },
        },
      });

      await exec.execute(nodes, run);

      // The recovery admission commit carries the run's own top-level map,
      // not the in-flight iteration's keyspace.
      assertEquals(persisted[0], { runId: "test-run", keys: ["before", "loop"] });
      for (const boundary of persisted) {
        assertEquals(boundary.runId, "test-run");
        assertEquals(
          boundary.keys.includes("before"),
          true,
          "a published map must never drop the run's completed top-level nodes",
        );
      }
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

    it("bounds the node details reported for a stuck graph", async () => {
      const blockedNodes: WorkflowNode[] = Array.from({ length: 11 }, (_, index) => ({
        id: `blocked-${index}`,
        dependsOn: ["approve"],
        config: { type: "step" } as any,
      }));
      const nodes: WorkflowNode[] = [
        {
          id: "approve",
          dependsOn: [],
          config: { type: "wait", waitType: "approval", message: "m" } as any,
        },
        ...blockedNodes,
      ];
      const exec = new DAGExecutor({ stepExecutor: new MockStepExecutor() });
      const result = await exec.execute(
        nodes,
        createTestRun({
          status: "running",
          nodeStates: {
            approve: {
              nodeId: "approve",
              status: "running",
              attempt: 1,
              startedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(result.completed, false);
      assertStringIncludes(result.error ?? "", '"approve" (running)');
      assertStringIncludes(result.error ?? "", '"blocked-8" (pending)');
      assertEquals(
        (result.error ?? "").includes('"blocked-9" (pending)'),
        false,
        "the diagnostic must stop after ten node details",
      );
      assertStringIncludes(result.error ?? "", "and 2 more");
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

    it("spends no recovery on a queued node that a parked wait stops from starting", async () => {
      // Queueing a node for recovery is not starting it. At maxConcurrency 1
      // the wait ahead of it in the queue parks and ends the pass, so the
      // interrupted step never runs. Charging it there burns its only recovery
      // on work that never happened, and the next pass fails the whole run as
      // out of budget even though the step still has not executed once.
      const executed: string[] = [];
      const persistedAttempts: number[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
        onNodeStatesChanged: ({ nodeStates }) => {
          const state = nodeStates["side-effect"];
          if (state?.status === "running" && state.attempt > 1) {
            persistedAttempts.push(state.attempt);
          }
        },
        maxConcurrency: 1,
      });
      const nodes: WorkflowNode[] = [
        {
          id: "gate",
          dependsOn: [],
          config: { type: "wait", waitType: "approval", message: "m" } as any,
        },
        { id: "side-effect", dependsOn: [], config: { type: "step" } as any },
      ];

      // Crash-recovery pass: the worker died with the step in flight, and the
      // wait has not been raised yet.
      const first = await exec.execute(
        nodes,
        createTestRun({
          status: "running",
          nodeStates: {
            "side-effect": {
              nodeId: "side-effect",
              status: "running",
              attempt: 1,
              startedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(first.waiting, true);
      assertEquals(executed, []);
      assertEquals(persistedAttempts, []);
      // #715's invariant still holds: the pass parks rather than reporting
      // completion, and the unexecuted step is still named as running.
      assertEquals(first.completed, false);
      assertEquals(first.nodeStates["side-effect"]!.status, "running");
      assertEquals(
        first.nodeStates["side-effect"]!.attempt,
        1,
        "a queued node that never started must keep its recovery",
      );

      // Approval-resume pass: nothing is ahead of the step now, so it runs.
      const second = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            ...first.nodeStates,
            gate: { ...first.nodeStates["gate"]!, status: "completed", completedAt: new Date() },
          },
          context: first.context,
        }),
      );

      assertEquals(second.error, undefined);
      assertEquals(second.completed, true);
      assertEquals(executed, ["side-effect"]);
      assertEquals(persistedAttempts, [2]);
      assertEquals(second.nodeStates["side-effect"]!.status, "completed");
    });

    it("spends exactly one recovery on a node that does start, and bounds the next death", async () => {
      // The other direction. Deferring the charge must not stop charging it: a
      // node admitted to a batch has its raised attempt persisted before it
      // executes, so a worker that dies again resumes out of budget instead of
      // re-running the side effect forever.
      const executed: string[] = [];
      let persisted: Record<string, NodeState> | undefined;
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
        onNodeStatesChanged: ({ nodeStates }) => {
          if (nodeStates["side-effect"]?.status === "running") {
            persisted = structuredClone(nodeStates);
          }
        },
      });
      const nodes: WorkflowNode[] = [
        { id: "side-effect", dependsOn: [], config: { type: "step" } as any },
      ];
      const interrupted = (attempt: number): Record<string, NodeState> => ({
        "side-effect": {
          nodeId: "side-effect",
          status: "running",
          attempt,
          startedAt: new Date(),
        },
      });

      const first = await exec.execute(
        nodes,
        createTestRun({ status: "running", nodeStates: interrupted(1) }),
      );

      assertEquals(first.completed, true);
      assertEquals(executed, ["side-effect"]);
      // The durable write a second worker death resumes from: the node is
      // still recorded running (nothing terminal was ever written for it) and
      // its attempt is already raised.
      assertEquals(persisted?.["side-effect"]?.status, "running");
      assertEquals(persisted?.["side-effect"]?.attempt, 2);

      // Resume from that write verbatim, exactly as a second worker would.
      const second = await exec.execute(
        nodes,
        createTestRun({ status: "running", nodeStates: persisted! }),
      );

      assertEquals(second.completed, false);
      assertEquals(
        executed,
        ["side-effect"],
        "the recovery budget must not stretch to a second run",
      );
      assertStringIncludes(second.error ?? "", "retry budget exhausted");
    });

    it("still spends only one recovery when the interrupted state has no startedAt", async () => {
      // `startedAt` is optional on NodeState, and `WorkflowBackend` is an
      // exported interface a project can implement, so a backend that does not
      // round-trip the timestamp hands back a running node without it. The
      // recovery budget must come from `attempt` alone: inferring "never
      // started" from a missing timestamp gives such a node a second recovery
      // and duplicates its side effect.
      const executed: string[] = [];
      let lastDurable: Record<string, NodeState> | undefined;
      let atExecution: Record<string, NodeState> | undefined;
      const build = () =>
        new DAGExecutor({
          stepExecutor: new MockStepExecutor(new Map(), (node) => {
            executed.push(node.id);
            atExecution = lastDurable;
            return { success: true, output: node.id, executionTime: 1 };
          }),
          onNodeStatesChanged: ({ nodeStates }) => {
            lastDurable = structuredClone(nodeStates);
          },
        });
      const nodes: WorkflowNode[] = [
        { id: "side-effect", dependsOn: [], config: { type: "step" } as any },
      ];

      const first = await build().execute(
        nodes,
        createTestRun({
          status: "running",
          nodeStates: {
            "side-effect": { nodeId: "side-effect", status: "running", attempt: 1 },
          },
        }),
      );
      assertEquals(first.completed, true);
      assertEquals(executed, ["side-effect"], "the one recovery runs it once");

      // Resume from the durable write in force while it was executing, exactly
      // as a second worker would after this one died.
      const second = await build().execute(
        nodes,
        createTestRun({ status: "running", nodeStates: atExecution! }),
      );
      assertEquals(
        executed,
        ["side-effect"],
        "a missing startedAt must not buy a second recovery",
      );
      assertEquals(second.completed, false);
      assertStringIncludes(second.error ?? "", "retry budget exhausted");
    });

    it("bounds a child graph's recovery too, not just the top-level run", async () => {
      // A composite runs its children against a synthetic run, and only the
      // top-level run persists. The budget check must not ride on that: a
      // child node out of budget has to be refused in the child graph, where
      // nothing is written, or the composite re-runs a side effect that
      // already exhausted its recoveries.
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nodes: WorkflowNode[] = [
        {
          id: "outer",
          dependsOn: [],
          config: {
            type: "parallel",
            nodes: [{ id: "inner", dependsOn: [], config: { type: "step" } }],
          } as any,
        },
      ];

      const result = await exec.execute(
        nodes,
        createTestRun({
          status: "running",
          nodeStates: {
            inner: {
              nodeId: "inner",
              status: "running",
              attempt: 2,
              startedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(executed, [], "an out-of-budget child must not be re-run");
      assertEquals(result.completed, false);
      assertStringIncludes(result.error ?? "", "retry budget exhausted");
    });
  });

  describe("wait resume inside a nested composite", () => {
    /**
     * A composite runs its children against a synthetic run, so the child graph
     * cannot read the real run's status. Resuming an approval used to look, one
     * level down, exactly like recovering from a dead worker: the enclosing
     * composite was re-entered off the recovery budget that exists for crashes.
     *
     * It only became visible once a re-entered sibling was queued behind the
     * concurrency limit. Executing the node overwrites the bumped attempt;
     * a node that never gets its turn keeps it, so ordinary approvals raised
     * the recorded attempt until the budget was declared spent.
     */
    const waitingParallel = (id: string): WorkflowNode => ({
      id,
      dependsOn: [],
      config: {
        type: "parallel",
        nodes: [
          {
            id: `${id}-wait`,
            dependsOn: [],
            config: { type: "wait", waitType: "approval", message: "m" } as any,
          },
        ],
      } as any,
    });

    const approve = (
      states: Record<string, NodeState>,
      waitId: string,
    ): Record<string, NodeState> => ({
      ...states,
      [waitId]: { ...states[waitId]!, status: "completed", completedAt: new Date() },
    });

    it("spends no recovery budget when an approval resumes a nested composite", async () => {
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(),
        // Forces the second inner composite to queue behind the first.
        maxConcurrency: 1,
      });
      const nodes: WorkflowNode[] = [
        {
          id: "outer",
          dependsOn: [],
          config: {
            type: "parallel",
            nodes: [waitingParallel("inner-a"), waitingParallel("inner-b")],
          } as any,
        },
      ];

      const first = await exec.execute(nodes, createTestRun());
      assertEquals(first.waiting, true);
      assertEquals(first.waitingNode, "inner-a-wait");

      // Approving the first wait re-enters "outer", which re-enters "inner-a"
      // and reaches "inner-b" -- which parks on its own approval.
      const second = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: approve(first.nodeStates, "inner-a-wait"),
          context: first.context,
        }),
      );
      assertEquals(second.waiting, true);
      assertEquals(second.waitingNode, "inner-b-wait");
      assertEquals(
        second.nodeStates["inner-a"]!.attempt,
        1,
        "an approval resume must not consume the recovery budget of a nested composite",
      );

      // Approving the second wait must finish the run. Nothing was ever
      // interrupted, so nothing may be reported as interrupted.
      const third = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: approve(second.nodeStates, "inner-b-wait"),
          context: second.context,
        }),
      );
      assertEquals(third.error, undefined);
      assertEquals(third.completed, true);
    });

    it("recovers an interrupted step on a wait resume instead of skipping it", async () => {
      // Parked and interrupted are not exclusive. A worker can die with a step
      // in flight while a sibling wait is parked, leaving the run "waiting"
      // with that step still recorded running. Treating the whole resume as
      // "nothing to recover" strands it -- and with nothing left ready the
      // graph reports completion, so the workflow finishes having silently
      // skipped a side effect.
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
          config: { type: "wait", waitType: "approval", message: "m" } as any,
        },
        { id: "side-effect", dependsOn: [], config: { type: "step" } as any },
      ];

      const result = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            gate: { nodeId: "gate", status: "completed", attempt: 1, completedAt: new Date() },
            "side-effect": {
              nodeId: "side-effect",
              status: "running",
              attempt: 1,
              startedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(result.completed, true);
      assertEquals(executed, ["side-effect"]);
      assertEquals(result.nodeStates["side-effect"]!.status, "completed");
    });

    it("never reports completion while an interrupted step is out of budget", async () => {
      // The same shape once the budget is gone. Failing loudly is the only
      // honest answer; reporting success would drop the step on the floor.
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
          config: { type: "wait", waitType: "approval", message: "m" } as any,
        },
        { id: "side-effect", dependsOn: [], config: { type: "step" } as any },
      ];

      const result = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            gate: { nodeId: "gate", status: "completed", attempt: 1, completedAt: new Date() },
            "side-effect": {
              nodeId: "side-effect",
              status: "running",
              attempt: 2,
              startedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(result.completed, false);
      assertEquals(executed, []);
      assertStringIncludes(result.error ?? "", "retry budget exhausted");
    });

    it("still recovers a nested node when the worker died mid-run", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nodes: WorkflowNode[] = [
        {
          id: "outer",
          dependsOn: [],
          config: {
            type: "parallel",
            nodes: [{ id: "child", dependsOn: [], config: { type: "step" } as any }],
          } as any,
        },
      ];

      // A dead worker leaves a "running" run, not a "waiting" one.
      const result = await exec.execute(
        nodes,
        createTestRun({
          status: "running",
          nodeStates: {
            outer: { nodeId: "outer", status: "running", attempt: 1, startedAt: new Date() },
            child: { nodeId: "child", status: "running", attempt: 1, startedAt: new Date() },
          },
        }),
      );

      assertEquals(result.completed, true);
      assertEquals(executed, ["child"]);
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
    it("rejects child-id collisions before concurrent sibling sub-workflows start", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: { result: node.id }, executionTime: 1 };
        }),
      });
      const nodes: WorkflowNode[] = [
        {
          id: "release-1",
          dependsOn: [],
          config: {
            type: "subWorkflow",
            workflow: {
              id: "release-wf-1",
              steps: [{ id: "review", dependsOn: [], config: { type: "step" } as any }],
            },
          } as any,
        },
        {
          id: "release-2",
          dependsOn: [],
          config: {
            type: "subWorkflow",
            workflow: {
              id: "release-wf-2",
              steps: [waitForApproval("review", { message: "Approve the release" })],
            },
          } as any,
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertStringIncludes(result.error ?? "", 'both declare child id "review"');
      assertEquals(executed, []);
      assertEquals(result.waiting, false);
      // The refusal is returned rather than thrown so earlier batches' states
      // survive, but it still classifies under the slug the ancestor-collision
      // throw uses.
      assertEquals(result.errorCause?.slug, INVALID_ARGUMENT.slug);
    });

    it("does not reject a sibling collision when one sub-workflow is skipped", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const release = (id: string, skip: boolean): WorkflowNode => ({
        id,
        dependsOn: [],
        config: {
          type: "subWorkflow",
          skip: () => skip,
          workflow: {
            id: `${id}-wf`,
            steps: [{ id: "review", dependsOn: [], config: { type: "step" } as any }],
          },
        } as any,
      });

      const result = await exec.execute(
        [release("skipped-release", true), release("active-release", false)],
        createTestRun(),
      );

      assertEquals(result.error, undefined);
      assertEquals(result.completed, true);
      assertEquals(result.nodeStates["skipped-release"]?.status, "skipped");
      assertEquals(executed, ["review"]);
    });

    it("admits callback-defined sibling sub-workflows one at a time", async () => {
      let definitionsResolved = 0;
      const dynamicWorkflow = (id: string): WorkflowDefinition => ({
        id,
        steps: () => {
          definitionsResolved++;
          return [waitForApproval("review", { message: "Approve the release" })];
        },
      });
      const nodes: WorkflowNode[] = [
        {
          ...subWorkflow("release-1", { workflow: dynamicWorkflow("release-wf-1") }),
          dependsOn: [],
        },
        {
          ...subWorkflow("release-2", { workflow: dynamicWorkflow("release-wf-2") }),
          dependsOn: [],
        },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "review");
      assertEquals(definitionsResolved, 1);
      assertEquals(result.nodeStates["release-2"], undefined);
    });

    it("resumes an active sub-workflow before a queued sibling reuses its child id", async () => {
      const serialExecutor = new DAGExecutor({
        stepExecutor: new MockStepExecutor(),
        maxConcurrency: 1,
      });
      const release = (id: string): WorkflowNode => ({
        ...subWorkflow(id, {
          workflow: {
            id: `${id}-workflow`,
            steps: [waitForApproval("review", { message: `Approve ${id}` })],
          },
        }),
        dependsOn: [],
      });
      const nodes = [release("release-1"), release("release-2")];

      const first = await serialExecutor.execute(nodes, createTestRun());
      assertEquals(first.waiting, true);
      assertEquals(first.nodeStates["release-1"]?.status, "running");
      assertEquals(first.nodeStates["release-2"], undefined);

      const second = await serialExecutor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            ...first.nodeStates,
            review: {
              ...first.nodeStates.review!,
              status: "completed",
              completedAt: new Date(),
            },
          },
        }),
      );
      assertEquals(second.waiting, true);
      assertEquals(second.nodeStates["release-1"]?.status, "completed");
      assertEquals(second.nodeStates["release-2"]?.status, "running");

      const third = await serialExecutor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            ...second.nodeStates,
            review: {
              ...second.nodeStates.review!,
              status: "completed",
              completedAt: new Date(),
            },
          },
        }),
      );
      assertEquals(third.completed, true);
      assertEquals(third.nodeStates["release-1"]?.status, "completed");
      assertEquals(third.nodeStates["release-2"]?.status, "completed");
    });

    it("preserves a resumed parallel decision after an earlier branch reused its child id", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "choose",
          dependsOn: [],
          config: {
            type: "branch",
            condition: () => true,
            then: [waitForApproval("choose/then/review", { message: "Branch review" })],
            else: [],
          } as any,
        },
        {
          ...parallel("choose/then", [
            waitForApproval("review", { message: "Parallel review" }),
          ]),
          dependsOn: ["choose"],
        },
      ];

      const first = await executor.execute(nodes, createTestRun());
      const second = await executor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            ...first.nodeStates,
            "choose/then/review": {
              ...first.nodeStates["choose/then/review"]!,
              status: "completed",
              completedAt: new Date(),
            },
          },
        }),
      );
      assertEquals(second.nodeStates.choose?.status, "completed");
      assertEquals(second.nodeStates["choose/then"]?.status, "running");

      const resumed = await executor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            ...second.nodeStates,
            "choose/then/review": {
              ...second.nodeStates["choose/then/review"]!,
              status: "completed",
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(resumed.completed, true);
      assertEquals(resumed.waiting, false);
      assertEquals(resumed.nodeStates["choose/then"]?.status, "completed");
    });

    it("does not import an unstarted historical sibling into a resumed parallel", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const priorChildren = [
        { id: "group/work", config: { type: "step" } as any },
        ...["group/a", "group/b"].map((id) => waitForApproval(id, { message: `Prior ${id}` })),
      ];
      const nodes: WorkflowNode[] = [
        {
          id: "prior",
          dependsOn: [],
          config: {
            type: "branch",
            condition: () => true,
            then: priorChildren,
            else: [],
          } as any,
        },
        {
          ...parallel("group", [
            { id: "work", config: { type: "step" } as any },
            { ...waitForApproval("a", { message: "Current A" }), dependsOn: ["group/work"] },
            { ...waitForApproval("b", { message: "Current B" }), dependsOn: ["group/a"] },
          ]),
          dependsOn: ["prior"],
        },
      ];
      const completed = (nodeId: string): NodeState => ({
        nodeId,
        status: "completed",
        attempt: 1,
        completedAt: new Date(),
      });
      const first = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            prior: {
              ...completed("prior"),
              output: { branch: "then" },
            },
            "group/a": completed("group/a"),
            "group/b": completed("group/b"),
            "group/work": completed("group/work"),
          },
        }),
      );
      assertEquals(first.waitingNode, "group/a");

      const resumed = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            ...first.nodeStates,
            "group/a": {
              ...first.nodeStates["group/a"]!,
              status: "completed",
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(resumed.waiting, true);
      assertEquals(resumed.waitingNode, "group/b");
      assertEquals(resumed.nodeStates["group/b"]?.status, "running");

      const completedResult = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            ...resumed.nodeStates,
            "group/b": {
              ...resumed.nodeStates["group/b"]!,
              status: "completed",
              completedAt: new Date(),
            },
          },
        }),
      );
      assertEquals(completedResult.completed, true);
      assertEquals(completedResult.nodeStates["group/a"]?.status, "completed");
      assertEquals(executed.filter((nodeId) => nodeId === "group/work"), ["group/work"]);
    });

    it("resumes an active static producer before a newly ready callback sibling", async () => {
      const nodes: WorkflowNode[] = [
        {
          ...subWorkflow("active", {
            workflow: {
              id: "active-workflow",
              steps: [waitForApproval("review", { message: "Active review" })],
            },
          }),
          dependsOn: [],
        },
        { id: "unlock", dependsOn: [], config: { type: "step" } as any },
        {
          ...subWorkflow("newly-ready", {
            workflow: {
              id: "newly-ready-workflow",
              steps: () => [waitForApproval("review", { message: "New review" })],
            },
          }),
          dependsOn: ["unlock"],
        },
      ];
      const result = await executor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            active: { nodeId: "active", status: "running", attempt: 1 },
            unlock: { nodeId: "unlock", status: "completed", attempt: 1 },
            review: {
              nodeId: "review",
              status: "completed",
              attempt: 1,
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(result.waiting, true);
      assertEquals(result.nodeStates.active?.status, "completed");
      assertEquals(result.nodeStates["newly-ready"]?.status, "running");
    });

    it("records children from a completed callback loop before a dependent sub-workflow", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nodes: WorkflowNode[] = [
        loop("loop", {
          while: (_context, loopContext) => loopContext.iteration < 1,
          maxIterations: 1,
          steps: () => [{ id: "review", config: { type: "step" } as any }],
          onMaxIterations: () => ({ loop_loop_state: { userValue: true } }),
        }),
        {
          ...subWorkflow("release", {
            workflow: {
              id: "release-workflow",
              steps: [waitForApproval("loop/review", { message: "Release review" })],
            },
          }),
          dependsOn: ["loop"],
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(executed, ["loop/review"]);
      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "loop/review");
      assertEquals(result.nodeStates.release?.status, "running");
      assertEquals(result.nodeStates["loop/review"]?.status, "running");
      assertEquals(result.context.loop_loop_state, { userValue: true });
    });

    it("prefers an active callback-defined sibling's legacy state", async () => {
      const release = (id: string): WorkflowNode => ({
        ...subWorkflow(id, {
          workflow: {
            id: `${id}-workflow`,
            steps: () => [waitForApproval("review", { message: `Approve ${id}` })],
          },
        }),
        dependsOn: id === "release-2" ? ["release-1"] : [],
      });
      const nodes = [release("release-1"), release("release-2")];

      const result = await executor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            "release-1": { nodeId: "release-1", status: "completed", attempt: 1 },
            "release-2": { nodeId: "release-2", status: "running", attempt: 1 },
            review: { nodeId: "review", status: "completed", attempt: 1 },
          },
        }),
      );

      assertEquals(result.completed, true);
      assertEquals(result.waiting, false);
      assertEquals(result.nodeStates["release-2"]?.status, "completed");
      assertEquals(result.nodeStates.review?.status, "completed");
    });

    it("rejects collisions from a sub-workflow nested in a concurrent composite", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nested = {
        ...parallel("group", [
          subWorkflow("nested", {
            workflow: {
              id: "nested-workflow",
              steps: [{ id: "approve", config: { type: "step" } as any }],
            },
          }),
        ]),
        dependsOn: [],
      };
      const collidingChildId = "group/approve";
      const direct = {
        ...subWorkflow("direct", {
          workflow: {
            id: "direct-workflow",
            steps: [{ id: collidingChildId, config: { type: "step" } as any }],
          },
        }),
        dependsOn: [],
      };

      const result = await exec.execute([nested, direct], createTestRun());

      assertEquals(result.completed, false);
      assertStringIncludes(result.error ?? "", `child id "${collidingChildId}"`);
      assertEquals(executed, []);
    });

    it("rejects a direct parallel child colliding with a concurrent sub-workflow", async () => {
      const nodes: WorkflowNode[] = [
        {
          ...parallel("group", [waitForApproval("review", { message: "Group review" })]),
          dependsOn: [],
        },
        {
          ...subWorkflow("direct", {
            workflow: {
              id: "direct-workflow",
              steps: [waitForApproval("group/review", { message: "Direct review" })],
            },
          }),
          dependsOn: [],
        },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertEquals(result.waiting, false);
      assertStringIncludes(result.error ?? "", 'child id "group/review"');
      assertEquals(result.errorCause?.slug, INVALID_ARGUMENT.slug);
    });

    it("rejects colliding siblings inside a callback-defined sub-workflow", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: { result: node.id }, executionTime: 1 };
        }),
      });
      const release = (id: string): WorkflowNode => ({
        ...subWorkflow(id, {
          workflow: {
            id: `${id}-wf`,
            steps: [
              waitForApproval("review", { message: "Approve the release" }),
              { id: `${id}-publish`, dependsOn: ["review"], config: { type: "step" } as any },
            ],
          },
        }),
        dependsOn: [],
      });
      const nodes: WorkflowNode[] = [
        {
          ...subWorkflow("outer", {
            workflow: {
              id: "outer-wf",
              steps: () => [release("release-1"), release("release-2")],
            },
          }),
          dependsOn: [],
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertStringIncludes(result.error ?? "", 'both declare child id "review"');
      // Neither sibling may park on the shared "review" key, so no approval is
      // raised and no dependent publish step runs.
      assertEquals(result.waiting, false);
      assertEquals(result.errorCause?.slug, INVALID_ARGUMENT.slug);
      assertEquals(executed, []);
    });

    it("rejects colliding sibling sub-workflows inside a map processor", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: { result: node.id }, executionTime: 1 };
        }),
      });
      const release = (id: string): WorkflowNode => ({
        ...subWorkflow(id, {
          workflow: {
            id: `${id}-wf`,
            steps: [waitForApproval("review", { message: "Approve the release" })],
          },
        }),
        dependsOn: [],
      });
      const nodes: WorkflowNode[] = [
        {
          ...map("releases", {
            items: [1],
            processor: {
              id: "release-processor",
              steps: [release("release-1"), release("release-2")],
            },
          }),
          dependsOn: [],
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertStringIncludes(result.error ?? "", 'both declare child id "releases_0/review"');
      assertEquals(result.waiting, false);
      assertEquals(executed, []);
    });

    it("serializes a workflow-definition map against a colliding sub-workflow", async () => {
      const nodes: WorkflowNode[] = [
        {
          ...map("orders", {
            items: [{}],
            processor: {
              id: "order-workflow",
              steps: [waitForApproval("review", { message: "Review the order" })],
            },
          }),
          dependsOn: [],
        },
        {
          ...subWorkflow("direct", {
            workflow: {
              id: "direct-workflow",
              steps: [
                waitForApproval("orders_0/review", { message: "Review the direct release" }),
              ],
            },
          }),
          dependsOn: [],
        },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.waiting, true);
      assertEquals(result.nodeStates.orders?.status, "running");
      assertEquals(result.nodeStates.direct, undefined);
      assertEquals(result.nodeStates["orders_0/review"]?.status, "running");
    });

    it("does not seed a completed generated map wrapper into a later sub-workflow", async () => {
      const nodes: WorkflowNode[] = [
        map("orders", {
          items: [{}],
          processor: {
            id: "order-workflow",
            steps: [{ id: "build", dependsOn: [], config: { type: "step" } as any }],
          },
        }),
        {
          ...subWorkflow("release", {
            workflow: {
              id: "release-workflow",
              steps: [waitForApproval("orders_0", { message: "Approve the release" })],
            },
          }),
          dependsOn: ["orders"],
        },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "orders_0");
      assertEquals(result.nodeStates.release?.status, "running");
      assertEquals(result.nodeStates.orders_0?.status, "running");
    });

    it("does not attribute an active legacy wait to an earlier completed map", async () => {
      const nodes: WorkflowNode[] = [
        map("orders", {
          items: [{}],
          processor: { id: "process-order", config: { type: "step" } as any },
        }),
        {
          ...subWorkflow("release", {
            workflow: {
              id: "release-workflow",
              steps: [waitForApproval("orders_review", { message: "Approve the release" })],
            },
          }),
          dependsOn: ["orders"],
        },
      ];

      const result = await executor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            orders: {
              nodeId: "orders",
              status: "completed",
              output: [{ processed: true }],
              attempt: 1,
              completedAt: new Date(),
            },
            orders_0: {
              nodeId: "orders_0",
              status: "completed",
              attempt: 1,
              completedAt: new Date(),
            },
            release: {
              nodeId: "release",
              status: "running",
              attempt: 1,
              startedAt: new Date(),
            },
            orders_review: {
              nodeId: "orders_review",
              status: "completed",
              attempt: 1,
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(result.completed, true);
      assertEquals(result.waiting, false);
      assertEquals(result.nodeStates.release?.status, "completed");
    });

    it("does not infer map descendants from a normal processor's output keys", async () => {
      const nodes: WorkflowNode[] = [
        map("orders", {
          items: [{}],
          processor: { id: "process-order", config: { type: "step" } as any },
        }),
        {
          ...subWorkflow("release", {
            workflow: {
              id: "release-workflow",
              steps: [waitForApproval("orders_0/review", { message: "Already approved" })],
            },
          }),
          dependsOn: ["orders"],
        },
      ];

      const result = await executor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            orders: {
              nodeId: "orders",
              status: "completed",
              output: [{}],
              attempt: 1,
              completedAt: new Date(),
            },
            orders_0: {
              nodeId: "orders_0",
              status: "completed",
              output: { "orders_0/review": { arbitrary: true } },
              attempt: 1,
              completedAt: new Date(),
            },
            release: { nodeId: "release", status: "running", attempt: 1 },
            "orders_0/review": {
              nodeId: "orders_0/review",
              status: "completed",
              attempt: 1,
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(result.completed, true);
      assertEquals(result.nodeStates.release?.status, "completed");
    });

    it("tracks descendants evidenced by a completed map wrapper output", async () => {
      const nodes: WorkflowNode[] = [
        map("orders", {
          items: [{}],
          processor: {
            id: "order-workflow",
            steps: [waitForApproval("review", { message: "Map review" })],
          },
        }),
        {
          ...subWorkflow("release", {
            workflow: {
              id: "release-workflow",
              steps: [waitForApproval("orders_0/review", { message: "Release review" })],
            },
          }),
          dependsOn: ["orders"],
        },
      ];

      const result = await executor.execute(
        nodes,
        createTestRun({
          status: "running",
          nodeStates: {
            orders: {
              nodeId: "orders",
              status: "completed",
              output: [{}],
              attempt: 1,
              completedAt: new Date(),
            },
            orders_0: {
              nodeId: "orders_0",
              status: "completed",
              output: { "orders_0/review": { approved: true } },
              attempt: 1,
              completedAt: new Date(),
            },
            "orders_0/review": {
              nodeId: "orders_0/review",
              status: "completed",
              attempt: 1,
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(result.completed, false);
      assertEquals(result.waiting, true);
      assertEquals(result.nodeStates.release?.status, "running");
    });

    it("tracks ownerless descendants from a completed callback-defined map", async () => {
      const nodes: WorkflowNode[] = [
        map("orders", {
          items: [{}],
          processor: {
            id: "order-workflow",
            steps: () => [waitForApproval("review", { message: "Map review" })],
          },
        }),
        {
          ...subWorkflow("release", {
            workflow: {
              id: "release-workflow",
              steps: [waitForApproval("orders_0/review", { message: "Release review" })],
            },
          }),
          dependsOn: ["orders"],
        },
      ];

      const result = await executor.execute(
        nodes,
        createTestRun({
          status: "running",
          nodeStates: {
            orders: {
              nodeId: "orders",
              status: "completed",
              output: [{}],
              attempt: 1,
              completedAt: new Date(),
            },
            orders_0: {
              nodeId: "orders_0",
              status: "completed",
              output: { "orders_0/review": { approved: true } },
              attempt: 1,
              completedAt: new Date(),
            },
            "orders_0/review": {
              nodeId: "orders_0/review",
              status: "completed",
              attempt: 1,
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(result.completed, false);
      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "orders_0/review");
      assertEquals(result.nodeStates.release?.status, "running");
    });

    it("does not seed a completed parallel child into a later sub-workflow", async () => {
      const nodes: WorkflowNode[] = [
        parallel("group", [waitForApproval("review", { message: "Group review" })]),
        {
          ...subWorkflow("release", {
            workflow: {
              id: "release-workflow",
              steps: [waitForApproval("group/review", { message: "Release review" })],
            },
          }),
          dependsOn: ["group"],
        },
      ];

      const result = await executor.execute(
        nodes,
        createTestRun({
          status: "running",
          nodeStates: {
            group: {
              nodeId: "group",
              status: "completed",
              attempt: 1,
              completedAt: new Date(),
            },
            "group/review": {
              nodeId: "group/review",
              status: "completed",
              attempt: 1,
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(result.completed, false);
      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "group/review");
      assertEquals(result.nodeStates.release?.status, "running");
    });

    it("does not claim children for a composite that was skipped", async () => {
      const skipped = parallel("skipped-group", [
        waitForApproval("shared-review", { message: "Never raised" }),
      ]);
      const active = {
        ...subWorkflow("active", {
          workflow: {
            id: "active-workflow",
            steps: [waitForApproval("shared-review", { message: "Already approved" })],
          },
        }),
        dependsOn: ["skipped-group"],
      };
      const result = await executor.execute(
        [skipped, active],
        createTestRun({
          status: "waiting",
          nodeStates: {
            "skipped-group": {
              nodeId: "skipped-group",
              status: "skipped",
              attempt: 1,
            },
            active: { nodeId: "active", status: "running", attempt: 1 },
            "shared-review": {
              nodeId: "shared-review",
              status: "completed",
              attempt: 1,
            },
          },
        }),
      );

      assertEquals(result.completed, true);
      assertEquals(result.nodeStates.active?.status, "completed");
    });

    it("claims only the selected branch inside a completed parallel", async () => {
      const completedParallel: WorkflowNode = {
        id: "completed-group",
        dependsOn: [],
        config: {
          type: "parallel",
          nodes: [{
            id: "gate",
            dependsOn: [],
            config: {
              type: "branch",
              condition: () => true,
              then: [{ id: "taken", dependsOn: [], config: { type: "step" } as any }],
              else: [waitForApproval("shared-review", { message: "Untaken" })],
            },
          }],
        },
      };
      const active = {
        ...subWorkflow("active", {
          workflow: {
            id: "active-workflow",
            steps: [waitForApproval("shared-review", { message: "Already approved" })],
          },
        }),
        dependsOn: ["completed-group"],
      };
      const result = await executor.execute(
        [completedParallel, active],
        createTestRun({
          status: "waiting",
          nodeStates: {
            "completed-group": {
              nodeId: "completed-group",
              status: "completed",
              attempt: 1,
            },
            gate: {
              nodeId: "gate",
              status: "completed",
              output: { branch: "then" },
              attempt: 1,
            },
            taken: { nodeId: "taken", status: "completed", attempt: 1 },
            active: { nodeId: "active", status: "running", attempt: 1 },
            "shared-review": {
              nodeId: "shared-review",
              status: "completed",
              attempt: 1,
            },
          },
        }),
      );

      assertEquals(result.completed, true);
      assertEquals(result.nodeStates.active?.status, "completed");
    });

    it("does not claim ownerless states solely from a completed loop prefix", async () => {
      const completedLoop = loop("loop", {
        while: () => false,
        maxIterations: 1,
        steps: () => [],
      });
      const active = {
        ...subWorkflow("active", {
          workflow: {
            id: "active-workflow",
            steps: [waitForApproval("loop/review", { message: "Already approved" })],
          },
        }),
        dependsOn: ["loop"],
      };
      const result = await executor.execute(
        [completedLoop, active],
        createTestRun({
          status: "waiting",
          nodeStates: {
            loop: { nodeId: "loop", status: "completed", attempt: 1 },
            active: { nodeId: "active", status: "running", attempt: 1 },
            "loop/review": {
              nodeId: "loop/review",
              status: "completed",
              attempt: 1,
            },
          },
        }),
      );

      assertEquals(result.completed, true);
      assertEquals(result.nodeStates.active?.status, "completed");
    });

    it("preserves an ownerless __proto__ child while seeding", async () => {
      const nodeStates: Record<string, NodeState> = {
        active: { nodeId: "active", status: "running", attempt: 1 },
      };
      Object.defineProperty(nodeStates, "__proto__", {
        value: { nodeId: "__proto__", status: "completed", attempt: 1 },
        enumerable: true,
        configurable: true,
        writable: true,
      });
      const result = await executor.execute(
        [subWorkflow("active", {
          workflow: {
            id: "proto-workflow",
            steps: [waitForApproval("__proto__", { message: "Already approved" })],
          },
        })],
        createTestRun({ status: "waiting", nodeStates }),
      );

      assertEquals(result.completed, true);
      assertEquals(Object.hasOwn(result.nodeStates, "__proto__"), true);
      assertEquals(result.nodeStates["__proto__"]?.status, "completed");
    });

    it("isolates a deferred parallel from a dynamic sub-workflow child", async () => {
      const dynamic = subWorkflow("dynamic", {
        workflow: {
          id: "dynamic-workflow",
          steps: () => [{ id: "group/review", config: { type: "step" } as any }],
        },
      });
      const group = parallel("group", [
        waitForApproval("review", { message: "Approve the group" }),
      ]);

      const result = await executor.execute([dynamic, group], createTestRun());

      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "group/review");
      assertEquals(result.nodeStates.group?.status, "running");
    });

    it("retains map-generated approval state when an enclosing parallel resumes", async () => {
      const nodes = [parallel("group", [
        map("orders", {
          items: [{}],
          processor: {
            id: "order-workflow",
            steps: [waitForApproval("review", { message: "Review the order" })],
          },
        }),
      ])];
      const first = await executor.execute(nodes, createTestRun());
      assertEquals(first.waiting, true);
      assertExists(first.waitingNode);
      const waitingState = first.nodeStates[first.waitingNode];
      assertExists(waitingState);

      const resumed = await executor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            ...first.nodeStates,
            [first.waitingNode]: {
              ...waitingState,
              status: "completed",
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(resumed.completed, true);
      assertEquals(resumed.waiting, false);
    });

    it("retains composite map processor approval state when an enclosing parallel resumes", async () => {
      const nodes = [parallel("group", [
        map("orders", {
          items: [{}],
          processor: parallel("review-group", [
            waitForApproval("review", { message: "Review the order" }),
          ]),
        }),
      ])];
      const first = await executor.execute(nodes, createTestRun());
      assertEquals(first.waiting, true);
      assertEquals(first.waitingNode, "group/orders_0/review");
      const waitingState = first.nodeStates["group/orders_0/review"];
      assertExists(waitingState);

      const resumed = await executor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            ...first.nodeStates,
            "group/orders_0/review": {
              ...waitingState,
              status: "completed",
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(resumed.waiting, false);
      assertEquals(resumed.completed, true);
      assertEquals(resumed.nodeStates["group/orders_0/review"]?.status, "completed");
    });

    it("retains directly owned approval state in a nested composite resume", async () => {
      const nodes = [subWorkflow("outer", {
        workflow: {
          id: "outer-workflow",
          steps: [parallel("group", [
            waitForApproval("review", { message: "Review the nested group" }),
          ])],
        },
      })];
      const first = await executor.execute(nodes, createTestRun());
      assertEquals(first.waiting, true);
      assertEquals(first.waitingNode, "group/review");
      assertExists(first.waitingNode);
      const waitingState = first.nodeStates[first.waitingNode];
      assertExists(waitingState);

      const resumed = await executor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            ...first.nodeStates,
            [first.waitingNode]: {
              ...waitingState,
              status: "completed",
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(resumed.completed, true);
      assertEquals(resumed.waiting, false);
      assertEquals(resumed.nodeStates[first.waitingNode]?.status, "completed");
    });

    it("isolates a deferred map from a dynamic sub-workflow child", async () => {
      const dynamic = subWorkflow("dynamic", {
        workflow: {
          id: "dynamic-workflow",
          steps: () => [{ id: "orders_0", config: { type: "step" } as any }],
        },
      });
      const orders = map("orders", {
        items: [{}],
        processor: waitForApproval("approval", { message: "Approve the order" }),
      });

      const result = await executor.execute([dynamic, orders], createTestRun());

      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "orders_0");
      assertEquals(result.nodeStates.orders?.status, "running");
    });

    it("keeps statically defined sibling sub-workflows in one batch", async () => {
      const staticRelease = (id: string, approvalId: string): WorkflowNode => ({
        ...subWorkflow(id, {
          workflow: {
            id: `${id}-wf`,
            steps: [waitForApproval(approvalId, { message: "Approve the release" })],
          },
        }),
        dependsOn: [],
      });
      const nodes: WorkflowNode[] = [
        staticRelease("release-1", "review-1"),
        staticRelease("release-2", "review-2"),
        {
          ...subWorkflow("release-dynamic", {
            workflow: {
              id: "release-dynamic-wf",
              steps: () => [waitForApproval("review-dynamic", { message: "Approve the release" })],
            },
          }),
          dependsOn: [],
        },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.waiting, true);
      // The callback-defined producer runs first so its runtime child IDs
      // become historical before the static siblings are admitted.
      assertEquals(result.waitingNodes?.map((wait) => wait.nodeId), ["review-dynamic"]);
      assertEquals(result.nodeStates["review-1"], undefined);
      assertEquals(result.nodeStates["review-2"], undefined);
    });

    it("admits a branch whose untaken arm would collide with a concurrent sibling", async () => {
      // Only one arm of a branch ever runs, and which one is decided when the
      // node executes. Refusing the run for a collision on the arm that is
      // never taken would fail a run halfway through for a condition that never
      // materializes, so a branch reaching a sub-workflow is admitted alone
      // instead and the arm it selects is checked by its own graph pass.
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: { result: node.id }, executionTime: 1 };
        }),
      });
      const armRelease = (id: string, childId: string): WorkflowNode => ({
        ...subWorkflow(id, {
          workflow: {
            id: `${id}-wf`,
            steps: [{ id: childId, dependsOn: [], config: { type: "step" } as any }],
          },
        }),
        dependsOn: [],
      });
      const nodes: WorkflowNode[] = [
        {
          id: "gate",
          dependsOn: [],
          config: {
            type: "branch",
            condition: () => true,
            then: [armRelease("taken", "taken-child")],
            else: [armRelease("untaken", "shipped")],
          } as any,
        },
        {
          ...subWorkflow("direct", {
            workflow: {
              id: "direct-wf",
              steps: [{ id: "shipped", dependsOn: [], config: { type: "step" } as any }],
            },
          }),
          dependsOn: [],
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.error, undefined);
      assertEquals(result.completed, true);
      // The unresolved branch runs first, so the two never produce child state
      // at the same time and its selected arm decides the historical IDs.
      assertEquals(executed, ["taken-child", "shipped"]);
    });

    it("admits an unresolved branch before a colliding static producer", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "gate",
          dependsOn: [],
          config: {
            type: "branch",
            condition: () => true,
            then: [waitForApproval("gate/then/review", { message: "Branch review" })],
            else: [],
          } as any,
        },
        {
          ...subWorkflow("static-release", {
            workflow: {
              id: "static-release-workflow",
              steps: [waitForApproval("gate/then/review", { message: "Static review" })],
            },
          }),
          dependsOn: [],
        },
      ];

      const result = await executor.execute(nodes, createTestRun());

      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "gate/then/review");
      assertEquals(result.nodeStates.gate?.status, "running");
      assertEquals(result.nodeStates["static-release"], undefined);
    });

    it("admits a sub-workflow whose untaken branch arm would collide with a sibling", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nodes: WorkflowNode[] = [
        {
          ...subWorkflow("conditional", {
            workflow: {
              id: "conditional-wf",
              steps: [{
                id: "gate",
                dependsOn: [],
                config: {
                  type: "branch",
                  condition: () => true,
                  then: [{
                    id: "gate/then/taken",
                    dependsOn: [],
                    config: { type: "step" } as any,
                  }],
                  else: [{
                    id: "gate/else/review",
                    dependsOn: [],
                    config: { type: "step" } as any,
                  }],
                } as any,
              }],
            },
          }),
          dependsOn: [],
        },
        {
          ...subWorkflow("direct", {
            workflow: {
              id: "direct-wf",
              steps: [{
                id: "gate/else/review",
                dependsOn: [],
                config: { type: "step" } as any,
              }],
            },
          }),
          dependsOn: [],
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.error, undefined);
      assertEquals(result.completed, true);
      assertEquals(executed.includes("gate/then/taken"), true);
      assertEquals(executed.includes("gate/else/review"), true);
    });

    it("resumes a sub-workflow nested in a loop without re-running its children", async () => {
      // A loop keeps its iteration's child states in a private snapshot in the
      // context, re-encoded through an explicit field whitelist. Ownership
      // metadata has to survive that round trip, or the resumed iteration
      // reseeds the sub-workflow through the ownerless legacy path.
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: { result: node.id }, executionTime: 1 };
        }),
      });

      const nodes: WorkflowNode[] = [
        {
          id: "the-loop",
          dependsOn: [],
          config: {
            type: "loop",
            maxIterations: 1,
            while: (_context: WorkflowContext, loopContext: LoopExecutionContext) =>
              loopContext.iteration < 1,
            steps: [
              {
                id: "release",
                dependsOn: [],
                config: {
                  type: "subWorkflow",
                  workflow: {
                    id: "release-wf",
                    steps: [
                      { id: "build", dependsOn: [], config: { type: "step" } as any },
                      waitForApproval("approve", { message: "Approve the release" }),
                      { id: "publish", dependsOn: ["approve"], config: { type: "step" } as any },
                    ],
                  },
                } as any,
              },
            ],
          } as any,
        },
      ];

      const first = await exec.execute(nodes, createTestRun());

      assertEquals(first.waiting, true);
      assertEquals(first.waitingNode, "approve");
      assertEquals(executed, ["build"]);
      const loopState = first.context["the-loop_loop_state"] as {
        iterationNodeStates: Record<string, { _subWorkflowOwnerPath?: string }>;
      };
      const persistedBuild = loopState.iterationNodeStates["build"];
      assertExists(persistedBuild);
      assertExists(persistedBuild._subWorkflowOwnerPath);

      const resumed = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          context: first.context,
          nodeStates: {
            ...first.nodeStates,
            approve: {
              ...first.nodeStates.approve!,
              status: "completed",
              output: { approved: true },
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(resumed.completed, true);
      assertEquals(executed, ["build", "publish"]);
    });

    it("rejects sub-workflow child ids that collide with declared parent nodes", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: { result: node.id }, executionTime: 1 };
        }),
      });

      const nodes: WorkflowNode[] = [
        { id: "review", dependsOn: [], config: { type: "step" } as any },
        {
          id: "release",
          dependsOn: ["review"],
          config: {
            type: "subWorkflow",
            workflow: {
              id: "release-wf",
              steps: [
                waitForApproval("review", { message: "Approve the release" }),
                { id: "publish", dependsOn: ["review"], config: { type: "step" } as any },
              ],
            },
          } as any,
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertStringIncludes(result.error ?? "", 'child id "review"');
      assertEquals(result.errorCause?.slug, INVALID_ARGUMENT.slug);
      // The nested approval must never be bypassed by the parent's completed
      // "review" state, so its dependent publish step must not have run.
      assertEquals(executed.includes("publish"), false);
    });

    it("resumes a waiting sub-workflow without re-running its completed children", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: { result: node.id }, executionTime: 1 };
        }),
      });

      const nodes: WorkflowNode[] = [
        {
          id: "release",
          dependsOn: [],
          config: {
            type: "subWorkflow",
            workflow: {
              id: "release-wf",
              steps: [
                { id: "build", dependsOn: [], config: { type: "step" } as any },
                waitForApproval("approve", { message: "Approve the release" }),
                { id: "publish", dependsOn: ["approve"], config: { type: "step" } as any },
              ],
            },
          } as any,
        },
      ];

      const first = await exec.execute(nodes, createTestRun());
      assertEquals(first.waiting, true);
      assertEquals(first.waitingNode, "approve");
      assertEquals(first.nodeStates.build?.status, "completed");
      assertEquals(executed, ["build"]);

      const resumed = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          context: first.context,
          nodeStates: {
            ...first.nodeStates,
            approve: {
              ...first.nodeStates.approve!,
              status: "completed",
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(resumed.completed, true);
      // "build" already completed before the approval, so the resume must run
      // only the approval's dependent.
      assertEquals(executed, ["build", "publish"]);
    });

    it("does not seed a sibling sub-workflow's child state", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: { result: node.id }, executionTime: 1 };
        }),
      });

      const nodes: WorkflowNode[] = [
        {
          id: "release-1",
          dependsOn: [],
          config: {
            type: "subWorkflow",
            workflow: {
              id: "release-wf-1",
              steps: [{ id: "review", dependsOn: [], config: { type: "step" } as any }],
            },
          } as any,
        },
        {
          id: "release-2",
          dependsOn: ["release-1"],
          config: {
            type: "subWorkflow",
            workflow: {
              id: "release-wf-2",
              steps: [waitForApproval("review", { message: "Approve the release" })],
            },
          } as any,
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "review");
      assertEquals(executed, ["review"]);
    });

    it("reconstructs sub-workflow ownership after an executor restart", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: { result: node.id }, executionTime: 1 };
        }),
      });

      const nodes: WorkflowNode[] = [
        {
          id: "release-1",
          dependsOn: [],
          config: {
            type: "subWorkflow",
            workflow: {
              id: "release-wf-1",
              steps: [{ id: "review", dependsOn: [], config: { type: "step" } as any }],
            },
          } as any,
        },
        {
          id: "release-2",
          dependsOn: ["release-1"],
          config: {
            type: "subWorkflow",
            workflow: {
              id: "release-wf-2",
              steps: [waitForApproval("review", { message: "Approve the release" })],
            },
          } as any,
        },
      ];

      const result = await exec.execute(
        nodes,
        createTestRun({
          status: "running",
          nodeStates: {
            "release-1": {
              nodeId: "release-1",
              status: "completed",
              attempt: 1,
              completedAt: new Date(),
            },
            review: {
              nodeId: "review",
              status: "completed",
              attempt: 1,
              completedAt: new Date(),
              _subWorkflowOwnerPath: "release-1",
            },
          },
        }),
      );

      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "review");
      assertEquals(executed, []);
    });

    it("resumes ownerless legacy state for the active sequential sibling", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nodes: WorkflowNode[] = [
        subWorkflow("release-1", {
          workflow: {
            id: "release-wf-1",
            steps: [
              waitForApproval("review", { message: "Approve the first release" }),
              { id: "publish", dependsOn: ["review"], config: { type: "step" } as any },
            ],
          },
        }),
        {
          ...subWorkflow("release-2", {
            workflow: {
              id: "release-wf-2",
              steps: [waitForApproval("review", { message: "Approve the second release" })],
            },
          }),
          dependsOn: ["release-1"],
        },
      ];
      const result = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            "release-1": {
              nodeId: "release-1",
              status: "running",
              attempt: 1,
              startedAt: new Date(),
            },
            review: {
              nodeId: "review",
              status: "completed",
              attempt: 1,
              startedAt: new Date(),
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(executed, ["publish"]);
      assertEquals(result.nodeStates["release-1"]?.status, "completed");
      assertEquals(result.nodeStates["release-2"]?.status, "running");
      assertEquals(result.nodeStates.review?.status, "running");
      assertEquals(result.waiting, true);
    });

    it("keeps ownerless state when only an untaken earlier branch reserves its id", async () => {
      const started: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(),
        onNodeStart: (nodeId) => void started.push(nodeId),
      });
      const nodes: WorkflowNode[] = [
        subWorkflow("release-1", {
          workflow: {
            id: "release-wf-1",
            steps: [{
              id: "gate",
              dependsOn: [],
              config: {
                type: "branch",
                condition: () => true,
                then: [{
                  id: "gate/then/publish",
                  dependsOn: [],
                  config: { type: "step" } as any,
                }],
                else: [waitForApproval("shared-review", { message: "Unused review" })],
              } as any,
            }],
          },
        }),
        {
          ...subWorkflow("release-2", {
            workflow: {
              id: "release-wf-2",
              steps: [waitForApproval("shared-review", { message: "Active review" })],
            },
          }),
          dependsOn: ["release-1"],
        },
      ];
      const originalStartedAt = new Date("2026-01-01T00:00:00.000Z");

      const result = await exec.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            "release-1": {
              nodeId: "release-1",
              status: "completed",
              attempt: 1,
              completedAt: new Date(),
            },
            gate: {
              nodeId: "gate",
              status: "completed",
              output: { branch: "then", result: {} },
              attempt: 1,
              completedAt: new Date(),
            },
            "gate/then/publish": {
              nodeId: "gate/then/publish",
              status: "completed",
              attempt: 1,
              completedAt: new Date(),
            },
            "release-2": {
              nodeId: "release-2",
              status: "running",
              attempt: 1,
              startedAt: originalStartedAt,
            },
            "shared-review": {
              nodeId: "shared-review",
              status: "running",
              attempt: 1,
              startedAt: originalStartedAt,
            },
          },
        }),
      );

      assertEquals(result.waiting, true);
      assertEquals(result.nodeStates["shared-review"]?.startedAt, originalStartedAt);
      assertEquals(started.includes("shared-review"), false);
    });

    it("does not use an ambiguous ownerless branch selection across siblings", async () => {
      const release = (id: string, condition: boolean): WorkflowNode => ({
        ...subWorkflow(id, {
          workflow: {
            id: `${id}-workflow`,
            steps: [{
              id: "gate",
              config: {
                type: "branch",
                condition: () => condition,
                then: [{ id: "publish", config: { type: "step" } as any }],
                else: [waitForApproval("shared-review", { message: `Approve ${id}` })],
              } as any,
            }],
          },
        }),
        dependsOn: id === "release-2" ? ["release-1"] : [],
      });
      const originalStartedAt = new Date("2026-01-01T00:00:00.000Z");

      const result = await executor.execute(
        [release("release-1", true), release("release-2", false)],
        createTestRun({
          status: "waiting",
          nodeStates: {
            "release-1": { nodeId: "release-1", status: "completed", attempt: 1 },
            "release-2": { nodeId: "release-2", status: "running", attempt: 1 },
            gate: {
              nodeId: "gate",
              status: "completed",
              output: { branch: "else", result: {} },
              attempt: 1,
            },
            "shared-review": {
              nodeId: "shared-review",
              status: "completed",
              attempt: 1,
              startedAt: originalStartedAt,
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(result.completed, true);
      assertEquals(result.nodeStates["release-2"]?.status, "completed");
      assertEquals(result.nodeStates["shared-review"]?.startedAt, originalStartedAt);
    });

    it("does not attribute an active nested legacy wait to a future outer sibling", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nestedRelease = (outerId: string): WorkflowNode =>
        subWorkflow(outerId, {
          workflow: {
            id: `${outerId}-workflow`,
            steps: [
              subWorkflow("inner", {
                workflow: {
                  id: `${outerId}-inner-workflow`,
                  steps: [
                    waitForApproval("review", { message: `Approve ${outerId}` }),
                    { id: "publish", dependsOn: ["review"], config: { type: "step" } as any },
                  ],
                },
              }),
            ],
          },
        });
      const first = nestedRelease("outer-1");
      const second = { ...nestedRelease("outer-2"), dependsOn: ["outer-1"] };

      const result = await exec.execute(
        [first, second],
        createTestRun({
          status: "waiting",
          nodeStates: {
            "outer-1": {
              nodeId: "outer-1",
              status: "running",
              attempt: 1,
              startedAt: new Date(),
            },
            inner: {
              nodeId: "inner",
              status: "running",
              attempt: 1,
              startedAt: new Date(),
            },
            review: {
              nodeId: "review",
              status: "completed",
              attempt: 1,
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(executed, ["publish"]);
      assertEquals(result.nodeStates["outer-1"]?.status, "completed");
      assertEquals(result.nodeStates["outer-2"]?.status, "running");
      assertEquals(result.waiting, true);
    });

    it("uses completed ancestor evidence for a nested legacy owner with a reused id", async () => {
      const completedOuter = subWorkflow("outer-1", {
        workflow: {
          id: "completed-outer",
          steps: [
            subWorkflow("inner", {
              workflow: {
                id: "completed-inner",
                steps: [{
                  id: "old-gate",
                  config: {
                    type: "branch",
                    condition: () => true,
                    then: [waitForApproval("old-review", { message: "Old review" })],
                    else: [waitForApproval("shared-review", { message: "Untaken review" })],
                  },
                }],
              },
            }),
          ],
        },
      });
      const activeOuter = {
        ...subWorkflow("outer-2", {
          workflow: {
            id: "active-outer",
            steps: [
              subWorkflow("inner", {
                workflow: {
                  id: "active-inner",
                  steps: [waitForApproval("shared-review", { message: "Active review" })],
                },
              }),
            ],
          },
        }),
        dependsOn: ["outer-1"],
      };
      const approvedAt = new Date("2026-01-01T00:00:00.000Z");

      const result = await executor.execute(
        [completedOuter, activeOuter],
        createTestRun({
          status: "waiting",
          nodeStates: {
            "outer-1": { nodeId: "outer-1", status: "completed", attempt: 1 },
            "outer-2": { nodeId: "outer-2", status: "running", attempt: 1 },
            inner: { nodeId: "inner", status: "running", attempt: 1 },
            "old-gate": {
              nodeId: "old-gate",
              status: "completed",
              output: { branch: "then" },
              attempt: 1,
            },
            "shared-review": {
              nodeId: "shared-review",
              status: "completed",
              attempt: 1,
              completedAt: approvedAt,
            },
          },
        }),
      );

      assertEquals(result.completed, true);
      assertEquals(result.waiting, false);
      assertEquals(result.nodeStates["outer-2"]?.status, "completed");
      assertEquals(result.nodeStates["shared-review"]?.completedAt, approvedAt);
    });

    it("does not seed a completed sub-workflow child into a later parallel", async () => {
      const nodes: WorkflowNode[] = [
        subWorkflow("producer", {
          workflow: {
            id: "producer-workflow",
            steps: [waitForApproval("group/review", { message: "Producer review" })],
          },
        }),
        {
          ...parallel("group", [
            waitForApproval("review", { message: "Parallel review" }),
          ]),
          dependsOn: ["producer"],
        },
      ];

      const result = await executor.execute(
        nodes,
        createTestRun({
          status: "waiting",
          nodeStates: {
            producer: { nodeId: "producer", status: "completed", attempt: 1 },
            "group/review": {
              nodeId: "group/review",
              status: "completed",
              attempt: 1,
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(result.completed, false);
      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "group/review");
      assertEquals(result.nodeStates.group?.status, "running");
      assertEquals(result.nodeStates["group/review"]?.status, "running");
    });

    it("does not seed a completed branch child into a later parallel", async () => {
      const completedBranch: WorkflowNode = {
        id: "choose",
        config: {
          type: "branch",
          condition: () => true,
          then: [waitForApproval("choose/then/review", { message: "Branch review" })],
          else: [],
        },
      };
      const laterParallel = {
        ...parallel("choose/then", [
          waitForApproval("review", { message: "Parallel review" }),
        ]),
        dependsOn: ["choose"],
      };

      const result = await executor.execute(
        [completedBranch, laterParallel],
        createTestRun({
          status: "waiting",
          nodeStates: {
            choose: {
              nodeId: "choose",
              status: "completed",
              output: { branch: "then" },
              attempt: 1,
            },
            "choose/then/review": {
              nodeId: "choose/then/review",
              status: "completed",
              attempt: 1,
              completedAt: new Date(),
            },
          },
        }),
      );

      assertEquals(result.completed, false);
      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "choose/then/review");
      assertEquals(result.nodeStates["choose/then"]?.status, "running");
      assertEquals(result.nodeStates["choose/then/review"]?.status, "running");
    });

    it("does not claim descendants of a skipped nested sub-workflow", async () => {
      const producer = subWorkflow("producer", {
        workflow: {
          id: "producer-workflow",
          steps: [
            subWorkflow("skipped-inner", {
              workflow: {
                id: "skipped-workflow",
                steps: [waitForApproval("shared-review", { message: "Skipped review" })],
              },
            }),
          ],
        },
      });
      const consumer = {
        ...subWorkflow("consumer", {
          workflow: {
            id: "consumer-workflow",
            steps: [waitForApproval("shared-review", { message: "Consumer review" })],
          },
        }),
        dependsOn: ["producer"],
      };
      const completedAt = new Date("2026-01-01T00:00:00.000Z");

      const result = await executor.execute(
        [producer, consumer],
        createTestRun({
          status: "waiting",
          nodeStates: {
            producer: { nodeId: "producer", status: "completed", attempt: 1 },
            "skipped-inner": { nodeId: "skipped-inner", status: "skipped", attempt: 1 },
            consumer: { nodeId: "consumer", status: "running", attempt: 1 },
            "shared-review": {
              nodeId: "shared-review",
              status: "completed",
              attempt: 1,
              completedAt,
            },
          },
        }),
      );

      assertEquals(result.completed, true);
      assertEquals(result.waiting, false);
      assertEquals(result.nodeStates.consumer?.status, "completed");
      assertEquals(result.nodeStates["shared-review"]?.completedAt, completedAt);
    });

    it("keeps slash-containing sub-workflow owner paths distinct", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: { result: node.id }, executionTime: 1 };
        }),
      });

      const nodes: WorkflowNode[] = [
        {
          id: "a",
          dependsOn: [],
          config: {
            type: "subWorkflow",
            workflow: {
              id: "nested-owner-workflow",
              steps: [{
                id: "b",
                dependsOn: [],
                config: {
                  type: "subWorkflow",
                  workflow: {
                    id: "nested-review-workflow",
                    steps: [{ id: "review", dependsOn: [], config: { type: "step" } as any }],
                  },
                } as any,
              }],
            },
          } as any,
        },
        {
          id: "a/b",
          dependsOn: ["a"],
          config: {
            type: "subWorkflow",
            workflow: {
              id: "slash-owner-workflow",
              steps: [waitForApproval("review", { message: "Approve the release" })],
            },
          } as any,
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.waiting, true);
      assertEquals(result.waitingNode, "review");
      assertEquals(executed, ["review"]);
    });

    it("accepts sub-workflow owner ids containing lone UTF-16 surrogates", async () => {
      const executed: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executed.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nodes: WorkflowNode[] = [{
        id: "\uD800",
        dependsOn: [],
        config: {
          type: "subWorkflow",
          workflow: {
            id: "surrogate-owner-workflow",
            steps: [{ id: "child", dependsOn: [], config: { type: "step" } as any }],
          },
        } as any,
      }];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(executed, ["child"]);
      assertEquals(result.nodeStates.child?._subWorkflowOwnerPath, "d800");
    });

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

    it("passes deep lossy context to the backend before normalization", async () => {
      const depth = 8000;
      let savedLeaf: unknown;
      let resumeSave!: () => void;
      const saveGate = new Promise<void>((resolve) => {
        resumeSave = resolve;
      });
      const backend = {
        saveCheckpoint: () => Promise.resolve(),
        getLatestCheckpoint: () => Promise.resolve(null),
      } as unknown as WorkflowBackend;
      const cpManager = new (class extends CheckpointManager {
        override async save(_runId: string, checkpoint: Checkpoint): Promise<boolean> {
          await saveGate;
          savedLeaf = deepCheckpointLeaf(checkpoint.context.deep, depth);
          return true;
        }
      })({ backend });
      const exec = new DAGExecutor({ stepExecutor, checkpointManager: cpManager });
      const lossyLeaf = new Date(0);

      // Full execution clones run state first, so exercise this persistence boundary directly.
      const checkpointExecutor = exec as unknown as {
        checkpoint(
          runId: string,
          nodeId: string,
          context: WorkflowContext,
          nodeStates: Record<string, NodeState>,
        ): Promise<void>;
      };
      const saving = checkpointExecutor.checkpoint(
        "test-run",
        "cp-node",
        { input: {}, deep: deepCheckpointValue(depth, lossyLeaf) },
        {},
      );
      lossyLeaf.setTime(1);
      resumeSave();
      await saving;

      assertEquals(savedLeaf instanceof Date, true);
      assertEquals((savedLeaf as Date).getTime(), 0);
    });

    it("lets an owned backend fence before touching a checkpoint object proxy", async () => {
      let trapCalls = 0;
      let saveCalled = false;
      const proxied = new Proxy({}, {
        get() {
          trapCalls++;
          throw new Error("checkpoint proxy get must not run before the fence");
        },
        getOwnPropertyDescriptor() {
          trapCalls++;
          throw new Error("checkpoint proxy descriptor must not run before the fence");
        },
        getPrototypeOf() {
          trapCalls++;
          throw new Error("checkpoint proxy prototype must not run before the fence");
        },
        ownKeys() {
          trapCalls++;
          throw new Error("checkpoint proxy keys must not run before the fence");
        },
      });
      const backend = {
        saveCheckpoint: () => Promise.resolve(),
        getLatestCheckpoint: () => Promise.resolve(null),
      } as unknown as WorkflowBackend;
      const cpManager = new (class extends CheckpointManager {
        override save(): Promise<boolean> {
          saveCalled = true;
          return Promise.resolve(false);
        }
      })({ backend });
      const exec = new DAGExecutor({ stepExecutor, checkpointManager: cpManager });
      const checkpointExecutor = exec as unknown as {
        checkpoint(
          runId: string,
          nodeId: string,
          context: WorkflowContext,
          nodeStates: Record<string, NodeState>,
          ownership: { runId: string; workerId: string },
        ): Promise<void>;
      };

      await assertRejects(() =>
        checkpointExecutor.checkpoint(
          "test-run",
          "cp-node",
          { input: { proxied } },
          {},
          { runId: "test-run", workerId: "stale-worker" },
        )
      );

      assertEquals(saveCalled, true);
      assertEquals(trapCalls, 0);
    });

    it("lets an owned backend fence before touching a checkpoint proxy array length", async () => {
      let trapCalls = 0;
      let saveCalled = false;
      const values = new Proxy([], {
        get(target, key, receiver) {
          trapCalls++;
          if (key === "length") {
            throw new Error("checkpoint proxy length must not run before the fence");
          }
          return Reflect.get(target, key, receiver);
        },
        getOwnPropertyDescriptor() {
          trapCalls++;
          throw new Error("checkpoint proxy descriptor must not run before the fence");
        },
        getPrototypeOf() {
          trapCalls++;
          throw new Error("checkpoint proxy prototype must not run before the fence");
        },
        ownKeys() {
          trapCalls++;
          throw new Error("checkpoint proxy keys must not run before the fence");
        },
      });
      const backend = {
        saveCheckpoint: () => Promise.resolve(),
        getLatestCheckpoint: () => Promise.resolve(null),
      } as unknown as WorkflowBackend;
      const cpManager = new (class extends CheckpointManager {
        override save(): Promise<boolean> {
          saveCalled = true;
          return Promise.resolve(false);
        }
      })({ backend });
      const exec = new DAGExecutor({ stepExecutor, checkpointManager: cpManager });
      const checkpointExecutor = exec as unknown as {
        checkpoint(
          runId: string,
          nodeId: string,
          context: WorkflowContext,
          nodeStates: Record<string, NodeState>,
          ownership: { runId: string; workerId: string },
        ): Promise<void>;
      };

      await assertRejects(() =>
        checkpointExecutor.checkpoint(
          "test-run",
          "cp-node",
          { input: { values } },
          {},
          { runId: "test-run", workerId: "stale-worker" },
        )
      );

      assertEquals(saveCalled, true);
      assertEquals(trapCalls, 0);
    });

    it("lets an owned backend fence before executing checkpoint accessors or hooks", async () => {
      let userCodeCalls = 0;
      let saveCalled = false;
      const dynamic = {
        toJSON() {
          userCodeCalls++;
          throw new Error("checkpoint toJSON must not run before the fence");
        },
      };
      Object.defineProperty(dynamic, "value", {
        enumerable: true,
        get() {
          userCodeCalls++;
          throw new Error("checkpoint getter must not run before the fence");
        },
      });
      const backend = {
        saveCheckpoint: () => Promise.resolve(),
        getLatestCheckpoint: () => Promise.resolve(null),
      } as unknown as WorkflowBackend;
      const cpManager = new (class extends CheckpointManager {
        override save(): Promise<boolean> {
          saveCalled = true;
          return Promise.resolve(false);
        }
      })({ backend });
      const exec = new DAGExecutor({ stepExecutor, checkpointManager: cpManager });
      const checkpointExecutor = exec as unknown as {
        checkpoint(
          runId: string,
          nodeId: string,
          context: WorkflowContext,
          nodeStates: Record<string, NodeState>,
          ownership: { runId: string; workerId: string },
        ): Promise<void>;
      };

      await assertRejects(() =>
        checkpointExecutor.checkpoint(
          "test-run",
          "cp-node",
          { input: { dynamic } },
          {},
          { runId: "test-run", workerId: "stale-worker" },
        )
      );

      assertEquals(saveCalled, true);
      assertEquals(userCodeCalls, 0);
    });

    it("raises a typed checkpoint persistence error after a successful owned fence", async () => {
      let trapCalls = 0;
      const proxied = new Proxy({}, {
        get() {
          trapCalls++;
          throw new Error("checkpoint proxy get must not run");
        },
        getOwnPropertyDescriptor() {
          trapCalls++;
          throw new Error("checkpoint proxy descriptor must not run");
        },
        getPrototypeOf() {
          trapCalls++;
          throw new Error("checkpoint proxy prototype must not run");
        },
        ownKeys() {
          trapCalls++;
          throw new Error("checkpoint proxy keys must not run");
        },
      });
      const backend = new MemoryBackend();
      await backend.createRun(createTestRun({
        id: "test-run",
        status: "running",
        workerId: "current-worker",
      }));
      const cpManager = new CheckpointManager({ backend });
      const exec = new DAGExecutor({ stepExecutor, checkpointManager: cpManager });
      const checkpointExecutor = exec as unknown as {
        checkpoint(
          runId: string,
          nodeId: string,
          context: WorkflowContext,
          nodeStates: Record<string, NodeState>,
          ownership: { runId: string; workerId: string },
        ): Promise<void>;
      };

      await assertRejects(
        () =>
          checkpointExecutor.checkpoint(
            "test-run",
            "cp-node",
            { input: { proxied } },
            {},
            { runId: "test-run", workerId: "current-worker" },
          ),
        VeryfrontError,
        "Proxy value",
      );

      assertEquals(trapCalls, 0);
    });

    it("detaches owned checkpoint node output before an asynchronous fence", async () => {
      const output = { topic: "original" };
      let resumeSave!: () => void;
      let reportSaveStarted!: () => void;
      const saveGate = new Promise<void>((resolve) => {
        resumeSave = resolve;
      });
      const saveStarted = new Promise<void>((resolve) => {
        reportSaveStarted = resolve;
      });
      let savedTopic: unknown;
      const backend = {
        saveCheckpoint: () => Promise.resolve(),
        getLatestCheckpoint: () => Promise.resolve(null),
      } as unknown as WorkflowBackend;
      const cpManager = new (class extends CheckpointManager {
        override async save(_runId: string, checkpoint: Checkpoint): Promise<boolean> {
          reportSaveStarted();
          await saveGate;
          savedTopic = (checkpoint.nodeStates["cp-node"]?.output as { topic: string }).topic;
          return true;
        }
      })({ backend });
      const exec = new DAGExecutor({
        stepExecutor: createMockStepExecutor(
          new Map([
            ["cp-node", { success: true, output }],
          ]),
        ),
        checkpointManager: cpManager,
      });
      const nodes: WorkflowNode[] = [{
        id: "cp-node",
        dependsOn: [],
        config: { type: "step", checkpoint: true } as any,
      }];

      const execution = exec.execute(
        nodes,
        createTestRun({ workerId: "current-worker" }),
      );
      await saveStarted;
      output.topic = "mutated";
      resumeSave();
      await execution;

      assertEquals(savedTopic, "original");
    });

    it("detaches owned checkpoint context before an asynchronous fence", async () => {
      const contextValue = { topic: "original" };
      let resumeSave!: () => void;
      let reportSaveStarted!: () => void;
      const saveGate = new Promise<void>((resolve) => {
        resumeSave = resolve;
      });
      const saveStarted = new Promise<void>((resolve) => {
        reportSaveStarted = resolve;
      });
      let savedTopic: unknown;
      const backend = {
        saveCheckpoint: () => Promise.resolve(),
        getLatestCheckpoint: () => Promise.resolve(null),
      } as unknown as WorkflowBackend;
      const cpManager = new (class extends CheckpointManager {
        override async save(_runId: string, checkpoint: Checkpoint): Promise<boolean> {
          reportSaveStarted();
          await saveGate;
          savedTopic = (checkpoint.context.value as { topic: string }).topic;
          return true;
        }
      })({ backend });
      const exec = new DAGExecutor({ stepExecutor, checkpointManager: cpManager });
      const checkpointExecutor = exec as unknown as {
        checkpoint(
          runId: string,
          nodeId: string,
          context: WorkflowContext,
          nodeStates: Record<string, NodeState>,
          ownership: { runId: string; workerId: string },
        ): Promise<void>;
      };

      const saving = checkpointExecutor.checkpoint(
        "test-run",
        "cp-node",
        { input: {}, value: contextValue },
        {},
        { runId: "test-run", workerId: "current-worker" },
      );
      await saveStarted;
      contextValue.topic = "mutated";
      resumeSave();
      await saving;

      assertEquals(savedTopic, "original");
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

      const exec = new DAGExecutor({ stepExecutor: trackingExecutor, maxConcurrency: 1 });
      const nodes: WorkflowNode[] = [
        { id: "a", dependsOn: [], config: { type: "step" } as any },
        { id: "b", dependsOn: [], config: { type: "step" } as any },
      ];

      await exec.execute(nodes, createTestRun(), "b");
      assertEquals(
        order,
        ["b", "a"],
        "startFromNode must seed the first batch, not the natural ready set",
      );
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

  it("runs dependency-free static branches concurrently", async () => {
    let activeSteps = 0;
    let maxActiveSteps = 0;
    const exec = new DAGExecutor({
      maxConcurrency: 2,
      stepExecutor: new MockStepExecutor(new Map(), async (node) => {
        activeSteps += 1;
        maxActiveSteps = Math.max(maxActiveSteps, activeSteps);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeSteps -= 1;
        return { success: true, output: node.id, executionTime: 5 };
      }),
    });
    const nodes: WorkflowNode[] = [
      {
        id: "first-branch",
        dependsOn: [],
        config: {
          type: "branch",
          condition: () => true,
          then: [{ id: "first-child", config: { type: "step" } as any }],
          else: [{ id: "first-alternate", config: { type: "step" } as any }],
        } as any,
      },
      {
        id: "second-branch",
        dependsOn: [],
        config: {
          type: "branch",
          condition: () => true,
          then: [{ id: "second-child", config: { type: "step" } as any }],
          else: [{ id: "second-alternate", config: { type: "step" } as any }],
        } as any,
      },
    ];

    const result = await exec.execute(nodes, createTestRun());

    assertEquals(result.completed, true);
    assertEquals(maxActiveSteps, 2);
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
