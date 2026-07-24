import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { MemoryBackend } from "../backends/memory.ts";
import type { NodeState, WorkflowContext, WorkflowRun } from "../types.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import {
  executeWorkflowRunControl,
  type WorkflowRunControlExecuteResult,
} from "./workflow-run-control.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

function createRun(id: string): WorkflowRun {
  return {
    id,
    workflowId: "workflow",
    status: "pending",
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

function completedResult(
  context: WorkflowContext = { input: {}, finish: { ok: true } },
  nodeStates: Record<string, NodeState> = {
    finish: { nodeId: "finish", status: "completed", attempt: 1 },
  },
): WorkflowRunControlExecuteResult {
  return { completed: true, context, nodeStates };
}

function waitingResult(
  context: WorkflowContext = {
    input: {},
    _tenant: { projectSlug: "internal", token: "token", productionMode: false },
  },
  nodeStates: Record<string, NodeState> = {
    review: { nodeId: "review", status: "running", attempt: 1 },
  },
): WorkflowRunControlExecuteResult {
  return { waiting: true, waitingNode: "review", context, nodeStates };
}

async function execute(
  backend: MemoryBackend,
  run: WorkflowRun,
  operation: (
    signal: AbortSignal,
  ) => Promise<WorkflowRunControlExecuteResult> | WorkflowRunControlExecuteResult,
  options: Partial<Parameters<typeof executeWorkflowRunControl>[0]> = {},
) {
  return await executeWorkflowRunControl({
    backend,
    run,
    expectedWorkerId: run.workerId,
    lockDuration: 30_000,
    heartbeatInterval: 10_000,
    enableLocking: false,
    isCurrentExecution: () => true,
    waitForCancellationUpdate: () => Promise.resolve(),
    waitForCancellationGrace: async (promise) => {
      await promise.catch(() => undefined);
    },
    execute: async ({ signal }) => await operation(signal),
    ...options,
  });
}

class DelayedActivationBackend extends MemoryBackend {
  readonly activationStarted = Promise.withResolvers<void>();
  readonly continueActivation = Promise.withResolvers<void>();

  override async updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.status === "running" && patch.heartbeatAt) {
      this.activationStarted.resolve();
      await this.continueActivation.promise;
    }
    return await super.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
  }
}

class LosingLockBackend extends MemoryBackend {
  readonly extensionAttempted = Promise.withResolvers<void>();
  releaseCalls = 0;

  override extendLock(): Promise<boolean> {
    this.extensionAttempted.resolve();
    return Promise.resolve(false);
  }

  override releaseLock(runId: string, lockId?: string): Promise<void> {
    this.releaseCalls++;
    return super.releaseLock(runId, lockId);
  }
}

class FailingOwnerHeartbeatBackend extends MemoryBackend {
  override updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.status === undefined && patch.heartbeatAt !== undefined) {
      return Promise.reject(new Error("owner heartbeat failed"));
    }
    return super.updateRunIfStatusAndWorker(runId, expectedStatuses, expectedWorkerId, patch);
  }
}

class WaitingReleaseBackend extends MemoryBackend {
  releaseBeforeCallback = false;
  callbackStarted = false;

  override async releaseLock(runId: string, lockId?: string): Promise<void> {
    await super.releaseLock(runId, lockId);
    if (!this.callbackStarted) this.releaseBeforeCallback = true;
  }
}

