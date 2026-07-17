import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryBackend } from "../backends/memory.ts";
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
    return Promise.resolve();
  }
}

class FailingRunExecutor extends FakeRunExecutor {
  override createRunExecution(_config: RunExecutionConfig): Promise<string> {
    return Promise.reject(new Error("spawn failed"));
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

function pollOnce(manager: WorkflowRunManager): Promise<void> {
  return (manager as unknown as { poll(): Promise<void> }).poll();
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

    let threw = false;
    try {
      await manager.start();
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
    assertEquals(manager.getStats().status, "running");
    // The rejected second start() must not re-initialize the executor.
    assertEquals(executor.initializeCalls, 1);
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

  it("getStats returns a defensive snapshot, not a live reference", () => {
    const { manager } = makeManager();
    track(manager);
    const a = manager.getStats();
    const b = manager.getStats();
    assertEquals(a === b, false);
    assertEquals(a, b);
    // Mutating a returned snapshot must not corrupt the manager's internal state.
    a.pollCount = 999;
    a.status = "stopped";
    const fresh = manager.getStats();
    assertEquals(fresh.pollCount, 0);
    assertEquals(fresh.status, "idle");
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
