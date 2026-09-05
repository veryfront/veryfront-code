import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { MemoryBackend } from "../backends/memory.ts";
import type { WorkflowBackend } from "../backends/types.ts";
import type {
  ApprovalDecision,
  NodeState,
  WaitNodeConfig,
  WorkflowContext,
  WorkflowRun,
} from "../types.ts";
import { INVALID_ARGUMENT, VeryfrontError } from "#veryfront/errors";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { getActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import type { RunExecutionConfig } from "../worker/executors/types.ts";
import {
  claimWorkflowRunControl,
  executeWorkflowRunControl,
  reconcileWorkflowRunControl,
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

/**
 * What the DAG returns when it found nothing to schedule and every unfinished
 * node is a wait, or is blocked behind one. That is the shape run control has
 * to tell apart from a genuine stall by consulting the durable record.
 */
function stalledWaitResult(
  waitNodeId: string,
  context: WorkflowContext = { input: {} },
): WorkflowRunControlExecuteResult {
  return {
    completed: false,
    waiting: false,
    stalledWaitNode: waitNodeId,
    context,
    nodeStates: {
      [waitNodeId]: { nodeId: waitNodeId, status: "running", attempt: 1 },
      after: { nodeId: "after", status: "pending", attempt: 0 },
    },
    error: `Workflow run ${JSON.stringify("stalled-run")} stalled in the root graph; ` +
      `unfinished nodes: ${JSON.stringify(waitNodeId)} (running), "after" (pending)`,
  };
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

class ClaimLockHeldBackend extends MemoryBackend {
  acquireAttempts = 0;

  override acquireLock(): Promise<string | null> {
    this.acquireAttempts++;
    return Promise.resolve(null);
  }
}

class ClaimStatusChangedAfterLockBackend extends MemoryBackend {
  readonly lockToken = "pending-token";
  releaseCalls: Array<{ runId: string; lockId?: string }> = [];

  override async acquireLock(): Promise<string | null> {
    return this.lockToken;
  }

  override async getRun(runId: string): Promise<WorkflowRun | null> {
    const run = await super.getRun(runId);
    if (run?.status === "pending") {
      await super.updateRun(runId, { status: "waiting" });
      return { ...run, status: "waiting" };
    }
    return run;
  }

  override releaseLock(runId: string, lockId?: string): Promise<void> {
    this.releaseCalls.push({ runId, lockId });
    return super.releaseLock(runId, lockId);
  }
}

class ClaimDelayedRunningUpdateBackend extends MemoryBackend {
  readonly runningUpdateStarted = Promise.withResolvers<void>();
  readonly continueRunningUpdate = Promise.withResolvers<void>();

  override async updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.status === "running" && patch.workerId) {
      this.runningUpdateStarted.resolve();
      await this.continueRunningUpdate.promise;
    }
    return await super.updateRunIfStatus(runId, expectedStatuses, patch);
  }
}

class ClaimPersistedAssignmentRejectsBackend extends MemoryBackend {
  readonly replacementWorkerId = "run-execution:replacement";

  constructor(private readonly replaceBeforeReject: boolean) {
    super();
  }

  override async updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.status === "running" && patch.workerId === "run-execution:execution-a") {
      const updated = await super.updateRunIfStatus(runId, expectedStatuses, patch);
      if (this.replaceBeforeReject) {
        await super.updateRun(runId, {
          status: "running",
          workerId: this.replacementWorkerId,
          context: { input: {}, replacement: true },
        });
      }
      if (updated) throw new Error("claim write acknowledgement failed");
      return updated;
    }
    return await super.updateRunIfStatus(runId, expectedStatuses, patch);
  }
}

class ClaimPendingClaimLostBackend extends MemoryBackend {
  replacementWorkerId = "run-execution:replacement";

  override async updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.status === "running" && patch.workerId) {
      await super.updateRun(runId, {
        status: "running",
        workerId: this.replacementWorkerId,
      });
      return Promise.resolve(false);
    }
    return super.updateRunIfStatus(runId, expectedStatuses, patch);
  }
}

class ClaimReclaimedAfterFailureBackend extends MemoryBackend {
  replacementWorkerId = "run-execution:replacement";

  override async updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.status === "failed" && expectedWorkerId.startsWith("run-execution:")) {
      await super.updateRun(runId, {
        status: "running",
        workerId: this.replacementWorkerId,
      });
    }
    return await super.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
  }
}

class ClaimStalledOwnerLostBackend extends MemoryBackend {
  replacementWorkerId = "run-execution:replacement";

  override async updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (
      patch.status === "running" &&
      patch.workerId?.startsWith("run-execution:") &&
      expectedWorkerId.startsWith("mgr:")
    ) {
      await super.updateRun(runId, {
        status: "running",
        workerId: this.replacementWorkerId,
      });
    }
    return await super.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
  }
}

class ClaimStalledFailureOwnerLostBackend extends MemoryBackend {
  replacementWorkerId = "run-execution:replacement";

  private async replaceOwner(runId: string): Promise<void> {
    await super.updateRun(runId, {
      status: "running",
      workerId: this.replacementWorkerId,
    });
  }

  override async updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.status === "failed") await this.replaceOwner(runId);
    return await super.updateRunIfStatus(runId, expectedStatuses, patch);
  }

  override async updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.status === "failed" && expectedWorkerId.startsWith("mgr:")) {
      await this.replaceOwner(runId);
    }
    return await super.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
  }
}

class ClaimMissingPolicyBackend extends MemoryBackend {
  override async getRun(runId: string): Promise<WorkflowRun | null> {
    const run = await super.getRun(runId);
    return run ? withoutSourcePolicy(run) : null;
  }
}

class ReconcileCancelOnPatchBackend extends MemoryBackend {
  override async updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.status === "failed") {
      await super.updateRun(runId, { status: "cancelled", completedAt: new Date() });
    }
    return await super.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
  }
}

