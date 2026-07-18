import "#veryfront/schemas/_test-setup.ts";
import {
  getCurrentRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { MemoryBackend } from "../backends/memory.ts";
import { waitForApproval, workflow } from "../dsl/index.ts";
import type { WorkflowRun } from "../types.ts";
import {
  createIsolatedWorkflowExecutor,
  failRunExecution,
  getFinalRunExitCode,
  getTenantFromEnv,
  runWithTenantContext,
} from "./shared.ts";

const ENV_KEYS = [
  "TENANT_PROJECT_SLUG",
  "TENANT_TOKEN",
  "TENANT_PROJECT_ID",
  "TENANT_PRODUCTION_MODE",
  "TENANT_RELEASE_ID",
  "TENANT_BRANCH_ID",
  "VERYFRONT_BRANCH_REF",
  "TENANT_ENVIRONMENT_NAME",
  "VERYFRONT_ENVIRONMENT_NAME",
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

  it("reads tenant context from env only when the required values are present", () => {
    rememberEnv();

    Deno.env.delete("TENANT_PROJECT_SLUG");
    Deno.env.delete("TENANT_TOKEN");
    assertEquals(getTenantFromEnv(), undefined);

    Deno.env.set("TENANT_PROJECT_SLUG", "acme");
    Deno.env.set("TENANT_TOKEN", "secret");
    Deno.env.set("TENANT_PROJECT_ID", "project-123");
    Deno.env.set("TENANT_PRODUCTION_MODE", "1");
    Deno.env.set("TENANT_RELEASE_ID", "release-1");
    Deno.env.set("TENANT_BRANCH_ID", "branch-123");

    assertEquals(getTenantFromEnv(), {
      projectSlug: "acme",
      token: "secret",
      projectId: "project-123",
      productionMode: true,
      releaseId: "release-1",
      branch: "branch-123",
    });
  });

  it("prefers the explicit Veryfront branch ref over the tenant branch id", () => {
    rememberEnv();

    Deno.env.set("TENANT_PROJECT_SLUG", "acme");
    Deno.env.set("TENANT_TOKEN", "secret");
    Deno.env.set("TENANT_BRANCH_ID", "branch-123");
    Deno.env.set("VERYFRONT_BRANCH_REF", "feature/ref");

    assertEquals(getTenantFromEnv()?.branch, "feature/ref");
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

  it("maps waiting and unexpected statuses to success exit codes", () => {
    const logger = createLogger();
    const exitCodes = { SUCCESS: 0, WORKFLOW_FAILED: 1 };

    assertEquals(
      getFinalRunExitCode(logger, exitCodes, "run-1", { status: "waiting" } as never, false),
      0,
    );
    assertEquals(getFinalRunExitCode(logger, exitCodes, "run-1", null, false), 0);
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
    const executor = createIsolatedWorkflowExecutor(backend);
    executor.register(
      workflow({
        id: "workflow-1",
        steps: [waitForApproval("review", { message: "Review required" })],
      }).definition,
    );
    const run = createRun("run-approval", "running", workerId);
    await backend.createRun(run);

    await executor.resume(run.id, undefined, workerId);

    assertEquals((await backend.getRun(run.id))?.status, "waiting");
    const approvals = await backend.getPendingApprovals(run.id);
    assertEquals(approvals.length, 1);
    assertEquals(approvals[0]?.nodeId, "review");
    assertEquals(approvals[0]?.message, "Review required");
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
});
