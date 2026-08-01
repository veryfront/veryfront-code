import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { WorkflowRunUpdate } from "../backends/types.ts";
import {
  branch,
  delay,
  dependsOn,
  loop,
  map,
  parallel,
  step,
  subWorkflow,
  waitForApproval,
  waitForEvent,
  workflow,
} from "../dsl/index.ts";
import { ApprovalManager } from "../runtime/approval-manager.ts";
import type {
  Checkpoint,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowRun,
} from "../types.ts";
import { SUBWORKFLOW_INPUT_KIND, WORKFLOW_RUNTIME_STATE_VERSION } from "../runtime-state.ts";
import { TimedWaitRecoveryService } from "../runtime/timed-wait-recovery.ts";
import { reserveWorkflowStart, WorkflowExecutor } from "./workflow-executor.ts";
import { DAGExecutor } from "./dag/index.ts";
import { CheckpointManager } from "./checkpoint-manager.ts";
import type { CheckpointOwnership } from "./checkpoint-manager.ts";
import { StepExecutor } from "./step-executor.ts";
import { getPrimaryAbortReason, isAbortCleanupError } from "./abortable-operation.ts";
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
import { MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES } from "../limits.ts";

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
    _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
    _workflowProjection: { context: {} },
  };
}

class CrashAfterDurableCheckpointManager extends CheckpointManager {
  private crashed = false;

  constructor(
    backend: MemoryBackend,
    private readonly shouldCrash: (checkpoint: Checkpoint) => boolean,
  ) {
    super({ backend });
  }

  override async save(
    runId: string,
    checkpoint: Checkpoint,
    ownership?: CheckpointOwnership,
  ): Promise<boolean> {
    const saved = await super.save(runId, checkpoint, ownership);
    if (saved && !this.crashed && this.shouldCrash(checkpoint)) {
      this.crashed = true;
      throw new Error("simulated crash after durable checkpoint save");
    }
    return saved;
  }
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

class ReassignsAfterTimedWakeBackend extends MemoryBackend {
  handoffs = 0;

  private async handoffAfterWake(
    runId: string,
    updated: boolean,
    patch: WorkflowRunUpdate,
  ): Promise<void> {
    if (!updated || patch.status !== "pending" || this.handoffs !== 0) return;
    this.handoffs++;
    await super.updateRunIfStatus(runId, ["pending"], {
      status: "running",
      workerId: "run-execution:replacement-owner",
    });
  }

  override async updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    patch: WorkflowRunUpdate,
  ): Promise<boolean> {
    const updated = await super.updateRunIfStatus(runId, expectedStatuses, patch);
    await this.handoffAfterWake(runId, updated, patch);
    return updated;
  }

  override async updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: WorkflowRunUpdate,
  ): Promise<boolean> {
    const updated = await super.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
    await this.handoffAfterWake(runId, updated, patch);
    return updated;
  }
}

class WaitingTransitionTrackingBackend extends MemoryBackend {
  waitingTransitions = 0;

