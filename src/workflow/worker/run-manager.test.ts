import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { RunExecutionConfig, RunExecutionInfo, RunExecutor } from "./executors/types.ts";
import { createWorkflowRunManager, WorkflowRunManager } from "./run-manager.ts";

/**
 * Minimal in-memory RunExecutor. Records initialize/destroy/create calls so
 * tests can assert lifecycle wiring without spawning real processes.
 */
class FakeRunExecutor implements RunExecutor {
  initializeCalls = 0;
  destroyCalls = 0;
  created: RunExecutionConfig[] = [];
  private executions = new Map<string, RunExecutionInfo>();

  createRunExecution(config: RunExecutionConfig): Promise<string> {
    this.created.push(config);
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

// A poll interval large enough that the first scheduled poll never fires during
// a test; stop() clears the pending timer, so no work runs and no timer leaks.
const NO_POLL = 1_000_000;

function makeManager(executor: RunExecutor = new FakeRunExecutor()) {
  const backend = new MemoryBackend();
  const manager = new WorkflowRunManager({ backend, executor, pollInterval: NO_POLL });
  return { backend, executor, manager };
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
    const { manager } = makeManager();
    track(manager);
    await manager.start();

    let threw = false;
    try {
      await manager.start();
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
    // Executor still initialized exactly once.
    assertEquals(manager.getStats().status, "running");
  });

  it("stop() transitions running → stopped and destroys the executor", async () => {
    const executor = new FakeRunExecutor();
    const { manager } = makeManager(executor);
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
