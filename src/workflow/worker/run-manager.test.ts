import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type {
  WorkflowRunCursorFilter,
  WorkflowRunUpdate,
} from "../backends/types.ts";
import type { WorkflowRun } from "../types.ts";
import type { RunExecutionConfig, RunExecutionInfo, RunExecutor } from "./executors/types.ts";
import { createWorkflowRunManager, WorkflowRunManager } from "./run-manager.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { getActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

/**
 * Minimal in-memory RunExecutor. Records initialize/destroy/create calls so
 * tests can assert lifecycle wiring without spawning real processes.
 */
class FakeRunExecutor implements RunExecutor {
  initializeCalls = 0;
  destroyCalls = 0;
  created: RunExecutionConfig[] = [];
  observedSourceIntegrationPolicies: unknown[] = [];
  private executions = new Map<string, RunExecutionInfo>();

  createRunExecution(config: RunExecutionConfig): Promise<string> {
    this.created.push(config);
    this.observedSourceIntegrationPolicies.push(getActiveSourceIntegrationPolicy());
    this.executions.set(config.executionId, {
      executionId: config.executionId,
      runId: config.run.id,
      status: "running",
      createdAt: new Date(0),
    });
    return Promise.resolve(config.executionId);
  }
  getRunExecutionStatus(executionId: string): Promise<RunExecutionInfo | null> {
    return Promise.resolve(this.executions.get(executionId) ?? null);
  }
  listRunExecutions(_managerId: string): Promise<RunExecutionInfo[]> {
    return Promise.resolve([...this.executions.values()]);
  }
  deleteRunExecution(executionId: string): Promise<void> {
    this.executions.delete(executionId);
    return Promise.resolve();
  }
  initialize(): Promise<void> {
    this.initializeCalls++;
    return Promise.resolve();
  }
  destroy(): Promise<void> {
    this.destroyCalls++;
    this.executions.clear();
    return Promise.resolve();
  }
}

class FailingRunExecutor extends FakeRunExecutor {
  override createRunExecution(_config: RunExecutionConfig): Promise<string> {
    return Promise.reject(new Error("spawn failed"));
  }
}

class GatedInitializeExecutor extends FakeRunExecutor {
  readonly initializeStarted = Promise.withResolvers<void>();
  readonly continueInitialize = Promise.withResolvers<void>();

  override async initialize(): Promise<void> {
    this.initializeCalls++;
    this.initializeStarted.resolve();
    await this.continueInitialize.promise;
  }
}

class PartiallyFailingInitializeExecutor extends FakeRunExecutor {
  open = false;
  cleanupFailuresRemaining = 0;

  override initialize(): Promise<void> {
    this.initializeCalls++;
    this.open = true;
    return Promise.reject(new Error("partial initialization failed"));
  }

  override destroy(): Promise<void> {
    this.destroyCalls++;
    if (this.cleanupFailuresRemaining > 0) {
      this.cleanupFailuresRemaining--;
      return Promise.reject(new Error("partial initialization cleanup failed"));
    }
    this.open = false;
    return Promise.resolve();
  }
}

class GatedCreateExecutor extends FakeRunExecutor {
  readonly createStarted = Promise.withResolvers<void>();
  readonly continueCreate = Promise.withResolvers<void>();

  override async createRunExecution(config: RunExecutionConfig): Promise<string> {
    this.createStarted.resolve();
    await this.continueCreate.promise;
    return await super.createRunExecution(config);
  }
}

class GatedDestroyExecutor extends FakeRunExecutor {
  readonly destroyStarted = Promise.withResolvers<void>();
  readonly continueDestroy = Promise.withResolvers<void>();

  override async destroy(): Promise<void> {
    this.destroyStarted.resolve();
    await this.continueDestroy.promise;
    await super.destroy();
  }
}

class AmbiguousCreateFailureExecutor extends FakeRunExecutor {
  cleanupFailuresRemaining = 1;

  override async createRunExecution(config: RunExecutionConfig): Promise<string> {
    await super.createRunExecution(config);
    throw new Error("spawn acknowledgement failed");
  }

  override deleteRunExecution(executionId: string): Promise<void> {
    if (this.cleanupFailuresRemaining > 0) {
      this.cleanupFailuresRemaining--;
      return Promise.reject(new Error("execution cleanup unavailable"));
    }
    return super.deleteRunExecution(executionId);
  }
}