class CompleteStalledWaitOnPauseBackend extends MemoryBackend {
  override async updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    const updated = await super.updateRunIfStatus(runId, expectedStatuses, patch);
    if (updated && patch.status === "waiting" && patch.nodeStates === undefined) {
      await super.updateRun(runId, {
        nodeStates: {
          "await-payment": {
            nodeId: "await-payment",
            status: "completed",
            output: { accepted: true },
            attempt: 1,
            completedAt: new Date(),
          },
        },
      });
    }
    return updated;
  }
}

class CompleteSiblingBeforeNormalPauseBackend extends MemoryBackend {
  override async updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.status === "waiting") {
      await super.updateRun(runId, {
        nodeStates: {
          sibling: {
            nodeId: "sibling",
            status: "completed",
            output: { delivered: true },
            attempt: 1,
            completedAt: new Date(),
          },
        },
      });
    }
    return await super.updateRunIfStatus(runId, expectedStatuses, patch);
  }
}

class ReconcileOwnerChangesBackend extends MemoryBackend {
  readonly attemptedOwners: string[] = [];
  readonly replacementOwners: string[];

  constructor(replacementOwners: string[]) {
    super();
    this.replacementOwners = replacementOwners;
  }

  override async updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.context?.review) {
      this.attemptedOwners.push(expectedWorkerId);
      const replacement = this.replacementOwners.shift();
      if (replacement) {
        await super.updateRun(runId, { workerId: replacement });
      }
    }
    return await super.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
  }
}

class ReconcileDeleteOnHydrateBackend extends MemoryBackend {
  override async updateRunIfStatusAndWorker(
    runId: string,
    _expectedStatuses: WorkflowRun["status"][],
    _expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.context?.env) await this.deleteRun(runId);
    return false;
  }
}

class ConcurrentNodeOutcomeBackend extends MemoryBackend {
  private pendingOutcomeUpdates = 0;
  private releaseOutcomeUpdates!: () => void;
  private readonly outcomeUpdatesReady = new Promise<void>((resolve) => {
    this.releaseOutcomeUpdates = resolve;
  });

  override async updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.nodeStates?.first || patch.nodeStates?.second) {
      this.pendingOutcomeUpdates++;
      if (this.pendingOutcomeUpdates === 2) this.releaseOutcomeUpdates();
      await this.outcomeUpdatesReady;
    }
    return await super.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
  }
}

/**
 * A minimal third-party backend with the historical replacement semantics:
 * `updateRun` overwrites context and nodeStates wholesale, no conditional
 * update methods exist, and nothing declares `supportsRunPatchKeyMerge`.
 * Reconciliation must send such a backend complete maps, never one-entry
 * merge patches.
 */
function createReplacementSemanticsBackend(initial: WorkflowRun): {
  backend: WorkflowBackend;
  read(): WorkflowRun;
} {
  let stored = structuredClone(initial);
  const backend = {
    getRun: () => Promise.resolve(structuredClone(stored)),
    updateRun: (_runId: string, patch: Partial<WorkflowRun>) => {
      stored = { ...stored, ...patch } as WorkflowRun;
      return Promise.resolve();
    },
    getPendingApprovals: () => Promise.resolve([]),
    destroy: () => Promise.resolve(),
  } as unknown as WorkflowBackend;
  return { backend, read: () => stored };
}

function withoutSourcePolicy(run: WorkflowRun): WorkflowRun {
  const { sourceIntegrationPolicy: _sourceIntegrationPolicy, ...missingSnapshot } = run;
  return missingSnapshot as unknown as WorkflowRun;
}

async function claim(
  backend: MemoryBackend,
  run: WorkflowRun,
  options: Partial<Parameters<typeof claimWorkflowRunControl>[0]> = {},
) {
  return await claimWorkflowRunControl({
    backend,
    run,
    managerId: "manager-a",
    executionId: "execution-a",
    stalledThreshold: 60_000,
    executionTimeout: 120_000,
    env: { MODE: "test" },
    debug: false,
    createRunExecution: () => Promise.resolve("execution-a"),
    ...options,
  });
}

