import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { MemoryBackend } from "../backends/memory.ts";
import { dependsOn, parallel, step, waitForApproval, workflow } from "../dsl/index.ts";
import type { WorkflowRun } from "../types.ts";
import { WorkflowExecutor } from "./workflow-executor.ts";

function createTool(
  id: string,
  execute: (input: unknown, context?: ToolExecutionContext) => unknown | Promise<unknown>,
): Tool {
  return {
    id,
    type: "function",
    description: `Test tool ${id}`,
    inputSchema: defineSchema((v) => v.object({}).passthrough())(),
    execute: (input, context) => Promise.resolve(execute(input, context)),
  };
}

function createRun(workflowId: string): WorkflowRun {
  return {
    id: `run-${workflowId}`,
    workflowId,
    status: "pending",
    input: {},
    nodeStates: {},
    currentNodes: [],
    context: { input: {} },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date(),
  };
}

describe("workflow/executor/workflow-executor", () => {
  it("acquires and releases the backend lock around successful execution", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, lockDuration: 5_000 });
    executor.register(
      workflow({
        id: "locked-success",
        steps: [
          step("finish", {
            tool: createTool("finish", () => ({ ok: true })),
          }),
        ],
      }).definition,
    );
    const run = createRun("locked-success");
    await backend.createRun(run);

    await executor.executeAsync(run.id);

    const updatedRun = await backend.getRun(run.id);
    assertExists(updatedRun);
    assertEquals(updatedRun.status, "completed");
    assertEquals(updatedRun.output, { finish: { ok: true } });
    assertEquals(await backend.isLocked(run.id), false);
  });

  it("does not execute a run when another worker already holds the lock", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, lockDuration: 5_000 });
    executor.register(
      workflow({
        id: "locked-conflict",
        steps: [
          step("finish", {
            tool: createTool("finish", () => ({ ok: true })),
          }),
        ],
      }).definition,
    );
    const run = createRun("locked-conflict");
    await backend.createRun(run);
    await backend.acquireLock(run.id, 5_000);

    await assertRejects(
      () => executor.executeAsync(run.id),
      Error,
      "another worker is already executing it",
    );

    const updatedRun = await backend.getRun(run.id);
    assertExists(updatedRun);
    assertEquals(updatedRun.status, "pending");
    assertEquals(updatedRun.output, undefined);
    await backend.releaseLock(run.id);
  });

  it("waits for an in-flight heartbeat before releasing the lock", async () => {
    let markHeartbeatStarted!: () => void;
    const heartbeatStarted = new Promise<void>((resolve) => markHeartbeatStarted = resolve);
    let finishHeartbeat!: () => void;
    const heartbeatGate = new Promise<void>((resolve) => finishHeartbeat = resolve);
    let markCompletionPersisted!: () => void;
    const completionPersisted = new Promise<void>((resolve) => markCompletionPersisted = resolve);
    let releaseCalls = 0;

    class BlockingHeartbeatBackend extends MemoryBackend {
      override async extendLock(
        runId: string,
        duration: number,
        lockId?: string,
      ): Promise<boolean> {
        markHeartbeatStarted();
        await heartbeatGate;
        return await super.extendLock(runId, duration, lockId);
      }

      override async releaseLock(runId: string, lockId?: string): Promise<void> {
        releaseCalls++;
        await super.releaseLock(runId, lockId);
      }

      override async updateRunIfStatus(
        runId: string,
        expectedStatuses: WorkflowRun["status"][],
        patch: Partial<WorkflowRun>,
      ): Promise<boolean> {
        const updated = await super.updateRunIfStatus(runId, expectedStatuses, patch);
        if (patch.status === "completed") markCompletionPersisted();
        return updated;
      }
    }

    const backend = new BlockingHeartbeatBackend();
    const executor = new WorkflowExecutor({
      backend,
      lockDuration: 5_000,
      heartbeatInterval: 1,
    });
    let markToolStarted!: () => void;
    const toolStarted = new Promise<void>((resolve) => markToolStarted = resolve);
    let finishTool!: () => void;
    const toolGate = new Promise<void>((resolve) => finishTool = resolve);
    executor.register(
      workflow({
        id: "in-flight-heartbeat",
        steps: [
          step("finish", {
            tool: createTool("finish", async () => {
              markToolStarted();
              await toolGate;
              return { ok: true };
            }),
          }),
        ],
      }).definition,
    );
    const run = createRun("in-flight-heartbeat");
    await backend.createRun(run);

    let executionSettled = false;
    const execution = executor.executeAsync(run.id).finally(() => executionSettled = true);
    await toolStarted;
    await heartbeatStarted;
    finishTool();
    await completionPersisted;
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      assertEquals(executionSettled, false);
      assertEquals(releaseCalls, 0);
      assertEquals(await backend.isLocked(run.id), true);
    } finally {
      finishHeartbeat();
    }

    await execution;
    assertEquals(releaseCalls, 1);
    assertEquals(await backend.isLocked(run.id), false);
  });

  it("marks failed runs and releases the lock when a step fails", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, lockDuration: 5_000 });
    executor.register(
      workflow({
        id: "locked-failure",
        steps: [
          step("fail", {
            tool: createTool("fail", () => {
              throw new Error("tool exploded");
            }),
          }),
        ],
      }).definition,
    );
    const run = createRun("locked-failure");
    await backend.createRun(run);

    await executor.executeAsync(run.id);

    const updatedRun = await backend.getRun(run.id);
    assertExists(updatedRun);
    assertEquals(updatedRun.status, "failed");
    assertEquals(updatedRun.nodeStates.fail?.status, "failed");
    assertEquals(updatedRun.error?.message, 'Node "fail" failed: tool exploded');
    assertEquals(await backend.isLocked(run.id), false);
  });

  it("keeps the lock until a cancelled tool finishes cooperative cleanup", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, lockDuration: 5_000 });
    let signal: AbortSignal | undefined;
    let markToolStarted!: () => void;
    const toolStarted = new Promise<void>((resolve) => markToolStarted = resolve);
    let signalAbort!: () => void;
    const signalAborted = new Promise<void>((resolve) => signalAbort = resolve);
    let finishCleanup!: () => void;
    const cleanupGate = new Promise<void>((resolve) => finishCleanup = resolve);

    executor.register(
      workflow({
        id: "cancel-cooperative-cleanup",
        steps: [
          step("slow", {
            tool: createTool("slow", (_input, context) => {
              signal = context?.abortSignal;
              markToolStarted();
              return new Promise((_resolve, reject) => {
                signal?.addEventListener("abort", () => {
                  signalAbort();
                  void cleanupGate.then(() => reject(signal?.reason));
                }, { once: true });
              });
            }),
          }),
        ],
      }).definition,
    );
    const run = createRun("cancel-cooperative-cleanup");
    await backend.createRun(run);

    let executionSettled = false;
    const execution = executor.executeAsync(run.id).finally(() => executionSettled = true);
    await toolStarted;
    assertExists(signal);

    await executor.cancel(run.id);
    await signalAborted;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(signal.aborted, true);
    assertEquals(executionSettled, false);
    assertEquals(await backend.isLocked(run.id), true);

    finishCleanup();
    await execution;

    assertEquals(executionSettled, true);
    assertEquals((await backend.getRun(run.id))?.status, "cancelled");
    assertEquals(await backend.isLocked(run.id), false);
  });

  it("keeps the lock until timed-out workflow cleanup finishes", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, lockDuration: 5_000 });
    let observedTimeoutReason: unknown;
    let markTimedOut!: () => void;
    const timedOut = new Promise<void>((resolve) => markTimedOut = resolve);
    let finishCleanup!: () => void;
    const cleanupGate = new Promise<void>((resolve) => finishCleanup = resolve);

    executor.register(
      workflow({
        id: "timeout-cooperative-cleanup",
        timeout: 1,
        steps: [
          step("slow", {
            tool: createTool("slow", (_input, context) => {
              const signal = context?.abortSignal;
              return new Promise((_resolve, reject) => {
                signal?.addEventListener("abort", () => {
                  observedTimeoutReason = signal.reason;
                  markTimedOut();
                  void cleanupGate.then(() => reject(signal.reason));
                }, { once: true });
              });
            }),
          }),
        ],
      }).definition,
    );
    const run = createRun("timeout-cooperative-cleanup");
    await backend.createRun(run);

    let executionSettled = false;
    const execution = executor.executeAsync(run.id).finally(() => executionSettled = true);
    await timedOut;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(executionSettled, false);
    assertEquals(await backend.isLocked(run.id), true);
    assertEquals(
      observedTimeoutReason instanceof Error && observedTimeoutReason.message,
      "Workflow timed out after 1ms",
    );

    finishCleanup();
    await assertRejects(() => execution, Error, "Workflow timed out after 1ms");

    assertEquals((await backend.getRun(run.id))?.status, "failed");
    assertEquals(await backend.isLocked(run.id), false);
  });

  it("aborts execution when another process persists cancellation", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({
      backend,
      lockDuration: 5_000,
      heartbeatInterval: 1,
    });
    let markToolStarted!: () => void;
    const toolStarted = new Promise<void>((resolve) => markToolStarted = resolve);
    let observedSignal: AbortSignal | undefined;

    executor.register(
      workflow({
        id: "remote-cancellation",
        steps: [
          step("slow", {
            tool: createTool("slow", (_input, context) => {
              observedSignal = context?.abortSignal;
              markToolStarted();
              return new Promise((_resolve, reject) => {
                observedSignal?.addEventListener(
                  "abort",
                  () => reject(observedSignal?.reason),
                  { once: true },
                );
              });
            }),
          }),
        ],
      }).definition,
    );
    const run = createRun("remote-cancellation");
    await backend.createRun(run);

    const execution = executor.executeAsync(run.id);
    await toolStarted;
    await backend.updateRun(run.id, { status: "cancelled", completedAt: new Date() });
    await execution;

    assertExists(observedSignal);
    assertEquals(observedSignal.aborted, true);
    assertEquals((await backend.getRun(run.id))?.status, "cancelled");
    assertEquals(await backend.isLocked(run.id), false);
  });

  it("does not overwrite cancellation when completion is already in flight", async () => {
    let completionAttempted!: () => void;
    const completionAttempt = new Promise<void>((resolve) => completionAttempted = resolve);
    let continueCompletion!: () => void;
    const completionGate = new Promise<void>((resolve) => continueCompletion = resolve);

    class CompletionRaceBackend extends MemoryBackend {
      override async updateRunIfStatus(
        runId: string,
        expectedStatuses: WorkflowRun["status"][],
        patch: Partial<WorkflowRun>,
      ): Promise<boolean> {
        if (patch.status === "completed") {
          completionAttempted();
          await completionGate;
        }
        return await super.updateRunIfStatus(runId, expectedStatuses, patch);
      }
    }

    const backend = new CompletionRaceBackend();
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "cancel-completion-race",
        steps: [step("finish", { tool: createTool("finish", () => ({ ok: true })) })],
      }).definition,
    );
    const run = createRun("cancel-completion-race");
    await backend.createRun(run);

    const execution = executor.executeAsync(run.id);
    await completionAttempt;
    await executor.cancel(run.id);
    continueCompletion();
    await execution;

    assertEquals((await backend.getRun(run.id))?.status, "cancelled");
  });

  it("runs completion callbacks when a concurrent cancellation loses", async () => {
    let cancellationAttempted!: () => void;
    const cancellationAttempt = new Promise<void>((resolve) => cancellationAttempted = resolve);
    let continueCancellation!: () => void;
    const cancellationGate = new Promise<void>((resolve) => continueCancellation = resolve);

    class CancellationLosesBackend extends MemoryBackend {
      override async updateRunIfStatus(
        runId: string,
        expectedStatuses: WorkflowRun["status"][],
        patch: Partial<WorkflowRun>,
      ): Promise<boolean> {
        if (patch.status === "cancelled") {
          cancellationAttempted();
          await cancellationGate;
        }
        return await super.updateRunIfStatus(runId, expectedStatuses, patch);
      }
    }

    const backend = new CancellationLosesBackend();
    let markToolStarted!: () => void;
    const toolStarted = new Promise<void>((resolve) => markToolStarted = resolve);
    let finishTool!: () => void;
    const toolGate = new Promise<void>((resolve) => finishTool = resolve);
    let completionCallbacks = 0;
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "completion-wins-cancel-race",
        steps: [
          step("finish", {
            tool: createTool("finish", async () => {
              markToolStarted();
              await toolGate;
              return { ok: true };
            }),
          }),
        ],
        onComplete: () => {
          completionCallbacks++;
        },
      }).definition,
    );
    const run = createRun("completion-wins-cancel-race");
    await backend.createRun(run);

    const execution = executor.executeAsync(run.id);
    await toolStarted;
    const cancellation = executor.cancel(run.id);
    await cancellationAttempt;
    finishTool();
    await execution;
    continueCancellation();

    await assertRejects(() => cancellation, Error, "run has already completed");
    assertEquals((await backend.getRun(run.id))?.status, "completed");
    assertEquals(completionCallbacks, 1);
  });

  it("does not resurrect a cancelled run while resuming from a checkpoint", async () => {
    let resumeAttempted!: () => void;
    const resumeAttempt = new Promise<void>((resolve) => resumeAttempted = resolve);
    let continueResume!: () => void;
    const resumeGate = new Promise<void>((resolve) => continueResume = resolve);

    class ResumeRaceBackend extends MemoryBackend {
      private async waitForRunningPatch(patch: Partial<WorkflowRun>): Promise<void> {
        if (patch.status !== "running") return;
        resumeAttempted();
        await resumeGate;
      }

      override async updateRun(
        runId: string,
        patch: Partial<WorkflowRun>,
      ): Promise<void> {
        await this.waitForRunningPatch(patch);
        await super.updateRun(runId, patch);
      }

      override async updateRunIfStatus(
        runId: string,
        expectedStatuses: WorkflowRun["status"][],
        patch: Partial<WorkflowRun>,
      ): Promise<boolean> {
        await this.waitForRunningPatch(patch);
        return await super.updateRunIfStatus(runId, expectedStatuses, patch);
      }
    }

    const backend = new ResumeRaceBackend();
    let resumedStepExecutions = 0;
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "cancel-resume-race",
        steps: [
          step("first", { tool: createTool("first", () => ({ first: true })) }),
          dependsOn(
            step("second", {
              tool: createTool("second", () => {
                resumedStepExecutions++;
                return { second: true };
              }),
            }),
            "first",
          ),
        ],
      }).definition,
    );

    const firstNodeState = {
      nodeId: "first",
      status: "completed" as const,
      output: { first: true },
      attempt: 1,
      completedAt: new Date(),
    };
    const run: WorkflowRun = {
      ...createRun("cancel-resume-race"),
      status: "waiting",
      context: { input: {}, first: { first: true } },
      nodeStates: { first: firstNodeState },
    };
    await backend.createRun(run);
    await backend.saveCheckpoint(run.id, {
      id: "cp-first",
      nodeId: "first",
      timestamp: new Date(),
      context: run.context,
      nodeStates: run.nodeStates,
    });

    const resuming = executor.resume(run.id);
    await resumeAttempt;
    await executor.cancel(run.id);
    continueResume();
    await resuming;

    assertEquals((await backend.getRun(run.id))?.status, "cancelled");
    assertEquals(resumedStepExecutions, 0);
  });

  it("does not persist completion after the run is reassigned to a new worker", async () => {
    const backend = new MemoryBackend();
    const oldWorkerId = "run-execution:old-owner";
    const newWorkerId = "run-execution:new-owner";
    let markToolStarted!: () => void;
    const toolStarted = new Promise<void>((resolve) => markToolStarted = resolve);
    let finishTool!: () => void;
    const toolGate = new Promise<void>((resolve) => finishTool = resolve);
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register(
      workflow({
        id: "stale-owner-completion",
        steps: [
          step("finish", {
            tool: createTool("finish", async () => {
              markToolStarted();
              await toolGate;
              return { stale: true };
            }),
          }),
        ],
      }).definition,
    );
    const run: WorkflowRun = {
      ...createRun("stale-owner-completion"),
      status: "running",
      workerId: oldWorkerId,
    };
    await backend.createRun(run);

    const execution = executor.executeAsync(run.id, undefined, oldWorkerId);
    await toolStarted;
    await backend.updateRun(run.id, { workerId: newWorkerId });
    finishTool();
    await execution;

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, newWorkerId);
    assertEquals(persisted?.output, undefined);
    assertEquals(persisted?.nodeStates, {});
  });

  it("does not append nested checkpoints after the top-level run owner changes", async () => {
    const backend = new MemoryBackend();
    const oldWorkerId = "run-execution:old-checkpoint-owner";
    const newWorkerId = "run-execution:new-checkpoint-owner";
    let markToolStarted!: () => void;
    const toolStarted = new Promise<void>((resolve) => markToolStarted = resolve);
    let finishTool!: () => void;
    const toolGate = new Promise<void>((resolve) => finishTool = resolve);
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register(
      workflow({
        id: "stale-owner-checkpoint",
        steps: [
          parallel("group", [
            step("finish", {
              checkpoint: true,
              tool: createTool("finish", async () => {
                markToolStarted();
                await toolGate;
                return { stale: true };
              }),
            }),
          ]),
        ],
      }).definition,
    );
    const run: WorkflowRun = {
      ...createRun("stale-owner-checkpoint"),
      status: "running",
      workerId: oldWorkerId,
    };
    await backend.createRun(run);

    const execution = executor.executeAsync(run.id, undefined, oldWorkerId);
    await toolStarted;
    await backend.updateRun(run.id, { workerId: newWorkerId });
    finishTool();
    await execution;

    assertEquals(await backend.getCheckpoints(run.id), []);
    assertEquals(await backend.getCheckpoints("group_parallel"), []);
    assertEquals((await backend.getRun(run.id))?.status, "running");
    assertEquals((await backend.getRun(run.id))?.workerId, newWorkerId);
  });

  it("rejects a stale owner before executing any workflow step", async () => {
    const backend = new MemoryBackend();
    let toolExecutions = 0;
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register(
      workflow({
        id: "stale-owner-start",
        steps: [
          step("finish", {
            tool: createTool("finish", () => {
              toolExecutions++;
              return { stale: true };
            }),
          }),
        ],
      }).definition,
    );
    const run: WorkflowRun = {
      ...createRun("stale-owner-start"),
      status: "running",
      workerId: "run-execution:new-owner",
    };
    await backend.createRun(run);

    await assertRejects(
      () => executor.executeAsync(run.id, undefined, "run-execution:old-owner"),
      Error,
      "ownership changed",
    );

    assertEquals(toolExecutions, 0);
    assertEquals((await backend.getRun(run.id))?.status, "running");
    assertEquals((await backend.getRun(run.id))?.workerId, "run-execution:new-owner");
  });

  it("does not persist failure or run error callbacks after ownership changes", async () => {
    const backend = new MemoryBackend();
    const oldWorkerId = "run-execution:old-failure-owner";
    const newWorkerId = "run-execution:new-failure-owner";
    let markToolStarted!: () => void;
    const toolStarted = new Promise<void>((resolve) => markToolStarted = resolve);
    let finishTool!: () => void;
    const toolGate = new Promise<void>((resolve) => finishTool = resolve);
    let workflowErrorCallbacks = 0;
    let executorErrorCallbacks = 0;
    const executor = new WorkflowExecutor({
      backend,
      enableLocking: false,
      onError: () => executorErrorCallbacks++,
    });
    executor.register(
      workflow({
        id: "stale-owner-failure",
        steps: [
          step("fail", {
            tool: createTool("fail", async () => {
              markToolStarted();
              await toolGate;
              throw new Error("stale failure");
            }),
          }),
        ],
        onError: () => {
          workflowErrorCallbacks++;
        },
      }).definition,
    );
    const run: WorkflowRun = {
      ...createRun("stale-owner-failure"),
      status: "running",
      workerId: oldWorkerId,
    };
    await backend.createRun(run);

    const execution = executor.executeAsync(run.id, undefined, oldWorkerId);
    await toolStarted;
    await backend.updateRun(run.id, { workerId: newWorkerId });
    finishTool();
    await execution;

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, newWorkerId);
    assertEquals(persisted?.error, undefined);
    assertEquals(persisted?.nodeStates, {});
    assertEquals(workflowErrorCallbacks, 0);
    assertEquals(executorErrorCallbacks, 0);
  });

  it("does not persist waiting state or callbacks after ownership changes", async () => {
    const backend = new MemoryBackend();
    const oldWorkerId = "run-execution:old-wait-owner";
    const newWorkerId = "run-execution:new-wait-owner";
    let markPayloadStarted!: () => void;
    const payloadStarted = new Promise<void>((resolve) => markPayloadStarted = resolve);
    let finishPayload!: () => void;
    const payloadGate = new Promise<void>((resolve) => finishPayload = resolve);
    let waitingCallbacks = 0;
    const executor = new WorkflowExecutor({
      backend,
      enableLocking: false,
      onWaiting: () => waitingCallbacks++,
    });
    executor.register(
      workflow({
        id: "stale-owner-waiting",
        steps: [
          waitForApproval("approval", {
            payload: async () => {
              markPayloadStarted();
              await payloadGate;
              return { stale: true };
            },
          }),
        ],
      }).definition,
    );
    const run: WorkflowRun = {
      ...createRun("stale-owner-waiting"),
      status: "running",
      workerId: oldWorkerId,
    };
    await backend.createRun(run);

    const execution = executor.executeAsync(run.id, undefined, oldWorkerId);
    await payloadStarted;
    await backend.updateRun(run.id, { workerId: newWorkerId });
    finishPayload();
    await execution;

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, newWorkerId);
    assertEquals(persisted?.currentNodes, []);
    assertEquals(persisted?.nodeStates, {});
    assertEquals(waitingCallbacks, 0);
  });

  it("waits for an async waiting callback before owner-bound execution settles", async () => {
    const backend = new MemoryBackend();
    const workerId = "run-execution:waiting-callback-owner";
    let markWaitingStarted!: () => void;
    const waitingStarted = new Promise<void>((resolve) => markWaitingStarted = resolve);
    let finishWaiting!: () => void;
    const waitingGate = new Promise<void>((resolve) => finishWaiting = resolve);
    const executor = new WorkflowExecutor({
      backend,
      enableLocking: false,
      heartbeatInterval: 1,
      onWaiting: async () => {
        markWaitingStarted();
        await waitingGate;
      },
    });
    executor.register(
      workflow({
        id: "await-waiting-callback",
        steps: [waitForApproval("approval")],
      }).definition,
    );
    const run: WorkflowRun = {
      ...createRun("await-waiting-callback"),
      status: "running",
      workerId,
    };
    await backend.createRun(run);

    let executionSettled = false;
    const execution = executor.executeAsync(run.id, undefined, workerId).finally(() => {
      executionSettled = true;
    });
    await waitingStarted;
    await new Promise((resolve) => setTimeout(resolve, 5));

    try {
      assertEquals(executionSettled, false);
      assertEquals((await backend.getRun(run.id))?.status, "waiting");
    } finally {
      finishWaiting();
    }

    await execution;
    assertEquals((await backend.getRun(run.id))?.status, "waiting");
  });

  it("does not run stale completion callbacks for a replacement owner's result", async () => {
    const backend = new MemoryBackend();
    const oldWorkerId = "run-execution:old-callback-owner";
    const newWorkerId = "run-execution:new-callback-owner";
    let markToolStarted!: () => void;
    const toolStarted = new Promise<void>((resolve) => markToolStarted = resolve);
    let finishTool!: () => void;
    const toolGate = new Promise<void>((resolve) => finishTool = resolve);
    let workflowCompletionCallbacks = 0;
    let executorCompletionCallbacks = 0;
    const executor = new WorkflowExecutor({
      backend,
      enableLocking: false,
      onComplete: () => executorCompletionCallbacks++,
    });
    executor.register(
      workflow({
        id: "stale-owner-callback",
        steps: [
          step("finish", {
            tool: createTool("finish", async () => {
              markToolStarted();
              await toolGate;
              return { stale: true };
            }),
          }),
        ],
        onComplete: () => {
          workflowCompletionCallbacks++;
        },
      }).definition,
    );
    const run: WorkflowRun = {
      ...createRun("stale-owner-callback"),
      status: "running",
      workerId: oldWorkerId,
    };
    await backend.createRun(run);

    const execution = executor.executeAsync(run.id, undefined, oldWorkerId);
    await toolStarted;
    await backend.updateRun(run.id, {
      status: "completed",
      workerId: newWorkerId,
      output: { fresh: true },
      completedAt: new Date(),
    });
    finishTool();
    await execution;

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "completed");
    assertEquals(persisted?.workerId, newWorkerId);
    assertEquals(persisted?.output, { fresh: true });
    assertEquals(workflowCompletionCallbacks, 0);
    assertEquals(executorCompletionCallbacks, 0);
  });

  it("rejects a stale worker heartbeat and aborts its in-flight work", async () => {
    const backend = new MemoryBackend();
    const oldWorkerId = "run-execution:old-heartbeat-owner";
    const newWorkerId = "run-execution:new-heartbeat-owner";
    let markToolStarted!: () => void;
    const toolStarted = new Promise<void>((resolve) => markToolStarted = resolve);
    let observedSignal: AbortSignal | undefined;
    const executor = new WorkflowExecutor({
      backend,
      enableLocking: false,
      heartbeatInterval: 1,
    });
    executor.register(
      workflow({
        id: "stale-owner-heartbeat",
        steps: [
          step("finish", {
            tool: createTool("finish", async (_input, context) => {
              observedSignal = context?.abortSignal;
              markToolStarted();
              await new Promise((resolve) => setTimeout(resolve, 50));
              return { stale: true };
            }),
          }),
        ],
      }).definition,
    );
    const run: WorkflowRun = {
      ...createRun("stale-owner-heartbeat"),
      status: "running",
      workerId: oldWorkerId,
    };
    await backend.createRun(run);

    const execution = executor.executeAsync(run.id, undefined, oldWorkerId);
    await toolStarted;
    await backend.updateRun(run.id, {
      workerId: newWorkerId,
      heartbeatAt: new Date(0),
    });
    await assertRejects(() => execution, Error, "ownership changed");

    const persisted = await backend.getRun(run.id);
    assertExists(observedSignal);
    assertEquals(observedSignal.aborted, true);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, newWorkerId);
    assertEquals(persisted?.heartbeatAt?.getTime(), 0);
    assertEquals(persisted?.output, undefined);
  });

  it("fails the run before completion when workflow output is schema-invalid", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "invalid-workflow-output",
        outputSchema: defineSchema((v) => v.object({ required: v.string() }))(),
        steps: [step("finish", { tool: createTool("finish", () => ({ ok: true })) })],
      }).definition,
    );
    const run = createRun("invalid-workflow-output");
    await backend.createRun(run);

    await assertRejects(() => executor.executeAsync(run.id));

    const finalRun = await backend.getRun(run.id);
    assertEquals(finalRun?.status, "failed");
    assertEquals(finalRun?.output, undefined);
  });
});