class FirstCreateAcknowledgementFailureExecutor extends FakeRunExecutor {
  createAttempts = 0;
  deletedExecutionIds: string[] = [];

  override async createRunExecution(config: RunExecutionConfig): Promise<string> {
    this.createAttempts++;
    const executionId = await super.createRunExecution(config);
    if (this.createAttempts === 1) {
      throw new Error("first spawn acknowledgement failed");
    }
    return executionId;
  }

  override deleteRunExecution(executionId: string): Promise<void> {
    this.deletedExecutionIds.push(executionId);
    return super.deleteRunExecution(executionId);
  }
}

class RetainedClaimCompensationBackend extends MemoryBackend {
  failedClaimUpdatesRemaining = 1;
  retainedOwnerRequeueFailuresRemaining = 0;
  failedClaimUpdateAttempts = 0;
  retainedOwnerRequeueAttempts: string[] = [];

  override updateRunIfStatusAndLock(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    lockId: string,
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    if (patch.status === "failed" && expectedWorkerId?.startsWith("run-execution:")) {
      this.failedClaimUpdateAttempts++;
      if (this.failedClaimUpdatesRemaining > 0) {
        this.failedClaimUpdatesRemaining--;
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

  override updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: WorkflowRunUpdate,
  ): Promise<boolean> {
    if (patch.status === "pending" && expectedWorkerId.startsWith("run-execution:")) {
      this.retainedOwnerRequeueAttempts.push(expectedWorkerId);
      if (this.retainedOwnerRequeueFailuresRemaining > 0) {
        this.retainedOwnerRequeueFailuresRemaining--;
        return Promise.reject(new Error("transient retained-owner requeue rejection"));
      }
    }
    return super.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
  }
}

class GatedListBackend extends MemoryBackend {
  readonly listStarted = Promise.withResolvers<void>();
  readonly continueList = Promise.withResolvers<void>();

  override async listRuns(
    filter: Parameters<MemoryBackend["listRuns"]>[0],
  ): Promise<WorkflowRun[]> {
    this.listStarted.resolve();
    await this.continueList.promise;
    return await super.listRuns(filter);
  }
}

class GatedAcquireBackend extends MemoryBackend {
  readonly acquireStarted = Promise.withResolvers<void>();
  readonly continueAcquire = Promise.withResolvers<void>();

  override async acquireLock(runId: string, duration: number): Promise<string | null> {
    this.acquireStarted.resolve();
    await this.continueAcquire.promise;
    return await super.acquireLock(runId, duration);
  }
}

class MissingPolicyOnListBackend extends MemoryBackend {
  override async getRun(runId: string): Promise<WorkflowRun | null> {
    const run = await super.getRun(runId);
    return run ? this.withoutSourcePolicy(run) : null;
  }

  override async listRuns(
    filter: Parameters<MemoryBackend["listRuns"]>[0],
  ): Promise<WorkflowRun[]> {
    return (await super.listRuns(filter)).map((run) => this.withoutSourcePolicy(run));
  }

  private withoutSourcePolicy(run: WorkflowRun): WorkflowRun {
    const { sourceIntegrationPolicy: _sourceIntegrationPolicy, ...missingSnapshot } = run;
    return missingSnapshot as unknown as WorkflowRun;
  }
}

// A poll interval large enough that the first scheduled poll never fires during
// a test; stop() clears the pending timer, so no work runs and no timer leaks.
const NO_POLL = 1_000_000;

function makeManager(executor: RunExecutor = new FakeRunExecutor()) {
  const backend = new MemoryBackend();
  const manager = new WorkflowRunManager({ backend, executor, pollInterval: NO_POLL });
  return { backend, executor, manager };
}

function createPendingRun(id: string): WorkflowRun {
  return {
    id,
    workflowId: "workflow-1",
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

function createExpiredTimedWaitRun(
  id: string,
  waitKind: "delay" | "event",
): WorkflowRun {
  return {
    ...createPendingRun(id),
    status: "waiting",
    workerId: "run-execution:previous-owner",
    currentNodes: ["pause"],
    nodeStates: {
      pause: {
        nodeId: "pause",
        status: "running",
        input: {
          type: "event",
          eventName: waitKind === "delay" ? "__delay__" : "never-arrives",
          timeout: 5,
          _waitKind: waitKind,
        },
        attempt: 1,
        startedAt: new Date(Date.now() - 10),
      },
    },
  };
}

function pollOnce(manager: WorkflowRunManager): Promise<void> {
  return (manager as unknown as { poll(): Promise<void> }).poll();
}

class VirtualPagedRecoveryBackend extends MemoryBackend {
  readonly cursors: Array<WorkflowRunCursorFilter["cursor"]> = [];
  readonly firstPage = Array.from({ length: 100 }, (_, index) => ({
    ...createPendingRun(`virtual-wait-${String(index).padStart(3, "0")}`),
    status: "waiting" as const,
    createdAt: new Date(1_000 + 100 - index),
  }));

  override listRunsAfterCursor(filter: WorkflowRunCursorFilter): Promise<WorkflowRun[]> {
    this.cursors.push(filter.cursor);
    if (!filter.cursor) return Promise.resolve(structuredClone(this.firstPage));
    return super.listRunsAfterCursor(filter);
  }
}

class MalformedPagedRecoveryBackend extends MemoryBackend {
  readonly row = {
    ...createPendingRun("malformed-wait-row"),
    status: "waiting" as const,
    createdAt: new Date(1_000),
  };

  override listRunsAfterCursor(_filter: WorkflowRunCursorFilter): Promise<WorkflowRun[]> {
    return Promise.resolve(structuredClone([this.row, this.row]));
  }
}

describe("workflow/worker/run-manager", () => {
  let managers: WorkflowRunManager[] = [];

  afterEach(async () => {
    // Ensure every started manager is stopped so its poll timer is cleared.
    for (const m of managers) await m.stop();
    managers = [];
  });

  function track(m: WorkflowRunManager): WorkflowRunManager {
    managers.push(m);
    return m;
  }

  it("rejects scheduling values that cannot make safe forward progress", () => {
    const backend = new MemoryBackend();
    const executor = new FakeRunExecutor();

    for (
      const option of [
        "pollInterval",
        "executionTimeout",
        "stalledThreshold",
        "lockRetryInterval",
      ] as const
    ) {
      for (const value of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertThrows(
          () => new WorkflowRunManager({ backend, executor, [option]: value }),
          Error,
          option,
        );
      }
    }

    for (const stalledThreshold of [1, 2]) {
      assertThrows(
        () => new WorkflowRunManager({ backend, executor, stalledThreshold }),
        Error,
        "at least 3",
      );
    }

    for (const maxConcurrentExecutions of [0, -1, 0.5, Number.NaN]) {
      assertThrows(
        () => new WorkflowRunManager({ backend, executor, maxConcurrentExecutions }),
        Error,
        "maxConcurrentExecutions",
      );
    }
  });

  it("assigns a stable, prefixed manager id", () => {
    const { manager } = makeManager();
    track(manager);
    const id = manager.getManagerId();
    assertEquals(id.startsWith("mgr"), true);
    // Stable across calls.
    assertEquals(manager.getManagerId(), id);
    // getStats reports the same id.
    assertEquals(manager.getStats().managerId, id);
  });

  it("starts idle and reports idle stats before start()", () => {
    const { manager } = makeManager();
    track(manager);
    const stats = manager.getStats();
    assertEquals(stats.status, "idle");
    assertEquals(stats.pollCount, 0);
    assertEquals(stats.activeExecutions, 0);
    assertEquals(stats.pendingCleanupExecutions, 0);
    assertEquals(stats.startedAt, undefined);
  });

  it("start() transitions to running, initializes the executor, and records startedAt", async () => {
    const executor = new FakeRunExecutor();
    const { manager } = makeManager(executor);
    track(manager);

    await manager.start();

    const stats = manager.getStats();
    assertEquals(stats.status, "running");
    assertEquals(executor.initializeCalls, 1);
    assertExists(stats.startedAt);
  });

  it("start() throws if already running", async () => {
    const executor = new FakeRunExecutor();
    const { manager } = makeManager(executor);
    track(manager);
    await manager.start();

    const rejected = manager.start().then(
      () => false,
      () => true,
    );
    assertEquals(await rejected, true);
    assertEquals(manager.getStats().status, "running");
    // The rejected second start() must not re-initialize the executor.
    assertEquals(executor.initializeCalls, 1);
  });

  it("tears down partial executor state and becomes terminal after initialization fails", async () => {
    const executor = new PartiallyFailingInitializeExecutor();
    const { manager } = makeManager(executor);
    track(manager);

    await assertRejects(() => manager.start(), Error, "partial initialization failed");

    assertEquals(executor.initializeCalls, 1);
    assertEquals(executor.destroyCalls, 1);
    assertEquals(executor.open, false);
    assertEquals(manager.getStats().status, "stopped");
    await assertRejects(() => manager.start(), Error, "cannot restart");
  });

  it("keeps failed initialization cleanup retryable through stop()", async () => {
    const executor = new PartiallyFailingInitializeExecutor();
    executor.cleanupFailuresRemaining = 1;
    const { manager } = makeManager(executor);
    track(manager);

    await assertRejects(() => manager.start(), Error, "cleanup both failed");
    assertEquals(manager.getStats().status, "stopping");
    assertEquals(executor.open, true);

    await manager.stop();
    assertEquals(executor.destroyCalls, 2);
    assertEquals(executor.open, false);
    assertEquals(manager.getStats().status, "stopped");
  });

  it("single-flights initialization and lets stop join startup", async () => {
    const executor = new GatedInitializeExecutor();
    const { manager } = makeManager(executor);
    track(manager);

    const firstStart = manager.start();
    await executor.initializeStarted.promise;
    const secondStart = manager.start();
    assertEquals(executor.initializeCalls, 1);
    assertEquals(manager.getStats().status, "starting");

    const stopping = manager.stop();
    assertEquals(manager.getStats().status, "stopping");
    executor.continueInitialize.resolve();
    await Promise.all([firstStart, secondStart, stopping]);

    assertEquals(executor.initializeCalls, 1);
    assertEquals(executor.destroyCalls, 1);
    assertEquals(manager.getStats().status, "stopped");
  });

  it("rejects restart after executor teardown", async () => {
    const { manager } = makeManager();
    track(manager);
    await manager.start();
    await manager.stop();

    await assertRejects(() => manager.start(), Error, "cannot restart");
    assertEquals(manager.getStats().status, "stopped");
  });

  it("stop() transitions running → stopped and destroys the executor", async () => {
    const executor = new FakeRunExecutor();
    const { manager } = makeManager(executor);
    track(manager);
    await manager.start();
    await manager.stop();

    assertEquals(manager.getStats().status, "stopped");
    assertEquals(executor.destroyCalls, 1);
  });

  it("joins an in-flight poll before executor teardown and admits no new run", async () => {
    const executor = new FakeRunExecutor();
    const backend = new GatedListBackend();
    const manager = new WorkflowRunManager({ backend, executor, pollInterval: NO_POLL });
    track(manager);
    const run = createPendingRun("run-stop-during-poll");
    await backend.createRun(run);
    await manager.start();

    const polling = pollOnce(manager);
    await backend.listStarted.promise;
    const stopping = manager.stop();
    backend.continueList.resolve();
    await Promise.all([polling, stopping]);

    assertEquals(executor.created.length, 0);
    assertEquals(executor.destroyCalls, 1);
    assertEquals((await backend.getRun(run.id))?.status, "pending");
    assertEquals(manager.getActiveExecutions(), []);
    assertEquals(manager.getStats().activeExecutions, 0);
  });

  it("closes admission after an in-flight pending-lock acquisition", async () => {
    const executor = new FakeRunExecutor();
    const backend = new GatedAcquireBackend();
    const manager = new WorkflowRunManager({ backend, executor, pollInterval: NO_POLL });
    track(manager);
    const run = createPendingRun("run-stop-during-lock-acquisition");
    await backend.createRun(run);
    await manager.start();

    const polling = pollOnce(manager);
    await backend.acquireStarted.promise;
    const stopping = manager.stop();
    backend.continueAcquire.resolve();
    await Promise.all([polling, stopping]);

    assertEquals(executor.created.length, 0);
    assertEquals((await backend.getRun(run.id))?.status, "pending");
    assertEquals(await backend.isLocked(run.id), false);
    assertEquals(manager.getStats().status, "stopped");
  });

  it("requeues an execution admitted before stop after teardown", async () => {
    const executor = new GatedCreateExecutor();
    const { backend, manager } = makeManager(executor);
    track(manager);
    const run = createPendingRun("run-stop-after-create-invocation");
    await backend.createRun(run);
    await manager.start();

    const polling = pollOnce(manager);
    await executor.createStarted.promise;
    const stopping = manager.stop();
    executor.continueCreate.resolve();
    await Promise.all([polling, stopping]);

    assertEquals(executor.created.length, 1);
    assertEquals(executor.destroyCalls, 1);
    assertEquals((await backend.getRun(run.id))?.status, "pending");
    assertEquals(manager.getActiveExecutions(), []);
  });

  it("requeues an ambiguous rejected child only after executor teardown", async () => {
    const executor = new AmbiguousCreateFailureExecutor();
    const { backend, manager } = makeManager(executor);
    track(manager);
    const run = createPendingRun("run-ambiguous-create-cleanup");
    await backend.createRun(run);
    await manager.start();

    await pollOnce(manager);
    const rejectedOwner = await backend.getRun(run.id);
    assertEquals(rejectedOwner?.status, "running");
    assertEquals(rejectedOwner?.workerId?.startsWith("run-execution:"), true);
    assertEquals(manager.getStats().pendingCleanupExecutions, 1);

    await manager.stop();

    assertEquals(executor.destroyCalls, 1);
    assertEquals((await backend.getRun(run.id))?.status, "pending");
    assertEquals(manager.getActiveExecutions(), []);
    assertEquals(manager.getStats().pendingCleanupExecutions, 0);
    assertEquals(
      await executor.getRunExecutionStatus(
        rejectedOwner?.workerId?.replace("run-execution:", "") ?? "",
      ),
      null,
    );
  });

  it("counts ambiguous cleanup candidates against the concurrency limit", async () => {
    const executor = new AmbiguousCreateFailureExecutor();
    executor.cleanupFailuresRemaining = 10;
    const backend = new MemoryBackend();
    const manager = new WorkflowRunManager({
      backend,
      executor,
      pollInterval: NO_POLL,
      maxConcurrentExecutions: 1,
    });
    track(manager);
    await backend.createRun(createPendingRun("run-cleanup-capacity-a"));
    await manager.start();
    await pollOnce(manager);
    assertEquals(manager.getStats().pendingCleanupExecutions, 1);

    await backend.createRun(createPendingRun("run-cleanup-capacity-b"));
    await pollOnce(manager);

    assertEquals(executor.created.length, 1);
    assertEquals((await backend.getRun("run-cleanup-capacity-b"))?.status, "pending");
    assertEquals(manager.getStats().pendingCleanupExecutions, 1);

    // Let afterEach exercise the shutdown drain after this test has proved that
    // repeated live cleanup failures retain the concurrency slot.
    executor.cleanupFailuresRemaining = 0;
  });

  it("retries a retained failed-claim teardown before releasing its concurrency slot", async () => {
    const executor = new FirstCreateAcknowledgementFailureExecutor();
    const backend = new RetainedClaimCompensationBackend();
    const manager = new WorkflowRunManager({
      backend,
      executor,
      pollInterval: NO_POLL,
      maxConcurrentExecutions: 1,
    });
    track(manager);
    const firstRun = createPendingRun("run-retained-claim-retry-a");
    await backend.createRun(firstRun);
    await manager.start();

    await pollOnce(manager);
    const firstExecutionId = executor.created[0]?.executionId;
    assertExists(firstExecutionId);
    const firstOwner = `run-execution:${firstExecutionId}`;
    assertEquals(manager.getStats().pendingCleanupExecutions, 1);
    assertEquals(executor.deletedExecutionIds, [firstExecutionId]);
    assertEquals((await backend.getRun(firstRun.id))?.workerId, firstOwner);

    backend.retainedOwnerRequeueFailuresRemaining = 1;
    await backend.createRun(createPendingRun("run-retained-claim-retry-b"));
    await pollOnce(manager);

    assertEquals(executor.createAttempts, 1);
    assertEquals(executor.deletedExecutionIds, [firstExecutionId, firstExecutionId]);
    assertEquals(backend.retainedOwnerRequeueAttempts, [firstOwner]);
    assertEquals(manager.getStats().pendingCleanupExecutions, 1);
    assertEquals((await backend.getRun("run-retained-claim-retry-b"))?.status, "pending");

    await pollOnce(manager);

    assertEquals(executor.createAttempts, 2);
    assertEquals(
      executor.deletedExecutionIds,
      [firstExecutionId, firstExecutionId, firstExecutionId],
    );
    assertEquals(backend.retainedOwnerRequeueAttempts, [firstOwner, firstOwner]);
    assertEquals(manager.getStats().pendingCleanupExecutions, 0);
    assertEquals(manager.getStats().activeExecutions, 1);
    const retriedRuns = [
      await backend.getRun(firstRun.id),
      await backend.getRun("run-retained-claim-retry-b"),
    ];
    assertEquals(retriedRuns.filter((run) => run?.status === "running").length, 1);
    assertEquals(retriedRuns.filter((run) => run?.status === "pending").length, 1);
  });

  it("keeps retained teardown retryable when stop cannot requeue its exact owner", async () => {
    const executor = new FirstCreateAcknowledgementFailureExecutor();
    const backend = new RetainedClaimCompensationBackend();
    const manager = new WorkflowRunManager({ backend, executor, pollInterval: NO_POLL });
    track(manager);
    const run = createPendingRun("run-retained-claim-stop-retry");
    await backend.createRun(run);
    await manager.start();
    await pollOnce(manager);

    const executionId = executor.created[0]?.executionId;
    assertExists(executionId);
    const expectedOwner = `run-execution:${executionId}`;
    backend.retainedOwnerRequeueFailuresRemaining = 1;

    const stopError = await assertRejects(
      () => manager.stop(),
      Error,
      `Could not drain retained workflow execution "${executionId}"`,
    );
    assertEquals(manager.getStats().status, "stopping");
    assertEquals(manager.getStats().pendingCleanupExecutions, 1);
    assertEquals(executor.destroyCalls, 1);
    assertEquals(executor.deletedExecutionIds, [executionId, executionId]);
    assertEquals(backend.retainedOwnerRequeueAttempts, [expectedOwner]);
    if (!(stopError instanceof Error)) throw new Error("Expected workflow teardown error");
    const cause = stopError.cause;
    assertEquals(cause instanceof AggregateError, true);
    if (!(cause instanceof AggregateError)) throw new Error("Expected aggregated teardown errors");
    assertEquals(
      cause.errors.map((error) => error instanceof Error ? error.message : String(error)),
      [
        `Could not compensate rejected run execution "${executionId}"`,
        "transient retained-owner requeue rejection",
      ],
    );

    await manager.stop();

    assertEquals(manager.getStats().status, "stopped");
    assertEquals(manager.getStats().pendingCleanupExecutions, 0);
    assertEquals(executor.destroyCalls, 1);
    assertEquals(executor.deletedExecutionIds, [executionId, executionId, executionId]);
    assertEquals(backend.retainedOwnerRequeueAttempts, [expectedOwner, expectedOwner]);
    assertEquals((await backend.getRun(run.id))?.status, "pending");
  });

  it("clears tracked executions after executor teardown", async () => {
    const executor = new FakeRunExecutor();
    const { backend, manager } = makeManager(executor);
    track(manager);
    await backend.createRun(createPendingRun("run-active-at-stop"));
    await manager.start();
    await pollOnce(manager);
    assertEquals(manager.getStats().activeExecutions, 1);

    await manager.stop();
    assertEquals(manager.getActiveExecutions(), []);
    assertEquals(manager.getStats().activeExecutions, 0);
    assertEquals((await backend.getRun("run-active-at-stop"))?.status, "pending");
  });

  it("does not requeue a replacement owner that takes over during executor teardown", async () => {
    const executor = new GatedDestroyExecutor();
    const { backend, manager } = makeManager(executor);
    track(manager);
    const run = createPendingRun("run-replaced-at-stop");
    await backend.createRun(run);
    await manager.start();
    await pollOnce(manager);
    const stopping = manager.stop();
    await executor.destroyStarted.promise;
    await backend.updateRun(run.id, {
      status: "running",
      workerId: "run-execution:replacement",
    });
    executor.continueDestroy.resolve();

    await stopping;

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, "run-execution:replacement");
    assertEquals(manager.getActiveExecutions(), []);
  });

  it("rejects backends without the complete managed-worker capability group", () => {
    const backend = new MemoryBackend();
    Object.defineProperty(backend, "extendLock", { value: undefined });
    assertThrows(
      () => new WorkflowRunManager({ backend, executor: new FakeRunExecutor() }),
      Error,
      "does not support managed workflow execution",
    );
  });

  it("stop() remains retryable when executor cleanup fails", async () => {
    const executor = new FakeRunExecutor();
    const cleanupError = new Error("transient executor cleanup failure");
    executor.destroy = () => {
      executor.destroyCalls++;
      return executor.destroyCalls === 1 ? Promise.reject(cleanupError) : Promise.resolve();
    };
    const { manager } = makeManager(executor);
    track(manager);
    await manager.start();

    await assertRejects(() => manager.stop(), Error, cleanupError.message);
    assertEquals(manager.getStats().status, "stopping");

    await manager.stop();
    assertEquals(manager.getStats().status, "stopped");
    assertEquals(executor.destroyCalls, 2);
  });

  it("stop() is a no-op when not running", async () => {
    const executor = new FakeRunExecutor();
    const { manager } = makeManager(executor);
    track(manager);
    // Never started.
    await manager.stop();
    assertEquals(manager.getStats().status, "idle");
    assertEquals(executor.destroyCalls, 0);
  });

  it("getActiveExecutions is empty for an idle manager", () => {
    const { manager } = makeManager();
    track(manager);
    assertEquals(manager.getActiveExecutions(), []);
  });

  it("getStats returns a deeply defensive snapshot", async () => {
    const { manager } = makeManager();
    track(manager);
    await manager.start();
    const a = manager.getStats();
    const b = manager.getStats();
    assertEquals(a === b, false);
    assertEquals(a, b);
    // Mutating a returned snapshot must not corrupt the manager's internal state.
    a.pollCount = 999;
    a.status = "stopped";
    a.startedAt?.setTime(0);
    const fresh = manager.getStats();
    assertEquals(fresh.pollCount, 0);
    assertEquals(fresh.status, "running");
    assertEquals(fresh.startedAt?.getTime() === 0, false);
  });

  it("reconciles an expired durable delay before admitting pending work", async () => {
    const executor = new FakeRunExecutor();
    const { backend, manager } = makeManager(executor);
    track(manager);
    const run = createExpiredTimedWaitRun("run-expired-delay", "delay");
    await backend.createRun(run);
    await manager.start();

    await pollOnce(manager);

    assertEquals(executor.created.length, 1);
    assertEquals(executor.created[0]?.run.id, run.id);
    assertEquals(executor.created[0]?.run.nodeStates.pause?.status, "completed");
    assertEquals(executor.created[0]?.run.currentNodes, ["pause"]);
    assertEquals((await backend.getRun(run.id))?.status, "running");
  });

  it("durably fails an expired event wait without starting an execution", async () => {
    const executor = new FakeRunExecutor();
    const { backend, manager } = makeManager(executor);
    track(manager);
    const run = createExpiredTimedWaitRun("run-expired-event", "event");
    await backend.createRun(run);
    await manager.start();

    await pollOnce(manager);

    const failed = await backend.getRun(run.id);
    assertEquals(executor.created.length, 0);
    assertEquals(failed?.status, "failed");
    assertEquals(failed?.nodeStates.pause?.status, "failed");
    assertEquals(failed?.error?.message, 'Wait node "pause" timed out after 5ms');
  });

  it("advances a bounded recovery cursor past stable non-due waiting pages", async () => {
    const backend = new VirtualPagedRecoveryBackend();
    const executor = new FakeRunExecutor();
    const manager = track(
      new WorkflowRunManager({ backend, executor, pollInterval: NO_POLL }),
    );
    const target = {
      ...createExpiredTimedWaitRun("run-after-full-wait-page", "delay"),
      createdAt: new Date(0),
    };
    await backend.createRun(target);
    await manager.start();

    await pollOnce(manager);
    assertEquals(executor.created.length, 0);
    assertEquals((await backend.getRun(target.id))?.status, "waiting");

    await pollOnce(manager);
    assertEquals(backend.cursors.length, 2);
    assertExists(backend.cursors[1]);
    assertEquals(executor.created.length, 1);
    assertEquals(executor.created[0]?.run.id, target.id);
  });

  it("rejects duplicate or out-of-order recovery pages without advancing work", async () => {
    const backend = new MalformedPagedRecoveryBackend();
    const executor = new FakeRunExecutor();
    const manager = track(
      new WorkflowRunManager({ backend, executor, pollInterval: NO_POLL }),
    );
    await manager.start();

    await pollOnce(manager);

    assertEquals(executor.created.length, 0);
    assertEquals(
      manager.getStats().lastError?.includes("duplicate or out-of-order"),
      true,
    );
  });

  it("poll() claims a pending run, starts one isolated execution, and releases the pending lock", async () => {
    const executor = new FakeRunExecutor();
    const { backend, manager } = makeManager(executor);
    track(manager);
    const run = createPendingRun("run-pending");
    await backend.createRun(run);
    await manager.start();

    await pollOnce(manager);

    const updatedRun = await backend.getRun(run.id);
    assertExists(updatedRun);
    assertEquals(executor.created.length, 1);
    assertEquals(executor.created[0]?.run.id, run.id);
    assertEquals(updatedRun.status, "running");
    assertEquals(updatedRun.workerId?.startsWith("run-execution:run_exec"), true);
    assertEquals(await backend.isLocked(run.id), false);
    assertEquals(manager.getActiveExecutions().length, 1);
    const leaked = manager.getActiveExecutions();
    leaked[0]!.status = "failed";
    leaked[0]!.createdAt.setTime(0);
    assertEquals(manager.getActiveExecutions()[0]?.status, "pending");
    assertEquals(manager.getActiveExecutions()[0]?.createdAt.getTime() === 0, false);
    assertEquals(manager.getStats().executionsCreated, 1);
  });

  it("restores the persisted source policy while creating an isolated execution", async () => {
    const executor = new FakeRunExecutor();
    const { backend, manager } = makeManager(executor);
    track(manager);
    const sourceIntegrationPolicy = normalizeSourceIntegrationPolicy({
      allow: { confluence: { allowedTools: ["get_page"] } },
    });
    const run = {
      ...createPendingRun("run-source-policy"),
      sourceIntegrationPolicy,
    };
    await backend.createRun(run);
    await manager.start();

    await pollOnce(manager);

    assertEquals(executor.created.length, 1);
    assertEquals(executor.observedSourceIntegrationPolicies, [sourceIntegrationPolicy]);
  });

  it("fails a run with no source policy snapshot before creating an isolated execution", async () => {
    const executor = new FakeRunExecutor();
    const backend = new MissingPolicyOnListBackend();
    const manager = new WorkflowRunManager({ backend, executor, pollInterval: NO_POLL });
    track(manager);
    const run = createPendingRun("run-missing-source-policy");
    await backend.createRun(run);
    await manager.start();

    await pollOnce(manager);

    const storedRun = await backend.getRun(run.id);
    assertEquals(executor.created.length, 0);
    assertExists(storedRun);
    assertEquals(storedRun.status, "failed");
    assertEquals(
      storedRun.error?.message.includes("source integration policy snapshot"),
      true,
    );
  });

  it("poll() records execution creation failures in manager stats and failed run state", async () => {
    const executor = new FailingRunExecutor();
    const { backend, manager } = makeManager(executor);
    track(manager);
    const run = createPendingRun("run-create-failure");
    await backend.createRun(run);
    await manager.start();

    await pollOnce(manager);

    const updatedRun = await backend.getRun(run.id);
    assertExists(updatedRun);
    assertEquals(updatedRun.status, "failed");
    assertEquals(updatedRun.error?.message.includes("RUN_EXECUTION_CREATION_FAILED"), true);
    assertEquals(await backend.isLocked(run.id), false);
    assertEquals(manager.getActiveExecutions(), []);
    assertEquals(manager.getStats().executionsFailed, 1);
  });

  it("createWorkflowRunManager builds a WorkflowRunManager", () => {
    const manager = createWorkflowRunManager({
      backend: new MemoryBackend(),
      executor: new FakeRunExecutor(),
      pollInterval: NO_POLL,
    });
    track(manager);
    assertEquals(manager instanceof WorkflowRunManager, true);
    assertEquals(manager.getManagerId().startsWith("mgr"), true);
  });
});