function approvalDecision(approved: boolean, comment?: string): ApprovalDecision {
  return { approved, approver: "reviewer", comment };
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

  it("keeps the waiting lock through persistence and releases it before batch reconciliation", async () => {
    const backend = new WaitingReleaseBackend();
    const run = {
      ...createRun("waiting-release-before-callback"),
      status: "running" as const,
      workerId: "run-execution:owner",
    };
    await backend.createRun(run);
    let lockedDuringPersistence: boolean | undefined;
    let lockedDuringNotification: boolean | undefined;
    let lockedDuringBatchComplete: boolean | undefined;

    await execute(
      backend,
      run,
      () => waitingResult(),
      {
        enableLocking: true,
        onWaitingPersist: async () => {
          backend.callbackStarted = true;
          lockedDuringPersistence = await backend.isLocked(run.id);
        },
        onWaiting: async () => {
          lockedDuringNotification = await backend.isLocked(run.id);
        },
        onWaitingBatchComplete: async () => {
          lockedDuringBatchComplete = await backend.isLocked(run.id);
        },
      },
    );

    assertEquals(backend.releaseBeforeCallback, false);
    assertEquals(lockedDuringPersistence, true);
    assertEquals(lockedDuringNotification, false);
    assertEquals(lockedDuringBatchComplete, false);
    assertEquals((await backend.getRun(run.id))?.status, "waiting");
  });

  it("does not revert a sibling delivered before the normal waiting transition", async () => {
    const backend = new CompleteSiblingBeforeNormalPauseBackend();
    const staleNodeStates: Record<string, NodeState> = {
      review: { nodeId: "review", status: "running", attempt: 1 },
      sibling: { nodeId: "sibling", status: "running", attempt: 1 },
    };
    const run = {
      ...createRun("normal-pause-preserves-sibling"),
      status: "running" as const,
      nodeStates: structuredClone(staleNodeStates),
    };
    await backend.createRun(run);

    const outcome = await execute(
      backend,
      run,
      () => waitingResult({ input: {} }, staleNodeStates),
    );

    assertEquals(outcome.status, "waiting");
    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.nodeStates.review?.status, "running");
    assertEquals(persisted?.nodeStates.sibling?.status, "completed");
    assertEquals(persisted?.nodeStates.sibling?.output, { delivered: true });
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

  it("re-parks a stalled wait node that still holds a durable event-wait record", async () => {
    const backend = new MemoryBackend();
    const run = { ...createRun("stalled-live-event-wait"), status: "running" as const };
    await backend.createRun(run);
    await backend.savePendingEventWait(run.id, {
      id: "evw-live",
      runId: run.id,
      nodeId: "await-payment",
      eventName: "payment.confirmed",
      waitKind: "event",
      requestedAt: new Date(),
      status: "pending",
    });
    let announced = 0;

    const outcome = await execute(backend, run, () => stalledWaitResult("await-payment"), {
      onWaiting: () => {
        announced++;
        return Promise.resolve();
      },
    });

    assertEquals(
      outcome.status,
      "waiting",
      "a graph parked behind a live event wait must go back to waiting, not fail",
    );
    const persisted = await backend.getRun(run.id);
    assertEquals(
      persisted?.status,
      "waiting",
      "the persisted run must be waiting while its event wait is still pending",
    );
    assertEquals(
      persisted?.error,
      undefined,
      "re-parking must not leave a stalled-graph error on a healthy run",
    );
    assertEquals(
      announced,
      0,
      "the wait was announced when the run first parked; announcing it again would " +
        "raise a duplicate event wait for the same node",
    );
  });

  it("reconstructs every missing wait after a live sibling in the stalled batch", async () => {
    const backend = new MemoryBackend();
    const run = {
      ...createRun("stalled-wait-batch"),
      status: "running" as const,
      nodeStates: {
        first: { nodeId: "first", status: "running" as const, attempt: 1 },
        second: { nodeId: "second", status: "running" as const, attempt: 1 },
      },
      currentNodes: ["first", "second"],
    };
    await backend.createRun(run);
    await backend.savePendingEventWait(run.id, {
      id: "evw-first-live",
      runId: run.id,
      nodeId: "first",
      eventName: "first.ready",
      waitKind: "event",
      requestedAt: new Date(),
      status: "pending",
    });
    const secondConfig: WaitNodeConfig = {
      type: "wait",
      waitType: "event",
      eventName: "second.ready",
      timeout: "1h",
    };
    const announced: Array<{ nodeId: string; config?: WaitNodeConfig }> = [];
    let completedBatches = 0;

    const result = stalledWaitResult("first");
    result.stalledWaitNodes = [
      {
        nodeId: "first",
        waitConfig: { type: "wait", waitType: "event", eventName: "first.ready" },
      },
      { nodeId: "second", waitConfig: secondConfig },
    ];
    result.nodeStates = run.nodeStates;
    const outcome = await execute(backend, run, () => result, {
      onWaitingPersist: async (_run, nodeId, config) => {
        announced.push({ nodeId, config });
        await backend.savePendingEventWait(run.id, {
          id: `evw-${nodeId}-reconstructed`,
          runId: run.id,
          nodeId,
          eventName: config?.eventName ?? "unknown",
          waitKind: "event",
          requestedAt: new Date(),
          status: "pending",
        });
      },
      onWaitingBatchComplete: () => {
        completedBatches++;
        return Promise.resolve();
      },
    });

    assertEquals(outcome.status, "waiting");
    assertEquals(announced, [{ nodeId: "second", config: secondConfig }]);
    assertEquals(completedBatches, 1);
    assertEquals(
      (await backend.getPendingEventWaits(run.id)).map((wait) => wait.nodeId),
      ["first", "second"],
    );
  });

  it("re-parks a stalled wait node that still holds a durable approval record", async () => {
    const backend = new MemoryBackend();
    const run = { ...createRun("stalled-live-approval"), status: "running" as const };
    await backend.createRun(run);
    await backend.savePendingApproval(run.id, {
      id: "apr-live",
      nodeId: "review",
      message: "Please review",
      requestedAt: new Date(),
      status: "pending",
    });

    const outcome = await execute(backend, run, () => stalledWaitResult("review"));

    assertEquals(
      outcome.status,
      "waiting",
      "a graph parked behind a live approval must go back to waiting, not fail",
    );
    assertEquals((await backend.getRun(run.id))?.status, "waiting");
  });

  it("fails a run under the slug a returned refusal carries", async () => {
    // The executor returns some refusals instead of throwing so earlier
    // batches' states survive. A caller classifying failures by slug must see
    // the same kind of error either way, not a generic orchestration failure.
    const backend = new MemoryBackend();
    const run = { ...createRun("returned-typed-refusal"), status: "running" as const };
    await backend.createRun(run);
    const refusal = INVALID_ARGUMENT.create({
      detail: 'Concurrent sub-workflow nodes "a" and "b" both declare child id "review"',
    });
    const errors: Error[] = [];

    const outcome = await execute(
      backend,
      run,
      () => ({
        completed: false,
        waiting: false,
        context: { input: {} },
        nodeStates: {},
        error: refusal.message,
        errorCause: refusal,
      }),
      { onError: (_run, error) => void errors.push(error) },
    );

    assertEquals(outcome.status, "failed");
    const [reported] = errors;
    assertExists(reported);
    assertEquals(reported instanceof VeryfrontError, true);
    assertEquals((reported as VeryfrontError).slug, INVALID_ARGUMENT.slug);
    assertEquals((await backend.getRun(run.id))?.error?.message, refusal.message);
  });

  it("retains a stalled approval node while its decision is reconciling", async () => {
    const backend = new MemoryBackend();
    const run = { ...createRun("stalled-decided-approval"), status: "running" as const };
    await backend.createRun(run);
    await backend.savePendingApproval(run.id, {
      id: "apr-decided",
      nodeId: "review",
      message: "Please review",
      requestedAt: new Date(),
      status: "pending",
    });
    await backend.updateApproval(run.id, "apr-decided", {
      approved: true,
      approver: "reviewer",
    });

    const outcome = await execute(backend, run, () => stalledWaitResult("review"));

    assertEquals(
      outcome.status,
      "waiting",
      "a decision claim reserves its node until reconciliation finishes",
    );
  });

  it("retains a stalled wait node while its delivered event is reconciling", async () => {
    const backend = new MemoryBackend();
    const run = { ...createRun("stalled-resolved-event-wait"), status: "running" as const };
    await backend.createRun(run);
    await backend.savePendingEventWait(run.id, {
      id: "evw-resolved",
      runId: run.id,
      nodeId: "await-payment",
      eventName: "payment.confirmed",
      waitKind: "event",
      requestedAt: new Date(),
      status: "pending",
    });
    await backend.appendRunEvent(run.id, {
      id: "evt-reconciling",
      eventName: "payment.confirmed",
      payload: {},
      publishedAt: new Date(),
    });
    assertExists(
      await backend.claimRunEventForWait(
        run.id,
        "evw-resolved",
        "payment.confirmed",
      ),
    );

    const outcome = await execute(backend, run, () => stalledWaitResult("await-payment"));

    assertEquals(
      outcome.status,
      "waiting",
      "a delivery claim reserves its node until reconciliation finishes",
    );
  });

  it("re-announces a wait after a transient durable-record read failure", async () => {
    class RejectFirstWaitClaimReadBackend extends MemoryBackend {
      rejected = false;

      override listApprovalDecisionClaims(runId?: string) {
        if (!this.rejected) {
          this.rejected = true;
          return Promise.reject(new Error("transient wait claim read failure"));
        }
        return super.listApprovalDecisionClaims(runId);
      }
    }

    const backend = new RejectFirstWaitClaimReadBackend();
    const run = {
      ...createRun("stalled-read-failure"),
      status: "running" as const,
      nodeStates: {
        "await-payment": {
          nodeId: "await-payment",
          status: "running" as const,
          attempt: 1,
        },
      },
      currentNodes: ["await-payment"],
    };
    await backend.createRun(run);
    let announced = 0;

    const outcome = await execute(backend, run, () => stalledWaitResult("await-payment"), {
      onWaitingPersist: async () => {
        announced++;
        await backend.savePendingEventWait(run.id, {
          id: "evw-reconstructed",
          runId: run.id,
          nodeId: "await-payment",
          eventName: "payment.confirmed",
          waitKind: "event",
          requestedAt: new Date(),
          status: "pending",
        });
      },
    });

    assertEquals(outcome.status, "waiting");
    assertEquals(announced, 1);
    assertEquals((await backend.getRun(run.id))?.status, "waiting");
  });

  it("preserves a stalled wait node completed concurrently after the status-only pause", async () => {
    const backend = new CompleteStalledWaitOnPauseBackend();
    const run = { ...createRun("stalled-concurrent-completion"), status: "running" as const };
    await backend.createRun(run);

    const outcome = await execute(backend, run, () => stalledWaitResult("await-payment"));

    assertEquals(outcome.status, "waiting");
    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "waiting");
    assertEquals(persisted?.nodeStates["await-payment"]?.status, "completed");
    assertEquals(persisted?.error, undefined);
  });

  it("fails a stalled wait node that never had a durable record", async () => {
    const backend = new MemoryBackend();
    const run = { ...createRun("stalled-no-record"), status: "running" as const };
    await backend.createRun(run);

    const outcome = await execute(backend, run, () => stalledWaitResult("await-payment"));

    assertEquals(
      outcome.status,
      "failed",
      "nothing durable is parked on this node, so the run must fail rather than re-park",
    );
    assertEquals(
      (await backend.getRun(run.id))?.error?.message.includes("stalled in the root graph"),
      true,
    );
  });

  it("fails a stalled wait node whose live record belongs to a different node", async () => {
    const backend = new MemoryBackend();
    const run = { ...createRun("stalled-other-node-record"), status: "running" as const };
    await backend.createRun(run);
    await backend.savePendingEventWait(run.id, {
      id: "evw-other-node",
      runId: run.id,
      nodeId: "await-shipping",
      eventName: "shipping.confirmed",
      waitKind: "event",
      requestedAt: new Date(),
      status: "pending",
    });

    const outcome = await execute(backend, run, () => stalledWaitResult("await-payment"));

    assertEquals(
      outcome.status,
      "failed",
      "a wait live on another node says nothing about the node the graph stalled on",
    );
  });
});

