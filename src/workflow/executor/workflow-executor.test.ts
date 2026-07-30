import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { WorkflowRunUpdate } from "../backends/types.ts";
import { branch, dependsOn, step, waitForApproval, workflow } from "../dsl/index.ts";
import { ApprovalManager } from "../runtime/approval-manager.ts";
import type { WorkflowDefinition, WorkflowRun } from "../types.ts";
import { reserveWorkflowStart, WorkflowExecutor } from "./workflow-executor.ts";
import { FakeTime } from "#std/testing/time";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils";
import {
  getActiveSourceIntegrationPolicy,
  runWithExactSourceIntegrationPolicy,
} from "#veryfront/integrations/source-policy-context.ts";
import {
  normalizeSourceIntegrationPolicy,
  type SourceIntegrationPolicyManifest,
} from "#veryfront/integrations/source-policy.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

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
    sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
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

class CompletesBeforeCancellationBackend extends MemoryBackend {
  completeBeforeCancellation = false;

  override async updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (this.completeBeforeCancellation && patch.status === "cancelled") {
      this.completeBeforeCancellation = false;
      await super.updateRun(runId, {
        status: "completed",
        completedAt: new Date(),
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

class FailingLockHeartbeatBackend extends MemoryBackend {
  readonly extensionAttempted = Promise.withResolvers<void>();
  releaseCalls = 0;

  override extendLock(_runId: string, _duration: number, _lockId: string): Promise<boolean> {
    this.extensionAttempted.resolve();
    return Promise.reject(new Error("lock backend unavailable"));
  }

  override releaseLock(runId: string, lockId: string): Promise<boolean> {
    this.releaseCalls++;
    return super.releaseLock(runId, lockId);
  }
}

class TokenCheckingLockBackend extends MemoryBackend {
  acquiredToken: string | null = null;
  extendedToken: string | undefined;
  extensionCalls = 0;

  override async acquireLock(runId: string, duration: number): Promise<string | null> {
    this.acquiredToken = await super.acquireLock(runId, duration);
    return this.acquiredToken;
  }

  override extendLock(
    runId: string,
    duration: number,
    lockId: string,
  ): Promise<boolean> {
    this.extensionCalls++;
    this.extendedToken = lockId;
    return super.extendLock(runId, duration, lockId);
  }
}

class ReplaceableExecutionLockBackend extends MemoryBackend {
  currentLockId: string | null = null;

  override async acquireLock(runId: string, duration: number): Promise<string | null> {
    this.currentLockId = await super.acquireLock(runId, duration);
    return this.currentLockId;
  }

  async replaceExecutionLock(runId: string, duration: number): Promise<string> {
    const previousLockId = this.currentLockId;
    assertExists(previousLockId);
    assertEquals(await super.releaseLock(runId, previousLockId), true);
    const replacementLockId = await this.acquireLock(runId, duration);
    assertExists(replacementLockId);
    return replacementLockId;
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
      return Promise.reject(new Error("owner heartbeat unavailable"));
    }
    return super.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
  }
}

class CancelOnLockHandoffBackend extends MemoryBackend {
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
    if (updated && patch.status === "waiting") {
      await super.updateRun(runId, { status: "cancelled", completedAt: new Date() });
    }
    return updated;
  }
}

class DelayedCancellationBackend extends MemoryBackend {
  readonly cancellationStarted = Promise.withResolvers<void>();
  readonly persistCancellation = Promise.withResolvers<void>();

  override async updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.status === "cancelled") {
      this.cancellationStarted.resolve();
      await this.persistCancellation.promise;
    }
    return await super.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
  }
}

class RetryableShutdownBackend extends MemoryBackend {
  rejectShutdownWrites = false;

