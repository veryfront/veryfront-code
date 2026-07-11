import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { MemoryBackend } from "../backends/memory.ts";
import { branch, step, workflow } from "../dsl/index.ts";
import type { WorkflowRun } from "../types.ts";
import { WorkflowExecutor } from "./workflow-executor.ts";
import { FakeTime } from "#std/testing/time";

function createTool(id: string, execute: (input: unknown) => unknown | Promise<unknown>): Tool {
  return {
    id,
    type: "function",
    description: `Test tool ${id}`,
    inputSchema: defineSchema((v) => v.object({}).passthrough())(),
    execute: (input) => Promise.resolve(execute(input)),
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

class CompletionRaceBackend extends MemoryBackend {
  interceptNextGet = false;
  readonly completionReadStarted = Promise.withResolvers<void>();
  readonly releaseCompletionRead = Promise.withResolvers<void>();

  override async getRun(runId: string): Promise<WorkflowRun | null> {
    const run = await super.getRun(runId);
    if (this.interceptNextGet) {
      this.interceptNextGet = false;
      this.completionReadStarted.resolve();
      await this.releaseCompletionRead.promise;
    }
    return run;
  }
}

class LosingLockBackend extends MemoryBackend {
  readonly extensionAttempted = Promise.withResolvers<void>();
  releaseCalls = 0;

  override extendLock(_runId: string, _duration: number): Promise<boolean> {
    this.extensionAttempted.resolve();
    return Promise.resolve(false);
  }

  override releaseLock(runId: string): Promise<void> {
    this.releaseCalls++;
    return super.releaseLock(runId);
  }
}

class FailingLockHeartbeatBackend extends MemoryBackend {
  readonly extensionAttempted = Promise.withResolvers<void>();
  releaseCalls = 0;

  override extendLock(_runId: string, _duration: number): Promise<boolean> {
    this.extensionAttempted.resolve();
    return Promise.reject(new Error("lock backend unavailable"));
  }

  override releaseLock(runId: string): Promise<void> {
    this.releaseCalls++;
    return super.releaseLock(runId);
  }
}

class DelayedCancellationBackend extends MemoryBackend {
  readonly cancellationStarted = Promise.withResolvers<void>();
  readonly persistCancellation = Promise.withResolvers<void>();

  override async updateRun(runId: string, patch: Partial<WorkflowRun>): Promise<void> {
    if (patch.status === "cancelled") {
      this.cancellationStarted.resolve();
      await this.persistCancellation.promise;
    }
    await super.updateRun(runId, patch);
  }
}

class CleanupTrackingBackend extends MemoryBackend {
  heartbeatUpdates = 0;
  releaseCalls = 0;

  override updateRun(runId: string, patch: Partial<WorkflowRun>): Promise<void> {
    if (Object.keys(patch).length === 1 && patch.heartbeatAt) this.heartbeatUpdates++;
    return super.updateRun(runId, patch);
  }

  override releaseLock(runId: string): Promise<void> {
    this.releaseCalls++;
    return super.releaseLock(runId);
  }
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

  it("aborts and settles the active graph without releasing a lock it no longer owns", async () => {
    using time = new FakeTime();
    const backend = new LosingLockBackend();
    const executor = new WorkflowExecutor({ backend, lockDuration: 30_000 });
    const started = Promise.withResolvers<void>();
    const finishOperation = Promise.withResolvers<void>();
    let receivedSignal: AbortSignal | undefined;
    const blockingTool: Tool = {
      id: "lock-loss-blocking",
      type: "function",
      description: "Wait until the test releases the operation",
      inputSchema: defineSchema((v) => v.object({}).passthrough())(),
      execute: async (_input, context) => {
        receivedSignal = context?.abortSignal;
        started.resolve();
        await finishOperation.promise;
        return { ok: true };
      },
    };
    executor.register(
      workflow({
        id: "lock-loss-quiescence",
        steps: [step("blocking", { tool: blockingTool })],
      }).definition,
    );
    const run = createRun("lock-loss-quiescence");
    await backend.createRun(run);

    const execution = executor.executeAsync(run.id);
    const rejected = assertRejects(() => execution, Error, "Lost lock");
    await started.promise;
    await time.tickAsync(10_000);
    await backend.extensionAttempted.promise;

    try {
      assertEquals(receivedSignal?.aborted, true);
      assertEquals(backend.releaseCalls, 0);
    } finally {
      finishOperation.resolve();
    }

    await rejected;
    assertEquals(backend.releaseCalls, 0);
  });

  it("fails closed when lock ownership cannot be renewed", async () => {
    using time = new FakeTime();
    const backend = new FailingLockHeartbeatBackend();
    const executor = new WorkflowExecutor({ backend, lockDuration: 30_000 });
    const started = Promise.withResolvers<void>();
    const finishOperation = Promise.withResolvers<void>();
    let receivedSignal: AbortSignal | undefined;
    const blockingTool: Tool = {
      id: "lock-heartbeat-failure",
      type: "function",
      description: "Wait until the test releases the operation",
      inputSchema: defineSchema((v) => v.object({}).passthrough())(),
      execute: async (_input, context) => {
        receivedSignal = context?.abortSignal;
        started.resolve();
        await finishOperation.promise;
        return { ok: true };
      },
    };
    executor.register(
      workflow({
        id: "lock-heartbeat-failure",
        steps: [step("blocking", { tool: blockingTool })],
      }).definition,
    );
    const run = createRun("lock-heartbeat-failure");
    await backend.createRun(run);

    const execution = executor.executeAsync(run.id);
    await started.promise;
    await time.tickAsync(10_000);
    await backend.extensionAttempted.promise;
    await Promise.resolve();

    try {
      assertEquals(receivedSignal?.aborted, true);
      assertEquals(backend.releaseCalls, 0);
    } finally {
      finishOperation.resolve();
    }

    await assertRejects(() => execution, Error, "Could not renew lock");
    assertEquals(backend.releaseCalls, 0);
  });

  it("keeps cancellation terminal and does not schedule dependent steps", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend });
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let receivedSignal: AbortSignal | undefined;
    let dependentExecutions = 0;
    const blockingTool: Tool = {
      id: "blocking",
      type: "function",
      description: "Wait until the test releases the tool",
      inputSchema: defineSchema((v) => v.object({}).passthrough())(),
      execute: async (_input, context) => {
        receivedSignal = context?.abortSignal;
        started.resolve();
        await release.promise;
        return { ok: true };
      },
    };
    executor.register(
      workflow({
        id: "cancel-running",
        steps: [
          step("blocking", { tool: blockingTool }),
          step("dependent", {
            tool: createTool("dependent", () => {
              dependentExecutions++;
              return { ok: true };
            }),
          }),
        ],
      }).definition,
    );

    const handle = await executor.start("cancel-running", {});
    await started.promise;
    await handle.cancel();
    release.resolve();
    await handle.settled();

    const cancelledRun = await backend.getRun(handle.runId);
    assertExists(cancelledRun);
    assertEquals(receivedSignal instanceof AbortSignal, true);
    assertEquals(receivedSignal?.aborted, true);
    assertEquals(dependentExecutions, 0);
    assertEquals(cancelledRun.status, "cancelled");
  });

  it("does not report a failure while cancellation is still being persisted", async () => {
    const backend = new DelayedCancellationBackend();
    let errorCallbacks = 0;
    const executor = new WorkflowExecutor({
      backend,
      onError: () => {
        errorCallbacks++;
      },
    });
    const started = Promise.withResolvers<void>();
    const blockingTool: Tool = {
      id: "delayed-cancellation",
      type: "function",
      description: "Wait for cancellation",
      inputSchema: defineSchema((v) => v.object({}).passthrough())(),
      execute: (_input, context) => {
        started.resolve();
        return new Promise((_resolve, reject) => {
          const signal = context?.abortSignal;
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    };
    executor.register(
      workflow({
        id: "delayed-cancellation",
        steps: [step("blocking", { tool: blockingTool })],
      }).definition,
    );

    const handle = await executor.start("delayed-cancellation", {});
    await started.promise;
    const cancellation = handle.cancel();
    await backend.cancellationStarted.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      assertEquals(errorCallbacks, 0);
    } finally {
      backend.persistCancellation.resolve();
    }

    await cancellation;
    await handle.settled();
    const cancelledRun = await backend.getRun(handle.runId);
    assertExists(cancelledRun);
    assertEquals(cancelledRun.status, "cancelled");
    assertEquals(errorCallbacks, 0);
  });

  it("does not overwrite cancellation after completion reads a stale run", async () => {
    const backend = new CompletionRaceBackend();
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "cancel-completion-race",
        steps: [
          step("finish", {
            tool: createTool("finish", () => {
              backend.interceptNextGet = true;
              return { ok: true };
            }),
          }),
        ],
      }).definition,
    );

    const handle = await executor.start("cancel-completion-race", {});
    await backend.completionReadStarted.promise;
    await handle.cancel();
    backend.releaseCompletionRead.resolve();
    await handle.settled();

    const cancelledRun = await backend.getRun(handle.runId);
    assertExists(cancelledRun);
    assertEquals(cancelledRun.status, "cancelled");
  });

  it("does not schedule more nodes after a workflow timeout", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend });
    let receivedSignal: AbortSignal | undefined;
    let dependentExecutions = 0;
    const slowTool: Tool = {
      id: "slow-timeout",
      type: "function",
      description: "Settles after the workflow timeout",
      inputSchema: defineSchema((v) => v.object({}).passthrough())(),
      execute: async (_input, context) => {
        receivedSignal = context?.abortSignal;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: true };
      },
    };
    executor.register(
      workflow({
        id: "workflow-timeout",
        timeout: 5,
        steps: [
          step("slow", { tool: slowTool }),
          step("dependent", {
            tool: createTool("dependent", () => {
              dependentExecutions++;
              return { ok: true };
            }),
          }),
        ],
      }).definition,
    );
    const run = createRun("workflow-timeout");
    await backend.createRun(run);

    await assertRejects(
      () => executor.executeAsync(run.id),
      Error,
      "Workflow timed out",
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    const timedOutRun = await backend.getRun(run.id);
    assertExists(timedOutRun);
    assertEquals(receivedSignal instanceof AbortSignal, true);
    assertEquals(receivedSignal?.aborted, true);
    assertEquals(dependentExecutions, 0);
    assertEquals(timedOutRun.status, "failed");
  });

  it("bounds timeout cleanup and fences a branch that ignores cancellation", async () => {
    using time = new FakeTime();
    const backend = new CleanupTrackingBackend();
    const executor = new WorkflowExecutor({
      backend,
      cancellationGracePeriod: 5,
    });
    const condition = Promise.withResolvers<boolean>();
    const conditionStarted = Promise.withResolvers<void>();
    let lateStepExecutions = 0;
    executor.register(
      workflow({
        id: "non-cooperative-timeout",
        timeout: 5,
        steps: [
          branch("non-cooperative-branch", {
            condition: () => {
              conditionStarted.resolve();
              return condition.promise;
            },
            then: [
              step("late-step", {
                tool: createTool("late-step", () => {
                  lateStepExecutions++;
                  return { shouldNotPersist: true };
                }),
              }),
            ],
          }),
        ],
      }).definition,
    );
    const run = createRun("non-cooperative-timeout");
    await backend.createRun(run);

    const execution = assertRejects(
      () => executor.executeAsync(run.id),
      Error,
      "Workflow timed out",
    );
    await conditionStarted.promise;
    let watchdogId: ReturnType<typeof setTimeout> | undefined;
    const boundedOutcome = Promise.race([
      execution.then(() => "rejected" as const),
      new Promise<"watchdog">((resolve) => {
        watchdogId = setTimeout(() => resolve("watchdog"), 100);
      }),
    ]);

    let outcome: "rejected" | "watchdog";
    try {
      await time.tickAsync(5);
      await time.tickAsync(5);
      await time.tickAsync(90);
      outcome = await boundedOutcome;
    } finally {
      if (watchdogId !== undefined) clearTimeout(watchdogId);
      condition.resolve(true);
      await time.tickAsync(0);
      await execution;
    }

    assertEquals(outcome, "rejected");
    const timedOutRun = await backend.getRun(run.id);
    assertExists(timedOutRun);
    assertEquals(timedOutRun.status, "failed");
    assertEquals(timedOutRun.output, undefined);
    assertEquals(lateStepExecutions, 0);
    assertEquals(backend.releaseCalls, 1);
    assertEquals(await backend.isLocked(run.id), false);

    const heartbeatUpdates = backend.heartbeatUpdates;
    await time.tickAsync(20_000);
    assertEquals(backend.heartbeatUpdates, heartbeatUpdates);
  });
});