describe("workflow/runtime/workflow-run-control claim", () => {
  it("skips pending runs when the pending lock cannot be acquired", async () => {
    const backend = new ClaimLockHeldBackend();
    const run = createRun("claim-lock-held");
    await backend.createRun(run);
    const created: RunExecutionConfig[] = [];

    const outcome = await claim(backend, run, {
      createRunExecution: (config) => {
        created.push(config);
        return Promise.resolve(config.executionId);
      },
    });

    assertEquals(outcome.status, "skipped-lock-held");
    assertEquals(created.length, 0);
    assertEquals(backend.acquireAttempts, 1);
    assertEquals((await backend.getRun(run.id))?.status, "pending");
  });

  it("skips pending runs that change status after the pending lock", async () => {
    const backend = new ClaimStatusChangedAfterLockBackend();
    const run = createRun("claim-status-changed");
    await backend.createRun(run);
    const created: RunExecutionConfig[] = [];

    const outcome = await claim(backend, run, {
      createRunExecution: (config) => {
        created.push(config);
        return Promise.resolve(config.executionId);
      },
    });

    assertEquals(outcome.status, "skipped-status-changed");
    assertEquals(created.length, 0);
    assertEquals(backend.releaseCalls, [{ runId: run.id, lockId: backend.lockToken }]);
    assertEquals((await backend.getRun(run.id))?.status, "waiting");
  });

  it("marks pending runs running before isolated execution creation", async () => {
    const backend = new ClaimDelayedRunningUpdateBackend();
    const run = createRun("claim-running-before-create");
    await backend.createRun(run);
    let createCalled = false;

    const claiming = claim(backend, run, {
      createRunExecution: async (config) => {
        createCalled = true;
        assertEquals((await backend.getRun(run.id))?.status, "running");
        assertEquals((await backend.getRun(run.id))?.workerId, "run-execution:execution-a");
        return config.executionId;
      },
    });

    await backend.runningUpdateStarted.promise;
    assertEquals(createCalled, false);
    backend.continueRunningUpdate.resolve();
    const outcome = await claiming;

    assertEquals(outcome.status, "created");
    assertEquals(outcome.execution?.executionId, "execution-a");
    assertEquals(createCalled, true);
  });

  it("fails the attempted execution owner when claim assignment persists then rejects", async () => {
    const backend = new ClaimPersistedAssignmentRejectsBackend(false);
    const run = createRun("claim-persisted-assignment-rejects");
    await backend.createRun(run);
    let createCalled = false;

    const outcome = await claim(backend, run, {
      createRunExecution: (config) => {
        createCalled = true;
        return Promise.resolve(config.executionId);
      },
    });

    assertEquals(outcome.status, "failed-after-claim");
    assertEquals(createCalled, false);
    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "failed");
    assertEquals(persisted?.workerId, "run-execution:execution-a");
    assertEquals(
      persisted?.error?.message.includes("claim write acknowledgement failed"),
      true,
    );
  });

  it("does not fail a replacement owner after claim assignment persists then rejects", async () => {
    const backend = new ClaimPersistedAssignmentRejectsBackend(true);
    const run = createRun("claim-persisted-assignment-replaced");
    await backend.createRun(run);

    const outcome = await claim(backend, run);

    assertEquals(outcome.status, "failed-after-claim");
    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, backend.replacementWorkerId);
    assertEquals(persisted?.context.replacement, true);
    assertEquals(persisted?.error, undefined);
  });

  it("skips pending runs when another owner wins the running claim", async () => {
    const backend = new ClaimPendingClaimLostBackend();
    const run = createRun("claim-pending-owner-lost");
    await backend.createRun(run);

    const outcome = await claim(backend, run);

    assertEquals(outcome.status, "skipped-status-changed");
    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, backend.replacementWorkerId);
    assertEquals(persisted?.error, undefined);
  });

  it("fails after claim only under the claimed isolated owner", async () => {
    const backend = new ClaimReclaimedAfterFailureBackend();
    const run = createRun("claim-after-claim-fencing");
    await backend.createRun(run);

    const outcome = await claim(backend, run, {
      createRunExecution: () => Promise.reject(new Error("spawn failed")),
    });

    assertEquals(outcome.status, "failed-after-claim");
    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, backend.replacementWorkerId);
    assertEquals(persisted?.error, undefined);
  });

  it("recovers stalled runs through the manager owner before isolated owner assignment", async () => {
    const backend = new MemoryBackend();
    const run = {
      ...createRun("claim-stalled"),
      status: "running" as const,
      heartbeatAt: new Date(Date.now() - 120_000),
      workerId: "run-execution:stale",
    };
    await backend.createRun(run);
    const ownerTransitions: string[] = [];

    const outcome = await claim(backend, run, {
      managerId: "manager-stalled",
      executionId: "execution-stalled",
      createRunExecution: async (config) => {
        ownerTransitions.push((await backend.getRun(run.id))?.workerId ?? "");
        return config.executionId;
      },
    });

    assertEquals(outcome.status, "created");
    assertEquals(ownerTransitions, ["run-execution:execution-stalled"]);
    assertEquals((await backend.getRun(run.id))?.workerId, "run-execution:execution-stalled");
  });

  it("skips stalled runs when the manager owner is replaced before isolated assignment", async () => {
    const backend = new ClaimStalledOwnerLostBackend();
    const run = {
      ...createRun("claim-stalled-owner-lost"),
      status: "running" as const,
      heartbeatAt: new Date(Date.now() - 120_000),
      workerId: "run-execution:stale",
    };
    await backend.createRun(run);

    const outcome = await claim(backend, run, {
      managerId: "manager-stalled-lost",
      executionId: "execution-stalled-lost",
    });

    assertEquals(outcome.status, "skipped-stalled-claim-lost");
    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, backend.replacementWorkerId);
    assertEquals(persisted?.error, undefined);
  });

  it("does not fail a stalled run reclaimed after the manager claim", async () => {
    const backend = new ClaimStalledFailureOwnerLostBackend();
    const storedRun = {
      ...createRun("claim-stalled-policy-failure-owner-lost"),
      status: "running" as const,
      heartbeatAt: new Date(Date.now() - 120_000),
      workerId: "run-execution:stale",
    };
    await backend.createRun(storedRun);

    const outcome = await claim(backend, withoutSourcePolicy(storedRun), {
      managerId: "manager-stalled-policy-failure",
      executionId: "execution-stalled-policy-failure",
    });

    assertEquals(outcome.status, "failed-before-claim");
    const persisted = await backend.getRun(storedRun.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, backend.replacementWorkerId);
    assertEquals(persisted?.error, undefined);
  });

  it("fails a stalled invalid run only while the manager still owns it", async () => {
    const backend = new MemoryBackend();
    const storedRun = {
      ...createRun("claim-stalled-policy-failure-owned"),
      status: "running" as const,
      heartbeatAt: new Date(Date.now() - 120_000),
      workerId: "run-execution:stale",
    };
    await backend.createRun(storedRun);

    const outcome = await claim(backend, withoutSourcePolicy(storedRun), {
      managerId: "manager-stalled-policy-failure-owned",
      executionId: "execution-stalled-policy-failure-owned",
    });

    assertEquals(outcome.status, "failed-before-claim");
    const persisted = await backend.getRun(storedRun.id);
    assertEquals(persisted?.status, "failed");
    assertEquals(persisted?.workerId, "mgr:manager-stalled-policy-failure-owned");
    assertEquals(
      persisted?.error?.message.includes("source integration policy snapshot"),
      true,
    );
  });

  it("resets startedAt to the new claim time when recovering a stalled run", async () => {
    using _time = new FakeTime(new Date("2026-01-01T00:00:00.000Z"));
    const backend = new MemoryBackend();
    const originalStartedAt = new Date("2025-01-01T00:00:00.000Z");
    const run = {
      ...createRun("claim-stalled-started-at"),
      status: "running" as const,
      startedAt: originalStartedAt,
      heartbeatAt: new Date(Date.now() - 120_000),
      workerId: "run-execution:stale",
    };
    await backend.createRun(run);

    const outcome = await claim(backend, run, {
      managerId: "manager-stalled-started-at",
      executionId: "execution-stalled-started-at",
    });

    const persisted = await backend.getRun(run.id);
    assertEquals(outcome.status, "created");
    assertEquals(persisted?.startedAt, new Date("2026-01-01T00:00:00.000Z"));
    assertEquals(persisted?.startedAt === originalStartedAt, false);
  });

  it("requires the persisted source policy and restores it while creating execution", async () => {
    const backend = new MemoryBackend();
    const sourceIntegrationPolicy = normalizeSourceIntegrationPolicy({
      allow: { confluence: { allowedTools: ["get_page"] } },
    });
    const run = { ...createRun("claim-source-policy"), sourceIntegrationPolicy };
    await backend.createRun(run);
    const observedPolicies: unknown[] = [];

    const created = await claim(backend, run, {
      createRunExecution: (config) => {
        observedPolicies.push(getActiveSourceIntegrationPolicy());
        return Promise.resolve(config.executionId);
      },
    });
    const missingPolicyBackend = new ClaimMissingPolicyBackend();
    const missingPolicyRun = createRun("claim-missing-source-policy");
    await missingPolicyBackend.createRun(missingPolicyRun);
    const failed = await claim(missingPolicyBackend, missingPolicyRun);

    assertEquals(created.status, "created");
    assertEquals(observedPolicies, [sourceIntegrationPolicy]);
    assertEquals(failed.status, "failed-before-claim");
    assertEquals((await missingPolicyBackend.getRun(missingPolicyRun.id))?.status, "failed");
  });
});