  override updateRunIfStatusAndLock(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    lockId: string,
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    if (patch.status === "waiting") this.waitingTransitions++;
    return super.updateRunIfStatusAndLock(
      runId,
      expectedStatuses,
      lockId,
      patch,
      expectedWorkerId,
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
        version: "1",
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
      version: "1",
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
        version: "1",
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
      version: "1",
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
      version: "1",
      status: "running" as const,
      workerId: "run-execution:old-owner",
    };
    executor.register(
      workflow({
        id: "owner-fenced-checkpoint",
        version: "1",
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

  it("fails closed on a legacy descendant checkpoint without a root envelope", async () => {
    const backend = new MemoryBackend();
    let childExecutions = 0;
    const executor = new WorkflowExecutor({
      backend,
      enableLocking: false,
    });
    executor.register({
      id: "descendant-checkpoint-root-recovery",
      version: "1",
      steps: [{
        id: "nested",
        config: {
          type: "subWorkflow",
          workflow: {
            id: "descendant-checkpoint-child",
            steps: [{
              id: "child",
              config: {
                type: "step",
                tool: createTool("descendant-checkpoint-child", () => {
                  childExecutions++;
                  return "done";
                }),
              },
            }],
          },
        },
      }],
    });
    const run: WorkflowRun = {
      ...createRun("descendant-checkpoint-root-recovery"),
      version: "1",
      status: "pending",
      input: { root: true },
      context: { input: { root: true }, keep: "OUTER" },
      _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
      _workflowProjection: { context: {} },
    };
    await backend.createRun(run);
    await backend.saveCheckpoint(run.id, {
      id: "nested-child-checkpoint",
      nodeId: "nested/child",
      timestamp: new Date(),
      context: { input: { secret: "SUB" }, "nested/child": "done" },
      nodeStates: {
        "nested/child": {
          nodeId: "nested/child",
          status: "completed",
          output: "done",
          attempt: 1,
          completedAt: new Date(),
        },
      },
      _workflowProjection: {
        context: {},
        inputKind: SUBWORKFLOW_INPUT_KIND,
      },
    });

    await assertRejects(
      () => executor.resume(run.id),
      Error,
      "legacy descendant checkpoint",
    );

    assertEquals(childExecutions, 0);
    assertEquals((await backend.getRun(run.id))?.status, "pending");
  });

  it("resumes a sub-workflow descendant envelope without replaying its completed child", async () => {
    const backend = new MemoryBackend();
    let childExecutions = 0;
    const definition: WorkflowDefinition = {
      id: "descendant-envelope-root-recovery",
      version: "1",
      steps: [{
        id: "nested",
        config: {
          type: "subWorkflow",
          workflow: {
            id: "descendant-envelope-child",
            steps: [{
              id: "child",
              config: {
                type: "step",
                checkpoint: true,
                tool: createTool("descendant-envelope-child", () => {
                  childExecutions++;
                  return "already-done";
                }),
              },
            }],
          },
        },
      }],
    };
    const run: WorkflowRun = {
      ...createRun(definition.id),
      version: definition.version,
      status: "pending",
      input: { root: true },
      context: { input: { root: true }, keep: "OUTER" },
      _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
      _workflowProjection: { context: {} },
    };
    await backend.createRun(run);
    const dag = new DAGExecutor({
      stepExecutor: new StepExecutor(),
      checkpointManager: new CheckpointManager({ backend }),
    });
    const seeded = await dag.execute(definition.steps as WorkflowNode[], run);
    assertEquals(seeded.completed, true);
    assertEquals(childExecutions, 1);
    assertExists((await backend.getLatestCheckpoint(run.id))?._resumeEnvelope);

    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register(definition);
    await executor.resume(run.id);

    const completed = await backend.getRun(run.id);
    assertEquals(completed?.status, "completed");
    assertEquals(childExecutions, 1);
    assertEquals(completed?.context.input, { root: true });
    assertEquals(completed?.context.keep, "OUTER");
    assertEquals(Object.hasOwn(completed?.context ?? {}, "nested/child"), false);
    assertEquals(completed?._workflowProjection?.inputKind, undefined);
  });

  it("restores a checkpoint on the final root node without replaying its side effect", async () => {
    const backend = new MemoryBackend();
    let executions = 0;
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register({
      id: "final-root-checkpoint-recovery",
      version: "1",
      steps: [{
        id: "final",
        config: {
          type: "step",
          checkpoint: true,
          tool: createTool("final-root-checkpoint", () => {
            executions++;
            return "replayed";
          }),
        },
      }],
    });
    const run = {
      ...createRun("final-root-checkpoint-recovery"),
      version: "1",
      status: "pending" as const,
      _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
      _workflowProjection: { context: {} },
    };
    await backend.createRun(run);
    await backend.saveCheckpoint(run.id, {
      id: "final-root-checkpoint",
      nodeId: "final",
      timestamp: new Date(),
      context: { input: {}, final: "already-done" },
      nodeStates: {
        final: {
          nodeId: "final",
          status: "completed",
          output: "already-done",
          attempt: 1,
          completedAt: new Date(),
        },
      },
      _workflowProjection: { context: {} },
    });

    await executor.resume(run.id);

    const completed = await backend.getRun(run.id);
    assertEquals(executions, 0);
    assertEquals(completed?.status, "completed");
    assertEquals(completed?.context.final, "already-done");
    assertEquals(completed?.output, { final: "already-done" });
  });

  it("resumes checkpoint work through dependency readiness instead of declaration order", async () => {
    const backend = new MemoryBackend();
    const order: string[] = [];
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register({
      id: "checkpoint-dependency-readiness",
      version: "1",
      steps: [
        {
          id: "A",
          dependsOn: [],
          config: { type: "step", tool: createTool("A", () => "replayed-A") },
        },
        {
          id: "C",
          dependsOn: ["B"],
          config: {
            type: "step",
            tool: createTool("C", () => {
              order.push("C");
              return "C-done";
            }),
          },
        },
        {
          id: "B",
          dependsOn: ["A"],
          config: {
            type: "step",
            tool: createTool("B", () => {
              order.push("B");
              return "B-done";
            }),
          },
        },
      ],
    });
    const run = {
      ...createRun("checkpoint-dependency-readiness"),
      version: "1",
      status: "pending" as const,
      _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
      _workflowProjection: { context: {} },
    };
    await backend.createRun(run);
    await backend.saveCheckpoint(run.id, {
      id: "checkpoint-after-A",
      nodeId: "A",
      timestamp: new Date(),
      context: { input: {}, A: "already-done" },
      nodeStates: {
        A: {
          nodeId: "A",
          status: "completed",
          output: "already-done",
          attempt: 1,
          completedAt: new Date(),
        },
      },
      _workflowProjection: { context: {} },
    });

    await executor.resume(run.id);

    const completed = await backend.getRun(run.id);
    assertEquals(completed?.status, "completed");
    assertEquals(order, ["B", "C"]);
    assertEquals(completed?.context, {
      input: {},
      A: "already-done",
      B: "B-done",
      C: "C-done",
    });
  });

  it("re-evaluates a dynamic root graph from its original admission snapshot", async () => {
    const backend = new MemoryBackend();
    let builderCalls = 0;
    let aRuns = 0;
    let bRuns = 0;
    let cRuns = 0;
    const definition: WorkflowDefinition = {
      id: "dynamic-root-admission-recovery",
      version: "1",
      steps: ({ context }) => {
        builderCalls++;
        return [
          {
            id: "A",
            config: {
              type: "step",
              checkpoint: true,
              input: (stepContext) => {
                stepContext.flag = true;
                return {};
              },
              tool: createTool("dynamic-root-A", () => {
                aRuns++;
                return "A";
              }),
            },
          },
          context.flag
            ? {
              id: "C",
              config: {
                type: "step",
                tool: createTool("dynamic-root-C", () => {
                  cRuns++;
                  return "C";
                }),
              },
            }
            : {
              id: "B",
              config: {
                type: "step",
                tool: createTool("dynamic-root-B", () => {
                  bRuns++;
                  return "B";
                }),
              },
            },
        ];
      },
    };
    const run: WorkflowRun = {
      ...createRun(definition.id),
      version: definition.version,
      context: { input: {}, flag: false },
      _workflowProjection: { context: {} },
    };
    await backend.createRun(run);
    const admittedNodes =
      (definition.steps as Exclude<WorkflowDefinition["steps"], WorkflowNode[]>)(
        { input: run.input, context: run.context },
      );
    const dag = new DAGExecutor({
      stepExecutor: new StepExecutor(),
      checkpointManager: new CheckpointManager({ backend }),
    });
    await dag.execute(admittedNodes, run);
    const checkpoint = await backend.getLatestCheckpoint(run.id);
    assertExists(checkpoint);
    assertEquals(checkpoint.context.flag, true);
    assertEquals(checkpoint._resumeEnvelope?.graphAdmission.stepsEvaluationContext.flag, false);

    aRuns = 0;
    bRuns = 0;
    cRuns = 0;
    builderCalls = 0;
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register(definition);
    await executor.resume(run.id);

    const completed = await backend.getRun(run.id);
    assertEquals(completed?.status, "completed");
    assertEquals(builderCalls, 1);
    assertEquals(aRuns, 0);
    assertEquals(bRuns, 1);
    assertEquals(cRuns, 0);
    assertEquals(completed?.context.flag, true);
    assertEquals(completed?.context.B, "B");
    assertEquals(completed?.context.C, undefined);
  });

  it("isolates mutations made by a dynamic root steps builder", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register({
      id: "isolated-root-builder",
      steps: ({ context }) => {
        context.builderLeak = "discard-me";
        return [{
          id: "work",
          config: {
            type: "step",
            tool: createTool("isolated-root-builder-work", () => "done"),
          },
        }];
      },
    });

    const handle = await executor.start("isolated-root-builder", {});
    await handle.settled();
    const completed = await backend.getRun(handle.runId);
    assertEquals(completed?.status, "completed");
    assertEquals(Object.hasOwn(completed?.context ?? {}, "builderLeak"), false);
  });

  it("fails closed before resuming a run under a different workflow version", async () => {
    const backend = new MemoryBackend();
    let executions = 0;
    const executor = new WorkflowExecutor({
      backend,
      enableLocking: false,
    });
    executor.register({
      id: "version-drift-recovery",
      version: "2",
      steps: [{
        id: "work",
        config: {
          type: "step",
          tool: createTool("version-drift-work", () => ++executions),
        },
      }],
    });
    const run = { ...createRun("version-drift-recovery"), version: "1" };
    await backend.createRun(run);

    await assertRejects(
      () => executor.resume(run.id),
      Error,
      "definition version changed",
    );
    assertEquals(executions, 0);
    const failed = await backend.getRun(run.id);
    assertEquals(failed?.status, "failed");
    assertEquals(failed?.currentNodes, []);
    assertEquals(failed?.error?.message.includes("definition version changed"), true);
    assertExists(failed?.completedAt);
  });

  it("terminalizes a persisted unversioned run before execute can change behavior", async () => {
    const backend = new MemoryBackend();
    let executions = 0;
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register({
      id: "unversioned-behavior-drift",
      steps: [{
        id: "work",
        config: {
          type: "step",
          tool: createTool("unversioned-behavior-drift-v2", () => ++executions),
        },
      }],
    });
    const run = createRun("unversioned-behavior-drift");
    await backend.createRun(run);

    await assertRejects(
      () => executor.executeAsync(run.id),
      Error,
      "non-null durable workflow version",
    );

    assertEquals(executions, 0);
    const failed = await backend.getRun(run.id);
    assertEquals(failed?.status, "failed");
    assertEquals(failed?.currentNodes, []);
    assertEquals(
      failed?.error?.message.includes("non-null durable workflow version"),
      true,
    );
    assertExists(failed?.completedAt);
  });

  it("terminalizes an exact preclaimed running owner when version admission fails", async () => {
    const backend = new MemoryBackend();
    let executions = 0;
    const executor = new WorkflowExecutor({ backend });
    executor.register({
      id: "preclaimed-version-drift",
      version: "2",
      steps: [{
        id: "work",
        config: {
          type: "step",
          tool: createTool("preclaimed-version-drift-work", () => ++executions),
        },
      }],
    });
    const workerId = "run-execution:preclaimed-version-drift";
    const run = {
      ...createRun("preclaimed-version-drift"),
      version: "1",
      status: "running" as const,
      workerId,
    };
    await backend.createRun(run);
    const lockId = await backend.acquireLock(run.id, 30_000);
    assertExists(lockId);

    await assertRejects(
      () => executor.resume(run.id, undefined, workerId, lockId),
      Error,
      "definition version changed",
    );

    const failed = await backend.getRun(run.id);
    assertEquals(failed?.status, "failed");
    assertEquals(failed?.workerId, workerId);
    assertEquals(failed?.currentNodes, []);
    assertEquals(failed?.error?.message.includes("definition version changed"), true);
    assertExists(failed?.completedAt);
    assertEquals(executions, 0);
    assertEquals(await backend.releaseLock(run.id, lockId), false);
  });

  it("does not rewrite a terminal run when version admission rejects", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register({
      id: "terminal-version-drift",
      version: "2",
      steps: [{
        id: "work",
        config: {
          type: "step",
          tool: createTool("terminal-version-drift-work", () => "must-not-run"),
        },
      }],
    });
    const completedAt = new Date("2026-01-01T00:00:00.000Z");
    const run: WorkflowRun = {
      ...createRun("terminal-version-drift"),
      version: "1",
      status: "completed",
      output: { stable: true },
      completedAt,
    };
    await backend.createRun(run);

    await assertRejects(
      () => executor.executeAsync(run.id),
      Error,
      "definition version changed",
    );

    const preserved = await backend.getRun(run.id);
    assertEquals(preserved?.status, "completed");
    assertEquals(preserved?.output, { stable: true });
    assertEquals(preserved?.error, undefined);
    assertEquals(preserved?.completedAt, completedAt);
  });

  it("fails an unversioned fresh run before persisting a durable wait", async () => {
    using time = new FakeTime();
    const backend = new WaitingTransitionTrackingBackend();
    let waitingCallbacks = 0;
    let resumedEffects = 0;
    const definition = workflow({
      id: "unversioned-durable-wait-boundary",
      steps: [
        delay("pause", 5),
        dependsOn(
          step("finish", {
            tool: createTool("unversioned-post-wait-effect", () => {
              resumedEffects++;
              return { done: true };
            }),
          }),
          "pause",
        ),
      ],
    }).definition;
    const executor = new WorkflowExecutor({
      backend,
      onWaiting: () => {
        waitingCallbacks++;
      },
    });
    executor.register(definition);

    const handle = await executor.start(definition.id, {});
    await handle.settled();

    const failedRun = await backend.getRun(handle.runId);
    assertEquals(failedRun?.status, "failed");
    assertEquals(
      failedRun?.error?.message.includes("non-null durable workflow version"),
      true,
    );
    assertEquals(failedRun?.nodeStates.pause, undefined);
    assertEquals(backend.waitingTransitions, 0);
    assertEquals(waitingCallbacks, 0);
    assertEquals(resumedEffects, 0);
    assertEquals(await backend.getPendingApprovals(handle.runId), []);

    await executor.destroy();
    const restartedExecutor = new WorkflowExecutor({ backend });
    restartedExecutor.register(definition);
    await time.tickAsync(5);
    await time.tickAsync(0);

    assertEquals((await backend.getRun(handle.runId))?.status, "failed");
    assertEquals(resumedEffects, 0);
    await assertRejects(
      () => restartedExecutor.resume(handle.runId),
      Error,
      'current status is "failed"',
    );
    await restartedExecutor.destroy();
  });

  it("rejects unversioned schema-two static checkpoint recovery", async () => {
    const backend = new MemoryBackend();
    let executions = 0;
    const definition: WorkflowDefinition = {
      id: "unversioned-schema-two-static",
      steps: [step("work", {
        checkpoint: true,
        tool: createTool("unversioned-schema-two-static-work", () => ++executions),
      })],
    };
    const run = createRun(definition.id);
    await backend.createRun(run);
    const checkpointManager = new CheckpointManager({ backend });
    await new DAGExecutor({
      checkpointManager,
      stepExecutor: new StepExecutor(),
    }).execute(definition.steps as WorkflowNode[], run);
    assertExists(await backend.getLatestCheckpoint(run.id));
    await assertRejects(
      () =>
        checkpointManager.prepareResume(
          run.id,
          definition.steps as WorkflowNode[],
          undefined,
          null,
          { context: run.context, workflowVersion: null },
        ),
      Error,
      "non-null durable workflow versions",
    );

    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register(definition);
    await assertRejects(
      () => executor.resume(run.id),
      Error,
      "non-null durable workflow version",
    );

    assertEquals(executions, 1);
    const failed = await backend.getRun(run.id);
    assertEquals(failed?.status, "failed");
    assertEquals(
      failed?.error?.message.includes("non-null durable workflow version"),
      true,
    );
    assertExists(failed?.completedAt);
  });

  it("rejects a legacy dynamic checkpoint without invoking its builder", async () => {
    const backend = new MemoryBackend();
    let builderCalls = 0;
    const executor = new WorkflowExecutor({
      backend,
      enableLocking: false,
    });
    executor.register({
      id: "legacy-dynamic-checkpoint",
      version: "1",
      steps: () => {
        builderCalls++;
        return [{ id: "work", config: { type: "step", tool: "tool" } }];
      },
    });
    const run = { ...createRun("legacy-dynamic-checkpoint"), version: "1" };
    await backend.createRun(run);
    await backend.saveCheckpoint(run.id, {
      id: "legacy-dynamic",
      nodeId: "work",
      timestamp: new Date(),
      context: { input: {}, work: "already-done" },
      nodeStates: {
        work: { nodeId: "work", status: "completed", attempt: 1, output: "already-done" },
      },
    });

    await assertRejects(
      () => executor.resume(run.id),
      Error,
      "legacy dynamic workflow checkpoint",
    );
    assertEquals(builderCalls, 0);
  });

  it("rejects a schema-two dynamic checkpoint with unversioned admission", async () => {
    const backend = new MemoryBackend();
    let builderCalls = 0;
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register({
      id: "unversioned-schema-two-dynamic",
      version: "1",
      steps: () => {
        builderCalls++;
        return [{
          id: "work",
          config: {
            type: "step",
            tool: createTool("unversioned-schema-two-dynamic-work", () => "replayed"),
          },
        }];
      },
    });
    const run = { ...createRun("unversioned-schema-two-dynamic"), version: "1" };
    await backend.createRun(run);
    await backend.saveCheckpoint(run.id, {
      id: "unversioned-schema-two-dynamic",
      nodeId: "work",
      timestamp: new Date(),
      context: { input: {}, work: "already-done" },
      nodeStates: {
        work: {
          nodeId: "work",
          status: "completed",
          attempt: 1,
          output: "already-done",
          completedAt: new Date(),
        },
      },
      _resumeEnvelope: {
        schemaVersion: 2,
        ownerNodeId: "work",
        context: { input: {}, work: "already-done" },
        nodeStates: {
          work: {
            nodeId: "work",
            status: "completed",
            attempt: 1,
            output: "already-done",
            completedAt: new Date(),
          },
        },
        workflowProjection: { context: {} },
        graphAdmission: {
          stepsEvaluationContext: { input: {} },
          stepsEvaluationProjection: { context: {} },
          graphIdentity: [{ id: "work", type: "step", dependsOn: null, composite: null }],
          workflowVersion: null,
        },
      },
    });

    await assertRejects(
      () => executor.resume(run.id),
      Error,
      "non-null durable workflow version",
    );

    assertEquals(builderCalls, 0);
    const failed = await backend.getRun(run.id);
    assertEquals(failed?.status, "failed");
    assertEquals(
      failed?.error?.message.includes("non-null durable workflow version"),
      true,
    );
    assertExists(failed?.completedAt);
  });

  it("checkpoints a fully settled concurrent batch so no sibling replays", async () => {
    const backend = new MemoryBackend();
    let aRuns = 0;
    let bRuns = 0;
    const definition: WorkflowDefinition = {
      id: "settled-batch-checkpoint",
      version: "1",
      steps: [
        {
          id: "A",
          dependsOn: [],
          config: {
            type: "step",
            checkpoint: true,
            tool: createTool("settled-batch-A", () => ++aRuns),
          },
        },
        {
          id: "B",
          dependsOn: [],
          config: {
            type: "step",
            tool: createTool("settled-batch-B", () => ++bRuns),
          },
        },
      ],
    };
    const run = { ...createRun(definition.id), version: definition.version };
    await backend.createRun(run);
    const dag = new DAGExecutor({
      stepExecutor: new StepExecutor(),
      checkpointManager: new CheckpointManager({ backend }),
    });
    await dag.execute(definition.steps as WorkflowNode[], run);
    const checkpoint = await backend.getLatestCheckpoint(run.id);
    assertExists(checkpoint);
    assertEquals(checkpoint.nodeStates.A?.status, "completed");
    assertEquals(checkpoint.nodeStates.B?.status, "completed");
    assertEquals(checkpoint.context.B, 1);

    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register(definition);
    await executor.resume(run.id);
    assertEquals(aRuns, 1);
    assertEquals(bRuns, 1);
    assertEquals((await backend.getRun(run.id))?.status, "completed");
  });

  it("resumes every composite descendant checkpoint without replaying its child", async () => {
    const cases: Array<{
      name: string;
      composite: (child: WorkflowNode) => WorkflowNode;
    }> = [
      {
        name: "parallel",
        composite: (child) => ({
          id: "owner",
          config: { type: "parallel", nodes: [child], checkpoint: false },
        }),
      },
      {
        name: "branch",
        composite: (child) => ({
          id: "owner",
          config: { type: "branch", condition: () => true, then: [child], checkpoint: false },
        }),
      },
      {
        name: "map",
        composite: (child) => ({
          id: "owner",
          config: { type: "map", items: [1], processor: child, checkpoint: false },
        }),
      },
      {
        name: "loop",
        composite: (child) => ({
          id: "owner",
          config: {
            type: "loop",
            while: (_context, state) => state.iteration === 0,
            steps: [child],
            maxIterations: 1,
            checkpoint: false,
          },
        }),
      },
      {
        name: "sub-workflow",
        composite: (child) => ({
          id: "owner",
          config: {
            type: "subWorkflow",
            workflow: { id: "child-workflow", steps: [child] },
            checkpoint: false,
          },
        }),
      },
    ];

    for (const testCase of cases) {
      const backend = new MemoryBackend();
      let childRuns = 0;
      const definition: WorkflowDefinition = {
        id: `composite-envelope-${testCase.name}`,
        version: "1",
        steps: [testCase.composite({
          id: "child",
          config: {
            type: "step",
            checkpoint: true,
            tool: createTool(`composite-${testCase.name}-child`, () => ++childRuns),
          },
        })],
      };
      const run = { ...createRun(definition.id), version: definition.version };
      await backend.createRun(run);
      const dag = new DAGExecutor({
        stepExecutor: new StepExecutor(),
        checkpointManager: new CheckpointManager({ backend }),
      });
      await dag.execute(definition.steps as WorkflowNode[], run);
      assertEquals(childRuns, 1, testCase.name);
      assertExists((await backend.getLatestCheckpoint(run.id))?._resumeEnvelope);

      const executor = new WorkflowExecutor({ backend, enableLocking: false });
      executor.register(definition);
      await executor.resume(run.id);
      assertEquals(childRuns, 1, testCase.name);
      assertEquals((await backend.getRun(run.id))?.status, "completed", testCase.name);
    }
  });

  it("continues a composite from its durable active retry attempt", async () => {
    const backend = new MemoryBackend();
    let gateRuns = 0;
    let terminalRuns = 0;
    const definition: WorkflowDefinition = {
      id: "durable-composite-attempt",
      version: "1",
      steps: [{
        id: "owner",
        config: {
          type: "branch",
          condition: () => true,
          retry: {
            maxAttempts: 2,
            backoff: "fixed",
            initialDelay: 0,
            maxDelay: 0,
            retryIf: () => true,
          },
          then: [
            {
              id: "gate",
              config: {
                type: "step",
                tool: createTool("durable-attempt-gate", () => {
                  gateRuns++;
                  if (gateRuns === 1) throw new Error("first attempt");
                  return "open";
                }),
              },
            },
            {
              id: "checkpoint",
              config: {
                type: "step",
                checkpoint: true,
                tool: createTool("durable-attempt-checkpoint", () => "saved"),
              },
            },
            {
              id: "terminal",
              config: {
                type: "step",
                tool: createTool("durable-attempt-terminal", () => {
                  terminalRuns++;
                  throw new Error("still failing");
                }),
              },
            },
          ],
        },
      }],
    };
    const run = { ...createRun(definition.id), version: definition.version };
    await backend.createRun(run);
    const dag = new DAGExecutor({
      stepExecutor: new StepExecutor(),
      checkpointManager: new CheckpointManager({ backend }),
    });
    await dag.execute(definition.steps as WorkflowNode[], run);
    const checkpoint = await backend.getLatestCheckpoint(run.id);
    assertExists(checkpoint);
    assertEquals(checkpoint._resumeEnvelope?.nodeStates.owner?.attempt, 2);

    terminalRuns = 0;
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register(definition);
    await executor.resume(run.id);
    assertEquals(terminalRuns, 1);
    assertEquals((await backend.getRun(run.id))?.status, "failed");
  });

  it("does not replenish retry budget after crashing on the attempt-two admission save", async () => {
    const backend = new MemoryBackend();
    let gateRuns = 0;
    const definition: WorkflowDefinition = {
      id: "attempt-two-admission-crash",
      version: "1",
      steps: [{
        id: "owner",
        config: {
          type: "branch",
          condition: () => true,
          checkpoint: false,
          retry: {
            maxAttempts: 2,
            backoff: "fixed",
            initialDelay: 0,
            maxDelay: 0,
            retryIf: () => true,
          },
          then: [{
            id: "gate",
            config: {
              type: "step",
              tool: createTool("attempt-two-admission-gate", () => {
                gateRuns++;
                throw new Error("gate remains closed");
              }),
            },
          }],
        },
      }],
    };
    const run = { ...createRun(definition.id), version: definition.version };
    await backend.createRun(run);
    const checkpointManager = new CrashAfterDurableCheckpointManager(
      backend,
      (checkpoint) =>
        checkpoint.nodeId === "owner" &&
        checkpoint._resumeEnvelope?.nodeStates.owner?.status === "running" &&
        checkpoint._resumeEnvelope.nodeStates.owner.attempt === 2,
    );
    const dag = new DAGExecutor({
      stepExecutor: new StepExecutor(),
      checkpointManager,
    });

    const interrupted = await dag.execute(definition.steps as WorkflowNode[], run);
    assertEquals(interrupted.completed, false);
    assertEquals(gateRuns, 1);
    const checkpoint = await backend.getLatestCheckpoint(run.id);
    assertExists(checkpoint);
    assertEquals(checkpoint._resumeEnvelope?.nodeStates.owner?.status, "running");
    assertEquals(checkpoint._resumeEnvelope?.nodeStates.owner?.attempt, 2);

    gateRuns = 0;
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register(definition);
    await executor.resume(run.id);

    assertEquals(gateRuns, 1);
    assertEquals((await backend.getRun(run.id))?.status, "failed");
  });

  it("detects dynamic sub-workflow and loop drift after crashing on admission save", async () => {
    const cases: Array<{
      name: "sub-workflow" | "loop";
      createOwner: (steps: () => WorkflowNode[]) => WorkflowNode;
    }> = [
      {
        name: "sub-workflow",
        createOwner: (steps) => ({
          id: "owner",
          config: {
            type: "subWorkflow",
            checkpoint: false,
            workflow: { id: "dynamic-child", version: "1", steps },
          },
        }),
      },
      {
        name: "loop",
        createOwner: (steps) => ({
          id: "owner",
          config: {
            type: "loop",
            checkpoint: false,
            while: (_context, state) => state.iteration === 0,
            steps,
            maxIterations: 1,
          },
        }),
      },
    ];

    for (const testCase of cases) {
      const backend = new MemoryBackend();
      let variant: "A" | "B" = "A";
      let builderCalls = 0;
      const childRuns: string[] = [];
      const dynamicSteps = (): WorkflowNode[] => {
        builderCalls++;
        const selected = variant;
        return [{
          id: selected,
          config: {
            type: "step",
            tool: createTool(`${testCase.name}-${selected}`, () => {
              childRuns.push(selected);
              return selected;
            }),
          },
        }];
      };
      const definition: WorkflowDefinition = {
        id: `admission-crash-${testCase.name}`,
        version: "1",
        steps: [testCase.createOwner(dynamicSteps)],
      };
      const run = { ...createRun(definition.id), version: definition.version };
      await backend.createRun(run);
      const checkpointManager = new CrashAfterDurableCheckpointManager(
        backend,
        (checkpoint) =>
          checkpoint.nodeId === "owner" &&
          checkpoint._resumeEnvelope?.nodeStates.owner?.status === "running",
      );
      const dag = new DAGExecutor({
        stepExecutor: new StepExecutor(),
        checkpointManager,
      });

      const interrupted = await dag.execute(definition.steps as WorkflowNode[], run);
      assertEquals(interrupted.completed, false, testCase.name);
      assertEquals(builderCalls, 1, testCase.name);
      assertEquals(childRuns, [], testCase.name);
      assertEquals(
        (await backend.getLatestCheckpoint(run.id))?._resumeEnvelope?.nodeStates.owner?.status,
        "running",
        testCase.name,
      );

      variant = "B";
      builderCalls = 0;
      const executor = new WorkflowExecutor({ backend, enableLocking: false });
      executor.register(definition);
      await executor.resume(run.id);

      const failed = await backend.getRun(run.id);
      assertEquals(builderCalls, 1, testCase.name);
      assertEquals(childRuns, [], testCase.name);
      assertEquals(failed?.status, "failed", testCase.name);
      assertEquals(failed?.error?.message.includes("admitted graph changed"), true, testCase.name);
    }
  });

  it("resumes the map item selection persisted before its first child effect", async () => {
    const backend = new MemoryBackend();
    let selection: "original" | "changed" = "original";
    let itemBuilderCalls = 0;
    let processorRuns = 0;
    const definition: WorkflowDefinition = {
      id: "map-admission-crash",
      version: "1",
      steps: [{
        id: "owner",
        config: {
          type: "map",
          checkpoint: false,
          items: () => {
            itemBuilderCalls++;
            return selection === "original" ? ["one"] : ["one", "two"];
          },
          processor: {
            id: "processor",
            config: {
              type: "step",
              tool: createTool("map-admission-processor", () => ++processorRuns),
            },
          },
        },
      }],
    };
    const run = { ...createRun(definition.id), version: definition.version };
    await backend.createRun(run);
    const checkpointManager = new CrashAfterDurableCheckpointManager(
      backend,
      (checkpoint) =>
        checkpoint.nodeId === "owner" &&
        checkpoint._resumeEnvelope?.nodeStates.owner?.status === "running",
    );
    const dag = new DAGExecutor({
      stepExecutor: new StepExecutor(),
      checkpointManager,
    });

    const interrupted = await dag.execute(definition.steps as WorkflowNode[], run);
    assertEquals(interrupted.completed, false);
    assertEquals(itemBuilderCalls, 1);
    assertEquals(processorRuns, 0);

    selection = "changed";
    itemBuilderCalls = 0;
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register(definition);
    await executor.resume(run.id);

    assertEquals(itemBuilderCalls, 0);
    assertEquals(processorRuns, 1);
    assertEquals((await backend.getRun(run.id))?.status, "completed");
  });

  it("fails closed when a dynamic sub-workflow child graph changes after checkpoint", async () => {
    const backend = new MemoryBackend();
    let variant: "A" | "B" = "A";
    let aRuns = 0;
    let bRuns = 0;
    const definition: WorkflowDefinition = {
      id: "dynamic-sub-workflow-drift",
      version: "1",
      steps: [{
        id: "owner",
        config: {
          type: "subWorkflow",
          workflow: {
            id: "dynamic-child",
            steps: () => [{
              id: variant,
              config: {
                type: "step",
                checkpoint: true,
                tool: createTool(`dynamic-sub-${variant}`, () => {
                  if (variant === "A") aRuns++;
                  else bRuns++;
                  return variant;
                }),
              },
            }],
          },
        },
      }],
    };
    const run = { ...createRun(definition.id), version: definition.version };
    await backend.createRun(run);
    const dag = new DAGExecutor({
      stepExecutor: new StepExecutor(),
      checkpointManager: new CheckpointManager({ backend }),
    });
    await dag.execute(definition.steps as WorkflowNode[], run);
    assertEquals(aRuns, 1);

    variant = "B";
    aRuns = 0;
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register(definition);
    await executor.resume(run.id);
    assertEquals(aRuns, 0);
    assertEquals(bRuns, 0);
    assertEquals((await backend.getRun(run.id))?.status, "failed");
    assertEquals(
      (await backend.getRun(run.id))?.error?.message.includes("admitted graph changed"),
      true,
    );
  });

  it("fails closed when a dynamic loop child graph changes after checkpoint", async () => {
    const backend = new MemoryBackend();
    let variant: "A" | "B" = "A";
    let aRuns = 0;
    let bRuns = 0;
    const definition: WorkflowDefinition = {
      id: "dynamic-loop-drift",
      version: "1",
      steps: [{
        id: "owner",
        config: {
          type: "loop",
          while: (_context, state) => state.iteration === 0,
          steps: () => [{
            id: variant,
            config: {
              type: "step",
              checkpoint: true,
              tool: createTool(`dynamic-loop-${variant}`, () => {
                if (variant === "A") aRuns++;
                else bRuns++;
                return variant;
              }),
            },
          }],
          maxIterations: 1,
        },
      }],
    };
    const run = { ...createRun(definition.id), version: definition.version };
    await backend.createRun(run);
    const dag = new DAGExecutor({
      stepExecutor: new StepExecutor(),
      checkpointManager: new CheckpointManager({ backend }),
    });
    await dag.execute(definition.steps as WorkflowNode[], run);
    assertEquals(aRuns, 1);

    variant = "B";
    aRuns = 0;
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register(definition);
    await executor.resume(run.id);
    assertEquals(aRuns, 0);
    assertEquals(bRuns, 0);
    assertEquals((await backend.getRun(run.id))?.status, "failed");
    assertEquals(
      (await backend.getRun(run.id))?.error?.message.includes("admitted graph changed"),
      true,
    );
  });

  it("does not leak sub-workflow admission or partial child state after crash and final failure", async () => {
    const backend = new MemoryBackend();
    let failingRuns = 0;
    const definition: WorkflowDefinition = {
      id: "sub-workflow-transaction-failure",
      version: "1",
      steps: [{
        id: "owner",
        config: {
          type: "subWorkflow",
          input: (context: WorkflowContext) => {
            context.inputAdmissionLeak = "private";
            return { child: true };
          },
          workflow: {
            id: "transaction-child",
            steps: ({ context }) => {
              context.stepsAdmissionLeak = "private";
              return [
                {
                  id: "prepare",
                  config: {
                    type: "step",
                    checkpoint: true,
                    tool: createTool("transaction-prepare", () => "prepared"),
                  },
                },
                {
                  id: "fail",
                  config: {
                    type: "step",
                    tool: createTool("transaction-fail", () => {
                      failingRuns++;
                      throw new Error("final child failure");
                    }),
                  },
                },
              ];
            },
          },
        },
      }],
    };
    const run: WorkflowRun = {
      ...createRun(definition.id),
      version: definition.version,
      context: { input: {}, keep: "outer" },
    };
    await backend.createRun(run);
    const dag = new DAGExecutor({
      stepExecutor: new StepExecutor(),
      checkpointManager: new CheckpointManager({ backend }),
    });
    await dag.execute(definition.steps as WorkflowNode[], run);
    assertExists(await backend.getLatestCheckpoint(run.id));

    failingRuns = 0;
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    executor.register(definition);
    await executor.resume(run.id);
    const failed = await backend.getRun(run.id);
    assertEquals(failingRuns, 1);
    assertEquals(failed?.status, "failed");
    assertEquals(failed?.context.keep, "outer");
    assertEquals(Object.hasOwn(failed?.context ?? {}, "inputAdmissionLeak"), false);
    assertEquals(Object.hasOwn(failed?.context ?? {}, "stepsAdmissionLeak"), false);
    assertEquals(Object.hasOwn(failed?.context ?? {}, "owner/prepare"), false);
  });

  it("rejects accessor-bearing checkpoint data before invoking a resolver", async () => {
    let resolverCalls = 0;
    let getterCalls = 0;
    const malicious = {
      id: "malicious",
      nodeId: "work",
      timestamp: new Date(),
      context: { input: {} },
      nodeStates: {},
    } as Checkpoint;
    Object.defineProperty(malicious, "_resumeEnvelope", {
      enumerable: true,
      get() {
        getterCalls++;
        return undefined;
      },
    });
    class MaliciousCheckpointBackend extends MemoryBackend {
      override getLatestCheckpoint(): Promise<Checkpoint | null> {
        return Promise.resolve(malicious);
      }
    }
    const manager = new CheckpointManager({ backend: new MaliciousCheckpointBackend() });
    await assertRejects(
      () =>
        manager.prepareResume("run", () => {
          resolverCalls++;
          return [];
        }),
      Error,
      "must be an own data property",
    );
    assertEquals(getterCalls, 0);
    assertEquals(resolverCalls, 0);
  });

  it("rejects Proxy-backed checkpoint dates without invoking their traps", async () => {
    let trapCalls = 0;
    const timestamp = new Proxy(new Date(), {
      get() {
        trapCalls++;
        throw new Error("timestamp trap invoked");
      },
    });
    const malicious = {
      id: "proxy-date",
      nodeId: "work",
      timestamp,
      context: { input: {} },
      nodeStates: {},
    } as Checkpoint;
    class ProxyDateBackend extends MemoryBackend {
      override getLatestCheckpoint(): Promise<Checkpoint | null> {
        return Promise.resolve(malicious);
      }
    }
    const manager = new CheckpointManager({ backend: new ProxyDateBackend() });

    await assertRejects(
      () => manager.getLatest("run"),
      Error,
      "must not be a Proxy",
    );
    assertEquals(trapCalls, 0);
  });

  it("fails closed on oversized, sparse, accessor, and Proxy checkpoint histories", async () => {
    const checkpoint: Checkpoint = {
      id: "history-checkpoint",
      nodeId: "work",
      timestamp: new Date(),
      context: { input: {} },
      nodeStates: {},
    };
    let elementGetterCalls = 0;
    let proxyTrapCalls = 0;
    const accessorHistory = [] as Checkpoint[];
    Object.defineProperty(accessorHistory, "0", {
      enumerable: true,
      configurable: true,
      get() {
        elementGetterCalls++;
        return checkpoint;
      },
    });
    const proxyHistory = new Proxy([checkpoint], {
      getOwnPropertyDescriptor(target, property) {
        proxyTrapCalls++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const extraKeyHistory = [checkpoint];
    Object.defineProperty(extraKeyHistory, "metadata", {
      value: "not part of a checkpoint history",
      enumerable: false,
    });
    const histories: Array<{ history: Checkpoint[]; message: string }> = [
      {
        history: Array.from(
          { length: MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES + 1 },
          () => checkpoint,
        ),
        message: "at most",
      },
      { history: new Array<Checkpoint>(1), message: "dense" },
      { history: accessorHistory, message: "own data property" },
      { history: proxyHistory, message: "non-Proxy" },
      { history: extraKeyHistory, message: "exactly" },
    ];

    for (const { history, message } of histories) {
      class MalformedHistoryBackend extends MemoryBackend {
        override getCheckpoints(): Promise<Checkpoint[]> {
          return Promise.resolve(history);
        }
      }
      const manager = new CheckpointManager({ backend: new MalformedHistoryBackend() });
      await assertRejects(() => manager.getAll("run"), Error, message);
    }

    assertEquals(elementGetterCalls, 0);
    assertEquals(proxyTrapCalls, 0);
  });

  it("returns detached checkpoint history candidates", async () => {
    const original: Checkpoint = {
      id: "detached",
      nodeId: "work",
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
      context: { input: { stable: true } },
      nodeStates: {
        work: {
          nodeId: "work",
          status: "completed",
          attempt: 1,
          completedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      },
    };
    class MutableHistoryBackend extends MemoryBackend {
      override getCheckpoints(): Promise<Checkpoint[]> {
        return Promise.resolve([original]);
      }
    }
    const manager = new CheckpointManager({ backend: new MutableHistoryBackend() });
    const captured = await manager.getAll("run");

    original.id = "mutated";
    original.timestamp.setUTCFullYear(2040);
    (original.context.input as Record<string, unknown>).stable = false;
    original.nodeStates.work!.status = "failed";

    assertEquals(captured[0]?.id, "detached");
    assertEquals(captured[0]?.timestamp.toISOString(), "2026-01-01T00:00:00.000Z");
    assertEquals(captured[0]?.context.input, { stable: true });
    assertEquals(captured[0]?.nodeStates.work?.status, "completed");
  });

  it("fails closed on a malformed candidate during explicit checkpoint selection", async () => {
    let idGetterCalls = 0;
    const malformed = {
      nodeId: "work",
      timestamp: new Date(),
      context: { input: {} },
      nodeStates: {},
    } as Checkpoint;
    Object.defineProperty(malformed, "id", {
      enumerable: true,
      configurable: true,
      get() {
        idGetterCalls++;
        return "malformed";
      },
    });
    const target: Checkpoint = {
      id: "target",
      nodeId: "work",
      timestamp: new Date(),
      context: { input: {}, work: "done" },
      nodeStates: {
        work: {
          nodeId: "work",
          status: "completed",
          attempt: 1,
          completedAt: new Date(),
        },
      },
    };
    class CandidateHistoryBackend extends MemoryBackend {
      override getCheckpoints(): Promise<Checkpoint[]> {
        return Promise.resolve([malformed, target]);
      }
    }
    const manager = new CheckpointManager({ backend: new CandidateHistoryBackend() });

    await assertRejects(
      () =>
        manager.prepareResume(
          "run",
          [{ id: "work", config: { type: "step", tool: "tool" } }],
          "target",
          "1",
        ),
      Error,
      "own data property",
    );
    assertEquals(idGetterCalls, 0);
  });

  it("rejects semantically invalid checkpoint node states", async () => {
    const nodes: WorkflowNode[] = [{
      id: "work",
      config: { type: "step", tool: "tool" },
    }];
    const invalidStates: Array<{ state: Record<string, unknown>; message: string }> = [
      {
        state: { nodeId: "work", status: "unknown", attempt: 1 },
        message: "status is invalid",
      },
      {
        state: { nodeId: "work", status: "running", attempt: 0 },
        message: "running attempt must be at least 1",
      },
      {
        state: { nodeId: "different", status: "completed", attempt: 1 },
        message: "nodeId must equal its record key",
      },
    ];

    for (const { state, message } of invalidStates) {
      const backend = new MemoryBackend();
      await backend.createRun({ ...createRun("invalid-state"), id: "run" });
      await backend.saveCheckpoint("run", {
        id: `invalid-${message}`,
        nodeId: "work",
        timestamp: new Date(),
        context: { input: {} },
        nodeStates: { work: state as never },
      });
      const manager = new CheckpointManager({ backend });
      await assertRejects(
        () => manager.prepareResume("run", nodes, undefined, "1"),
        Error,
        message,
      );
    }
  });

  it("rejects an unversioned legacy static checkpoint as migration-required", async () => {
    const backend = new MemoryBackend();
    await backend.createRun({ ...createRun("legacy-static"), id: "run" });
    await backend.saveCheckpoint("run", {
      id: "unversioned-legacy-static",
      nodeId: "work",
      timestamp: new Date(),
      context: { input: {}, work: "done" },
      nodeStates: {
        work: {
          nodeId: "work",
          status: "completed",
          attempt: 1,
          completedAt: new Date(),
        },
      },
    });
    await assertRejects(
      () =>
        new CheckpointManager({ backend }).prepareResume(
          "run",
          [{ id: "work", config: { type: "step", tool: "tool" } }],
          undefined,
          null,
          { context: { input: {} }, workflowVersion: null },
        ),
      Error,
      "complete durable workflow-version proof",
    );
  });

  it("permits legacy static-root recovery only with exact stored/current version proof", async () => {
    const backend = new MemoryBackend();
    const run = { ...createRun("versioned-legacy-static"), id: "run", version: "1" };
    await backend.createRun(run);
    await backend.saveCheckpoint("run", {
      id: "versioned-legacy-static",
      nodeId: "work",
      timestamp: new Date(),
      context: { input: {}, work: "done" },
      nodeStates: {
        work: {
          nodeId: "work",
          status: "completed",
          attempt: 1,
          completedAt: new Date(),
        },
      },
    });
    const manager = new CheckpointManager({ backend });
    const nodes: WorkflowNode[] = [{ id: "work", config: { type: "step", tool: "tool" } }];

    await assertRejects(
      () => manager.prepareResume("run", nodes, undefined, "1"),
      Error,
      "complete durable workflow-version proof",
    );
    const resume = await manager.prepareResume(
      "run",
      nodes,
      undefined,
      "1",
      { context: run.context, workflowVersion: run.version },
    );
    assertExists(resume);
    assertEquals(resume.graphAdmission?.workflowVersion, "1");
  });

  it("requires exact stored/current version proof for schema-one static-root recovery", async () => {
    const envelopeContext = { input: {}, work: "already-done" };
    const nodeStates = {
      work: {
        nodeId: "work",
        status: "completed" as const,
        attempt: 1,
        completedAt: new Date(),
      },
    };
    const legacyCheckpoint = {
      id: "schema-one",
      nodeId: "work",
      timestamp: new Date(),
      context: envelopeContext,
      nodeStates,
      _resumeEnvelope: {
        schemaVersion: 1,
        startFromNode: "work",
        context: envelopeContext,
        nodeStates,
        workflowProjection: { context: {} },
      },
    } as unknown as Checkpoint;
    class SchemaOneBackend extends MemoryBackend {
      override getLatestCheckpoint(): Promise<Checkpoint | null> {
        return Promise.resolve(legacyCheckpoint);
      }
    }
    const backend = new SchemaOneBackend();
    const nodes: WorkflowNode[] = [{
      id: "work",
      config: { type: "step", tool: "tool" },
    }];
    const manager = new CheckpointManager({ backend });

    await assertRejects(
      () => manager.prepareResume("run", nodes, undefined, "1"),
      Error,
      "complete durable workflow-version proof",
    );
    await assertRejects(
      () =>
        manager.prepareResume(
          "run",
          nodes,
          undefined,
          "1",
          { context: envelopeContext, workflowVersion: "2" },
        ),
      Error,
      "does not match current version",
    );
    const compatible = await manager.prepareResume(
      "run",
      nodes,
      undefined,
      "1",
      { context: envelopeContext, workflowVersion: "1" },
    );
    assertExists(compatible);
    assertEquals(compatible.context, envelopeContext);
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
        version: "1",
        steps: [waitForApproval("review")],
      }).definition,
    );
    const run = {
      ...createRun("await-waiting-callback"),
      version: "1",
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
        version: "1",
        steps: [
          step("prepare", { tool: createTool("prepare", () => ({ ready: true })) }),
          waitForApproval("review"),
        ],
      }).definition,
    );
    const run = {
      ...createRun("reject-waiting-callback"),
      version: "1",
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

  it("resumes a durably paused delay when its deadline is reached", async () => {
    using time = new FakeTime();
    const backend = new MemoryBackend();
    let prepareExecutions = 0;
    let finishExecutions = 0;
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "timed-delay-resume",
        version: "1",
        steps: [
          step("prepare", {
            checkpoint: true,
            tool: createTool("prepare", () => {
              prepareExecutions++;
              return { ready: true };
            }),
          }),
          dependsOn(delay("pause", 5), "prepare"),
          dependsOn(
            step("finish", {
              tool: createTool("finish", () => {
                finishExecutions++;
                return { done: true };
              }),
            }),
            "pause",
          ),
        ],
      }).definition,
    );

    const handle = await executor.start("timed-delay-resume", {});
    await handle.settled();
    assertEquals((await backend.getRun(handle.runId))?.status, "waiting");
    assertExists(await backend.getLatestCheckpoint(handle.runId));

    await time.tickAsync(4);
    assertEquals((await backend.getRun(handle.runId))?.status, "waiting");

    await time.tickAsync(1);
    await time.tickAsync(0);
    assertEquals((await backend.getRun(handle.runId))?.status, "completed");
    assertEquals(prepareExecutions, 1);
    assertEquals(finishExecutions, 1);
    assertEquals(await handle.result(), {
      prepare: { ready: true },
      finish: { done: true },
    });
    assertEquals((await backend.getRun(handle.runId))?.nodeStates.pause?.status, "completed");
  });

  it("recovers a reachable near-limit input after a durable delay", async () => {
    using time = new FakeTime();
    const backend = new MemoryBackend();
    const payload = Array.from({ length: 139 }, () => "x".repeat(60_349));
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "large-durable-delay-recovery",
        version: "1",
        steps: [delay("pause", 5)],
      }).definition,
    );

