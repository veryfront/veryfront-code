import "#veryfront/schemas/_test-setup.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { WorkflowRun } from "../types.ts";
import { EXIT_CODES, runWorkflowJob } from "./job-entrypoint.ts";

const ENV_KEYS = [
  "WORKFLOW_RUN_ID",
  "VERYFRONT_TASK_ENV_JSON",
  "VERYFRONT_PROJECT_API_URL",
  "TENANT_TOKEN",
  "TENANT_PROJECT_SLUG",
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

describe("runWorkflowJob", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("hydrates the workflow run context env from injected project env before resume", async () => {
    rememberEnv();

    const backend = new MemoryBackend();
    const run: WorkflowRun = {
      id: "run-1",
      workflowId: "test-workflow",
      status: "pending",
      input: {},
      nodeStates: {},
      currentNodes: [],
      context: { input: {} },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
    };
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set(
      "VERYFRONT_TASK_ENV_JSON",
      JSON.stringify({
        SERVICENOW_USERNAME: "automation@example.com",
        AI_GATEWAY_TOKEN: "project-token",
        VERYFRONT_API_TOKEN: "should-be-filtered",
      }),
    );
    Deno.env.set("VERYFRONT_PROJECT_API_URL", "https://api.veryfront.com");

    let observedEnv: Record<string, string> | undefined;
    const executor = {
      resume: async (runId: string) => {
        const currentRun = await backend.getRun(runId);
        observedEnv = currentRun?.context.env;
        await backend.updateRun(runId, { status: "completed" });
      },
    };

    const exitCode = await runWorkflowJob({
      backend,
      executor: executor as never,
    });

    assertEquals(exitCode, EXIT_CODES.SUCCESS);
    assertEquals(observedEnv, {
      SERVICENOW_USERNAME: "automation@example.com",
      AI_GATEWAY_TOKEN: "project-token",
    });
  });

  it("uses the stored tenant context when tenant env vars are absent", async () => {
    rememberEnv();

    const backend = new MemoryBackend();
    const run: WorkflowRun = {
      id: "run-tenant",
      workflowId: "test-workflow",
      status: "pending",
      input: {},
      nodeStates: {},
      currentNodes: [],
      context: { input: {} },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      _tenant: {
        projectSlug: "acme",
        token: "tenant-token",
        projectId: "project-123",
        productionMode: true,
        releaseId: "release-1",
      },
    };
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.delete("TENANT_TOKEN");
    Deno.env.delete("TENANT_PROJECT_SLUG");

    let observedContext = getCurrentRequestContext();
    const executor = {
      resume: async (runId: string) => {
        observedContext = getCurrentRequestContext();
        await backend.updateRun(runId, { status: "waiting" });
      },
    };

    const exitCode = await runWorkflowJob({
      backend,
      executor: executor as never,
    });

    assertEquals(exitCode, EXIT_CODES.SUCCESS);
    assertExists(observedContext);
    assertEquals(observedContext.projectSlug, "acme");
    assertEquals(observedContext.projectId, "project-123");
    assertEquals(observedContext.token, "tenant-token");
    assertEquals(observedContext.productionMode, true);
    assertEquals(observedContext.releaseId, "release-1");
  });

  it("marks the run as failed when the executor throws", async () => {
    rememberEnv();

    const backend = new MemoryBackend();
    const run: WorkflowRun = {
      id: "run-failure",
      workflowId: "test-workflow",
      status: "pending",
      input: {},
      nodeStates: {},
      currentNodes: [],
      context: { input: {} },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
    };
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);

    const exitCode = await runWorkflowJob({
      backend,
      executor: {
        resume: async () => {
          throw new Error("boom");
        },
      } as never,
    });

    const updatedRun = await backend.getRun(run.id);

    assertEquals(exitCode, EXIT_CODES.WORKFLOW_FAILED);
    assertExists(updatedRun);
    assertEquals(updatedRun.status, "failed");
    assertEquals(updatedRun.error?.message, "EXECUTION_ERROR: boom");
  });
});
