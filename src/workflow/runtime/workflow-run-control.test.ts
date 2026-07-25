import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { MemoryBackend } from "../backends/memory.ts";
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
