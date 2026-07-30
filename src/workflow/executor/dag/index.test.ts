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
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { DAGExecutor } from "./index.ts";
import type {
  Checkpoint,
  LoopExecutionContext,
  RetryConfig,
  WorkflowContext,
  WorkflowNode,
  WorkflowRun,
} from "../../types.ts";
import { StepExecutor, type StepResult } from "../step-executor.ts";
import { CheckpointManager, type CheckpointOwnership } from "../checkpoint-manager.ts";
import type { WorkflowBackend } from "../../backends/types.ts";
import { MemoryBackend } from "../../backends/memory.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { branch, parallel, sequence, step } from "../../dsl/index.ts";

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
    updateRunIfStatus: () => Promise.resolve(true),
    listRuns: () => Promise.resolve([]),
    saveCheckpoint: () => Promise.resolve(),
    getLatestCheckpoint: () => Promise.resolve(null),
    savePendingApproval: () => Promise.resolve(),
    getPendingApprovals: () => Promise.resolve([]),
    getApproval: () => Promise.resolve(null),
    listPendingApprovals: () => Promise.resolve([]),
    updatePendingApproval: () => Promise.resolve(),
    updateApproval: () => Promise.resolve(true),
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

class RecordingCheckpointManager extends CheckpointManager {
  saved: Array<{ runId: string; nodeId: string }> = [];

  override async save(
    runId: string,
    checkpoint: Checkpoint,
    ownership?: CheckpointOwnership,
  ): Promise<boolean> {
    this.saved.push({ runId, nodeId: checkpoint.nodeId });
    return await super.save(runId, checkpoint, ownership);
  }
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

function createNestedCheckpointNodes(): WorkflowNode[] {
  const checkpointedStep = (): WorkflowNode => ({
    id: "checkpoint-child",
    config: { type: "step", tool: "test", checkpoint: true },
  });

  return [
    {
      id: "checkpoint-parallel",
      config: {
        type: "parallel",
        nodes: [checkpointedStep()],
        checkpoint: false,
      },
    },
    {
      id: "checkpoint-branch",
      config: {
        type: "branch",
        condition: () => true,
        then: [checkpointedStep()],
        checkpoint: false,
      },
    },
    {
      id: "checkpoint-map",
      config: {
        type: "map",
        items: [{ item: 1 }],
        processor: checkpointedStep(),
        concurrency: 1,
        checkpoint: false,
      },
    },
    {
      id: "checkpoint-loop",
      config: {
        type: "loop",
        while: (_context, loop) => loop.iteration === 0,
        steps: [checkpointedStep()],
        maxIterations: 1,
        checkpoint: false,
      },
    },
    {
      id: "checkpoint-sub-workflow",
      config: {
        type: "subWorkflow",
        workflow: {
          id: "nested-checkpoint-workflow",
          steps: [checkpointedStep()],
        },
        checkpoint: false,
      },
    },
  ];
}

async function executeNestedCheckpointGraph(): Promise<{
  backend: MemoryBackend;
  checkpointManager: RecordingCheckpointManager;
  nodes: WorkflowNode[];
  run: WorkflowRun;
}> {
  const backend = new MemoryBackend();
  const checkpointManager = new RecordingCheckpointManager({ backend });
  const run = createTestRun({
    id: "canonical-checkpoint-run",
    workerId: "run-execution:checkpoint-owner",
  });
  const nodes = createNestedCheckpointNodes();
  await backend.createRun(run);

  const executor = new DAGExecutor({
    stepExecutor: createMockStepExecutor(),
    checkpointManager,
  });
  const result = await executor.execute(
    nodes,
    run,
    undefined,
    undefined,
    { runId: run.id, workerId: run.workerId! },
  );
  assertEquals(result.completed, true);

  return { backend, checkpointManager, nodes, run };
}

function createNestedRoute(): WorkflowNode {
  return branch("route", {
    condition: () => true,
    then: [
      parallel(
        "inner",
        sequence(
          step("prepare", { tool: "prepare" }),
          step("publish", { tool: "publish" }),
        ),
      ),
    ],
  });
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
      const nodes: WorkflowNode[] = [{
        id: "step1",
        config: { type: "step", tool: "test" } as any,
      }];

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
        { id: "a", config: { type: "step", tool: "test" } as any },
        { id: "b", config: { type: "step", tool: "test" } as any },
        { id: "c", config: { type: "step", tool: "test" } as any },
      ];

