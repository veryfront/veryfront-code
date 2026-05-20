import "#veryfront/schemas/_test-setup.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { Tool } from "#veryfront/tool";
import { MemoryBackend } from "../backends/memory.ts";
import { dependsOn, step, workflow } from "../dsl/index.ts";
import { WorkflowExecutor } from "../executor/workflow-executor.ts";
import type { WorkflowRun } from "../types.ts";
import { EXIT_CODES, runWorkflowRun } from "./job-entrypoint.ts";

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

function createMockTool(name: string, handler: (input: unknown) => unknown): Tool {
  return {
    id: name,
    type: "function",
    description: `Mock tool: ${name}`,
    inputSchema: defineSchema((v) => v.object({}).passthrough())(),
    execute: (input) => Promise.resolve(handler(input)),
  };
}

describe("runWorkflowRun", () => {
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

    const exitCode = await runWorkflowRun({
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

    const exitCode = await runWorkflowRun({
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

    const exitCode = await runWorkflowRun({
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

  it("executes workflow runs already marked running by the run manager", async () => {
    rememberEnv();

    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    const workflowDefinition = workflow({
      id: "running-workflow",
      steps: [
        step("finish", {
          tool: createMockTool("finish-tool", () => ({ ok: true })),
        }),
      ],
    });
    executor.register(workflowDefinition.definition);

    const run: WorkflowRun = {
      id: "run-running",
      workflowId: "running-workflow",
      status: "running",
      input: {},
      nodeStates: {},
      currentNodes: [],
      context: { input: {} },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      startedAt: new Date(),
      workerId: "job:job-1",
    };
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);

    const exitCode = await runWorkflowRun({
      backend,
      executor,
    });

    const updatedRun = await backend.getRun(run.id);

    assertEquals(exitCode, EXIT_CODES.SUCCESS);
    assertExists(updatedRun);
    assertEquals(updatedRun.status, "completed");
    assertEquals(updatedRun.output, { finish: { ok: true } });
  });

  it("resumes run-manager workflow runs from the latest checkpoint", async () => {
    rememberEnv();

    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend, enableLocking: false });
    let firstExecuted = false;
    let secondExecuted = false;
    const workflowDefinition = workflow({
      id: "checkpointed-workflow",
      steps: [
        step("first", {
          tool: createMockTool("first-tool", () => {
            firstExecuted = true;
            return { first: true };
          }),
        }),
        dependsOn(
          step("second", {
            tool: createMockTool("second-tool", () => {
              secondExecuted = true;
              return { second: true };
            }),
          }),
          "first",
        ),
      ],
    });
    executor.register(workflowDefinition.definition);

    const firstNodeState = {
      nodeId: "first",
      status: "completed" as const,
      output: { first: true },
      attempt: 1,
    };
    const run: WorkflowRun = {
      id: "run-checkpointed",
      workflowId: "checkpointed-workflow",
      status: "running",
      input: {},
      nodeStates: { first: firstNodeState },
      currentNodes: [],
      context: { input: {}, first: { first: true } },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      startedAt: new Date(),
      workerId: "job:job-2",
    };
    await backend.createRun(run);
    await backend.saveCheckpoint(run.id, {
      id: "cp-first",
      nodeId: "first",
      timestamp: new Date(),
      context: { input: {}, first: { first: true } },
      nodeStates: { first: firstNodeState },
    });

    Deno.env.set("WORKFLOW_RUN_ID", run.id);

    const exitCode = await runWorkflowRun({
      backend,
      executor,
    });

    const updatedRun = await backend.getRun(run.id);

    assertEquals(exitCode, EXIT_CODES.SUCCESS);
    assertEquals(firstExecuted, false);
    assertEquals(secondExecuted, true);
    assertExists(updatedRun);
    assertEquals(updatedRun.status, "completed");
    assertEquals(updatedRun.output, { first: { first: true }, second: { second: true } });
  });
});
