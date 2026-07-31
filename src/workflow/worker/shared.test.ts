import "#veryfront/schemas/_test-setup.ts";
import {
  getCurrentRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { WorkflowRunUpdate } from "../backends/types.ts";
import { delay, waitForApproval, workflow } from "../dsl/index.ts";
import type { WorkflowRun } from "../types.ts";
import {
  acquireRunExecutionLock,
  captureWorkflowRunEntrypointOptions,
  createIsolatedWorkflowRuntime,
  createWorkflowRunEntrypointHandle,
  destroyOwnedWorkflowRunEntrypointResources,
  failRunExecution,
  getFinalRunExitCode,
  hydrateRunContextEnv,
  runWithTenantContext,
} from "./shared.ts";

const ENV_KEYS = [
  "VERYFRONT_TASK_ENV_JSON",
  "WORKFLOW_RUN_ID",
  "RUN_EXECUTION_ID",
  "WORKFLOW_LOCK_DURATION_MS",
  "WORKFLOW_LOCK_ACQUISITION_TIMEOUT_MS",
  "WORKFLOW_LOCK_RETRY_INTERVAL_MS",
] as const;

const savedEnv = new Map<string, string | undefined>();

function rememberEnv(): void {
  for (const key of ENV_KEYS) {
    if (!savedEnv.has(key)) {
      savedEnv.set(key, Deno.env.get(key));
    }
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
  savedEnv.clear();
}

function createLogger() {
  return {
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  };
}

function createRun(id: string, status: WorkflowRun["status"], workerId?: string): WorkflowRun {
  return {
    id,
    workflowId: "workflow-1",
    status,
    input: {},
    nodeStates: {},
    currentNodes: [],
    context: { input: {} },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date(),
    sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
    workerId,
  };
}

describe("workflow worker shared helpers", () => {
  afterEach(() => {
    restoreEnv();
  });

  function configureExecutionLockPolicy(): void {
    rememberEnv();
    Deno.env.set("WORKFLOW_LOCK_DURATION_MS", "30000");
    Deno.env.set("WORKFLOW_LOCK_ACQUISITION_TIMEOUT_MS", "100");
    Deno.env.set("WORKFLOW_LOCK_RETRY_INTERVAL_MS", "1");
  }

  it("releases an acquired token when the ownership admission CAS rejects", async () => {
    class RejectingAdmissionBackend extends MemoryBackend {
      releaseCalls = 0;

      override updateRunIfStatusAndLock(): Promise<boolean> {
        return Promise.reject(new Error("admission CAS failed"));
      }

      override releaseLock(runId: string, lockId: string): Promise<boolean> {
        this.releaseCalls++;
        return super.releaseLock(runId, lockId);
      }
    }

    configureExecutionLockPolicy();
    const backend = new RejectingAdmissionBackend();
    const workerId = "run-execution:admission-owner";
    const run = createRun("admission-cas-rejects", "running", workerId);
    await backend.createRun(run);

    await assertRejects(
      () => acquireRunExecutionLock(backend, run.id, workerId),
      Error,
      "admission CAS failed",
    );
    assertEquals(backend.releaseCalls, 1);
    assertEquals(await backend.isLocked(run.id), false);
  });

  it("preserves both admission and exact-token cleanup failures", async () => {
    class DoublyFailingAdmissionBackend extends MemoryBackend {
      override updateRunIfStatusAndLock(): Promise<boolean> {
        return Promise.reject(new Error("primary admission failure"));
      }

      override releaseLock(): Promise<boolean> {
        return Promise.reject(new Error("exact-token cleanup failure"));
      }
    }

    configureExecutionLockPolicy();
    const backend = new DoublyFailingAdmissionBackend();
    const workerId = "run-execution:dual-failure-owner";
    const run = createRun("admission-dual-failure", "running", workerId);
    await backend.createRun(run);

    const error = await assertRejects(
      () => acquireRunExecutionLock(backend, run.id, workerId),
      AggregateError,
      "admission and cleanup both failed",
    );
    if (!(error instanceof AggregateError)) throw error;
    assertEquals(
      error.errors.map((entry: unknown) => entry instanceof Error ? entry.message : String(entry)),
      ["primary admission failure", "exact-token cleanup failure"],
    );
  });

  it("fails closed when unadmitted token release is non-boolean", async () => {
    class MalformedReleaseBackend extends MemoryBackend {
      override updateRunIfStatusAndLock(): Promise<boolean> {
        return Promise.resolve(false);
      }

      override releaseLock(): Promise<boolean> {
        return Promise.resolve("released" as unknown as boolean);
      }
    }

    configureExecutionLockPolicy();
    const backend = new MalformedReleaseBackend();
    const workerId = "run-execution:malformed-release-owner";
    const run = createRun("admission-malformed-release", "running", workerId);
    await backend.createRun(run);

    const error = await assertRejects(
      () => acquireRunExecutionLock(backend, run.id, workerId),
      AggregateError,
      "admission and cleanup both failed",
    );
    if (!(error instanceof AggregateError)) throw error;
    assertEquals(
      error.errors.some((entry: unknown) =>
        entry instanceof Error && entry.message.includes("non-boolean lock release result")
      ),
      true,
    );
  });

  it("rejects proxied entrypoint options without evaluating traps", () => {
    let hookCalls = 0;
    const options = new Proxy({ debug: false }, {
      get() {
        hookCalls++;
        throw new Error("get trap must not run");
      },
      getOwnPropertyDescriptor() {
        hookCalls++;
        throw new Error("descriptor trap must not run");
      },
      getPrototypeOf() {
        hookCalls++;
        throw new Error("prototype trap must not run");
      },
      ownKeys() {
        hookCalls++;
        throw new Error("ownKeys trap must not run");
      },
    });

    assertThrows(
      () => captureWorkflowRunEntrypointOptions(options, "Test entrypoint"),
      Error,
      "non-Proxy plain record",
    );
    assertEquals(hookCalls, 0);
  });

  it("admits only exact enumerable data-property entrypoint options without getters", () => {
    let getterCalls = 0;
    const accessorOptions = Object.defineProperty({}, "debug", {
      enumerable: true,
      get() {
        getterCalls++;
        return false;
      },
    });
    assertThrows(
      () => captureWorkflowRunEntrypointOptions(accessorOptions, "Test entrypoint"),
      Error,
      "enumerable own data property",
    );
    assertEquals(getterCalls, 0);

    assertThrows(
      () =>
        captureWorkflowRunEntrypointOptions(
          { debug: false, unsupported: true },
          "Test entrypoint",
        ),
      Error,
      "unsupported fields",
    );
    assertThrows(
      () =>
        captureWorkflowRunEntrypointOptions(
          Object.defineProperty({}, "debug", { value: false }),
          "Test entrypoint",
        ),
      Error,
      "enumerable own data property",
    );
  });

  it("returns a detached immutable entrypoint option snapshot", () => {
    const options = { debug: false };
    const captured = captureWorkflowRunEntrypointOptions(options, "Test entrypoint");

    options.debug = true;

    assertEquals(captured.debug, false);
    assertEquals(captured.options.debug, false);
    assertEquals(Object.isFrozen(captured), true);
    assertEquals(Object.isFrozen(captured.options), true);
  });

  it("restores branch context while executing workflow work", async () => {
    await runWithTenantContext(
      {
        projectSlug: "acme",
        token: "secret",
        projectId: "project-123",
        productionMode: false,
        releaseId: null,
        branch: "branch-123",
      },
      async () => {
        const context = getCurrentRequestContext();
        assertEquals(context?.branch, "branch-123");
      },
    );
  });

  it("maps only completed and waiting runs to the success exit code", () => {
    const logger = createLogger();
    const exitCodes = { SUCCESS: 0, WORKFLOW_FAILED: 1 };

    assertEquals(
      getFinalRunExitCode(logger, exitCodes, "run-1", { status: "completed" } as never, false),
      0,
    );
    assertEquals(
      getFinalRunExitCode(logger, exitCodes, "run-1", { status: "waiting" } as never, false),
      0,
    );
  });

  it("fails closed for missing, active, and cancelled final run states", () => {
    const logger = createLogger();
    const exitCodes = { SUCCESS: 0, WORKFLOW_FAILED: 1 };

    assertEquals(getFinalRunExitCode(logger, exitCodes, "run-1", null, false), 1);
    for (const status of ["pending", "running", "cancelled"] as const) {
      assertEquals(
        getFinalRunExitCode(logger, exitCodes, "run-1", { status } as never, false),
        1,
      );
    }
  });

  it("maps failed runs to the failure exit code", () => {
    const logger = createLogger();
    const exitCodes = { SUCCESS: 0, WORKFLOW_FAILED: 1 };

    assertEquals(
      getFinalRunExitCode(logger, exitCodes, "run-1", { status: "failed" } as never, false),
      1,
    );
  });

  it("persists approvals before an isolated executor returns a waiting run", async () => {
    const backend = new MemoryBackend();
    const workerId = "run-execution:approval-owner";
    const runtime = createIsolatedWorkflowRuntime(backend);
    runtime.executor.register(
      workflow({
        id: "workflow-1",
        steps: [waitForApproval("review", { message: "Review required" })],
      }).definition,
    );
    const run = createRun("run-approval", "running", workerId);
    await backend.createRun(run);

    await runtime.executor.resume(run.id, undefined, workerId);

    assertEquals((await backend.getRun(run.id))?.status, "waiting");
    const approvals = await backend.getPendingApprovals(run.id);
    assertEquals(approvals.length, 1);
    assertEquals(approvals[0]?.nodeId, "review");
    assertEquals(approvals[0]?.message, "Review required");
    await runtime.destroy();
  });

  it("preserves a timed wait when an isolated runtime is normally destroyed", async () => {
    const backend = new MemoryBackend();
    const workerId = "run-execution:timed-wait-owner";
    const runtime = createIsolatedWorkflowRuntime(backend);
    runtime.executor.register(
      workflow({
        id: "workflow-1",
        steps: [delay("pause", 60_000)],
      }).definition,
    );
    const run = createRun("run-timed-wait", "running", workerId);
    await backend.createRun(run);

    await runtime.executor.resume(run.id, undefined, workerId);
    assertEquals((await backend.getRun(run.id))?.status, "waiting");

    await runtime.destroy();

    assertEquals((await backend.getRun(run.id))?.status, "waiting");
    assertEquals((await backend.getRun(run.id))?.nodeStates.pause?.status, "running");
  });

  it("destroys an isolated runtime without destroying its borrowed backend", async () => {
    class BorrowedBackend extends MemoryBackend {
      destroyCalls = 0;

      override destroy(): Promise<void> {
        this.destroyCalls++;
        return Promise.resolve();
      }
    }

    const backend = new BorrowedBackend();
    const runtime = createIsolatedWorkflowRuntime(backend);
    await runtime.destroy();
    await runtime.destroy();

    assertEquals(backend.destroyCalls, 0);
    assertEquals(await backend.healthCheck(), true);
    await assertRejects(
      () => runtime.executor.resume("closed-runtime"),
      Error,
      "workflow executor is closed",
    );
  });

  it("makes managed entrypoints one-shot and joins their raw run before cleanup", async () => {
    const runGate = Promise.withResolvers<void>();
    let cleanupCalls = 0;
    let destroySettled = false;
    const entrypoint = createWorkflowRunEntrypointHandle(
      async () => {
        await runGate.promise;
        return 17;
      },
      () => {
        cleanupCalls++;
        return Promise.resolve();
      },
    );

    const run = entrypoint();
    await assertRejects(() => entrypoint(), Error, "it is running");
    const destroy = entrypoint.destroy().then(() => {
      destroySettled = true;
    });
    await Promise.resolve();
    assertEquals(destroySettled, false);
    assertEquals(cleanupCalls, 0);

    runGate.resolve();
    assertEquals(await run, 17);
    await destroy;
    assertEquals(cleanupCalls, 1);
    await entrypoint.destroy();
    assertEquals(cleanupCalls, 1);
    await assertRejects(() => entrypoint(), Error, "it is closed");
  });

  it("admits run identity before same-stack environment mutation", async () => {
    rememberEnv();
    Deno.env.set("WORKFLOW_RUN_ID", "admitted-run");
    Deno.env.set("RUN_EXECUTION_ID", "admitted-execution");
    let capturedIdentity: string[] | undefined;
    const entrypoint = createWorkflowRunEntrypointHandle(
      async () => {
        capturedIdentity = [
          Deno.env.get("WORKFLOW_RUN_ID") ?? "",
          Deno.env.get("RUN_EXECUTION_ID") ?? "",
        ];
        await Promise.resolve();
        return 0;
      },
      () => Promise.resolve(),
    );

    const execution = entrypoint();
    Deno.env.set("WORKFLOW_RUN_ID", "redirected-run");
    Deno.env.set("RUN_EXECUTION_ID", "redirected-execution");

    assertEquals(await execution, 0);
    assertEquals(capturedIdentity, ["admitted-run", "admitted-execution"]);
  });

  it("can destroy an unused entrypoint and retry failed cleanup", async () => {
    let cleanupCalls = 0;
    const entrypoint = createWorkflowRunEntrypointHandle(
      () => Promise.resolve(0),
      () => {
        cleanupCalls++;
        return cleanupCalls === 1 ? Promise.reject(new Error("cleanup failed")) : Promise.resolve();
      },
    );

    await assertRejects(() => entrypoint.destroy(), Error, "cleanup failed");
    await entrypoint.destroy();
    assertEquals(cleanupCalls, 2);
    await assertRejects(() => entrypoint(), Error, "it is closed");
  });

  it("preserves entrypoint execution and cleanup failures", async () => {
    const entrypoint = createWorkflowRunEntrypointHandle(
      () => Promise.reject(new Error("execution failed")),
      () => Promise.reject(new Error("cleanup failed")),
    );

    const failure = await assertRejects(
      () => entrypoint(),
      AggregateError,
      "execution and cleanup failed",
    ) as AggregateError;
    assertEquals(
      failure.errors.map((error) => error instanceof Error ? error.message : String(error)),
      ["execution failed", "cleanup failed"],
    );
  });

  it("never closes an owned backend until runtime cleanup succeeds", async () => {
    class OwnedBackend extends MemoryBackend {
      destroyCalls = 0;

      override destroy(): Promise<void> {
        this.destroyCalls++;
        return Promise.resolve();
      }
    }

    const backend = new OwnedBackend();
    let runtimeDestroyCalls = 0;
    const runtime = {
      executor: {} as never,
      destroy(): Promise<void> {
        runtimeDestroyCalls++;
        return runtimeDestroyCalls === 1
          ? Promise.reject(new Error("runtime cleanup failed"))
          : Promise.resolve();
      },
    };
    const entrypoint = createWorkflowRunEntrypointHandle(
      () => Promise.resolve(0),
      () => destroyOwnedWorkflowRunEntrypointResources(backend, runtime),
    );

    await assertRejects(() => entrypoint(), Error, "runtime cleanup failed");
    assertEquals(runtimeDestroyCalls, 1);
    assertEquals(backend.destroyCalls, 0);

    await entrypoint.destroy();
    assertEquals(runtimeDestroyCalls, 2);
    assertEquals(backend.destroyCalls, 1);
  });

  it("does not fail cancelled, completed, or waiting runs after execution errors", async () => {
    const exitCodes = { SUCCESS: 0, WORKFLOW_FAILED: 1 };

    for (const status of ["cancelled", "completed", "waiting"] as const) {
      const backend = new MemoryBackend();
      const run = createRun(`run-${status}`, status);
      await backend.createRun(run);

      assertEquals(
        await failRunExecution(backend, createLogger(), exitCodes, run.id, new Error("late")),
        1,
      );
      const persisted = await backend.getRun(run.id);
      assertEquals(persisted?.status, status);
      assertEquals(persisted?.error, undefined);
    }
  });

  it("does not fail a run claimed by a new owner after lock loss", async () => {
    const backend = new MemoryBackend();
    const run = createRun("run-new-owner", "running", "run-execution:new-owner");
    await backend.createRun(run);

    assertEquals(
      await failRunExecution(
        backend,
        createLogger(),
        { SUCCESS: 0, WORKFLOW_FAILED: 1 },
        run.id,
        new Error("lost lock"),
        "run-execution:old-owner",
      ),
      1,
    );

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, "run-execution:new-owner");
    assertEquals(persisted?.error, undefined);
  });

  it("does not fail a run reassigned between the owner check and status update", async () => {
    class ReassignBeforeFailureBackend extends MemoryBackend {
      override async updateRunIfStatusAndWorker(
        runId: string,
        expectedStatuses: WorkflowRun["status"][],
        expectedWorkerId: string,
        patch: Partial<WorkflowRun>,
      ): Promise<boolean> {
        if (patch.status === "failed") {
          await super.updateRun(runId, { workerId: "run-execution:new-owner" });
        }
        return await super.updateRunIfStatusAndWorker(
          runId,
          expectedStatuses,
          expectedWorkerId,
          patch,
        );
      }
    }

    const backend = new ReassignBeforeFailureBackend();
    const run = createRun("run-owner-race", "running", "run-execution:old-owner");
    await backend.createRun(run);

    await failRunExecution(
      backend,
      createLogger(),
      { SUCCESS: 0, WORKFLOW_FAILED: 1 },
      run.id,
      new Error("lost lock"),
      "run-execution:old-owner",
    );

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, "run-execution:new-owner");
    assertEquals(persisted?.error, undefined);
  });

  it("fails environment hydration immediately when lock ownership changes mid-update", async () => {
    class ReassignDuringHydrationBackend extends MemoryBackend {
      replacementToken: string | null = null;

      override async updateRunIfStatusAndLock(
        runId: string,
        expectedStatuses: WorkflowRun["status"][],
        lockId: string,
        patch: WorkflowRunUpdate,
        expectedWorkerId?: string,
      ): Promise<boolean> {
        if (patch.context?.env) {
          await super.releaseLock(runId, lockId);
          this.replacementToken = await super.acquireLock(runId, 30_000);
          await super.updateRun(runId, { workerId: "run-execution:new-owner" });
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

    rememberEnv();
    Deno.env.set("VERYFRONT_TASK_ENV_JSON", JSON.stringify({ MODE: "managed" }));
    const backend = new ReassignDuringHydrationBackend();
    const workerId = "run-execution:old-owner";
    const run = createRun("run-hydration-owner-race", "running", workerId);
    await backend.createRun(run);
    const lockId = await backend.acquireLock(run.id, 30_000);
    if (!lockId) throw new Error("Could not acquire hydration test lock");

    await assertRejects(
      () => hydrateRunContextEnv(backend, run.id, run, workerId, lockId),
      Error,
      "lost execution ownership",
    );
    assertEquals((await backend.getRun(run.id))?.context.env, undefined);
    assertEquals((await backend.getRun(run.id))?.workerId, "run-execution:new-owner");
    if (!backend.replacementToken) throw new Error("Replacement did not acquire hydration lock");
    assertEquals(await backend.releaseLock(run.id, backend.replacementToken), true);
  });
});