      const result = await exec.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
      assertEquals(order, ["a", "b", "c"]);
    });

    it("rejects duplicate node IDs before executing either declaration", async () => {
      let executions = 0;
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), () => {
          executions++;
          return { success: true, executionTime: 1 };
        }),
      });

      await assertRejects(
        () =>
          exec.execute(
            [
              { id: "duplicate", config: { type: "step", tool: "test" } as any },
              { id: "duplicate", config: { type: "step", tool: "test" } as any },
            ],
            createTestRun(),
          ),
        Error,
        'duplicate node ID "duplicate"',
      );
      assertEquals(executions, 0);
    });
  });

  describe("parallel execution with explicit dependencies", () => {
    it("should execute independent nodes in parallel", async () => {
      const nodes: WorkflowNode[] = [
        { id: "a", dependsOn: [], config: { type: "step", tool: "test" } as any },
        { id: "b", dependsOn: [], config: { type: "step", tool: "test" } as any },
        { id: "c", dependsOn: ["a", "b"], config: { type: "step", tool: "test" } as any },
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
            steps: [{ id: "writer", config: { type: "step", tool: "test" } as any }],
          } as any,
        },
        { id: "reader", dependsOn: [], config: { type: "step", tool: "test" } as any },
      ];

      const result = await isolatedExecutor.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(result.nodeStates["reader"]!.output, { sawWriter: false });
      assertEquals(result.context["loop/writer"], "written");
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
            steps: [{ id: "writer", config: { type: "step", tool: "test" } as any }],
          } as any,
        },
        { id: "observer", dependsOn: [], config: { type: "step", tool: "test" } as any },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      // Isolation: the observer ran against the batch-start snapshot, so the
      // mutator's mid-flight write was invisible to it.
      assertEquals(result.nodeStates["observer"]!.output, { sawWriter: false });
      // Deterministic merge-back: after the batch settles, BOTH siblings'
      // context updates are present in the merged context.
      assertEquals(result.context["mutator/writer"], "written");
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
          { id: "mutator", dependsOn: [], config: { type: "step", tool: "test" } as any },
          { id: "observer", dependsOn: [], config: { type: "step", tool: "test" } as any },
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
            config: { type: "step", tool: "test" } as any,
          },
          { id: "observer", dependsOn: [], config: { type: "step", tool: "test" } as any },
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
          { id: "first", dependsOn: [], config: { type: "step", tool: "test" } as any },
          { id: "second", dependsOn: [], config: { type: "step", tool: "test" } as any },
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
            nodes: [{ id: "child", config: { type: "step", tool: "test" } as any }],
          },
          {
            type: "branch",
            condition: () => true,
            then: [{ id: "child", config: { type: "step", tool: "test" } as any }],
          },
        ]
      ) {
        const result = await exec.execute(
          [
            { id: "writer", dependsOn: [], config: { type: "step", tool: "test" } as any },
            { id: "compound", dependsOn: [], config: config as any },
          ],
          createTestRun({ context: { input: {}, shared: "stale" } }),
        );

        assertEquals(result.completed, true);
        assertEquals(result.context.shared, "fresh");
        const childId = config.type === "parallel" ? "compound/child" : "compound/then/child";
        assertEquals(result.context[childId], childId);
      }
    });

    it("propagates top-level context deletions", async () => {
      const deletingExecutor = new MockStepExecutor(new Map(), (_node, context) => {
        delete context.removed;
        return { success: true, output: "deleted", executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: deletingExecutor });

      const result = await exec.execute(
        [{ id: "delete", config: { type: "step", tool: "test" } as any }],
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
            then: [{ id: "delete-child", config: { type: "step", tool: "test" } as any }],
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
        { id: "fail-node", config: { type: "step", tool: "test" } as any },
        { id: "after", config: { type: "step", tool: "test" } as any },
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
        config: { type: "step", tool: "test" } as any,
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
        [{ id: "failed-mutator", config: { type: "step", tool: "test" } as any }],
        createTestRun({ context: { input: {}, shared: { count: 0 }, removed: true } }),
      );

      assertEquals(result.completed, false);
      assertEquals(result.context.shared, { count: 0 });
      assertEquals(result.context.removed, true);
    });

    it("discards the complete context patch from a failed compound node", async () => {
      const failedCompoundExecutor = new MockStepExecutor(new Map(), (node, context) => {
        if (node.id === "failed-parallel/successful-child") {
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
              {
                id: "successful-child",
                dependsOn: [],
                config: { type: "step", tool: "test" } as any,
              },
              { id: "failed-child", dependsOn: [], config: { type: "step", tool: "test" } as any },
            ],
          } as any,
        }],
        createTestRun({ context: { input: {}, shared: { count: 0 } } }),
      );

      assertEquals(result.completed, false);
      assertEquals(result.context.shared, { count: 0 });
      assertEquals(Object.hasOwn(result.context, "failed-parallel/successful-child"), false);
      assertEquals(
        result.nodeStates["failed-parallel/successful-child"]?.status,
        "completed",
      );
    });

    it("rejects workflow context that cannot be cloned", async () => {
      const run = createTestRun({
        context: { input: {}, callback: () => undefined },
      });

      const error = await assertRejects(
        () =>
          executor.execute([{ id: "step", config: { type: "step", tool: "test" } as any }], run),
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
        () =>
          exec.execute(
            [{ id: "step", config: { type: "step", tool: "test" } as any }],
            createTestRun(),
          ),
        Error,
        "Workflow context changes must contain only structured-cloneable values",
      );

      assertEquals((error as { slug?: string }).slug, "invalid-argument");
    });
  });

  describe("cycle detection", () => {
    it("should detect and report cycles", async () => {
      const nodes: WorkflowNode[] = [
        { id: "a", dependsOn: ["b"], config: { type: "step", tool: "test" } as any },
        { id: "b", dependsOn: ["a"], config: { type: "step", tool: "test" } as any },
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
        { id: "after", config: { type: "step", tool: "test" } as any },
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
        { id: "done", dependsOn: [], config: { type: "step", tool: "test" } as any },
        { id: "next", config: { type: "step", tool: "test" } as any },
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

  describe("persistent node identity admission", () => {
    it("rejects a flattened DSL identity collision before any callbacks", async () => {
      const calls = {
        nodeStart: 0,
        skip: 0,
        nodeComplete: 0,
        child: 0,
      };
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), () => {
          calls.child++;
          return { success: true, executionTime: 1 };
        }),
        onNodeStart: () => calls.nodeStart++,
        onNodeComplete: () => calls.nodeComplete++,
      });

      await assertRejects(
        () =>
          exec.execute(
            [
              parallel("p", [
                step("x", {
                  tool: "nested",
                  skip: () => {
                    calls.skip++;
                    return false;
                  },
                }),
              ]),
              step("p/x", {
                tool: "top-level",
                skip: () => {
                  calls.skip++;
                  return false;
                },
              }),
            ],
            createTestRun(),
          ),
        Error,
        'duplicate node ID "p/x"',
      );

      assertEquals(calls, {
        nodeStart: 0,
        skip: 0,
        nodeComplete: 0,
        child: 0,
      });
    });

    it("namespaces raw sibling composite descendants across every static composite kind", async () => {
      const executions: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executions.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const shared = (): WorkflowNode => ({
        id: "shared",
        config: { type: "step", tool: "test" } as any,
      });
      const nodes: WorkflowNode[] = [
        {
          id: "raw-parallel",
          config: { type: "parallel", nodes: [shared()] },
        },
        {
          id: "raw-branch",
          config: {
            type: "branch",
            condition: () => true,
            then: [shared()],
          },
        },
        {
          id: "raw-loop",
          config: {
            type: "loop",
            maxIterations: 1,
            while: () => true,
            steps: [shared()],
          },
        },
        {
          id: "raw-sub-workflow",
          config: {
            type: "subWorkflow",
            workflow: {
              id: "raw-child-workflow",
              steps: [shared()],
            },
          },
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(executions, [
        "raw-parallel/shared",
        "raw-branch/then/shared",
        "raw-loop/shared",
        "raw-sub-workflow/shared",
      ]);
    });

    it("namespaces descendants returned by dynamic loop and sub-workflow builders", async () => {
      const executions: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executions.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nodes: WorkflowNode[] = [
        {
          id: "dynamic-loop",
          config: {
            type: "loop",
            maxIterations: 1,
            while: () => true,
            steps: () => [{ id: "child", config: { type: "step", tool: "test" } as any }],
          },
        },
        {
          id: "dynamic-sub-workflow",
          config: {
            type: "subWorkflow",
            workflow: {
              id: "dynamic-child-workflow",
              steps: () => [{ id: "child", config: { type: "step", tool: "test" } as any }],
            },
          },
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(executions, [
        "dynamic-loop/child",
        "dynamic-sub-workflow/child",
      ]);
    });

    it("rebases every reused map processor subtree to its persistent item identity", async () => {
      const executions: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executions.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const processor = parallel(
        "processor",
        sequence(
          step("prepare", { tool: "prepare" }),
          step("publish", { tool: "publish" }),
        ),
      );
      const nodes: WorkflowNode[] = [
        {
          id: "first-map",
          config: { type: "map", items: [1], processor },
        },
        {
          id: "second-map",
          config: { type: "map", items: [2], processor },
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(executions, [
        "first-map_0/prepare",
        "first-map_0/publish",
        "second-map_0/prepare",
        "second-map_0/publish",
      ]);
    });

    it("resumes only the qualified descendant in a mapped processor subtree", async () => {
      const executions: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          executions.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const completedNodeId = "mapped_0/prepare";
      const processor = parallel(
        "processor",
        sequence(
          step("prepare", { tool: "prepare" }),
          step("publish", { tool: "publish" }),
        ),
      );
      const run = createTestRun({
        nodeStates: {
          [completedNodeId]: {
            nodeId: completedNodeId,
            status: "completed",
            output: completedNodeId,
            attempt: 1,
            completedAt: new Date(),
          },
        },
        context: {
          input: { topic: "test" },
          [completedNodeId]: completedNodeId,
        },
      });

      const result = await exec.execute(
        [{ id: "mapped", config: { type: "map", items: [1], processor } }],
        run,
      );

      assertEquals(result.completed, true);
      assertEquals(executions, ["mapped_0/publish"]);
      assertEquals(result.nodeStates[completedNodeId]?.status, "completed");
    });
  });

  describe("branch node", () => {
    it("executes sequenced branch children after namespacing their dependencies", async () => {
      const order: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          order.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nodes = [
        branch("route", {
          condition: () => true,
          then: sequence(
            step("classify", { tool: "classify" }),
            step("respond", { tool: "respond" }),
          ),
        }),
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(order, ["route/then/classify", "route/then/respond"]);
    });

    it("should execute then-branch when condition is true", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "branch1",
          dependsOn: [],
          config: {
            type: "branch",
            condition: () => true,
            then: [{ id: "then-step", config: { type: "step", tool: "test" } as any }],
            else: [{ id: "else-step", config: { type: "step", tool: "test" } as any }],
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
          then: [{ id: "must-not-run", config: { type: "step", tool: "test" } as any }],
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
    it("starts independent DSL children concurrently by default", async () => {
      let activeExecutions = 0;
      let maxActiveExecutions = 0;
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), async (node) => {
          activeExecutions++;
          maxActiveExecutions = Math.max(maxActiveExecutions, activeExecutions);
          await Promise.resolve();
          activeExecutions--;
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nodes = [
        parallel("batch", [
          step("first", { tool: "first" }),
          step("second", { tool: "second" }),
        ]),
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(maxActiveExecutions, 2);
    });

    it("executes sequenced parallel children after namespacing their dependencies", async () => {
      const order: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          order.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nodes = [
        parallel(
          "batch",
          sequence(
            step("prepare", { tool: "prepare" }),
            step("publish", { tool: "publish" }),
          ),
        ),
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(order, ["batch/prepare", "batch/publish"]);
    });

    it("fails a composite graph with duplicate child IDs before executing them", async () => {
      let executions = 0;
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), () => {
          executions++;
          return { success: true, executionTime: 1 };
        }),
      });
      const nodes = [
        parallel("batch", [
          step("duplicate", { tool: "first" }),
          step("duplicate", { tool: "second" }),
        ]),
      ];

      await assertRejects(
        () => exec.execute(nodes, createTestRun()),
        Error,
        'duplicate node ID "batch/duplicate"',
      );
      assertEquals(executions, 0);
    });

    it("fully namespaces dependent descendants in same-named nested composites", async () => {
      const order: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          order.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nodes = sequence(
        parallel("outer-one", [createNestedRoute()]),
        parallel("outer-two", [createNestedRoute()]),
      );

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(order, [
        "outer-one/route/then/inner/prepare",
        "outer-one/route/then/inner/publish",
        "outer-two/route/then/inner/prepare",
        "outer-two/route/then/inner/publish",
      ]);
      for (const nodeId of order) {
        assertEquals(result.nodeStates[nodeId]?.status, "completed");
        assertEquals(result.context[nodeId], nodeId);
      }
    });

    it("resumes only the fully-qualified descendant from its owning composite", async () => {
      const order: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          order.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const resumedNodeId = "outer-one/route/then/inner/prepare";
      const nodes = sequence(
        parallel("outer-one", [createNestedRoute()]),
        parallel("outer-two", [createNestedRoute()]),
      );
      const run = createTestRun({
        nodeStates: {
          [resumedNodeId]: {
            nodeId: resumedNodeId,
            status: "completed",
            output: resumedNodeId,
            attempt: 1,
            completedAt: new Date(),
          },
        },
        context: {
          input: { topic: "test" },
          [resumedNodeId]: resumedNodeId,
        },
      });

      const result = await exec.execute(nodes, run);

      assertEquals(result.completed, true);
      assertEquals(order, [
        "outer-one/route/then/inner/publish",
        "outer-two/route/then/inner/prepare",
        "outer-two/route/then/inner/publish",
      ]);
      assertEquals(result.nodeStates[resumedNodeId]?.status, "completed");
      assertEquals(result.context[resumedNodeId], resumedNodeId);
    });

    it("preserves descendants already qualified for the outer composite", async () => {
      const order: string[] = [];
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          order.push(node.id);
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      const nodes = [
        parallel("outer", [
          branch("outer/route", {
            condition: () => true,
            then: [
              parallel(
                "outer/route/then/inner",
                sequence(
                  step("outer/route/then/inner/prepare", { tool: "prepare" }),
                  step("outer/route/then/inner/publish", { tool: "publish" }),
                ),
              ),
            ],
          }),
        ]),
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, true);
      assertEquals(order, [
        "outer/route/then/inner/prepare",
        "outer/route/then/inner/publish",
      ]);
    });

    it("should execute parallel sub-nodes", async () => {
      const nodes: WorkflowNode[] = [
        {
          id: "par1",
          dependsOn: [],
          config: {
            type: "parallel",
            nodes: [
              { id: "p-a", dependsOn: [], config: { type: "step", tool: "test" } as any },
              { id: "p-b", dependsOn: [], config: { type: "step", tool: "test" } as any },
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
        if (node.id === "par1/p-step") {
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
              { id: "p-step", dependsOn: [], config: { type: "step", tool: "test" } as any },
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
      // The composite node is the waiting node reported to the executor.
      assertEquals(first.waitingNode, "par1");
      assertEquals(stepARuns, 1);
      assertEquals(first.nodeStates["par1/p-step"]!.status, "completed");
      assertEquals(Object.hasOwn(first.context, "removed"), false);

      // Resume: mark the wait node completed (approval granted) and re-run with
      // the accumulated nodeStates from the first run. The real executor resumes
      // by passing the waiting node id as startFromNode.
      const resumedStates = {
        ...first.nodeStates,
        "par1/p-wait": {
          ...first.nodeStates["par1/p-wait"]!,
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
            processor: { id: "proc", config: { type: "step", tool: "test" } as any },
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
            processor: { id: "proc", config: { type: "step", tool: "test" } as any },
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
            processor: { id: "proc", config: { type: "step", tool: "test" } as any },
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
            processor: { id: "proc", config: { type: "step", tool: "test" } as any },
          } as any,
        },
      ];

      const result = await executor.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
    });

    it("should reject defined invalid map concurrency instead of using the default", async () => {
      for (const concurrency of [0, Number.NaN]) {
        const nodes: WorkflowNode[] = [
          {
            id: "map-invalid-concurrency",
            dependsOn: [],
            config: {
              type: "map",
              items: ["item"],
              processor: { id: "proc", config: { type: "step", tool: "test" } as any },
              concurrency,
            } as any,
          },
        ];

        const result = await executor.execute(nodes, createTestRun());

        assertEquals(result.completed, false);
        assertEquals(
          result.error?.includes("maxConcurrency must be a positive safe integer"),
          true,
        );
      }
    });

    it("rejects raw map concurrency before resolving items", async () => {
      const invalidValues = [
        0,
        -1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ];

      for (const [index, concurrency] of invalidValues.entries()) {
        let itemCalls = 0;
        let stepExecutions = 0;
        const exec = new DAGExecutor({
          stepExecutor: new MockStepExecutor(new Map(), () => {
            stepExecutions++;
            return { success: true, executionTime: 1 };
          }),
        });
        const node: WorkflowNode = {
          id: `raw-map-${index}`,
          config: {
            type: "map",
            items: () => {
              itemCalls++;
              return [];
            },
            processor: { id: "processor", config: { type: "step", tool: "test" } as any },
            concurrency,
          },
        };

        const result = await exec.execute([node], createTestRun());

        assertEquals(result.completed, false);
        assertEquals(result.error?.includes("maxConcurrency"), true);
        assertEquals(itemCalls, 0);
        assertEquals(stepExecutions, 0);
      }
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
            steps: [{ id: "loop-step", config: { type: "step", tool: "test" } as any }],
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
            steps: [{ id: "ls", config: { type: "step", tool: "test" } as any }],
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
        new Map([["loop-error/bad-step", { success: false, error: "bad step" }]]),
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
            steps: [{ id: "bad-step", config: { type: "step", tool: "test" } as any }],
          } as any,
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      const state = result.nodeStates["loop-error"]!;
      const output = state.output as { exitReason: string; iterations: number };
      assertEquals(result.completed, false);
      assertEquals(state.status, "failed");
      assertEquals(state.error, 'Node "loop-error/bad-step" failed: bad step');
      assertEquals(output.exitReason, "error");
      assertEquals(output.iterations, 0);
      assertEquals(result.context["loop-error"], undefined);
    });

    it("rejects raw maxIterations before invoking loop callbacks", async () => {
      const invalidValues = [
        0,
        -1,
        1.5,
        101,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ];

      for (const [index, maxIterations] of invalidValues.entries()) {
        let callbackCalls = 0;
        let stepExecutions = 0;
        const exec = new DAGExecutor({
          stepExecutor: new MockStepExecutor(new Map(), () => {
            stepExecutions++;
            return { success: true, executionTime: 1 };
          }),
        });
        const node: WorkflowNode = {
          id: `raw-loop-max-${index}`,
          config: {
            type: "loop",
            maxIterations,
            while: () => {
              callbackCalls++;
              return false;
            },
            steps: [{ id: "child", config: { type: "step", tool: "test" } as any }],
            onComplete: () => {
              callbackCalls++;
              return {};
            },
            onMaxIterations: () => {
              callbackCalls++;
              return {};
            },
          },
        };

        const result = await exec.execute([node], createTestRun());

        assertEquals(result.completed, false);
        assertEquals(result.error?.includes("maxIterations"), true);
        assertEquals(callbackCalls, 0);
        assertEquals(stepExecutions, 0);
      }
    });

    it("rejects raw invalid loop delay before condition or child work", async () => {
      const invalidValues: Array<string | number> = [
        -1,
        0.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER,
        "0ms",
      ];

      for (const [index, delay] of invalidValues.entries()) {
        let conditionCalls = 0;
        let stepExecutions = 0;
        const exec = new DAGExecutor({
          stepExecutor: new MockStepExecutor(new Map(), () => {
            stepExecutions++;
            return { success: true, executionTime: 1 };
          }),
        });
        const node: WorkflowNode = {
          id: `raw-loop-delay-${index}`,
          config: {
            type: "loop",
            maxIterations: 2,
            delay,
            while: () => {
              conditionCalls++;
              return true;
            },
            steps: [{ id: "child", config: { type: "step", tool: "test" } as any }],
          },
        };

        const result = await exec.execute([node], createTestRun());

        assertEquals(result.completed, false);
        assertEquals(result.error?.includes("delay"), true);
        assertEquals(conditionCalls, 0);
        assertEquals(stepExecutions, 0);
      }
    });

    it("preserves numeric zero as a valid raw loop delay", async () => {
      let stepExecutions = 0;
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), () => {
          stepExecutions++;
          return { success: true, executionTime: 1 };
        }),
      });
      const node: WorkflowNode = {
        id: "raw-loop-zero-delay",
        config: {
          type: "loop",
          maxIterations: 2,
          delay: 0,
          while: () => true,
          steps: [{ id: "child", config: { type: "step", tool: "test" } as any }],
        },
      };

      const result = await exec.execute([node], createTestRun());

      assertEquals(result.completed, true);
      assertEquals(stepExecutions, 2);
    });
  });

  describe("loop resume (H9)", () => {
    it("should not re-run completed steps of an in-flight loop iteration on resume", async () => {
      let incrRuns = 0;
      const trackingExecutor = new MockStepExecutor(new Map(), (node) => {
        if (node.id === "loop1/l-incr") incrRuns++;
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
              { id: "l-incr", dependsOn: [], config: { type: "step", tool: "test" } as any },
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
      assertEquals(first.waitingNode, "loop1");
      assertEquals(incrRuns, 1);
      assertEquals(first.nodeStates["loop1/l-incr"]!.status, "completed");

      // Resume: approve the wait and re-run from the loop node, carrying the
      // accumulated state. The pre-wait step must NOT run again for this
      // iteration.
      const resumedStates = {
        ...first.nodeStates,
        "loop1/l-wait": {
          ...first.nodeStates["loop1/l-wait"]!,
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
              steps: [{ id: "sub-step", config: { type: "step", tool: "test" } as any }],
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
              steps: [{ id: "inner", config: { type: "step", tool: "test" } as any }],
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
          config: { type: "step", tool: "test", checkpoint: true } as any,
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
        config: { type: "step", tool: "test" } as any,
      }];

      await exec.execute(nodes, createTestRun());
      assertEquals(cpManager.saved.length, 0);
    });

    it("stores all five composite descendants under the canonical root run", async () => {
      const { checkpointManager, run } = await executeNestedCheckpointGraph();

      assertEquals(checkpointManager.saved, [
        { runId: run.id, nodeId: "checkpoint-parallel/checkpoint-child" },
        { runId: run.id, nodeId: "checkpoint-branch/then/checkpoint-child" },
        { runId: run.id, nodeId: "checkpoint-map_0" },
        { runId: run.id, nodeId: "checkpoint-loop/checkpoint-child" },
        { runId: run.id, nodeId: "checkpoint-sub-workflow/checkpoint-child" },
      ]);
      assertEquals((await checkpointManager.getAll(run.id)).length, 5);
    });

    it("resumes a composite from its root-owned descendant checkpoint", async () => {
      const backend = new MemoryBackend();
      const checkpointManager = new RecordingCheckpointManager({ backend });
      const run = createTestRun({
        id: "canonical-resume-run",
        workerId: "run-execution:resume-owner",
      });
      const ownership = { runId: run.id, workerId: run.workerId! };
      const nodes: WorkflowNode[] = [{
        id: "resume-parallel",
        config: {
          type: "parallel",
          strategy: "allSettled",
          checkpoint: false,
          nodes: [
            {
              id: "first",
              config: { type: "step", tool: "test", checkpoint: true },
            },
            {
              id: "pause",
              config: {
                type: "wait",
                waitType: "event",
                eventName: "resume-event",
                checkpoint: false,
              },
            },
          ],
        },
      }];
      let firstExecutions = 0;
      const executor = new DAGExecutor({
        checkpointManager,
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          if (node.id === "resume-parallel/first") firstExecutions++;
          return { success: true, output: node.id, executionTime: 1 };
        }),
      });
      await backend.createRun(run);

      const firstResult = await executor.execute(
        nodes,
        run,
        undefined,
        undefined,
        ownership,
      );
      assertEquals(firstResult.waiting, true);
      const resumeInfo = await checkpointManager.prepareResume(run.id, nodes);
      assertExists(resumeInfo);

      const resumedResult = await executor.execute(
        nodes,
        {
          ...run,
          context: resumeInfo.context,
          nodeStates: resumeInfo.nodeStates,
        },
        resumeInfo.startFromNode,
        undefined,
        ownership,
      );

      assertEquals(resumedResult.waiting, true);
      assertEquals(firstExecutions, 1);
    });

    it("makes nested checkpoints visible to root-scoped retention cleanup", async () => {
      const { checkpointManager, run } = await executeNestedCheckpointGraph();

      await checkpointManager.cleanup(run.id, 2);

      assertEquals((await checkpointManager.getAll(run.id)).length, 2);
    });

    it("leaves no synthetic checkpoint orphans after deleting the root run", async () => {
      const { backend, checkpointManager, run } = await executeNestedCheckpointGraph();
      const storageRunIds = new Set(checkpointManager.saved.map(({ runId }) => runId));

      await backend.deleteRun(run.id);

      for (const storageRunId of storageRunIds) {
        assertEquals(await backend.getLatestCheckpoint(storageRunId), null);
      }
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
        config: { type: "step", tool: "test" } as any,
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
        { id: "b", dependsOn: [], config: { type: "step", tool: "test" } as any },
        { id: "a", dependsOn: ["b"], config: { type: "step", tool: "test" } as any },
      ];

      await exec.execute(nodes, createTestRun(), "b");
      assertEquals(order[0], "b");
    });
  });

  describe("maxConcurrency", () => {
    it("should reject values that cannot make forward progress safely", () => {
      const invalidValues = [
        0,
        -1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ];

      for (const maxConcurrency of invalidValues) {
        assertThrows(
          () => new DAGExecutor({ stepExecutor, maxConcurrency }),
          Error,
          "maxConcurrency must be a positive safe integer",
        );
      }
    });

    it("should respect maxConcurrency config", async () => {
      const exec = new DAGExecutor({ stepExecutor, maxConcurrency: 1 });

      const nodes: WorkflowNode[] = [
        { id: "a", dependsOn: [], config: { type: "step", tool: "test" } as any },
        { id: "b", dependsOn: [], config: { type: "step", tool: "test" } as any },
      ];

      const result = await exec.execute(nodes, createTestRun());
      assertEquals(result.completed, true);
    });
  });

  describe("runtime timer validation", () => {
    it("accepts zero cancellation grace but rejects invalid values", () => {
      new DAGExecutor({ stepExecutor, cancellationGracePeriod: 0 });

      for (
        const cancellationGracePeriod of [
          -1,
          0.5,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.MAX_SAFE_INTEGER,
        ]
      ) {
        assertThrows(
          () => new DAGExecutor({ stepExecutor, cancellationGracePeriod }),
          Error,
          "cancellationGracePeriod",
        );
      }
    });

    it("rejects a raw zero composite timeout before executing its children", async () => {
      let executions = 0;
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), () => {
          executions++;
          return { success: true, executionTime: 1 };
        }),
      });
      const node: WorkflowNode = {
        id: "invalid-timeout",
        config: {
          type: "parallel",
          timeout: 0,
          nodes: [{ id: "child", config: { type: "step", tool: "test" } as any }],
        },
      };

      const result = await exec.execute([node], createTestRun());

      assertEquals(result.completed, false);
      assertEquals(result.error?.includes("timeout must be greater than zero"), true);
      assertEquals(executions, 0);
    });

    const compositeTypes = ["parallel", "map", "branch", "loop", "subWorkflow"] as const;
    const invalidPolicies: Array<{
      name: string;
      config: { timeout: number } | { retry: { maxAttempts: number } };
      expectedError: string;
    }> = [
      {
        name: "timeout",
        config: { timeout: 0 },
        expectedError: "timeout must be greater than zero",
      },
      {
        name: "retry",
        config: { retry: { maxAttempts: 0 } },
        expectedError: "maxAttempts must be a positive integer",
      },
      {
        name: "numeric retry",
        config: { retry: 5 as unknown as { maxAttempts: number } },
        expectedError: "plain record",
      },
      {
        name: "falsy retry",
        config: { retry: false as unknown as { maxAttempts: number } },
        expectedError: "plain record",
      },
    ];

    for (const compositeType of compositeTypes) {
      for (const invalidPolicy of invalidPolicies) {
        for (const skipResult of [false, true]) {
          it(
            `rejects raw ${compositeType} ${invalidPolicy.name} before side effects when skip returns ${skipResult}`,
            async () => {
              const calls = {
                nodeStart: 0,
                skip: 0,
                nodeComplete: 0,
                strategy: 0,
                child: 0,
              };
              const nodeId = `raw-${compositeType}-${invalidPolicy.name}-skip-${skipResult}`;
              const child = (): WorkflowNode => ({
                id: `${nodeId}/child`,
                config: { type: "step", tool: "test" } as any,
              });
              const skip = () => {
                calls.skip++;
                return skipResult;
              };
              const common = { ...invalidPolicy.config, skip };
              let node: WorkflowNode;

              switch (compositeType) {
                case "parallel":
                  node = {
                    id: nodeId,
                    config: { type: "parallel", nodes: [child()], ...common },
                  };
                  break;
                case "map":
                  node = {
                    id: nodeId,
                    config: {
                      type: "map",
                      items: () => {
                        calls.strategy++;
                        return [1];
                      },
                      processor: child(),
                      concurrency: 1,
                      ...common,
                    },
                  };
                  break;
                case "branch":
                  node = {
                    id: nodeId,
                    config: {
                      type: "branch",
                      condition: () => {
                        calls.strategy++;
                        return true;
                      },
                      then: [child()],
                      ...common,
                    },
                  };
                  break;
                case "loop":
                  node = {
                    id: nodeId,
                    config: {
                      type: "loop",
                      maxIterations: 1,
                      while: () => {
                        calls.strategy++;
                        return true;
                      },
                      steps: [child()],
                      ...common,
                    },
                  };
                  break;
                case "subWorkflow":
                  node = {
                    id: nodeId,
                    config: {
                      type: "subWorkflow",
                      workflow: {
                        id: `${nodeId}/workflow`,
                        steps: [child()],
                      },
                      input: () => {
                        calls.strategy++;
                        return {};
                      },
                      ...common,
                    },
                  };
                  break;
              }

              const exec = new DAGExecutor({
                stepExecutor: new MockStepExecutor(new Map(), () => {
                  calls.child++;
                  return { success: true, executionTime: 1 };
                }),
                onNodeStart: () => calls.nodeStart++,
                onNodeComplete: () => calls.nodeComplete++,
              });

              const result = await exec.execute([node], createTestRun());

              assertEquals(calls, {
                nodeStart: 0,
                skip: 0,
                nodeComplete: 0,
                strategy: 0,
                child: 0,
              });
              assertEquals(result.completed, false);
              assertEquals(result.nodeStates[nodeId]?.status, "failed");
              assertEquals(result.error?.includes(invalidPolicy.expectedError), true);
            },
          );
        }
      }
    }

    it("preflights an invalid composite sibling before either sibling starts", async () => {
      const calls = { nodeStart: 0, nodeComplete: 0, skip: 0, valid: 0, child: 0 };
      const exec = new DAGExecutor({
        stepExecutor: new MockStepExecutor(new Map(), (node) => {
          if (node.id === "valid-sibling") calls.valid++;
          else calls.child++;
          return { success: true, executionTime: 1 };
        }),
        onNodeStart: () => calls.nodeStart++,
        onNodeComplete: () => calls.nodeComplete++,
      });
      const nodes: WorkflowNode[] = [
        {
          id: "valid-sibling",
          dependsOn: [],
          config: { type: "step" },
        },
        {
          id: "invalid-composite-sibling",
          dependsOn: [],
          config: {
            type: "parallel",
            retry: 5 as unknown as RetryConfig,
            skip: () => {
              calls.skip++;
              return false;
            },
            nodes: [{ id: "child", config: { type: "step" } }],
          },
        },
      ];

      const result = await exec.execute(nodes, createTestRun());

      assertEquals(result.completed, false);
      assertEquals(result.error?.includes("plain record"), true);
      assertEquals(calls, { nodeStart: 0, nodeComplete: 0, skip: 0, valid: 0, child: 0 });
    });

    const invalidStepPolicies = [
      {
        name: "retry",
        config: { retry: "three" as unknown as RetryConfig },
        expectedError: "plain record",
      },
      {
        name: "timeout",
        config: { timeout: 0 },
        expectedError: "timeout must be greater than zero",
      },
    ];

    for (const invalidStepPolicy of invalidStepPolicies) {
      it(
        `rejects a raw step ${invalidStepPolicy.name} before skip, input, lifecycle, or tool callbacks`,
        async () => {
          const calls = {
            nodeStart: 0,
            nodeComplete: 0,
            skip: 0,
            input: 0,
            stepStart: 0,
            stepComplete: 0,
            stepError: 0,
            tool: 0,
          };
          const stepExecutor = new StepExecutor({
            onStepStart: () => calls.stepStart++,
            onStepComplete: () => calls.stepComplete++,
            onStepError: () => calls.stepError++,
          });
          const exec = new DAGExecutor({
            stepExecutor,
            onNodeStart: () => calls.nodeStart++,
            onNodeComplete: () => calls.nodeComplete++,
          });
          const node: WorkflowNode = {
            id: `raw-step-${invalidStepPolicy.name}`,
            config: {
              type: "step",
              ...invalidStepPolicy.config,
              skip: () => {
                calls.skip++;
                return false;
              },
              input: () => {
                calls.input++;
                return {};
              },
              tool: {
                id: "must-not-run",
                description: "must not run when step policy admission fails",
                execute: () => {
                  calls.tool++;
                  return { ok: true };
                },
                // deno-lint-ignore no-explicit-any
              } as any,
            },
          };

          const result = await exec.execute([node], createTestRun());

          assertEquals(result.completed, false);
          assertEquals(result.error?.includes(invalidStepPolicy.expectedError), true);
          assertEquals(calls, {
            nodeStart: 0,
            nodeComplete: 0,
            skip: 0,
            input: 0,
            stepStart: 0,
            stepComplete: 0,
            stepError: 0,
            tool: 0,
          });
        },
      );
    }

    const staticContainerCases = [
      {
        name: "parallel child",
        create: (invalidStep: WorkflowNode, _strategy: () => void): WorkflowNode => ({
          id: "static-parallel",
          dependsOn: [],
          config: { type: "parallel", nodes: [invalidStep] },
        }),
      },
      {
        name: "unselected branch arm",
        create: (invalidStep: WorkflowNode, strategy: () => void): WorkflowNode => ({
          id: "static-branch",
          dependsOn: [],
          config: {
            type: "branch",
            condition: () => {
              strategy();
              return true;
            },
            then: [],
            else: [invalidStep],
          },
        }),
      },
      {
        name: "static loop child",
        create: (invalidStep: WorkflowNode, strategy: () => void): WorkflowNode => ({
          id: "static-loop",
          dependsOn: [],
          config: {
            type: "loop",
            maxIterations: 1,
            while: () => {
              strategy();
              return false;
            },
            steps: [invalidStep],
          },
        }),
      },
      {
        name: "static sub-workflow child",
        create: (invalidStep: WorkflowNode, strategy: () => void): WorkflowNode => ({
          id: "static-sub-workflow",
          dependsOn: [],
          config: {
            type: "subWorkflow",
            workflow: { id: "nested-workflow", steps: [invalidStep] },
            input: () => {
              strategy();
              return {};
            },
          },
        }),
      },
      {
        name: "map processor subtree",
        create: (invalidStep: WorkflowNode, strategy: () => void): WorkflowNode => ({
          id: "static-map",
          dependsOn: [],
          config: {
            type: "map",
            items: () => {
              strategy();
              return [];
            },
            processor: {
              id: "processor",
              config: { type: "parallel", nodes: [invalidStep] },
            },
          },
        }),
      },
    ];

    for (const staticContainerCase of staticContainerCases) {
      it(
        `preflights an invalid policy in a ${staticContainerCase.name} before scheduling siblings`,
        async () => {
          const calls = {
            nodeStart: 0,
            nodeComplete: 0,
            skip: 0,
            input: 0,
            strategy: 0,
            tool: 0,
          };
          const tool = {
            id: "must-not-run",
            description: "must not run when graph admission fails",
            execute: () => {
              calls.tool++;
              return { ok: true };
            },
            // deno-lint-ignore no-explicit-any
          } as any;
          const invalidStep: WorkflowNode = {
            id: "bad-policy",
            config: {
              type: "step",
              retry: "three" as unknown as RetryConfig,
              skip: () => {
                calls.skip++;
                return false;
              },
              input: () => {
                calls.input++;
                return {};
              },
              tool,
            },
          };
          const validSibling: WorkflowNode = {
            id: "valid-static-sibling",
            dependsOn: [],
            config: { type: "step", input: () => ({}), tool },
          };
          const container = staticContainerCase.create(
            invalidStep,
            () => calls.strategy++,
          );
          const stepExecutor = new StepExecutor({
            onStepStart: () => calls.nodeStart++,
            onStepComplete: () => calls.nodeComplete++,
            onStepError: () => calls.nodeComplete++,
          });
          const exec = new DAGExecutor({
            stepExecutor,
            onNodeStart: () => calls.nodeStart++,
            onNodeComplete: () => calls.nodeComplete++,
          });

          const result = await exec.execute([validSibling, container], createTestRun());

          assertEquals(result.completed, false);
          assertEquals(result.error?.includes("plain record"), true);
          assertEquals(calls, {
            nodeStart: 0,
            nodeComplete: 0,
            skip: 0,
            input: 0,
            strategy: 0,
            tool: 0,
          });
        },
      );
    }
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
        if (node.id !== "retrying-branch/then/retrying-branch-child") {
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
          then: [{ id: "retrying-branch-child", config: { type: "step", tool: "test" } as any }],
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
      assertEquals(
        result.nodeStates["retrying-branch/then/retrying-branch-child"]!.status,
        "completed",
      );
      assertEquals(
        result.context["retrying-branch/then/retrying-branch-child"],
        "recovered",
      );
    });

    it("keeps the selected branch stable across a parent retry", async () => {
      let conditionCalls = 0;
      let stableChildRuns = 0;
      let retryingChildRuns = 0;
      let elseChildRuns = 0;
      const trackingExecutor = new MockStepExecutor(new Map(), (node) => {
        if (node.id === "stable-retrying-branch/then/branch-stable-child") {
          stableChildRuns++;
          return { success: true, output: "stable", executionTime: 1 };
        }
        if (node.id === "stable-retrying-branch/then/branch-retrying-child") {
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
            return context["stable-retrying-branch/then/branch-stable-child"] === undefined;
          },
          then: [
            { id: "branch-stable-child", config: { type: "step", tool: "test" } as any },
            { id: "branch-retrying-child", config: { type: "step", tool: "test" } as any },
          ],
          else: [{ id: "branch-else-child", config: { type: "step", tool: "test" } as any }],
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
      assertEquals(
        result.context["stable-retrying-branch/then/branch-stable-child"],
        "stable",
      );
      assertEquals(
        result.context["stable-retrying-branch/then/branch-retrying-child"],
        "recovered",
      );
    });

    it("preserves successful parallel child context across a parent retry", async () => {
      let stableChildRuns = 0;
      let retryingChildRuns = 0;
      const trackingExecutor = new MockStepExecutor(new Map(), (node) => {
        if (node.id === "retrying-parallel/stable-child") {
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
            { id: "stable-child", dependsOn: [], config: { type: "step", tool: "test" } as any },
            { id: "retrying-child", dependsOn: [], config: { type: "step", tool: "test" } as any },
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
      assertEquals(result.context["retrying-parallel/stable-child"], "stable");
      assertEquals(result.context["retrying-parallel/retrying-child"], "recovered");
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
          if (nodeId === "parallel-policy/parallel-child") completedChildren++;
        },
      });
      const nodes: WorkflowNode[] = [{
        id: "parallel-policy",
        config: {
          type: "parallel",
          timeout: 5,
          retry: retryAfterTimeout,
          nodes: [{ id: "parallel-child", config: { type: "step", tool: "test" } as any }],
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
          processor: { id: "map-child", config: { type: "step", tool: "test" } as any },
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

    it("detaches static exotic subworkflow input for every retry attempt", async () => {
      const observedCounts: number[] = [];
      let childAttempts = 0;
      const trackingExecutor = new MockStepExecutor(new Map(), () => {
        childAttempts++;
        return childAttempts === 1
          ? { success: false, error: "retry child", executionTime: 1 }
          : { success: true, output: "done", executionTime: 1 };
      });
      const exec = new DAGExecutor({ stepExecutor: trackingExecutor });
      const admittedInput = new Map<string, number>([["count", 1]]);
      const nodes: WorkflowNode[] = [{
        id: "exotic-input-subworkflow",
        config: {
          type: "subWorkflow",
          input: admittedInput,
          workflow: {
            id: "exotic-input-child",
            steps: ({ input }: { input: unknown }) => {
              const attemptInput = input as Map<string, number>;
              observedCounts.push(attemptInput.get("count")!);
              attemptInput.set("count", 2);
              return [{ id: "child", config: { type: "step", tool: "test" } }];
            },
          },
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
      assertEquals(observedCounts, [1, 1]);
      assertEquals(admittedInput.get("count"), 1);
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
