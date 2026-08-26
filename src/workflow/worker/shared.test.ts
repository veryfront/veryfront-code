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

class ClaimScanCountingBackend extends MemoryBackend {
  approvalClaimScans = 0;

  override listApprovalDecisionClaims(
    runId?: string,
  ): ReturnType<MemoryBackend["listApprovalDecisionClaims"]> {
    this.approvalClaimScans++;
    return super.listApprovalDecisionClaims(runId);
  }
}

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

function createCapturingLogger() {
  const errors: string[] = [];
  const infos: string[] = [];
  const warnings: string[] = [];
  return {
    logger: {
      error: (message: string) => {
        errors.push(message);
      },
      info: (message: string) => {
        infos.push(message);
      },
      warn: (message: string) => {
        warnings.push(message);
      },
    },
    errors,
    infos,
    warnings,
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
    Deno.env.set("TENANT_ENVIRONMENT_NAME", "Development");
    Deno.env.delete("VERYFRONT_ENVIRONMENT_NAME");

    assertEquals(getTenantFromEnv(), {
      projectSlug: "acme",
      token: "secret",
      projectId: "project-123",
      productionMode: true,
      releaseId: "release-1",
      branch: "branch-123",
      environmentName: "Development",
    });

    Deno.env.set("VERYFRONT_ENVIRONMENT_NAME", "Preview");
    assertEquals(
      getTenantFromEnv()?.environmentName,
      "Preview",
      "VERYFRONT_ENVIRONMENT_NAME must win over TENANT_ENVIRONMENT_NAME",
    );

    Deno.env.delete("TENANT_TOKEN");
    assertEquals(
      getTenantFromEnv(),
      undefined,
      "a slug without a token must not produce a tenant",
    );

    Deno.env.set("TENANT_TOKEN", "secret");
    Deno.env.delete("TENANT_PROJECT_SLUG");
    assertEquals(
      getTenantFromEnv(),
      undefined,
      "a token without a slug must not produce a tenant",
    );
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

  it("maps a paused waiting run to the success exit code", () => {
    const logger = createLogger();
    const exitCodes = { SUCCESS: 0, WORKFLOW_FAILED: 1 };

    assertEquals(
      getFinalRunExitCode(logger, exitCodes, "run-1", { status: "waiting" } as never, false),
      0,
    );
  });

  it("maps failed runs to the failure exit code", () => {
    const logger = createLogger();
    const exitCodes = { SUCCESS: 0, WORKFLOW_FAILED: 1 };

    assertEquals(
      getFinalRunExitCode(logger, exitCodes, "run-1", { status: "failed" } as never, false),
      1,
    );
  });

  it("does not report success for runs that never reached a durable final state", () => {
    const logger = createLogger();
    const exitCodes = { SUCCESS: 0, WORKFLOW_FAILED: 1 };

    assertEquals(getFinalRunExitCode(logger, exitCodes, "run-1", null, false), 1);
    assertEquals(
      getFinalRunExitCode(logger, exitCodes, "run-1", { status: "cancelled" } as never, false),
      1,
    );
    assertEquals(
      getFinalRunExitCode(logger, exitCodes, "run-1", { status: "pending" } as never, false),
      1,
    );
    assertEquals(
      getFinalRunExitCode(logger, exitCodes, "run-1", { status: "running" } as never, false),
      1,
    );
  });

  it("logs sanitized run ids for runs that never reached a durable final state", () => {
    const { logger, warnings } = createCapturingLogger();
    const exitCodes = { SUCCESS: 0, WORKFLOW_FAILED: 1 };
    const runId = "run-\x1b[2Jtoken=secret";

    assertEquals(getFinalRunExitCode(logger, exitCodes, runId, null, false), 1);
    assertEquals(
      getFinalRunExitCode(
        logger,
        exitCodes,
        runId,
        { status: "cancelled" } as never,
        false,
      ),
      1,
    );

    assertEquals(
      getFinalRunExitCode(
        logger,
        exitCodes,
        runId,
        { status: "pending" } as never,
        false,
      ),
      1,
    );
    assertEquals(
      getFinalRunExitCode(
        logger,
        exitCodes,
        runId,
        { status: "running" } as never,
        false,
      ),
      1,
    );
    assertEquals(
      getFinalRunExitCode(
        logger,
        exitCodes,
        runId,
        { status: "unexpected" } as never,
        false,
      ),
      1,
    );

    assertEquals(warnings, [
      "Workflow run was not found after execution: run-token=secret",
      "Workflow was cancelled: run-token=secret",
      "Workflow did not reach a durable final state: pending (runId: run-token=secret)",
      "Workflow did not reach a durable final state: running (runId: run-token=secret)",
      "Unexpected final status: unexpected (runId: run-token=secret)",
    ]);
  });

  it("logs sanitized run ids for completed, failed, and waiting runs", () => {
    const { errors, infos, logger } = createCapturingLogger();
    const exitCodes = { SUCCESS: 0, WORKFLOW_FAILED: 1 };
    const runId = "run-\x1b[2Jtoken=secret";

    assertEquals(
      getFinalRunExitCode(logger, exitCodes, runId, { status: "completed" } as never, true),
      0,
    );
    assertEquals(
      getFinalRunExitCode(logger, exitCodes, runId, { status: "failed" } as never, false),
      1,
    );
    assertEquals(
      getFinalRunExitCode(logger, exitCodes, runId, { status: "waiting" } as never, true),
      0,
    );

    assertEquals(infos, [
      "Workflow completed successfully: run-token=secret",
      "Workflow paused (waiting): run-token=secret",
    ]);
    assertEquals(errors, ["Workflow failed: run-token=secret"]);
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

  it("does not globally scan approval claims for each isolated executor", async () => {
    const backend = new ClaimScanCountingBackend();

    createIsolatedWorkflowExecutor(backend);
    await Promise.resolve();

    assertEquals(backend.approvalClaimScans, 0);
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
