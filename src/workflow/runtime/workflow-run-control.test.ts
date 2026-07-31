import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { MemoryBackend } from "../backends/memory.ts";
import type { WorkflowRunUpdate } from "../backends/types.ts";
import type { ApprovalDecision, NodeState, WorkflowContext, WorkflowRun } from "../types.ts";
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

  override extendLock(_runId: string, _duration: number, _lockId: string): Promise<boolean> {
    this.extensionAttempted.resolve();
    return Promise.resolve(false);
  }

  override releaseLock(runId: string, lockId: string): Promise<boolean> {
    this.releaseCalls++;
    return super.releaseLock(runId, lockId);
  }
}

class GatedHeartbeatBackend extends MemoryBackend {
  readonly extensionStarted = Promise.withResolvers<void>();
  readonly continueExtension = Promise.withResolvers<void>();

  override async extendLock(
    runId: string,
    duration: number,
    lockId: string,
  ): Promise<boolean> {
    this.extensionStarted.resolve();
    await this.continueExtension.promise;
    return await super.extendLock(runId, duration, lockId);
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

class WaitingTransitionBackend extends MemoryBackend {
  transitionBeforeCallback = false;
  callbackStarted = false;

  override async updateRunIfStatusAndLock(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    lockId: string,
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    const updated = await super.updateRunIfStatusAndLock(
      runId,
      expectedStatuses,
      lockId,
      patch,
      expectedWorkerId,
    );
    if (patch.status === "waiting" && !this.callbackStarted) {
      this.transitionBeforeCallback = true;
    }
    return updated;
  }
}

class InvalidAcquisitionBackend extends MemoryBackend {
  override acquireLock(): Promise<string | null> {
    return Promise.resolve("   ");
  }
}

class InvalidRenewalBackend extends MemoryBackend {
  readonly extensionAttempted = Promise.withResolvers<void>();

  override extendLock(_runId: string, _duration: number, _lockId: string): Promise<boolean> {
    this.extensionAttempted.resolve();
    return Promise.resolve("yes" as unknown as boolean);
  }
}

class RefusingLockFencedTransitionBackend extends MemoryBackend {
  override updateRunIfStatusAndLock(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    lockId: string,
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    if (patch.status !== undefined && patch.status !== "running") {
      return Promise.resolve(false);
    }
    return super.updateRunIfStatusAndLock(
      runId,
      expectedStatuses,
      lockId,
      patch,
      expectedWorkerId,
    );
  }
}

class ReplacedBeforeTerminalTransitionBackend extends MemoryBackend {
  replacementToken: string | null = null;

  override async updateRunIfStatusAndLock(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    lockId: string,
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    if (patch.status !== undefined && patch.status !== "running") {
      await super.releaseLock(runId, lockId);
      this.replacementToken = await super.acquireLock(runId, 30_000);
    }
    return await super.updateRunIfStatusAndLock(
      runId,
      expectedStatuses,
      lockId,
      patch,
      expectedWorkerId,
    );
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
  releaseCalls: Array<{ runId: string; lockId: string }> = [];

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

  override releaseLock(runId: string, lockId: string): Promise<boolean> {
    this.releaseCalls.push({ runId, lockId });
    return super.releaseLock(runId, lockId);
  }
}

class ClaimDelayedRunningUpdateBackend extends MemoryBackend {
  readonly runningUpdateStarted = Promise.withResolvers<void>();
  readonly continueRunningUpdate = Promise.withResolvers<void>();

  override async updateRunIfStatusAndLock(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    lockId: string,
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    if (patch.status === "running" && patch.workerId) {
      this.runningUpdateStarted.resolve();
      await this.continueRunningUpdate.promise;
    }
    return await super.updateRunIfStatusAndLock(
      runId,
      expectedStatuses,
      lockId,
      patch,
      expectedWorkerId,
    );
  }
}

class ClaimPendingClaimLostBackend extends MemoryBackend {
  replacementWorkerId = "run-execution:replacement";

  override async updateRunIfStatusAndLock(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    lockId: string,
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    if (patch.status === "running" && patch.workerId) {
      await super.updateRun(runId, {
        status: "running",
        workerId: this.replacementWorkerId,
      });
      return Promise.resolve(false);
    }
    return super.updateRunIfStatusAndLock(
      runId,
      expectedStatuses,
      lockId,
      patch,
      expectedWorkerId,
    );
  }
}

class ClaimReclaimedAfterFailureBackend extends MemoryBackend {
  replacementWorkerId = "run-execution:replacement";
  replacementToken: string | null = null;

  override async updateRunIfStatusAndLock(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    lockId: string,
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    if (patch.status === "failed" && expectedWorkerId?.startsWith("run-execution:")) {
      await super.releaseLock(runId, lockId);
      this.replacementToken = await super.acquireLock(runId, 30_000);
      await super.updateRun(runId, {
        status: "running",
        workerId: this.replacementWorkerId,
      });
    }
    return await super.updateRunIfStatusAndLock(
      runId,
      expectedStatuses,
      lockId,
      patch,
      expectedWorkerId,
    );
  }
}

class ClaimFailureUpdateRejectsBackend extends MemoryBackend {
  failureUpdateAttempts = 0;
  failureUpdatesRemaining = 1;

  override updateRunIfStatusAndLock(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    lockId: string,
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    if (patch.status === "failed" && expectedWorkerId?.startsWith("run-execution:")) {
      this.failureUpdateAttempts++;
      if (this.failureUpdatesRemaining > 0) {
        this.failureUpdatesRemaining--;
        return Promise.reject(new Error("transient failed-claim CAS rejection"));
      }
    }
    return super.updateRunIfStatusAndLock(
      runId,
      expectedStatuses,
      lockId,
      patch,
      expectedWorkerId,
    );
  }
}

class IntendedChildAcquiresBeforeFinalClaimCheckBackend extends MemoryBackend {
  childStarted = false;
  childToken: string | null = null;

  override async updateRunIfStatusAndLock(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    lockId: string,
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    if (this.childStarted && patch.status === undefined && patch.heartbeatAt !== undefined) {
      await super.releaseLock(runId, lockId);
      this.childToken = await super.acquireLock(runId, 30_000);
    }
    return await super.updateRunIfStatusAndLock(
      runId,
      expectedStatuses,
      lockId,
      patch,
      expectedWorkerId,
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
    lockRetryInterval: 50,
    executionTimeout: 120_000,
    env: { MODE: "test" },
    debug: false,
    isAdmissionOpen: () => true,
    createRunExecution: (config) => Promise.resolve(config.executionId),
    deleteRunExecution: () => Promise.resolve(),
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

  it("rejects incomplete and malformed backend lock capabilities", async () => {
    const incomplete = new MemoryBackend();
    Object.defineProperty(incomplete, "extendLock", { value: undefined });
    const incompleteRun = createRun("incomplete-lock-capability");
    await incomplete.createRun(incompleteRun);
    await assertRejects(
      () => execute(incomplete, incompleteRun, () => completedResult(), { enableLocking: true }),
      Error,
      "locking requires backend acquireLock, extendLock, releaseLock, and lock-fenced update",
    );
    assertEquals((await incomplete.getRun(incompleteRun.id))?.status, "pending");

    const malformed = new InvalidAcquisitionBackend();
    const malformedRun = createRun("invalid-lock-token");
    await malformed.createRun(malformedRun);
    await assertRejects(
      () => execute(malformed, malformedRun, () => completedResult(), { enableLocking: true }),
      Error,
      "invalid lock token",
    );
    assertEquals((await malformed.getRun(malformedRun.id))?.status, "pending");
  });

  it("fails closed when lock renewal returns a non-boolean result", async () => {
    using time = new FakeTime();
    const backend = new InvalidRenewalBackend();
    const run = createRun("invalid-lock-renewal-result");
    await backend.createRun(run);
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();

    const execution = execute(
      backend,
      run,
      async () => {
        started.resolve();
        await release.promise;
        return completedResult();
      },
      { enableLocking: true, heartbeatInterval: 5 },
    );
    await started.promise;
    await time.tickAsync(5);
    await backend.extensionAttempted.promise;
    release.resolve();

    await assertRejects(() => execution, Error, "Could not renew lock");
    assertEquals((await backend.getRun(run.id))?.status, "running");
  });

  it("does not notify waiting observers when the lock-fenced transition loses ownership", async () => {
    const backend = new RefusingLockFencedTransitionBackend();
    const run = createRun("waiting-release-refused");
    await backend.createRun(run);
    let callbackCalls = 0;

    const outcome = await execute(backend, run, () => waitingResult(), {
      enableLocking: true,
      onWaiting: () => {
        callbackCalls++;
      },
    });

    assertEquals(outcome.status, "ownership-lost");
    assertEquals(callbackCalls, 0);
    assertEquals((await backend.getRun(run.id))?.status, "running");
  });

  it("atomically consumes the waiting lock before callback reconciliation", async () => {
    const backend = new WaitingTransitionBackend();
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

    assertEquals(backend.transitionBeforeCallback, true);
    assertEquals(lockedDuringCallback, false);
    assertEquals((await backend.getRun(run.id))?.status, "waiting");
  });

  it("settles an in-flight heartbeat before consuming the waiting lease", async () => {
    using time = new FakeTime();
    const backend = new GatedHeartbeatBackend();
    const run = createRun("waiting-with-in-flight-heartbeat");
    await backend.createRun(run);
    const operationStarted = Promise.withResolvers<void>();
    const finishOperation = Promise.withResolvers<void>();
    let callbackCalls = 0;

    const execution = execute(
      backend,
      run,
      async () => {
        operationStarted.resolve();
        await finishOperation.promise;
        return waitingResult();
      },
      {
        enableLocking: true,
        heartbeatInterval: 5,
        onWaiting: () => {
          callbackCalls++;
        },
      },
    );

    await operationStarted.promise;
    await time.tickAsync(5);
    await backend.extensionStarted.promise;
    finishOperation.resolve();
    backend.continueExtension.resolve();

    const outcome = await execution;
    assertEquals(outcome.status, "waiting");
    assertEquals(callbackCalls, 1);
    assertEquals((await backend.getRun(run.id))?.status, "waiting");
    assertEquals(await backend.isLocked(run.id), false);
  });

  it("does not fail a waiting run while a replacement owns the handoff lease", async () => {
    const backend = new MemoryBackend();
    const run = createRun("replacement-owns-waiting-handoff");
    await backend.createRun(run);
    const callbackStarted = Promise.withResolvers<void>();
    const rejectCallback = Promise.withResolvers<void>();
    let failureObserverCalls = 0;

    const execution = execute(backend, run, () => waitingResult(), {
      enableLocking: true,
      onWaiting: async () => {
        callbackStarted.resolve();
        await rejectCallback.promise;
        throw new Error("approval persistence failed");
      },
      onError: () => {
        failureObserverCalls++;
      },
    });

    await callbackStarted.promise;
    const replacementToken = await backend.acquireLock(run.id, 30_000);
    if (!replacementToken) throw new Error("Replacement did not acquire the handoff lease");
    rejectCallback.resolve();

    const outcome = await execution;
    assertEquals(outcome.status, "ownership-lost");
    assertEquals(failureObserverCalls, 0);
    assertEquals((await backend.getRun(run.id))?.status, "waiting");
    assertEquals(await backend.isLocked(run.id), true);
    assertEquals(await backend.releaseLock(run.id, replacementToken), true);
  });

  it("does not publish terminal or waiting state after a replacement acquires the lease", async () => {
    const scenarios = ["completed", "failed", "waiting"] as const;

    for (const scenario of scenarios) {
      const backend = new ReplacedBeforeTerminalTransitionBackend();
      const run = createRun(`replacement-before-${scenario}`);
      await backend.createRun(run);
      let observerCalls = 0;

      await assertRejects(
        () =>
          execute(
            backend,
            run,
            () => {
              if (scenario === "completed") return completedResult();
              if (scenario === "waiting") return waitingResult();
              return {
                error: "primary failure",
                context: { input: {} },
                nodeStates: {},
              };
            },
            {
              enableLocking: true,
              onComplete: () => {
                observerCalls++;
              },
              onError: () => {
                observerCalls++;
              },
              onWaiting: () => {
                observerCalls++;
              },
            },
          ),
        Error,
        "Lost lock ownership before releasing",
      );

      assertEquals(observerCalls, 0);
      assertEquals((await backend.getRun(run.id))?.status, "running");
      assertEquals((await backend.getRun(run.id))?.output, undefined);
      if (!backend.replacementToken) {
        throw new Error("Replacement did not acquire the workflow lease");
      }
      assertEquals(await backend.releaseLock(run.id, backend.replacementToken), true);
    }
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

  it("keeps internal execution context while omitting framework fields from default output", async () => {
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
      _tenant: { projectSlug: "private", token: "token", productionMode: false },
      finish: { ok: true },
    });
    assertEquals(persisted.output, {
      finish: { ok: true },
    });
  });

  it("persists prepared output before notifying completion", async () => {
    const backend = new MemoryBackend();
    const run = { ...createRun("prepared-output"), status: "running" as const };
    await backend.createRun(run);
    let callbackRun: WorkflowRun | undefined;

    await execute(
      backend,
      run,
      () => completedResult(),
      {
        prepareOutput: (output) => ({ validated: output }),
        onComplete: (completedRun) => {
          callbackRun = completedRun;
        },
      },
    );

    const persisted = await backend.getRun(run.id);
    assertExists(persisted);
    assertEquals(persisted.status, "completed");
    assertEquals(persisted.output, {
      validated: { finish: { ok: true } },
    });
    assertEquals(callbackRun?.status, "completed");
    assertEquals(callbackRun?.output, persisted.output);
  });

  it("keeps completed outcome when the post-persistence observer rejects", async () => {
    const backend = new MemoryBackend();
    const run = { ...createRun("completion-observer-rejects"), status: "running" as const };
    await backend.createRun(run);

    const outcome = await execute(backend, run, () => completedResult(), {
      onComplete: () => {
        throw new Error("completion observer failed");
      },
    });

    assertEquals(outcome.status, "completed");
    assertEquals((await backend.getRun(run.id))?.status, "completed");
  });

  it("preserves returned and thrown failures when failure observers reject", async () => {
    const returnedBackend = new MemoryBackend();
    const returnedRun = { ...createRun("returned-failure-observer"), status: "running" as const };
    await returnedBackend.createRun(returnedRun);
    const returned = await execute(
      returnedBackend,
      returnedRun,
      () => ({
        error: "returned primary failure",
        context: { input: {} },
        nodeStates: {},
      }),
      {
        onError: () => {
          throw new Error("returned observer failure");
        },
      },
    );
    assertEquals(returned.status, "failed");
    assertEquals(
      (await returnedBackend.getRun(returnedRun.id))?.error?.message,
      "returned primary failure",
    );

    const thrownBackend = new MemoryBackend();
    const thrownRun = { ...createRun("thrown-failure-observer"), status: "running" as const };
    await thrownBackend.createRun(thrownRun);
    await assertRejects(
      () =>
        execute(
          thrownBackend,
          thrownRun,
          () => {
            throw new Error("thrown primary failure");
          },
          {
            onError: async () => {
              throw new Error("thrown observer failure");
            },
          },
        ),
      Error,
      "thrown primary failure",
    );
    assertEquals(
      (await thrownBackend.getRun(thrownRun.id))?.error?.message,
      "thrown primary failure",
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
        const persisted = await backend.getRun(run.id);
        assertEquals(persisted?.status, "running");
        assertEquals(persisted?.workerId, "run-execution:execution-a");
        assertEquals(config.run.status, persisted?.status);
        assertEquals(config.run.workerId, persisted?.workerId);
        assertEquals(config.run.startedAt, persisted?.startedAt);
        assertEquals(config.run.heartbeatAt, persisted?.heartbeatAt);
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

  it("requeues a claim when admission closes while the running CAS is in flight", async () => {
    const backend = new ClaimDelayedRunningUpdateBackend();
    const run = createRun("claim-admission-closes-during-cas");
    await backend.createRun(run);
    let admissionOpen = true;
    let createCalls = 0;

    const claiming = claim(backend, run, {
      isAdmissionOpen: () => admissionOpen,
      createRunExecution: (config) => {
        createCalls++;
        return Promise.resolve(config.executionId);
      },
    });
    await backend.runningUpdateStarted.promise;
    admissionOpen = false;
    backend.continueRunningUpdate.resolve();

    const outcome = await claiming;
    assertEquals(outcome.status, "skipped-admission-closed");
    assertEquals(createCalls, 0);
    assertEquals((await backend.getRun(run.id))?.status, "pending");
    assertEquals(await backend.isLocked(run.id), false);
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

    assertEquals(outcome.status, "skipped-claim-lost");
    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, backend.replacementWorkerId);
    assertEquals(persisted?.error, undefined);
    assertEquals(await backend.isLocked(run.id), true);
    if (!backend.replacementToken) throw new Error("Replacement did not acquire claim lock");
    assertEquals(await backend.releaseLock(run.id, backend.replacementToken), true);
  });

  it("retains teardown ownership when failed-claim compensation rejects after deletion", async () => {
    const backend = new ClaimFailureUpdateRejectsBackend();
    const run = createRun("claim-failure-update-rejects");
    await backend.createRun(run);
    const deletedExecutionIds: string[] = [];

    const outcome = await claim(backend, run, {
      createRunExecution: () => Promise.reject(new Error("primary spawn failure")),
      deleteRunExecution: (executionId) => {
        deletedExecutionIds.push(executionId);
        return Promise.resolve();
      },
    });

    assertEquals(outcome.status, "skipped-claim-lost");
    assertEquals(outcome.teardownCandidate, {
      executionId: "execution-a",
      runId: run.id,
    });
    assertEquals(deletedExecutionIds, ["execution-a"]);
    assertEquals(backend.failureUpdateAttempts, 1);
    assertEquals(
      outcome.error?.message,
      'Could not compensate rejected run execution "execution-a"',
    );
    const cause = outcome.error?.cause;
    assertEquals(cause instanceof AggregateError, true);
    if (!(cause instanceof AggregateError)) throw new Error("Expected aggregated claim errors");
    assertEquals(
      cause.errors.map((error) => error instanceof Error ? error.message : String(error)),
      ["primary spawn failure", "transient failed-claim CAS rejection"],
    );

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, "run-execution:execution-a");
    assertEquals(await backend.isLocked(run.id), false);
  });

  it("admits the intended child when it acquires a fresh lease before final verification", async () => {
    const backend = new IntendedChildAcquiresBeforeFinalClaimCheckBackend();
    const run = createRun("claim-child-acquires-before-final-check");
    await backend.createRun(run);
    let deleteCalls = 0;

    const outcome = await claim(backend, run, {
      createRunExecution: (config) => {
        backend.childStarted = true;
        return Promise.resolve(config.executionId);
      },
      deleteRunExecution: () => {
        deleteCalls++;
        return Promise.resolve();
      },
    });

    assertEquals(outcome.status, "created");
    assertEquals(deleteCalls, 0);
    assertEquals(
      (await backend.getRun(run.id))?.workerId,
      "run-execution:execution-a",
    );
    if (!backend.childToken) throw new Error("Intended child did not acquire its lease");
    assertEquals(await backend.releaseLock(run.id, backend.childToken), true);
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