    const handle = await executor.start("large-durable-delay-recovery", { payload });
    await handle.settled();
    const waiting = await backend.getRun(handle.runId);
    assertEquals(waiting?.status, "waiting");
    assertEquals(
      (waiting?.input as { payload: string[] }).payload.length,
      payload.length,
    );

    await executor.destroy();
    await time.tickAsync(5);
    const recovered = await new TimedWaitRecoveryService(
      backend,
      "large-durable-delay-recovery-owner",
    ).recover({ now: Date.now(), maxAwakened: 1 });

    assertEquals(recovered.awakenedRuns.map((run) => run.id), [handle.runId]);
    assertEquals(recovered.errors, []);
    assertEquals((await backend.getRun(handle.runId))?.status, "pending");
  });

  it("does not adopt a replacement owner after the timed-wake CAS", async () => {
    using time = new FakeTime();
    const backend = new ReassignsAfterTimedWakeBackend();
    let finishExecutions = 0;
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "timed-delay-owner-handoff",
        version: "1",
        steps: [
          delay("pause", 5),
          dependsOn(
            step("finish", {
              tool: createTool("owner-handoff-finish", () => {
                finishExecutions++;
                return { done: true };
              }),
            }),
            "pause",
          ),
        ],
      }).definition,
    );

    const handle = await executor.start("timed-delay-owner-handoff", {});
    await handle.settled();
    await time.tickAsync(5);
    await time.tickAsync(0);

    const handedOff = await backend.getRun(handle.runId);
    assertEquals(backend.handoffs, 1);
    assertEquals(handedOff?.status, "running");
    assertEquals(handedOff?.workerId, "run-execution:replacement-owner");
    assertEquals(finishExecutions, 0);
  });

  it("schedules timed waits independently when run and node IDs contain NUL", async () => {
    using time = new FakeTime();
    const backend = new MemoryBackend();
    let firstFinishExecutions = 0;
    let secondFinishExecutions = 0;
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "nul-key-first",
        version: "1",
        steps: [
          delay("b\0c", 5),
          dependsOn(
            step("first-finish", {
              tool: createTool("nul-key-first-finish", () => {
                firstFinishExecutions++;
                return { done: true };
              }),
            }),
            "b\0c",
          ),
        ],
      }).definition,
    );
    executor.register(
      workflow({
        id: "nul-key-second",
        version: "1",
        steps: [
          delay("c", 40),
          dependsOn(
            step("second-finish", {
              tool: createTool("nul-key-second-finish", () => {
                secondFinishExecutions++;
                return { done: true };
              }),
            }),
            "c",
          ),
        ],
      }).definition,
    );
    const firstRun = { ...createRun("nul-key-first"), id: "a", version: "1" };
    const secondRun = { ...createRun("nul-key-second"), id: "a\0b", version: "1" };
    await backend.createRun(firstRun);
    await backend.createRun(secondRun);
    await executor.resume(firstRun.id);
    await executor.resume(secondRun.id);

    await time.tickAsync(5);
    await time.tickAsync(0);
    assertEquals((await backend.getRun(firstRun.id))?.status, "completed");
    assertEquals((await backend.getRun(secondRun.id))?.status, "waiting");
    assertEquals(firstFinishExecutions, 1);
    assertEquals(secondFinishExecutions, 0);

    await time.tickAsync(35);
    await time.tickAsync(0);
    assertEquals((await backend.getRun(secondRun.id))?.status, "completed");
    assertEquals(secondFinishExecutions, 1);
  });

  it("fails a durably paused event wait when its timeout expires", async () => {
    using time = new FakeTime();
    const backend = new MemoryBackend();
    let errorCallbacks = 0;
    const executor = new WorkflowExecutor({
      backend,
      onError: () => {
        errorCallbacks++;
      },
    });
    executor.register(
      workflow({
        id: "timed-event-timeout",
        version: "1",
        steps: [waitForEvent("signal", { eventName: "__delay__", timeout: 5 })],
      }).definition,
    );

    const handle = await executor.start("timed-event-timeout", {});
    await handle.settled();
    await time.tickAsync(5);
    await time.tickAsync(0);

    const failedRun = await backend.getRun(handle.runId);
    assertEquals(failedRun?.status, "failed");
    assertEquals(failedRun?.nodeStates.signal?.status, "failed");
    assertEquals(errorCallbacks, 1);

    const result = assertRejects(
      () => handle.result(),
      Error,
      'Wait node "signal" timed out after 5ms',
    );
    await time.tickAsync(100);
    await result;
  });

  it("fails a due event timeout before an earlier-inserted delay can resume the run", async () => {
    using time = new FakeTime();
    const backend = new MemoryBackend();
    let finishExecutions = 0;
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "mixed-timed-wait-priority",
        version: "1",
        steps: [
          parallel("waits", [
            delay("delay-first", 5),
            waitForEvent("event-second", { eventName: "signal", timeout: 5 }),
          ]),
          dependsOn(
            step("finish", {
              tool: createTool("mixed-timed-wait-finish", () => {
                finishExecutions++;
                return { done: true };
              }),
            }),
            "waits",
          ),
        ],
      }).definition,
    );

    const handle = await executor.start("mixed-timed-wait-priority", {});
    await handle.settled();
    assertEquals((await backend.getRun(handle.runId))?.status, "waiting");

    await time.tickAsync(5);
    await time.tickAsync(0);

    const failedRun = await backend.getRun(handle.runId);
    assertEquals(failedRun?.status, "failed");
    assertEquals(failedRun?.nodeStates["waits/event-second"]?.status, "failed");
    assertEquals(finishExecutions, 0);
  });

  it("keeps concurrent parallel delays waiting until every deadline has elapsed", async () => {
    using time = new FakeTime();
    const backend = new MemoryBackend();
    let finishExecutions = 0;
    let skipCalls = 0;
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "parallel-timed-delays",
        version: "1",
        steps: [
          parallel(
            "waits",
            [
              step("writer", { tool: createTool("parallel-writer", () => ({ wrote: true })) }),
              delay("short", 5),
              delay("long", 50),
            ],
            {
              skip: (context) => {
                skipCalls++;
                return context["waits/writer"] !== undefined;
              },
            },
          ),
          dependsOn(
            step("finish", {
              tool: createTool("finish", () => {
                finishExecutions++;
                return { done: true };
              }),
            }),
            "waits",
          ),
        ],
      }).definition,
    );

    const handle = await executor.start("parallel-timed-delays", {});
    await handle.settled();

    await time.tickAsync(5);
    await time.tickAsync(0);
    const partiallyElapsed = await backend.getRun(handle.runId);
    assertEquals(partiallyElapsed?.status, "waiting");
    assertEquals(partiallyElapsed?.nodeStates["waits/short"]?.status, "completed");
    assertEquals(partiallyElapsed?.nodeStates["waits/long"]?.status, "running");
    assertEquals(partiallyElapsed?.nodeStates.waits?.status, "running");
    assertEquals(finishExecutions, 0);

    await time.tickAsync(45);
    await time.tickAsync(0);
    assertEquals((await backend.getRun(handle.runId))?.status, "completed");
    assertEquals(finishExecutions, 1);
    assertEquals(skipCalls, 1);
  });

  it("re-enters a durably waiting branch without switching the selected arm", async () => {
    using time = new FakeTime();
    const backend = new MemoryBackend();
    let conditionCalls = 0;
    let childExecutions = 0;
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "branch-timed-delay",
        version: "1",
        steps: [
          branch("choice", {
            condition: () => {
              conditionCalls++;
              return conditionCalls === 1;
            },
            then: [
              delay("pause", 5),
              dependsOn(
                step("child", {
                  tool: createTool("branch-child", () => {
                    childExecutions++;
                    return { branch: "then" };
                  }),
                }),
                "pause",
              ),
            ],
            else: [step("wrong-arm", { tool: createTool("wrong-arm", () => "wrong") })],
          }),
        ],
      }).definition,
    );

    const handle = await executor.start("branch-timed-delay", {});
    await handle.settled();
    await time.tickAsync(5);
    await time.tickAsync(0);

    assertEquals((await backend.getRun(handle.runId))?.status, "completed");
    assertEquals(conditionCalls, 1);
    assertEquals(childExecutions, 1);
    assertEquals(
      (await backend.getRun(handle.runId))?.nodeStates["choice/else/wrong-arm"],
      undefined,
    );
  });

  it("resumes the in-flight loop iteration after a durable delay", async () => {
    using time = new FakeTime();
    const backend = new MemoryBackend();
    const conditionIterations: number[] = [];
    const selectedStepCounts: number[] = [];
    let writerExecutions = 0;
    let finishExecutions = 0;
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "loop-timed-delay",
        version: "1",
        steps: [
          loop("repeat", {
            while: (context, iteration) => {
              conditionIterations.push(iteration.iteration);
              return iteration.iteration < 1 && context["repeat/writer"] === undefined;
            },
            maxIterations: 2,
            steps: (context) => {
              const selected = [
                step("writer", {
                  tool: createTool("loop-writer", () => {
                    writerExecutions++;
                    return { wrote: true };
                  }),
                }),
                dependsOn(delay("pause", 5), "writer"),
              ];
              if (context["repeat/writer"] === undefined) {
                selected.push(dependsOn(
                  step("finish", {
                    tool: createTool("loop-finish", () => {
                      finishExecutions++;
                      return { finished: true };
                    }),
                  }),
                  "pause",
                ));
              }
              selectedStepCounts.push(selected.length);
              return selected;
            },
          }),
        ],
      }).definition,
    );

    const handle = await executor.start("loop-timed-delay", {});
    await handle.settled();
    await time.tickAsync(5);
    await time.tickAsync(0);

    const completed = await backend.getRun(handle.runId);
    assertEquals(completed?.status, "completed");
    assertEquals(completed?.nodeStates["repeat/writer"]?.status, "completed");
    assertEquals(completed?.nodeStates["repeat/pause"]?.status, "completed");
    assertEquals(completed?.nodeStates["repeat/finish"]?.status, "completed");
    assertEquals(writerExecutions, 1);
    assertEquals(finishExecutions, 1);
    assertEquals(conditionIterations, [0, 1]);
    assertEquals(selectedStepCounts, [3, 3]);
    const loopOutput = completed?.nodeStates.repeat?.output as {
      previousResults: Array<Record<string, unknown>>;
    };
    assertEquals(loopOutput.previousResults[0]?.["repeat/writer"], { wrote: true });
    assertEquals(loopOutput.previousResults[0]?.["repeat/finish"], { finished: true });
    assertEquals(completed?.context.repeat_loop_state, undefined);
    assertEquals((completed?.output as Record<string, unknown>).repeat_loop_state, undefined);
    assertEquals((await handle.result() as Record<string, unknown>).repeat_loop_state, undefined);
  });

  it("resumes mapped delay processors without completing the parent early", async () => {
    using time = new FakeTime();
    const backend = new MemoryBackend();
    let finishExecutions = 0;
    const selectedItemCounts: number[] = [];
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "map-timed-delays",
        version: "1",
        steps: [
          {
            ...map("waits", {
              items: (context) => {
                const items = context.sibling === undefined ? ["a", "b"] : ["a"];
                selectedItemCounts.push(items.length);
                return items;
              },
              processor: delay("pause", 5),
            }),
            dependsOn: [],
          },
          {
            ...step("sibling", {
              tool: createTool("map-sibling", () => ({ changedParentContext: true })),
            }),
            dependsOn: [],
          },
          dependsOn(
            step("finish", {
              tool: createTool("map-finish", () => {
                finishExecutions++;
                return { done: true };
              }),
            }),
            "waits",
          ),
        ],
      }).definition,
    );

    const handle = await executor.start("map-timed-delays", {});
    await handle.settled();
    await time.tickAsync(5);
    await time.tickAsync(0);

    const firstItemElapsed = await backend.getRun(handle.runId);
    assertEquals(firstItemElapsed?.status, "waiting");
    assertEquals(firstItemElapsed?.nodeStates.waits_0?.status, "completed");
    assertEquals(firstItemElapsed?.nodeStates.waits_1?.status, "running");
    assertEquals(finishExecutions, 0);

    await time.tickAsync(5);
    await time.tickAsync(0);

    assertEquals((await backend.getRun(handle.runId))?.status, "completed");
    assertEquals((await backend.getRun(handle.runId))?.nodeStates.waits?.status, "completed");
    assertEquals(finishExecutions, 1);
    assertEquals(selectedItemCounts, [2]);
  });

  it("retains partial map processor context across a durable wait", async () => {
    using time = new FakeTime();
    const backend = new MemoryBackend();
    let writerExecutions = 0;
    const finishInputs: unknown[] = [];
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "map-partial-context",
        version: "1",
        steps: [map("items", {
          items: ["one"],
          processor: parallel("processor", [
            step("writer", {
              tool: createTool("map-context-writer", () => {
                writerExecutions++;
                return { wrote: true };
              }),
            }),
            dependsOn(delay("pause", 5), "writer"),
            dependsOn(
              step("finish", {
                input: (context) => ({ writer: context["items_0/writer"] }),
                tool: createTool("map-context-finish", (input) => {
                  finishInputs.push(input);
                  return input;
                }),
              }),
              "pause",
            ),
          ]),
        })],
      }).definition,
    );

    const handle = await executor.start("map-partial-context", {});
    await handle.settled();
    assertEquals((await backend.getRun(handle.runId))?.status, "waiting");

    await time.tickAsync(5);
    await time.tickAsync(0);

    assertEquals((await backend.getRun(handle.runId))?.status, "completed");
    assertEquals(writerExecutions, 1);
    assertEquals(finishInputs, [{ writer: { wrote: true } }]);
  });

  it("resumes a timed wait inside a sub-workflow with stable dynamic steps", async () => {
    using time = new FakeTime();
    const backend = new MemoryBackend();
    const selectedStepCounts: number[] = [];
    let innerFinishExecutions = 0;
    let outerFinishExecutions = 0;
    const inner = workflow({
      id: "timed-sub-workflow-inner",
      version: "1",
      steps: ({ context }) => {
        const selected = [delay("pause", 5)];
        if (context.sibling === undefined) {
          selected.push(dependsOn(
            step("inner-finish", {
              tool: createTool("sub-workflow-inner-finish", () => {
                innerFinishExecutions++;
                return { done: true };
              }),
            }),
            "pause",
          ));
        }
        selectedStepCounts.push(selected.length);
        return selected;
      },
    }).definition;
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "timed-sub-workflow-outer",
        version: "1",
        steps: [
          {
            ...subWorkflow("nested", {
              workflow: inner,
              input: (context: WorkflowContext) => context.env,
            }),
            dependsOn: [],
          },
          {
            ...step("sibling", {
              tool: createTool("sub-workflow-sibling", () => ({ changedParentContext: true })),
            }),
            dependsOn: [],
          },
          dependsOn(
            step("outer-finish", {
              tool: createTool("sub-workflow-outer-finish", () => {
                outerFinishExecutions++;
                return { done: true };
              }),
            }),
            "nested",
          ),
        ],
      }).definition,
    );

    const originalTaskEnvJson = Deno.env.get("VERYFRONT_TASK_ENV_JSON");
    try {
      Deno.env.set(
        "VERYFRONT_TASK_ENV_JSON",
        JSON.stringify({ PROJECT_SECRET: "sub-workflow-secret" }),
      );
      const handle = await executor.start("timed-sub-workflow-outer", {});
      await handle.settled();
      const waitingInternal = await backend.getRun(handle.runId);
      assertEquals(waitingInternal?.status, "waiting");
      assertEquals(
        (waitingInternal?.nodeStates.nested?.output as Record<string, unknown>).input,
        { PROJECT_SECRET: "sub-workflow-secret" },
      );
      const waitingPublic = await handle.status();
      assertEquals(
        (waitingPublic.nodeStates.nested?.output as Record<string, unknown>).input,
        undefined,
      );

      await time.tickAsync(5);
      await time.tickAsync(0);

      const completed = await backend.getRun(handle.runId);
      assertEquals(completed?.status, "completed");
      assertEquals(completed?.nodeStates["nested/pause"]?.status, "completed");
      assertEquals(completed?.nodeStates["nested/inner-finish"]?.status, "completed");
      assertEquals(completed?.nodeStates.nested?.status, "completed");
      assertEquals(innerFinishExecutions, 1);
      assertEquals(outerFinishExecutions, 1);
      assertEquals(selectedStepCounts, [2, 2]);
      assertEquals(
        (completed?.nodeStates["nested/inner-finish"]?.input as Record<string, unknown>)
          .PROJECT_SECRET,
        "sub-workflow-secret",
      );
      assertEquals((await handle.status()).nodeStates["nested/inner-finish"]?.input, undefined);
      assertEquals(
        ((await handle.result() as Record<string, unknown>).nested as Record<string, unknown>)
          .input,
        undefined,
      );
    } finally {
      if (originalTaskEnvJson === undefined) {
        Deno.env.delete("VERYFRONT_TASK_ENV_JSON");
      } else {
        Deno.env.set("VERYFRONT_TASK_ENV_JSON", originalTaskEnvJson);
      }
    }
  });

  it("projects failed sub-workflow context inputs from status and failure observers", async () => {
    const backend = new MemoryBackend();
    let observedFailureRun: WorkflowRun | undefined;
    const executor = new WorkflowExecutor({
      backend,
      onError: (run) => {
        observedFailureRun = run;
      },
    });
    const inner = workflow({
      id: "failed-sub-workflow-inner",
      steps: [
        step("fail", {
          tool: createTool("failed-sub-workflow-tool", () => {
            throw new Error("inner failure");
          }),
        }),
      ],
    }).definition;
    executor.register(
      workflow({
        id: "failed-sub-workflow-outer",
        steps: [subWorkflow("nested", {
          workflow: inner,
          input: (context: WorkflowContext) => context.env,
        })],
      }).definition,
    );

    const originalTaskEnvJson = Deno.env.get("VERYFRONT_TASK_ENV_JSON");
    try {
      Deno.env.set(
        "VERYFRONT_TASK_ENV_JSON",
        JSON.stringify({ PROJECT_SECRET: "failed-sub-workflow-secret" }),
      );
      const handle = await executor.start("failed-sub-workflow-outer", {});
      await handle.settled();

      const rawRun = await backend.getRun(handle.runId);
      assertEquals(rawRun?.status, "failed");
      assertEquals(
        (rawRun?.nodeStates.nested?.output as Record<string, unknown>).input,
        { PROJECT_SECRET: "failed-sub-workflow-secret" },
      );
      assertEquals(rawRun?.nodeStates["nested/fail"]?.input, {
        PROJECT_SECRET: "failed-sub-workflow-secret",
      });

      const publicRun = await handle.status();
      assertEquals(
        (publicRun.nodeStates.nested?.output as Record<string, unknown>).input,
        undefined,
      );
      assertEquals(publicRun.nodeStates["nested/fail"]?.input, undefined);
      assertEquals(observedFailureRun?.status, "failed");
      assertEquals(
        (observedFailureRun?.nodeStates.nested?.output as Record<string, unknown>).input,
        undefined,
      );
    } finally {
      if (originalTaskEnvJson === undefined) {
        Deno.env.delete("VERYFRONT_TASK_ENV_JSON");
      } else {
        Deno.env.set("VERYFRONT_TASK_ENV_JSON", originalTaskEnvJson);
      }
    }
  });

  it("preserves custom sub-workflow outputs that resemble framework context", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend });
    const inner = workflow({ id: "custom-sub-workflow-inner", steps: [] }).definition;
    const customOutput = {
      input: "keep-input",
      env: { visible: true },
      _tenant: {
        projectSlug: "user-project",
        token: "user-token",
        productionMode: false,
      },
      payload: "keep-payload",
    };
    executor.register(
      workflow({
        id: "custom-sub-workflow-outer",
        steps: [subWorkflow("nested", {
          workflow: inner,
          output: () => customOutput,
        })],
      }).definition,
    );

    const handle = await executor.start("custom-sub-workflow-outer", {});
    await handle.settled();

    assertEquals((await handle.status()).nodeStates.nested?.output, customOutput);
    assertEquals((await handle.result() as Record<string, unknown>).nested, customOutput);
  });

  it("projects completed sub-workflow context from workflow failure callbacks", async () => {
    const backend = new MemoryBackend();
    let observedContext: WorkflowContext | undefined;
    const executor = new WorkflowExecutor({ backend });
    const inner = workflow({
      id: "completed-before-failure-inner",
      steps: [step("done", { tool: createTool("inner-done", () => ({ done: true })) })],
    }).definition;
    executor.register(
      workflow({
        id: "completed-before-failure-outer",
        steps: [
          subWorkflow("nested", {
            workflow: inner,
            input: (context: WorkflowContext) => context.env,
          }),
          dependsOn(
            step("fail", {
              tool: createTool("outer-fail", () => {
                throw new Error("outer failure");
              }),
            }),
            "nested",
          ),
        ],
        onError: (_error, context) => {
          observedContext = context;
        },
      }).definition,
    );

    const originalTaskEnvJson = Deno.env.get("VERYFRONT_TASK_ENV_JSON");
    try {
      Deno.env.set(
        "VERYFRONT_TASK_ENV_JSON",
        JSON.stringify({ PROJECT_SECRET: "completed-before-failure-secret" }),
      );
      const handle = await executor.start("completed-before-failure-outer", {});
      await handle.settled();

      const raw = await backend.getRun(handle.runId);
      assertEquals(
        (raw?.context.nested as WorkflowContext).input,
        { PROJECT_SECRET: "completed-before-failure-secret" },
      );
      assertEquals((observedContext?.nested as WorkflowContext).input, undefined);
    } finally {
      if (originalTaskEnvJson === undefined) {
        Deno.env.delete("VERYFRONT_TASK_ENV_JSON");
      } else {
        Deno.env.set("VERYFRONT_TASK_ENV_JSON", originalTaskEnvJson);
      }
    }
  });

  it("projects map-of-subworkflow context composition from state, context, and result", async () => {
    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend });
    const inner = workflow({
      id: "mapped-sub-workflow-inner",
      steps: [step("inner", { tool: createTool("mapped-inner", () => ({ done: true })) })],
    }).definition;
    executor.register(
      workflow({
        id: "mapped-sub-workflow-outer",
        steps: [map("mapped", {
          items: (context) => [context.env],
          processor: inner,
        })],
      }).definition,
    );

    const originalTaskEnvJson = Deno.env.get("VERYFRONT_TASK_ENV_JSON");
    try {
      Deno.env.set(
        "VERYFRONT_TASK_ENV_JSON",
        JSON.stringify({ PROJECT_SECRET: "mapped-sub-workflow-secret" }),
      );
      const handle = await executor.start("mapped-sub-workflow-outer", {});
      await handle.settled();

      const raw = await backend.getRun(handle.runId);
      assertEquals(
        ((raw?.nodeStates.mapped?.output as unknown[])[0] as WorkflowContext).input,
        { PROJECT_SECRET: "mapped-sub-workflow-secret" },
      );
      assertEquals((raw?.nodeStates.mapped_0?.output as WorkflowContext).input, {
        PROJECT_SECRET: "mapped-sub-workflow-secret",
      });
      assertEquals(raw?.nodeStates["mapped_0/inner"]?.input, {
        PROJECT_SECRET: "mapped-sub-workflow-secret",
      });

      const publicRun = await handle.status();
      assertEquals(
        ((publicRun.nodeStates.mapped?.output as unknown[])[0] as WorkflowContext).input,
        undefined,
      );
      assertEquals((publicRun.nodeStates.mapped_0?.output as WorkflowContext).input, undefined);
      assertEquals(publicRun.nodeStates["mapped_0/inner"]?.input, undefined);
      assertEquals(
        ((publicRun.context.mapped as unknown[])[0] as WorkflowContext).input,
        undefined,
      );
      assertEquals(
        (((await handle.result()) as Record<string, unknown>).mapped as WorkflowContext[])[0]
          ?.input,
        undefined,
      );
    } finally {
      if (originalTaskEnvJson === undefined) {
        Deno.env.delete("VERYFRONT_TASK_ENV_JSON");
      } else {
        Deno.env.set("VERYFRONT_TASK_ENV_JSON", originalTaskEnvJson);
      }
    }
  });

  it("does not resume a timed delay after cancellation", async () => {
    using time = new FakeTime();
    const backend = new MemoryBackend();
    let finishExecutions = 0;
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "cancel-timed-delay",
        version: "1",
        steps: [
          delay("pause", 10),
          dependsOn(
            step("finish", {
              tool: createTool("finish", () => {
                finishExecutions++;
                return { done: true };
              }),
            }),
            "pause",
          ),
        ],
      }).definition,
    );

    const handle = await executor.start("cancel-timed-delay", {});
    await handle.settled();
    await handle.cancel();
    await time.tickAsync(10);

    assertEquals((await backend.getRun(handle.runId))?.status, "cancelled");
    assertEquals(finishExecutions, 0);
  });

  it("leaves durable timed waits intact during destroy without a late local resume", async () => {
    using time = new FakeTime();
    const backend = new MemoryBackend();
    let finishExecutions = 0;
    const executor = new WorkflowExecutor({ backend });
    executor.register(
      workflow({
        id: "destroy-timed-delay",
        version: "1",
        steps: [
          delay("pause", 10),
          dependsOn(
            step("finish", {
              tool: createTool("finish", () => {
                finishExecutions++;
                return { done: true };
              }),
            }),
            "pause",
          ),
        ],
      }).definition,
    );

    const handle = await executor.start("destroy-timed-delay", {});
    await handle.settled();
    await executor.destroy();
    await time.tickAsync(10);

    assertEquals((await backend.getRun(handle.runId))?.status, "waiting");
    assertEquals(finishExecutions, 0);
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
        version: "1",
        steps: [waitForApproval("review")],
      }).definition,
    );
    const run = {
      ...createRun("cancel-during-waiting-handoff"),
      version: "1",
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
      version: "1",
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
      version: "1",
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
        version: "1",
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
      version: "1",
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
        version: "1",
        steps: [
          step("finish", {
            tool: createTool("finish", () => ({ ok: true })),
          }),
        ],
      }).definition,
    );
    const run = { ...createRun("locked-success"), version: "1" };
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
        version: "1",
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
    const run = { ...createRun("invalid-output"), version: "1" };
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
        version: "1",
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
    const run = { ...createRun("transformed-output"), version: "1" };
    await backend.createRun(run);

    await executor.executeAsync(run.id);

    const completedRun = await backend.getRun(run.id);
    assertExists(completedRun);
    assertEquals(completedRun.status, "completed");
    assertEquals(completedRun.output, { normalized: "READY" });
    assertEquals(completionOutput, completedRun.output);
  });

  it("preserves framework-shaped fields owned by a versioned output transform", async () => {
    const backend = new MemoryBackend();
    let completionOutput: unknown;
    const transformed = {
      input: "keep-input",
      env: { visible: true },
      _tenant: { visible: true },
    };
    const executor = new WorkflowExecutor({
      backend,
      onComplete: (run) => {
        completionOutput = run.output;
      },
    });
    executor.register(
      workflow({
        id: "framework-shaped-transformed-output",
        outputSchema: defineSchema((v) =>
          v.object({ finish: v.unknown() }).transform(() => transformed)
        )(),
        steps: [step("finish", { tool: createTool("transform-finish", () => "done") })],
      }).definition,
    );

    const handle = await executor.start("framework-shaped-transformed-output", {});
    await handle.settled();

    assertEquals((await handle.status()).output, transformed);
    assertEquals(await handle.result(), transformed);
    assertEquals(completionOutput, transformed);
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
        version: "1",
        steps: [step("finish", { tool: createTool("finish", () => ({ ok: true })) })],
        onComplete: () => {
          observerCalls.push("workflow");
          throw new Error("workflow observer failed");
        },
      }).definition,
    );
    const run = { ...createRun("completion-observer-failure"), version: "1" };
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
        version: "1",
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
    const run = { ...createRun("failure-observer-failure"), version: "1" };
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
        version: "1",
        steps: [
          step("finish", {
            tool: createTool("finish", () => ({ ok: true })),
          }),
        ],
      }).definition,
    );
    const run = { ...createRun("locked-conflict"), version: "1" };
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
        version: "1",
        steps: [
          step("fail", {
            tool: createTool("fail", () => {
              throw new Error("tool exploded");
            }),
          }),
        ],
      }).definition,
    );
    const run = { ...createRun("locked-failure"), version: "1" };
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
        version: "1",
        steps: [step("blocking", { tool: blockingTool })],
      }).definition,
    );
    const run = { ...createRun("lock-loss-quiescence"), version: "1" };
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
        version: "1",
        steps: [step("blocking", { tool: blockingTool })],
      }).definition,
    );
    const run = { ...createRun("lock-heartbeat-failure"), version: "1" };
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
        version: "1",
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
    const run = { ...createRun("token-bound-heartbeat"), version: "1" };
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
        version: "1",
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
      version: "1",
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

  it("keeps cancellation terminal when cooperative cleanup rejects distinctly", async () => {
    const backend = new MemoryBackend();
    const cleanupFailure = new Error("cancelled tool cleanup failed");
    const started = Promise.withResolvers<void>();
    const cleanupObserved = Promise.withResolvers<void>();
    let cancellationReason: unknown;
    let errorCallbacks = 0;
    const executor = new WorkflowExecutor({
      backend,
      cancellationGracePeriod: 5,
      onError: () => {
        errorCallbacks++;
      },
    });
    const blockingTool: Tool = {
      id: "cancellation-cleanup-failure",
      type: "function",
      description: "Reject with a distinct cleanup failure after cancellation",
      inputSchema: defineSchema((v) => v.object({}).passthrough())(),
      execute: (_input, context) => {
        const signal = context?.abortSignal;
        started.resolve();
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            cancellationReason = signal.reason;
            reject(cleanupFailure);
            cleanupObserved.resolve();
          }, { once: true });
        });
      },
    };
    executor.register(
      workflow({
        id: "cancellation-cleanup-failure",
        steps: [step("blocking", { tool: blockingTool })],
      }).definition,
    );

    const handle = await executor.start("cancellation-cleanup-failure", {});
    await started.promise;
    await handle.cancel();
    await cleanupObserved.promise;
    await handle.settled();

    const cancelledRun = await backend.getRun(handle.runId);
    assertExists(cancelledRun);
    assertInstanceOf(cancellationReason, Error);
    assertEquals(Object.is(cancellationReason, cleanupFailure), false);
    assertEquals(cancelledRun.status, "cancelled");
    assertEquals(cancelledRun.error, undefined);
    assertEquals(cancelledRun.output, undefined);
    assertEquals(errorCallbacks, 0);
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
        version: "1",
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
    const run = { ...createRun("workflow-timeout"), version: "1" };
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

  it("preserves ordered cleanup diagnostics behind the exact workflow timeout", async () => {
    using time = new FakeTime();
    const backend = new MemoryBackend();
    const cleanupFailure = new Error("timed-out tool cleanup failed");
    const started = Promise.withResolvers<void>();
    let receivedSignal: AbortSignal | undefined;
    const executor = new WorkflowExecutor({
      backend,
      cancellationGracePeriod: 5,
    });
    const blockingTool: Tool = {
      id: "timeout-cleanup-failure",
      type: "function",
      description: "Reject with a distinct cleanup failure after timeout",
      inputSchema: defineSchema((v) => v.object({}).passthrough())(),
      execute: (_input, context) => {
        receivedSignal = context?.abortSignal;
        started.resolve();
        return new Promise((_resolve, reject) => {
          receivedSignal?.addEventListener(
            "abort",
            () => reject(cleanupFailure),
            { once: true },
          );
        });
      },
    };
    executor.register(
      workflow({
        id: "timeout-cleanup-failure",
        version: "1",
        timeout: 5,
        steps: [step("blocking", { tool: blockingTool })],
      }).definition,
    );
    const run = { ...createRun("timeout-cleanup-failure"), version: "1" };
    await backend.createRun(run);

    const rejection = executor.executeAsync(run.id).then(
      () => undefined,
      (error: unknown) => error,
    );
    await started.promise;
    await time.tickAsync(5);
    const error = await rejection;

    assertEquals(isAbortCleanupError(error), true);
    assertInstanceOf(error, AggregateError);
    if (!isAbortCleanupError(error)) return;
    const primaryReason = getPrimaryAbortReason(error);
    assertStrictEquals(error.errors[0], primaryReason);
    assertStrictEquals(error.cause, primaryReason);
    assertStrictEquals(receivedSignal?.reason, primaryReason);
    assertStrictEquals(error.errors[1], cleanupFailure);
    assertEquals(error.errors.length, 2);

    const timedOutRun = await backend.getRun(run.id);
    assertExists(timedOutRun);
    assertEquals(timedOutRun.status, "failed");
    assertEquals(Object.hasOwn(timedOutRun.error ?? {}, "cleanupErrors"), false);
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
        version: "1",
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
    const run = { ...createRun("non-cooperative-timeout"), version: "1" };
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
        version: "1",
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
        version: "1",
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