describe("workflow/runtime/workflow-run-control reconcile", () => {
  it("merges concurrent node outcomes without reverting a sibling", async () => {
    const backend = new ConcurrentNodeOutcomeBackend();
    const run: WorkflowRun = {
      ...createRun("reconcile-concurrent-outcomes"),
      status: "waiting",
      workerId: "run-execution:owner",
      nodeStates: {
        first: { nodeId: "first", status: "running", attempt: 1 },
        second: { nodeId: "second", status: "running", attempt: 1 },
      },
    };
    await backend.createRun(run);

    await Promise.all([
      reconcileWorkflowRunControl({
        backend,
        operation: {
          type: "event-delivery",
          runId: run.id,
          waitId: "wait-first",
          nodeId: "first",
          eventName: "first.completed",
          waitKind: "event",
          payload: { value: 1 },
        },
      }),
      reconcileWorkflowRunControl({
        backend,
        operation: {
          type: "event-delivery",
          runId: run.id,
          waitId: "wait-second",
          nodeId: "second",
          eventName: "second.completed",
          waitKind: "event",
          payload: { value: 2 },
        },
      }),
    ]);

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.nodeStates.first?.status, "completed");
    assertEquals(persisted?.nodeStates.second?.status, "completed");
    assertEquals((persisted?.context.first as { payload?: unknown })?.payload, { value: 1 });
    assertEquals((persisted?.context.second as { payload?: unknown })?.payload, { value: 2 });
  });

  it("clears a stale node error when event delivery completes it", async () => {
    const backend = new MemoryBackend();
    const run = {
      ...createRun("reconcile-event-clears-error"),
      status: "waiting" as const,
      nodeStates: {
        gate: {
          nodeId: "gate",
          status: "failed" as const,
          error: "earlier attempt failed",
          attempt: 2,
        },
      },
    };
    await backend.createRun(run);

    await reconcileWorkflowRunControl({
      backend,
      operation: {
        type: "event-delivery",
        runId: run.id,
        waitId: "wait-gate",
        nodeId: "gate",
        eventName: "gate.ready",
        waitKind: "event",
      },
    });

    const state = (await backend.getRun(run.id))?.nodeStates.gate;
    assertEquals(state?.status, "completed");
    assertEquals(state?.error, undefined);
    assertEquals(state?.attempt, 2);
  });

  it("does not apply an event delivery from a discarded wait execution", async () => {
    const backend = new MemoryBackend();
    const run = {
      ...createRun("reconcile-stale-event-wait"),
      status: "waiting" as const,
      nodeStates: {
        gate: {
          nodeId: "gate",
          status: "running" as const,
          attempt: 1,
          _waitInstanceId: "wait-current",
        },
      },
    };
    await backend.createRun(run);

    const outcome = await reconcileWorkflowRunControl({
      backend,
      operation: {
        type: "event-delivery",
        runId: run.id,
        waitId: "wait-stale",
        nodeId: "gate",
        eventName: "gate.ready",
        waitKind: "event",
        waitInstanceId: "wait-stale",
      },
    });

    assertEquals(outcome.status, "stale-wait");
    assertEquals((await backend.getRun(run.id))?.nodeStates.gate?.status, "running");
    assertEquals((await backend.getRun(run.id))?.context.gate, undefined);
  });

  it("sends complete maps to a backend without declared key-merge support", async () => {
    // The historical third-party contract: updateRun overwrites context and
    // nodeStates wholesale, and nothing declares supportsRunPatchKeyMerge.
    // A single-entry patch would erase every other node's persisted outcome.
    const { backend, read } = createReplacementSemanticsBackend({
      ...createRun("reconcile-replacement-approval"),
      status: "waiting",
      context: { input: {}, earlier: { done: true } },
      nodeStates: {
        earlier: { nodeId: "earlier", status: "completed", attempt: 1 },
        review: { nodeId: "review", status: "running", attempt: 1 },
      },
    });

    const outcome = await reconcileWorkflowRunControl({
      backend,
      operation: {
        type: "approval-decision",
        runId: "reconcile-replacement-approval",
        approvalId: "approval-replacement",
        nodeId: "review",
        decision: { approved: true, approver: "reviewer" },
        decidedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    assertEquals(outcome.status, "reconciled");
    assertEquals(read().nodeStates.review?.status, "completed");
    assertEquals(
      read().nodeStates.earlier,
      { nodeId: "earlier", status: "completed", attempt: 1 },
      "deciding one approval must not erase a sibling node's persisted state " +
        "on a backend that replaces the map wholesale",
    );
    assertEquals(
      read().context.earlier,
      { done: true },
      "deciding one approval must not erase prior workflow outputs on a " +
        "replacement-semantics backend",
    );
  });

  it("refuses concurrent approval outcomes on a replacement-semantics backend", async () => {
    const { backend, read } = createReplacementSemanticsBackend({
      ...createRun("reconcile-replacement-concurrent-approvals"),
      status: "waiting",
      context: { input: {} },
      nodeStates: {
        first: { nodeId: "first", status: "running", attempt: 1 },
        second: { nodeId: "second", status: "running", attempt: 1 },
      },
    });
    backend.getPendingApprovals = () =>
      Promise.resolve([{
        id: "approval-second",
        nodeId: "second",
        message: "Approve second",
        requestedAt: new Date(),
        status: "pending",
      }]);

    await assertRejects(
      () =>
        reconcileWorkflowRunControl({
          backend,
          operation: {
            type: "approval-decision",
            runId: "reconcile-replacement-concurrent-approvals",
            approvalId: "approval-first",
            nodeId: "first",
            decision: { approved: true, approver: "reviewer" },
          },
        }),
      Error,
      "key-merge run patches",
    );

    assertEquals(read().nodeStates.first?.status, "running");
    assertEquals(read().nodeStates.second?.status, "running");
    assertEquals(read().context.first, undefined);
  });

  it("rejects event delivery on a backend without key-merge support", async () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const waitInput = { eventName: "payment.confirmed", timeout: 60_000 };
    const { backend, read } = createReplacementSemanticsBackend({
      ...createRun("reconcile-replacement-event"),
      status: "waiting",
      context: { input: {}, earlier: { done: true } },
      nodeStates: {
        earlier: { nodeId: "earlier", status: "completed", attempt: 1 },
        "await-payment": {
          nodeId: "await-payment",
          status: "running",
          input: waitInput,
          attempt: 3,
          startedAt,
        },
      },
    });

    await assertRejects(
      () =>
        reconcileWorkflowRunControl({
          backend,
          operation: {
            type: "event-delivery",
            runId: "reconcile-replacement-event",
            waitId: "wait-replacement",
            nodeId: "await-payment",
            eventName: "payment.confirmed",
            waitKind: "event",
            payload: { amount: 42 },
          },
        }),
      Error,
      "key-merge",
    );
    assertEquals(read().nodeStates["await-payment"]?.status, "running");
    assertEquals(read().nodeStates["await-payment"]?.input, waitInput);
    assertEquals(read().nodeStates["await-payment"]?.startedAt, startedAt);
  });

  it("omits an absent approval comment while preserving structured data", async () => {
    const backend = new MemoryBackend();
    const run = {
      ...createRun("reconcile-optional-decision-fields"),
      status: "waiting" as const,
      nodeStates: {
        review: {
          nodeId: "review",
          status: "running" as const,
          attempt: 1,
          _subWorkflowOwnerPath: "release-2",
        },
      },
    };
    await backend.createRun(run);

    const outcome = await reconcileWorkflowRunControl({
      backend,
      operation: {
        type: "approval-decision",
        runId: run.id,
        approvalId: "approval-optional-fields",
        nodeId: "review",
        decision: {
          approved: true,
          approver: "reviewer",
          data: { confirmed: true },
        },
        decidedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    const persisted = await backend.getRun(run.id);
    assertEquals(outcome.status, "reconciled");
    assertEquals(persisted?.context.review, {
      approved: true,
      approver: "reviewer",
      data: { confirmed: true },
      decidedAt: "2026-01-01T00:00:00.000Z",
    });
    assertEquals(persisted?.nodeStates.review?.output, {
      approved: true,
      approver: "reviewer",
      data: { confirmed: true },
    });
    assertEquals(persisted?.nodeStates.review?._subWorkflowOwnerPath, "release-2");
  });

  it("keeps the recorded attempt and clears the failure when an approval lands", async () => {
    // The wait was retried before a decision arrived. The approval outcome must
    // record the attempt that actually ran, not reset the count to 1, and must
    // drop the error the earlier attempt left behind.
    const backend = new MemoryBackend();
    const run = {
      ...createRun("reconcile-retried-approval"),
      status: "waiting" as const,
      nodeStates: {
        review: {
          nodeId: "review",
          status: "running" as const,
          attempt: 3,
          error: "approval wait was interrupted",
        },
      },
    };
    await backend.createRun(run);

    const outcome = await reconcileWorkflowRunControl({
      backend,
      operation: {
        type: "approval-decision",
        runId: run.id,
        approvalId: "approval-retried",
        nodeId: "review",
        decision: { approved: true, approver: "reviewer" },
        decidedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    const persisted = await backend.getRun(run.id);
    assertEquals(outcome.status, "reconciled");
    assertEquals(persisted?.nodeStates.review?.status, "completed");
    assertEquals(persisted?.nodeStates.review?.attempt, 3);
    assertEquals(persisted?.nodeStates.review?.error, undefined);
  });

  it("reports a deleted run as terminal when env hydration loses its update", async () => {
    const backend = new ReconcileDeleteOnHydrateBackend();
    const run = {
      ...createRun("reconcile-hydrate-deleted"),
      status: "running" as const,
      workerId: "run-execution:owner",
    };
    await backend.createRun(run);

    const outcome = await reconcileWorkflowRunControl({
      backend,
      operation: {
        type: "hydrate-env",
        run,
        env: { MODE: "new" },
        expectedWorkerId: run.workerId,
      },
    });

    assertEquals(outcome.status, "skipped-terminal");
    assertEquals(outcome.run, undefined);
  });

  it("keeps cancellation terminal during approval rejection", async () => {
    const backend = new ReconcileCancelOnPatchBackend();
    const run = {
      ...createRun("reconcile-rejection-cancelled"),
      status: "waiting" as const,
      workerId: "run-execution:owner",
    };
    await backend.createRun(run);

    const outcome = await reconcileWorkflowRunControl({
      backend,
      operation: {
        type: "approval-decision",
        runId: run.id,
        approvalId: "approval-a",
        nodeId: "review",
        decision: approvalDecision(false, "not ready"),
        decidedAt: new Date("2026-01-01T00:00:00.000Z"),
        maxAttempts: 3,
      },
    });

    const persisted = await backend.getRun(run.id);
    assertEquals(outcome.status, "skipped-terminal");
    assertEquals(persisted?.status, "cancelled");
    assertEquals(persisted?.error, undefined);
  });

  it("fails the run on a rejected approval and never resumes it", async () => {
    const backend = new MemoryBackend();
    const run = {
      ...createRun("reconcile-rejected"),
      status: "waiting" as const,
      workerId: "run-execution:owner",
    };
    await backend.createRun(run);
    const resumeCalls: Array<{ runId: string; expectedWorkerId?: string }> = [];

    const outcome = await reconcileWorkflowRunControl({
      backend,
      operation: {
        type: "approval-decision",
        runId: run.id,
        approvalId: "approval-x",
        nodeId: "review",
        decision: approvalDecision(false, "not ready"),
        decidedAt: new Date("2026-01-01T00:00:00.000Z"),
        maxAttempts: 3,
        resume: (runId, expectedWorkerId) => {
          resumeCalls.push({ runId, expectedWorkerId });
          return Promise.resolve();
        },
      },
    });

    const persisted = await backend.getRun(run.id);
    assertEquals(outcome.status, "reconciled");
    assertEquals(persisted?.status, "failed", "a rejected approval fails the run");
    assertEquals(
      persisted?.error?.message,
      'Approval "approval-x" was rejected: not ready',
      "the rejection reason is persisted",
    );
    assertEquals(
      resumeCalls,
      [],
      "a rejected approval must never resume execution past the gate",
    );
  });

  it("persists approval decisions against the current owner and retries on owner change", async () => {
    const backend = new ReconcileOwnerChangesBackend([
      "run-execution:owner-b",
      "run-execution:owner-c",
    ]);
    const run = {
      ...createRun("reconcile-owner-retry"),
      status: "waiting" as const,
      workerId: "run-execution:owner-a",
    };
    await backend.createRun(run);
    const resumeCalls: Array<{ runId: string; expectedWorkerId?: string }> = [];

    const outcome = await reconcileWorkflowRunControl({
      backend,
      operation: {
        type: "approval-decision",
        runId: run.id,
        approvalId: "approval-b",
        nodeId: "review",
        decision: approvalDecision(true, "ship"),
        decidedAt: new Date("2026-01-01T00:00:00.000Z"),
        maxAttempts: 4,
        resume: (runId, expectedWorkerId) => {
          resumeCalls.push({ runId, expectedWorkerId });
          return Promise.resolve();
        },
      },
    });

    const persisted = await backend.getRun(run.id);
    assertEquals(outcome.status, "reconciled");
    assertEquals(backend.attemptedOwners, [
      "run-execution:owner-a",
      "run-execution:owner-b",
      "run-execution:owner-c",
    ]);
    assertEquals(persisted?.workerId, "run-execution:owner-c");
    assertEquals(persisted?.context.review, {
      approved: true,
      approver: "reviewer",
      comment: "ship",
      decidedAt: "2026-01-01T00:00:00.000Z",
    });
    assertEquals(persisted?.nodeStates.review?.status, "completed");
    assertEquals(resumeCalls, [{ runId: run.id, expectedWorkerId: "run-execution:owner-c" }]);
  });

  it("does nothing for terminal approval decisions", async () => {
    const backend = new MemoryBackend();
    const run = {
      ...createRun("reconcile-terminal-noop"),
      status: "completed" as const,
      workerId: "run-execution:owner",
      output: { ok: true },
    };
    await backend.createRun(run);

    const outcome = await reconcileWorkflowRunControl({
      backend,
      operation: {
        type: "approval-decision",
        runId: run.id,
        approvalId: "approval-terminal",
        nodeId: "review",
        decision: approvalDecision(true),
      },
    });

    const persisted = await backend.getRun(run.id);
    assertEquals(outcome.status, "skipped-terminal");
    assertEquals(persisted?.status, "completed");
    assertEquals(persisted?.context.review, undefined);
    assertEquals(persisted?.output, { ok: true });
  });

  it("does not hydrate env or persist failure for stale entrypoint owners", async () => {
    const backend = new MemoryBackend();
    const run = {
      ...createRun("reconcile-stale-entrypoint"),
      status: "running" as const,
      workerId: "run-execution:new-owner",
      context: { input: {}, env: { EXISTING: "1" } },
    };
    await backend.createRun(run);

    const hydrated = await reconcileWorkflowRunControl({
      backend,
      operation: {
        type: "hydrate-env",
        run,
        env: { EXISTING: "1", SECRET: "redacted" },
        expectedWorkerId: "run-execution:old-owner",
      },
    });
    const failed = await reconcileWorkflowRunControl({
      backend,
      operation: {
        type: "fail-execution",
        runId: run.id,
        error: new Error("lost lock"),
        expectedWorkerId: "run-execution:old-owner",
      },
    });

    const persisted = await backend.getRun(run.id);
    assertEquals(hydrated.status, "stale-owner");
    assertEquals(failed.status, "stale-owner");
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, "run-execution:new-owner");
    assertEquals(persisted?.context.env, { EXISTING: "1" });
    assertEquals(persisted?.error, undefined);
  });
});