  override updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: WorkflowRunUpdate,
  ): Promise<boolean> {
    if (this.rejectShutdownWrites) {
      return Promise.reject(new Error("shutdown run store unavailable"));
    }
    return super.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
  }

  override updateRunIfStatusAndLock(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    lockId: string,
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    if (this.rejectShutdownWrites) {
      return Promise.reject(new Error("shutdown run store unavailable"));
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

class CleanupTrackingBackend extends MemoryBackend {
  heartbeatUpdates = 0;
  releaseCalls = 0;

  override updateRun(runId: string, patch: Partial<WorkflowRun>): Promise<void> {
    if (Object.keys(patch).length === 1 && patch.heartbeatAt) this.heartbeatUpdates++;
    return super.updateRun(runId, patch);
  }

  override updateRunIfStatusAndLock(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    lockId: string,
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    if (Object.keys(patch).length === 1 && patch.heartbeatAt) this.heartbeatUpdates++;
    return super.updateRunIfStatusAndLock(
      runId,
      expectedStatuses,
      lockId,
      patch,
      expectedWorkerId,
    );
  }

  override releaseLock(runId: string, lockId: string): Promise<boolean> {
    this.releaseCalls++;
    return super.releaseLock(runId, lockId);
  }
}

describe("workflow/executor/workflow-executor", () => {
  it("rejects invalid maxConcurrency before accepting workflow work", () => {
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
        () => new WorkflowExecutor({ backend: new MemoryBackend(), maxConcurrency }),
        Error,
        "maxConcurrency must be a positive safe integer",
      );
    }
  });

  it("rejects invalid positive runtime timer options at construction", () => {
    const invalidValues = [
      0,
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MAX_TIMER_DELAY_MS + 1,
    ];

    for (const option of ["lockDuration", "heartbeatInterval", "resultWaitTimeout"] as const) {
      for (const value of invalidValues) {
        assertThrows(
          () =>
            new WorkflowExecutor({
              backend: new MemoryBackend(),
              [option]: value,
            }),
          Error,
          option,
        );
      }
    }
  });

  it("accepts zero cancellation grace but rejects invalid values", () => {
    new WorkflowExecutor({ backend: new MemoryBackend(), cancellationGracePeriod: 0 });

    for (
      const cancellationGracePeriod of [
        -1,
        0.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        MAX_TIMER_DELAY_MS + 1,
      ]
    ) {
      assertThrows(
        () =>
          new WorkflowExecutor({
            backend: new MemoryBackend(),
            cancellationGracePeriod,
          }),
        Error,
        "cancellationGracePeriod",
      );
    }
  });

  it("requires heartbeatInterval to leave a two-renewal lease safety margin", () => {
    new WorkflowExecutor({
      backend: new MemoryBackend(),
      lockDuration: 30_000,
      heartbeatInterval: 10_000,
    });

    for (const heartbeatInterval of [10_001, 29_999, 30_000, 30_001]) {
      assertThrows(
        () =>
          new WorkflowExecutor({
            backend: new MemoryBackend(),
            lockDuration: 30_000,
            heartbeatInterval,
          }),
        Error,
        "heartbeatInterval must be no greater than one third of lockDuration",
      );
    }
  });

  it("fails closed on incomplete locking unless locking is explicitly disabled", () => {
    const backend = new MemoryBackend();
    Object.defineProperty(backend, "extendLock", { value: undefined });

    assertThrows(
      () => new WorkflowExecutor({ backend }),
      Error,
      "locking requires backend acquireLock, extendLock, releaseLock, and lock-fenced update",
    );
    new WorkflowExecutor({ backend, enableLocking: false });
  });

  it("rejects duplicate workflow registrations and snapshots static step arrays", () => {
    const executor = new WorkflowExecutor({ backend: new MemoryBackend() });
    const definition = workflow({
      id: "captured-registration",
      steps: [step("initial", { tool: createTool("initial", () => ({ ok: true })) })],
    }).definition;
    executor.register(definition);
    const captured = executor.getWorkflow(definition.id);

    (definition.steps as WorkflowDefinition["steps"] & unknown[]).push(
      step("late", { tool: createTool("late", () => ({ ok: true })) }),
    );
    assertEquals(Array.isArray(captured?.steps) ? captured.steps.length : undefined, 1);
    assertThrows(
      () => executor.register(definition),
      Error,
      "Workflow already registered",
    );
  });

  it("rejects raw zero and NaN workflow timeouts at registration", () => {
    const executor = new WorkflowExecutor({ backend: new MemoryBackend() });

    for (const timeout of [0, Number.NaN]) {
      const definition: WorkflowDefinition = {
        id: `invalid-timeout-${String(timeout)}`,
        timeout,
        steps: [{ id: "step", config: { type: "step", tool: "tool" } }],
      };

      assertThrows(
        () => executor.register(definition),
        Error,
        "timeout",
      );
    }
  });

  it("persists the exact source integration policy when a run starts", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    const activeSourceIntegrationPolicy = {
      schemaVersion: 1,
      mode: "allowlist",
      integrations: {
        confluence: { allowedToolIds: ["search_content", "get_page"] },
      },
    } satisfies SourceIntegrationPolicyManifest;
    const sourceIntegrationPolicy = normalizeSourceIntegrationPolicy({
      allow: {
        confluence: { allowedTools: ["search_content", "get_page"] },
      },
    });
    let observedPolicy: unknown;

    executor.register(
      workflow({
        id: "source-policy-start",
        steps: [
          step("observe", {
            tool: createTool("observe", () => {
              observedPolicy = getActiveSourceIntegrationPolicy();
              return { ok: true };
            }),
          }),
        ],
      }).definition,
    );

    const handle = await runWithExactSourceIntegrationPolicy(
      activeSourceIntegrationPolicy,
      () => executor.start("source-policy-start", {}),
    );
    await handle.settled();

    const storedRun = await backend.getRun(handle.runId);
    assertExists(storedRun);
    assertEquals(
      (storedRun as WorkflowRun & { sourceIntegrationPolicy: unknown })
        .sourceIntegrationPolicy,
      sourceIntegrationPolicy,
    );
    assertEquals(observedPolicy, sourceIntegrationPolicy);
  });

  it("restores the persisted source policy on resume and intersects a narrower reload", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    const persistedPolicy = normalizeSourceIntegrationPolicy({
      allow: {
        confluence: { allowedTools: ["get_page", "search_content"] },
      },
    });
    const reloadedPolicy = normalizeSourceIntegrationPolicy({
      allow: {
        confluence: { allowedTools: ["get_page"] },
        github: {},
      },
    });
    const expectedPolicy = normalizeSourceIntegrationPolicy({
      allow: {
        confluence: { allowedTools: ["get_page"] },
      },
    });
    let observedPolicy: unknown;

    executor.register(
      workflow({
        id: "source-policy-resume",
        steps: [
          step("observe", {
            tool: createTool("observe", () => {
              observedPolicy = getActiveSourceIntegrationPolicy();
              return { ok: true };
            }),
          }),
        ],
      }).definition,
    );

    await backend.createRun({
      ...createRun("source-policy-resume"),
      status: "waiting",
      ...{ sourceIntegrationPolicy: persistedPolicy },
    });

    await runWithExactSourceIntegrationPolicy(
      reloadedPolicy,
      () => executor.resume("run-source-policy-resume"),
    );

    assertEquals(observedPolicy, expectedPolicy);
  });

  it("activates and calls onStart before resolving dynamic workflow nodes", async () => {
    const backend = new MemoryBackend();
    const events: string[] = [];
    const executor = new WorkflowExecutor({
      backend,
      enableLocking: false,
      onStart: () => {
        events.push("onStart");
      },
    });
    executor.register(
      workflow({
        id: "dynamic-node-resolution-failure",
        steps: () => {
          events.push("resolveNodes");
          throw new Error("dynamic steps exploded");
        },
      }).definition,
    );

    const handle = await executor.start("dynamic-node-resolution-failure", {});
    await handle.settled();

    const failedRun = await backend.getRun(handle.runId);
    assertExists(failedRun);
    assertEquals(events, ["onStart", "resolveNodes"]);
    assertEquals(failedRun.status, "failed");
    assertEquals(failedRun.error?.message, "dynamic steps exploded");
    assertEquals(failedRun.startedAt instanceof Date, true);
  });

  it("does not complete a run after worker ownership changes during execution", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    executor.register(
      workflow({
        id: "owner-fenced-completion",
        steps: [
          step("blocking", {
            tool: createTool("blocking", async () => {
              started.resolve();
              await release.promise;
              return { stale: true };
            }),
          }),
        ],
      }).definition,
    );
    const run = {
      ...createRun("owner-fenced-completion"),
      status: "running" as const,
      workerId: "run-execution:old-owner",
    };
    await backend.createRun(run);

    const execution = executor.resume(run.id, undefined, run.workerId);
    await started.promise;
    await backend.updateRun(run.id, { workerId: "run-execution:new-owner" });
    release.resolve();
    await execution;

    const persisted = await backend.getRun(run.id);
    assertExists(persisted);
    assertEquals(persisted.status, "running");
    assertEquals(persisted.workerId, "run-execution:new-owner");
    assertEquals(persisted.output, undefined);
  });

  it("does not save a checkpoint after worker ownership changes", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    const run = {
      ...createRun("owner-fenced-checkpoint"),
      status: "running" as const,
      workerId: "run-execution:old-owner",
    };
    executor.register(
      workflow({
        id: "owner-fenced-checkpoint",
        steps: [
          step("reclaimed", {
            checkpoint: true,
            tool: createTool("reclaimed", async () => {
              await backend.updateRun(run.id, { workerId: "run-execution:new-owner" });
              return { stale: true };
            }),
          }),
        ],
      }).definition,
    );
    await backend.createRun(run);

    await executor.resume(run.id, undefined, run.workerId);

    const persisted = await backend.getRun(run.id);
    assertExists(persisted);
    assertEquals(persisted.status, "running");
    assertEquals(persisted.workerId, "run-execution:new-owner");
    assertEquals(await backend.getLatestCheckpoint(run.id), null);
  });

  it("releases a waiting run lock before its async callback settles", async () => {
    using time = new FakeTime();
    const backend = new MemoryBackend();
    const callbackStarted = Promise.withResolvers<void>();
    const releaseCallback = Promise.withResolvers<void>();
    const executor = new WorkflowExecutor({
      backend,
      heartbeatInterval: 5,
      onWaiting: async () => {
        callbackStarted.resolve();
        await releaseCallback.promise;
      },
    });
    executor.register(
      workflow({
        id: "await-waiting-callback",
        steps: [waitForApproval("review")],
      }).definition,
    );
    const run = {
      ...createRun("await-waiting-callback"),
      status: "running" as const,
      workerId: "run-execution:current-owner",
    };
    await backend.createRun(run);

    let settled = false;
    const execution = executor.resume(run.id, undefined, run.workerId).then(() => {
      settled = true;
    });
    await callbackStarted.promise;
    await Promise.resolve();

    assertEquals(settled, false);
    const pausedRun = await backend.getRun(run.id);
    assertEquals(pausedRun?.status, "waiting");
    assertEquals(await backend.isLocked(run.id), false);

    await time.tickAsync(5);
    const heartbeatRun = await backend.getRun(run.id);
    assertEquals(
      heartbeatRun?.heartbeatAt?.getTime(),
      pausedRun?.heartbeatAt?.getTime(),
    );
    assertEquals(heartbeatRun?.workerId, run.workerId);
    assertEquals(settled, false);

    releaseCallback.resolve();
    await time.tickAsync(0);
    await execution;
    assertEquals(settled, true);
  });

  it("fails a waiting run when its async callback rejects", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({
      backend,
      onWaiting: () => Promise.reject(new Error("approval persistence failed")),
    });
    executor.register(
      workflow({
        id: "reject-waiting-callback",
        steps: [
          step("prepare", { tool: createTool("prepare", () => ({ ready: true })) }),
          waitForApproval("review"),
        ],
      }).definition,
    );
    const run = {
      ...createRun("reject-waiting-callback"),
      status: "running" as const,
      workerId: "run-execution:current-owner",
    };
    await backend.createRun(run);

    await assertRejects(
      () => executor.resume(run.id, undefined, run.workerId),
      Error,
      "approval persistence failed",
    );

    const failedRun = await backend.getRun(run.id);
    assertEquals(failedRun?.status, "failed");
    assertEquals(failedRun?.error?.message, "approval persistence failed");
    assertEquals(failedRun?.workerId, run.workerId);
    assertEquals(failedRun?.context.prepare, { ready: true });
    assertEquals(failedRun?.nodeStates.prepare?.status, "completed");
    assertEquals(failedRun?.nodeStates.review?.status, "running");
    assertEquals(await backend.isLocked(run.id), false);
  });

  it("does not invoke a waiting callback after cancellation during lock handoff", async () => {
    const backend = new CancelOnLockHandoffBackend();
    let callbackCalls = 0;
    const executor = new WorkflowExecutor({
      backend,
      onWaiting: () => {
        callbackCalls++;
      },
    });
    executor.register(
      workflow({
        id: "cancel-during-waiting-handoff",
        steps: [waitForApproval("review")],
      }).definition,
    );
    const run = {
      ...createRun("cancel-during-waiting-handoff"),
      status: "running" as const,
      workerId: "run-execution:current-owner",
    };
    await backend.createRun(run);

    await executor.resume(run.id, undefined, run.workerId);

    assertEquals((await backend.getRun(run.id))?.status, "cancelled");
    assertEquals(callbackCalls, 0);
  });

  it("does not let an old waiting callback fail a replacement executor", async () => {
    const backend = new MemoryBackend();
    const callbackStarted = Promise.withResolvers<void>();
    const rejectCallback = Promise.withResolvers<void>();
    const replacementStarted = Promise.withResolvers<void>();
    const releaseReplacement = Promise.withResolvers<void>();
    const blockingTool = createTool("finish", async () => {
      replacementStarted.resolve();
      await releaseReplacement.promise;
      return { ok: true };
    });
    const definition = workflow({
      id: "replacement-during-waiting-callback",
      steps: [
        waitForApproval("review"),
        dependsOn(step("finish", { tool: blockingTool }), "review"),
      ],
    }).definition;
    const originalExecutor = new WorkflowExecutor({
      backend,
      onWaiting: async (pausedRun, nodeId) => {
        await backend.savePendingApproval(pausedRun.id, {
          id: "approval-replacement-race",
          nodeId,
          message: "approve me",
          payload: {},
          requestedAt: new Date(),
          status: "pending",
        });
        callbackStarted.resolve();
        await rejectCallback.promise;
        throw new Error("late waiting callback failure");
      },
    });
    const replacementExecutor = new WorkflowExecutor({ backend });
    originalExecutor.register(definition);
    replacementExecutor.register(definition);
    const approvalManager = new ApprovalManager({
      backend,
      executor: replacementExecutor,
      expirationCheckInterval: 0,
    });
    const run = {
      ...createRun("replacement-during-waiting-callback"),
      status: "running" as const,
      workerId: "run-execution:shared-owner",
    };
    await backend.createRun(run);
    const originalExecution = originalExecutor.resume(run.id, undefined, run.workerId);

    try {
      await callbackStarted.promise;
      const replacementExecution = approvalManager.approve(
        run.id,
        "approval-replacement-race",
        "reviewer",
      );
      await replacementStarted.promise;

      rejectCallback.resolve();
      await originalExecution;
      assertEquals((await backend.getRun(run.id))?.status, "running");

      releaseReplacement.resolve();
      await replacementExecution;
      assertEquals((await backend.getRun(run.id))?.status, "completed");
    } finally {
      rejectCallback.resolve();
      releaseReplacement.resolve();
      approvalManager.stop();
    }
  });

  it("keeps an approval decision when a waiting run has an older checkpoint", async () => {
    const backend = new MemoryBackend();
    let finishRuns = 0;
    const approvalId = "approval-after-checkpoint";
    const executor = new WorkflowExecutor({
      backend,
      onWaiting: async (pausedRun, nodeId) => {
        await backend.savePendingApproval(pausedRun.id, {
          id: approvalId,
          nodeId,
          message: "approve me",
          payload: {},
          requestedAt: new Date(),
          status: "pending",
        });
      },
    });
    executor.register(
      workflow({
        id: "approval-after-checkpoint",
        steps: [
          step("prepare", {
            checkpoint: true,
            tool: createTool("prepare", () => ({ ready: true })),
          }),
          dependsOn(waitForApproval("review"), "prepare"),
          dependsOn(
            step("finish", {
              tool: createTool("finish", () => {
                finishRuns++;
                return { done: true };
              }),
            }),
            "review",
          ),
        ],
      }).definition,
    );
    const run = {
      ...createRun("approval-after-checkpoint"),
      status: "running" as const,
      workerId: "run-execution:checkpoint-owner",
    };
    await backend.createRun(run);
    await executor.resume(run.id, undefined, run.workerId);

    assertExists(await backend.getLatestCheckpoint(run.id));
    assertEquals((await backend.getRun(run.id))?.status, "waiting");

    const approvals = new ApprovalManager({
      backend,
      executor,
      expirationCheckInterval: 0,
    });
    try {
      await approvals.approve(run.id, approvalId, "reviewer");

      const completedRun = await backend.getRun(run.id);
      assertEquals(completedRun?.status, "completed");
      assertEquals(finishRuns, 1);
      assertEquals(
        (completedRun?.context.review as { approved?: boolean })?.approved,
        true,
      );
      assertEquals(completedRun?.context.finish, { done: true });
    } finally {
      approvals.stop();
    }
  });

  it("fences a started execution after stalled ownership is replaced", async () => {
    const backend = new TokenCheckingLockBackend();
    const executor = new WorkflowExecutor({
      backend,
      heartbeatInterval: 30_000,
      lockDuration: 120_000,
    });
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    executor.register(
      workflow({
        id: "owned-start-reclaimed",
        steps: [
          step("stall", {
            tool: createTool("stall", async () => {
              started.resolve();
              await release.promise;
              return { old: true };
            }),
          }),
        ],
      }).definition,
    );

    const handle = await executor.start("owned-start-reclaimed", {});
    await started.promise;
    const startedRun = await backend.getRun(handle.runId);
    assertEquals(startedRun?.workerId?.startsWith("run-execution:"), true);

    const activeLockToken = backend.acquiredToken;
    assertExists(activeLockToken);
    await backend.releaseLock(handle.runId, activeLockToken);
    await backend.updateRun(handle.runId, {
      heartbeatAt: new Date(Date.now() - 1_000),
    });
    assertEquals(
      await backend.claimStalledRun(handle.runId, "replacement-owner", 1),
      true,
    );
    const replacementLock = await backend.acquireLock(handle.runId, 30_000);
    assertEquals(typeof replacementLock, "string");

    release.resolve();
    await handle.settled();

    const reclaimedRun = await backend.getRun(handle.runId);
    assertEquals(reclaimedRun?.status, "running");
    assertEquals(reclaimedRun?.workerId, "replacement-owner");
    assertEquals(reclaimedRun?.output, undefined);
    assertEquals(await backend.isLocked(handle.runId), true);

    assertExists(replacementLock);
    await backend.releaseLock(handle.runId, replacementLock);
  });

  it("acquires and releases the backend lock around successful execution", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({
      backend,
      lockDuration: 5_000,
      heartbeatInterval: 1_000,
    });
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

  it("fails durably before completion when the output schema rejects", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    let completionCalls = 0;
    executor.register(
      workflow({
        id: "invalid-output",
        outputSchema: defineSchema((v) =>
          v.object({
            finish: v.object({ value: v.string() }),
          })
        )(),
        steps: [
          step("finish", {
            tool: createTool("finish", () => ({ value: 42 })),
          }),
        ],
        onComplete: () => {
          completionCalls++;
        },
      }).definition,
    );
    const run = createRun("invalid-output");
    await backend.createRun(run);

    await assertRejects(
      () => executor.executeAsync(run.id),
      Error,
    );

    const failedRun = await backend.getRun(run.id);
    assertExists(failedRun);
    assertEquals(failedRun.status, "failed");
    assertEquals(failedRun.output, undefined);
    assertExists(failedRun.error);
    assertEquals(completionCalls, 0);
  });

  it("persists schema-transformed output before notifying completion", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    let completionOutput: unknown;
    executor.register(
      workflow({
        id: "transformed-output",
        outputSchema: defineSchema((v) =>
          v.object({
            finish: v.object({ value: v.string() }),
          }).transform((output) => ({
            normalized: output.finish.value.toUpperCase(),
          }))
        )(),
        steps: [
          step("finish", {
            tool: createTool("finish", () => ({ value: "ready" })),
          }),
        ],
        onComplete: (output) => {
          completionOutput = output;
        },
      }).definition,
    );
    const run = createRun("transformed-output");
    await backend.createRun(run);

    await executor.executeAsync(run.id);

    const completedRun = await backend.getRun(run.id);
    assertExists(completedRun);
    assertEquals(completedRun.status, "completed");
    assertEquals(completedRun.output, { normalized: "READY" });
    assertEquals(completionOutput, completedRun.output);
  });

  it("keeps terminal state authoritative when completion observers reject", async () => {
    const backend = new MemoryBackend();
    const observerCalls: string[] = [];
    const executor = new WorkflowExecutor({
      backend,
      enableLocking: false,
      onComplete: async () => {
        observerCalls.push("executor");
        throw new Error("executor observer failed");
      },
    });
    executor.register(
      workflow({
        id: "completion-observer-failure",
        steps: [step("finish", { tool: createTool("finish", () => ({ ok: true })) })],
        onComplete: () => {
          observerCalls.push("workflow");
          throw new Error("workflow observer failed");
        },
      }).definition,
    );
    const run = createRun("completion-observer-failure");
    await backend.createRun(run);

    await executor.executeAsync(run.id);

    assertEquals(observerCalls.sort(), ["executor", "workflow"]);
    assertEquals((await backend.getRun(run.id))?.status, "completed");
  });

  it("preserves the primary execution failure when failure observers reject", async () => {
    const backend = new MemoryBackend();
    const observerCalls: string[] = [];
    const executor = new WorkflowExecutor({
      backend,
      enableLocking: false,
      onError: async () => {
        observerCalls.push("executor");
        throw new Error("executor failure observer failed");
      },
    });
    executor.register(
      workflow({
        id: "failure-observer-failure",
        steps: [
          step("fail", {
            tool: createTool("fail", () => {
              throw new Error("primary execution failure");
            }),
          }),
        ],
        onError: () => {
          observerCalls.push("workflow");
          throw new Error("workflow failure observer failed");
        },
      }).definition,
    );
    const run = createRun("failure-observer-failure");
    await backend.createRun(run);

    await executor.executeAsync(run.id);

    assertEquals(observerCalls.sort(), ["executor", "workflow"]);
    const failedRun = await backend.getRun(run.id);
    assertEquals(failedRun?.status, "failed");
    assertEquals(failedRun?.error?.message, 'Node "fail" failed: primary execution failure');
  });

  it("does not execute a run when another worker already holds the lock", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({
      backend,
      lockDuration: 5_000,
      heartbeatInterval: 1_000,
    });
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
    const heldLockToken = await backend.acquireLock(run.id, 5_000);
    assertExists(heldLockToken);

    await assertRejects(
      () => executor.executeAsync(run.id),
      Error,
      "another worker is already executing it",
    );

    const updatedRun = await backend.getRun(run.id);
    assertExists(updatedRun);
    assertEquals(updatedRun.status, "pending");
    assertEquals(updatedRun.output, undefined);
    await backend.releaseLock(run.id, heldLockToken);
  });

  it("marks failed runs and releases the lock when a step fails", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({
      backend,
      lockDuration: 5_000,
      heartbeatInterval: 1_000,
    });
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

  it("renews the lock with its immutable token at the configured interval", async () => {
    using time = new FakeTime();
    const backend = new TokenCheckingLockBackend();
    const executor = new WorkflowExecutor({
      backend,
      lockDuration: 30_000,
      heartbeatInterval: 5,
    });
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    executor.register(
      workflow({
        id: "token-bound-heartbeat",
        steps: [
          step("blocking", {
            tool: createTool("blocking", async () => {
              started.resolve();
              await release.promise;
              return { ok: true };
            }),
          }),
        ],
      }).definition,
    );
    const run = createRun("token-bound-heartbeat");
    await backend.createRun(run);

    const execution = executor.executeAsync(run.id);
    await started.promise;
    await time.tickAsync(5);

    assertEquals(backend.extensionCalls, 1);
    assertEquals(backend.extendedToken, backend.acquiredToken);

    release.resolve();
    await time.tickAsync(0);
    await execution;
  });

  it("aborts when an owner heartbeat cannot verify persisted ownership", async () => {
    using time = new FakeTime();
    const backend = new FailingOwnerHeartbeatBackend();
    const executor = new WorkflowExecutor({
      backend,
      enableLocking: false,
      heartbeatInterval: 5,
    });
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    executor.register(
      workflow({
        id: "owner-heartbeat-failure",
        steps: [
          step("blocking", {
            tool: createTool("blocking", async () => {
              started.resolve();
              await release.promise;
              return { ok: true };
            }),
          }),
        ],
      }).definition,
    );
    const run = {
      ...createRun("owner-heartbeat-failure"),
      status: "running" as const,
      workerId: "run-execution:current-owner",
    };
    await backend.createRun(run);

    const execution = executor.resume(run.id, undefined, run.workerId);
    const rejected = assertRejects(
      () => execution,
      Error,
      "Could not verify execution ownership",
    );
    await started.promise;
    await time.tickAsync(5);
    release.resolve();
    await time.tickAsync(0);

    await rejected;
    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, run.workerId);
    assertEquals(persisted?.output, undefined);
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

  it("cancels a result waiter without leaking its poll timer or cancelling the run", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend });
    const started = Promise.withResolvers<void>();
    const blockingTool: Tool = {
      id: "result-waiter",
      type: "function",
      description: "Wait until the workflow itself is cancelled",
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
        id: "result-waiter",
        steps: [step("blocking", { tool: blockingTool })],
      }).definition,
    );

    const handle = await executor.start("result-waiter", {});
    await started.promise;
    const controller = new AbortController();
    const result = handle.result(controller.signal);
    controller.abort(new Error("stop waiting for the workflow result"));

    await assertRejects(
      () => result,
      Error,
      "stop waiting for the workflow result",
    );
    assertEquals((await handle.status()).status, "running");

    await handle.cancel();
    await handle.settled();
    assertEquals((await handle.status()).status, "cancelled");
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

  it("does not overwrite completion after cancellation reads a stale run", async () => {
    const backend = new CompletesBeforeCancellationBackend();
    const executor = new WorkflowExecutor({ backend });
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    executor.register(
      workflow({
        id: "completion-cancel-race",
        steps: [
          step("work", {
            tool: createTool("work", async () => {
              started.resolve();
              await release.promise;
              return { ok: true };
            }),
          }),
        ],
      }).definition,
    );

    const handle = await executor.start("completion-cancel-race", {});
    await started.promise;
    backend.completeBeforeCancellation = true;

    try {
      await assertRejects(
        () => handle.cancel(),
        Error,
        "run has already completed",
      );
    } finally {
      release.resolve();
      await handle.settled();
    }

    assertEquals((await backend.getRun(handle.runId))?.status, "completed");
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
    assertEquals(backend.releaseCalls, 0);
    assertEquals(await backend.isLocked(run.id), false);

    const heartbeatUpdates = backend.heartbeatUpdates;
    await time.tickAsync(20_000);
    assertEquals(backend.heartbeatUpdates, heartbeatUpdates);
  });

  it("joins one-shot admissions and prevents released or forged close bypasses", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register(
      workflow({
        id: "reserved-start-shutdown",
        steps: [step("complete", { tool: createTool("reserved-start", () => "done") })],
      }).definition,
    );

    const released = reserveWorkflowStart(
      executor,
      "reserved-start-shutdown",
      {},
      { runId: "released-admission-run" },
    );
    released.release();
    released.release();
    const firstReleasedConsume = released.consume();
    assertStrictEquals(released.consume(), firstReleasedConsume);
    await assertRejects(
      () => firstReleasedConsume,
      Error,
      "workflow executor admission was released",
    );
    assertEquals(await backend.getRun("released-admission-run"), null);

    const held = reserveWorkflowStart(
      executor,
      "reserved-start-shutdown",
      {},
      { runId: "consumed-admission-run" },
    );
    const heldForRelease = reserveWorkflowStart(
      executor,
      "reserved-start-shutdown",
      {},
      { runId: "late-released-admission-run" },
    );
    let destroySettled = false;
    const destroyPromise = executor.destroy().finally(() => {
      destroySettled = true;
    });
    await Promise.resolve();
    assertEquals(destroySettled, false);
    assertThrows(
      () => executor.start("reserved-start-shutdown", {}),
      Error,
      "workflow executor is closing",
    );
    assertEquals("reserveStart" in executor, false);
    assertThrows(
      () =>
        reserveWorkflowStart(
          Object.create(WorkflowExecutor.prototype) as WorkflowExecutor,
          "reserved-start-shutdown",
          {},
        ),
      Error,
      "admission owner is invalid",
    );

    heldForRelease.release();
    heldForRelease.release();
    await Promise.resolve();
    assertEquals(destroySettled, false);
    const firstConsume = held.consume();
    assertStrictEquals(held.consume(), firstConsume);
    const handle = await firstConsume;
    await destroyPromise;
    await handle.settled();

    assertEquals((await backend.getRun(handle.runId))?.status, "cancelled");
    assertEquals(await backend.getRun("late-released-admission-run"), null);
  });

  it("waits for an admitted handle status read before closing", async () => {
    const backend = new CompletionRaceBackend();
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "handle-status-shutdown",
        steps: [step("complete", { tool: createTool("status-tool", () => "done") })],
      }).definition,
    );
    const handle = await executor.start("handle-status-shutdown", {});
    await handle.settled();
    backend.interceptNextGet = true;
    const statusPromise = handle.status();
    await backend.completionReadStarted.promise;
    let destroySettled = false;
    const destroyPromise = executor.destroy().finally(() => {
      destroySettled = true;
    });

    try {
      await Promise.resolve();
      assertEquals(destroySettled, false);
      backend.releaseCompletionRead.resolve();
      assertEquals((await statusPromise).id, handle.runId);
      await destroyPromise;
      assertThrows(
        () => handle.status(),
        Error,
        "workflow executor is closed",
      );
    } finally {
      backend.releaseCompletionRead.resolve();
      await Promise.allSettled([statusPromise, destroyPromise]);
    }
  });

  it("actively aborts result polling when closing", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "result-waiter-shutdown",
        steps: [waitForApproval("review")],
      }).definition,
    );
    const handle = await executor.start("result-waiter-shutdown", {});
    await handle.settled();
    const resultPromise = handle.result();
    const resultRejection = assertRejects(
      () => resultPromise,
      Error,
      "Workflow executor is closing",
    );

    await Promise.all([executor.destroy(), resultRejection]);
    assertThrows(
      () => handle.result(),
      Error,
      "workflow executor is closed",
    );
  });

  it("cancels and quiesces active execution before closing", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, cancellationGracePeriod: 20 });
    const started = Promise.withResolvers<void>();
    const blockingTool: Tool = {
      id: "shutdown-blocker",
      type: "function",
      description: "Wait for executor shutdown",
      inputSchema: defineSchema((v) => v.object({}).passthrough())(),
      execute: (_input, context) => {
        started.resolve();
        return new Promise((_resolve, reject) => {
          context?.abortSignal?.addEventListener(
            "abort",
            () => reject(context.abortSignal?.reason),
            { once: true },
          );
        });
      },
    };
    executor.register(
      workflow({
        id: "executor-shutdown",
        steps: [step("block", { tool: blockingTool })],
      }).definition,
    );

    const handle = await executor.start("executor-shutdown", {});
    await started.promise;
    const firstDestroy = executor.destroy();
    assertEquals(executor.destroy(), firstDestroy);
    await firstDestroy;
    await handle.settled();

    assertEquals((await backend.getRun(handle.runId))?.status, "cancelled");
    assertThrows(
      () => executor.start("executor-shutdown", {}),
      Error,
      "workflow executor is closed",
    );
  });

  it("quiesces a stale execution without cancelling its replacement worker", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({
      backend,
      cancellationGracePeriod: 20,
      enableLocking: false,
    });
    const started = Promise.withResolvers<void>();
    executor.register(
      workflow({
        id: "shutdown-worker-handoff",
        steps: [
          step("block", {
            tool: createTool("shutdown-worker-handoff-blocker", (_input) => {
              started.resolve();
              return new Promise(() => {});
            }),
          }),
        ],
      }).definition,
    );

    const handle = await executor.start("shutdown-worker-handoff", {});
    await started.promise;
    const admittedRun = await backend.getRun(handle.runId);
    assertExists(admittedRun?.workerId);
    const replacementWorkerId = "run-execution:replacement-worker";
    await backend.updateRun(handle.runId, { workerId: replacementWorkerId });

    await executor.destroy();
    await handle.settled();

    const replacementRun = await backend.getRun(handle.runId);
    assertEquals(replacementRun?.status, "running");
    assertEquals(replacementRun?.workerId, replacementWorkerId);
    assertEquals(admittedRun.workerId === replacementRun?.workerId, false);
  });

  it("quiesces a stale execution without cancelling its replacement lock owner", async () => {
    const backend = new ReplaceableExecutionLockBackend();
    const executor = new WorkflowExecutor({ backend, cancellationGracePeriod: 20 });
    const started = Promise.withResolvers<void>();
    executor.register(
      workflow({
        id: "shutdown-lock-handoff",
        steps: [
          step("block", {
            tool: createTool("shutdown-lock-handoff-blocker", () => {
              started.resolve();
              return new Promise(() => {});
            }),
          }),
        ],
      }).definition,
    );

    const handle = await executor.start("shutdown-lock-handoff", {});
    await started.promise;
    const admittedRun = await backend.getRun(handle.runId);
    assertExists(admittedRun?.workerId);
    const replacementLockId = await backend.replaceExecutionLock(handle.runId, 30_000);

    try {
      await executor.destroy();
      await handle.settled();

      const replacementRun = await backend.getRun(handle.runId);
      assertEquals(replacementRun?.status, "running");
      assertEquals(replacementRun?.workerId, admittedRun.workerId);
      assertEquals(await backend.extendLock(handle.runId, 30_000, replacementLockId), true);
    } finally {
      await backend.releaseLock(handle.runId, replacementLockId);
      await Promise.allSettled([handle.settled(), executor.destroy()]);
    }
  });

  it("aborts every overlapping execution admitted for the same run", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({
      backend,
      cancellationGracePeriod: 20,
      enableLocking: false,
    });
    const firstStarted = Promise.withResolvers<void>();
    const bothStarted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const aborted = [false, false];
    let executionCount = 0;
    const blockingTool: Tool = {
      id: "overlapping-shutdown-blocker",
      type: "function",
      description: "Wait for overlapping execution teardown",
      inputSchema: defineSchema((v) => v.object({}).passthrough())(),
      execute: (_input, context) => {
        const index = executionCount++;
        if (index === 0) firstStarted.resolve();
        if (executionCount === 2) bothStarted.resolve();
        return new Promise<void>((resolve, reject) => {
          const abort = () => {
            aborted[index] = true;
            reject(context?.abortSignal?.reason);
          };
          if (context?.abortSignal?.aborted) abort();
          else context?.abortSignal?.addEventListener("abort", abort, { once: true });
          release.promise.then(resolve, reject);
        });
      },
    };
    executor.register(
      workflow({
        id: "overlapping-executor-shutdown",
        steps: [step("block", { tool: blockingTool })],
      }).definition,
    );

    const handle = await executor.start("overlapping-executor-shutdown", {});
    await firstStarted.promise;
    const admittedRun = await backend.getRun(handle.runId);
    assertExists(admittedRun?.workerId);
    const overlappingExecution = executor.executeAsync(
      handle.runId,
      undefined,
      admittedRun.workerId,
    );
    await bothStarted.promise;
    const destroyPromise = executor.destroy();
    let watchdogId: ReturnType<typeof setTimeout> | undefined;

    try {
      const outcome = await Promise.race([
        destroyPromise.then(() => "destroyed" as const),
        new Promise<"timed-out">((resolve) => {
          watchdogId = setTimeout(() => resolve("timed-out"), 200);
        }),
      ]);
      assertEquals(outcome, "destroyed");
      await Promise.allSettled([handle.settled(), overlappingExecution]);

      assertEquals(aborted, [true, true]);
      assertEquals((await backend.getRun(handle.runId))?.status, "cancelled");
    } finally {
      if (watchdogId !== undefined) clearTimeout(watchdogId);
      release.resolve();
      await Promise.allSettled([
        handle.settled(),
        overlappingExecution,
        destroyPromise,
      ]);
    }
  });

  it("keeps failed shutdown state retryable until durable cancellation succeeds", async () => {
    const backend = new RetryableShutdownBackend();
    const executor = new WorkflowExecutor({
      backend,
      cancellationGracePeriod: 20,
      enableLocking: false,
    });
    const started = Promise.withResolvers<void>();
    const blockingTool: Tool = {
      id: "retryable-shutdown-blocker",
      type: "function",
      description: "Wait for a retryable executor shutdown",
      inputSchema: defineSchema((v) => v.object({}).passthrough())(),
      execute: (_input, context) => {
        started.resolve();
        return new Promise((_resolve, reject) => {
          const abort = () => reject(context?.abortSignal?.reason);
          if (context?.abortSignal?.aborted) abort();
          else context?.abortSignal?.addEventListener("abort", abort, { once: true });
        });
      },
    };
    executor.register(
      workflow({
        id: "retryable-executor-shutdown",
        steps: [step("block", { tool: blockingTool })],
      }).definition,
    );

    const handle = await executor.start("retryable-executor-shutdown", {});
    await started.promise;
    backend.rejectShutdownWrites = true;
    const firstDestroy = executor.destroy();

    try {
      assertEquals(executor.destroy(), firstDestroy);
      await assertRejects(
        () => firstDestroy,
        AggregateError,
        "Failed to destroy workflow executor cleanly",
      );
      await handle.settled();

      assertEquals((await backend.getRun(handle.runId))?.status, "running");
      assertThrows(
        () => executor.start("retryable-executor-shutdown", {}),
        Error,
        "workflow executor is closing",
      );

      backend.rejectShutdownWrites = false;
      const retryDestroy = executor.destroy();
      assertEquals(retryDestroy === firstDestroy, false);
      await retryDestroy;

      assertEquals((await backend.getRun(handle.runId))?.status, "cancelled");
      assertEquals(executor.destroy(), retryDestroy);
      assertThrows(
        () => executor.getStatus(handle.runId),
        Error,
        "workflow executor is closed",
      );
    } finally {
      backend.rejectShutdownWrites = false;
      await Promise.allSettled([handle.settled(), executor.destroy()]);
    }
  });
});