describe("workflow/runtime/workflow-run-control execute", () => {
  it("activates pending runs through an owner/status gate", async () => {
    const backend = new DelayedActivationBackend();
    const run = { ...createRun("activation-gate"), workerId: "run-execution:owner-a" };
    await backend.createRun(run);

    let operationCalls = 0;
    const execution = execute(backend, run, () => {
      operationCalls++;
      return completedResult();
    });
    await backend.activationStarted.promise;
    await backend.updateRun(run.id, { workerId: "run-execution:owner-b" });
    backend.continueActivation.resolve();

    const outcome = await execution;
    assertEquals(outcome.status, "ownership-lost");
    assertEquals(operationCalls, 0);
    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "pending");
    assertEquals(persisted?.workerId, "run-execution:owner-b");
  });

  it("does not complete after durable owner changes", async () => {
    const backend = new MemoryBackend();
    const run = {
      ...createRun("owner-change-before-completion"),
      status: "running" as const,
      workerId: "run-execution:owner-a",
    };
    await backend.createRun(run);

    await execute(backend, run, async () => {
      await backend.updateRun(run.id, { workerId: "run-execution:owner-b" });
      return completedResult();
    });

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, "run-execution:owner-b");
    assertEquals(persisted?.output, undefined);
  });

  it("leaves replacement owner state untouched after lock loss", async () => {
    using time = new FakeTime();
    const backend = new LosingLockBackend();
    const run = createRun("lock-loss-preserves-replacement");
    await backend.createRun(run);
    const operationStarted = Promise.withResolvers<void>();
    const releaseOperation = Promise.withResolvers<void>();
    let receivedSignal: AbortSignal | undefined;

    const execution = execute(
      backend,
      run,
      async (signal) => {
        receivedSignal = signal;
        operationStarted.resolve();
        await releaseOperation.promise;
        return completedResult();
      },
      { enableLocking: true, heartbeatInterval: 5 },
    );

    await operationStarted.promise;
    await time.tickAsync(5);
    await backend.extensionAttempted.promise;
    await backend.updateRun(run.id, {
      status: "running",
      workerId: "run-execution:replacement",
      context: { input: {}, replacement: true },
    });
    releaseOperation.resolve();

    await assertRejects(() => execution, Error, "Lost lock");
    assertEquals(receivedSignal?.aborted, true);
    assertEquals(backend.releaseCalls, 0);
    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, "run-execution:replacement");
    assertEquals(persisted?.context.replacement, true);
    assertEquals(persisted?.output, undefined);
  });

  it("releases the waiting lock before callback reconciliation", async () => {
    const backend = new WaitingReleaseBackend();
    const run = {
      ...createRun("waiting-release-before-callback"),
      status: "running" as const,
      workerId: "run-execution:owner",
    };
    await backend.createRun(run);
    let lockedDuringCallback: boolean | undefined;

    await execute(
      backend,
      run,
      () => waitingResult(),
      {
        enableLocking: true,
        onWaiting: async () => {
          backend.callbackStarted = true;
          lockedDuringCallback = await backend.isLocked(run.id);
        },
      },
    );

    assertEquals(backend.releaseBeforeCallback, true);
    assertEquals(lockedDuringCallback, false);
    assertEquals((await backend.getRun(run.id))?.status, "waiting");
  });

  it("keeps cancellation terminal over completion and failure", async () => {
    const backend = new MemoryBackend();
    const completeRun = { ...createRun("cancel-before-complete"), status: "running" as const };
    const failRun = { ...createRun("cancel-before-fail"), status: "running" as const };
    await backend.createRun(completeRun);
    await backend.createRun(failRun);

    await execute(backend, completeRun, async () => {
      await backend.updateRun(completeRun.id, {
        status: "cancelled",
        completedAt: new Date(),
      });
      return completedResult();
    });
    await execute(backend, failRun, async () => {
      await backend.updateRun(failRun.id, {
        status: "cancelled",
        completedAt: new Date(),
      });
      throw new Error("late failure");
    });

    assertEquals((await backend.getRun(completeRun.id))?.status, "cancelled");
    const failedPersisted = await backend.getRun(failRun.id);
    assertEquals(failedPersisted?.status, "cancelled");
    assertEquals(failedPersisted?.error, undefined);
  });

  it("aborts when heartbeat cannot verify durable owner", async () => {
    using time = new FakeTime();
    const backend = new FailingOwnerHeartbeatBackend();
    const run = {
      ...createRun("heartbeat-owner-fencing"),
      status: "running" as const,
      workerId: "run-execution:owner",
    };
    await backend.createRun(run);
    const operationStarted = Promise.withResolvers<void>();
    const releaseOperation = Promise.withResolvers<void>();
    let receivedSignal: AbortSignal | undefined;

    const execution = execute(
      backend,
      run,
      async (signal) => {
        receivedSignal = signal;
        operationStarted.resolve();
        await releaseOperation.promise;
        return completedResult();
      },
      { heartbeatInterval: 5 },
    );
    await operationStarted.promise;
    await time.tickAsync(5);
    releaseOperation.resolve();

    await assertRejects(() => execution, Error, "Could not verify execution ownership");
    assertEquals(receivedSignal?.aborted, true);
    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.output, undefined);
  });

  it("does not persist terminal state from a stale AbortController", async () => {
    const backend = new MemoryBackend();
    const run = { ...createRun("stale-controller"), status: "running" as const };
    await backend.createRun(run);

    await execute(
      backend,
      run,
      () => completedResult(),
      { isCurrentExecution: () => false },
    );

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.output, undefined);
  });

  it("persists only public context and output", async () => {
    const backend = new MemoryBackend();
    const run = { ...createRun("public-context"), status: "running" as const };
    await backend.createRun(run);

    await execute(
      backend,
      run,
      () =>
        completedResult({
          input: {},
          env: { PUBLIC_VALUE: "kept" },
          _tenant: { projectSlug: "private", token: "token", productionMode: false },
          finish: { ok: true },
        }),
    );

    const persisted = await backend.getRun(run.id);
    assertExists(persisted);
    assertEquals(persisted.status, "completed");
    assertEquals(persisted.context, {
      input: {},
      env: { PUBLIC_VALUE: "kept" },
      finish: { ok: true },
    });
    assertEquals(persisted.output, {
      env: { PUBLIC_VALUE: "kept" },
      finish: { ok: true },
    });
  });
});
