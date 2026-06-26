import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import type { Tool } from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool";
import { createWorkflowClient, WorkflowClient } from "./workflow-client.ts";
import { MemoryBackend } from "../backends/memory.ts";
import { workflow } from "../dsl/workflow.ts";
import { step } from "../dsl/step.ts";
import { waitForApproval } from "../dsl/wait.ts";
import type { WorkflowRun } from "../types.ts";

function createMockTool(name: string, output: unknown): Tool {
  return {
    id: name,
    type: "function",
    description: `Mock tool: ${name}`,
    inputSchema: defineSchema((v) => v.object({}).passthrough())(),
    execute: () => Promise.resolve(output),
  };
}

describe("WorkflowClient", () => {
  let client: WorkflowClient;
  let backend: MemoryBackend;

  const testWorkflow = workflow({
    id: "test-workflow",
    description: "A test workflow",
    steps: [
      step("step1", { agent: "test-agent" }),
      step("step2", { tool: "test-tool" }),
    ],
  });

  const approvalWorkflow = workflow({
    id: "approval-workflow",
    steps: [
      step("prepare", { agent: "preparer" }),
      waitForApproval("review", { message: "Please review" }),
      step("finalize", { agent: "finalizer" }),
    ],
  });

  beforeEach(() => {
    backend = new MemoryBackend();
    client = createWorkflowClient({ backend });
    client.register(testWorkflow);
    client.register(approvalWorkflow);
  });

  afterEach(async () => {
    await client.destroy();
  });

  describe("register()", () => {
    async function withNewClient(
      register: (client: WorkflowClient) => void,
    ): Promise<void> {
      const client = createWorkflowClient({ backend: new MemoryBackend() });
      register(client);
      await client.destroy();
    }

    it("should register a workflow", async () => {
      await withNewClient((client) => client.register(testWorkflow));
    });

    it("should register workflow definition directly", async () => {
      await withNewClient((client) => client.register(testWorkflow.definition));
    });
  });

  describe("start()", () => {
    it("should start a workflow and return a handle", async () => {
      const handle = await client.start("test-workflow", { topic: "test" });

      assertExists(handle);
      assertExists(handle.runId);
      assertEquals(typeof handle.runId, "string");
    });

    it("should create a run in the backend", async () => {
      const handle = await client.start("test-workflow", { data: "value" });

      const run = await backend.getRun(handle.runId);
      assertExists(run);
      assertEquals(run.workflowId, "test-workflow");
      assertEquals(run.input, { data: "value" });
    });

    it("should throw for unregistered workflow", async () => {
      await assertRejects(
        () => client.start("non-existent", {}),
        Error,
        "Workflow not found",
      );
    });

    it("should use resource-not-found for unregistered workflow", async () => {
      try {
        await client.start("non-existent", {});
        throw new Error("Expected start() to throw");
      } catch (error) {
        assertEquals(error instanceof VeryfrontError, true);
        if (!(error instanceof VeryfrontError)) throw error;

        assertEquals(error.slug, "resource-not-found");
        assertEquals(error.status, 404);
      }
    });

    it("captures injected project env on the workflow run context", async () => {
      const originalTaskEnvJson = Deno.env.get("VERYFRONT_TASK_ENV_JSON");
      const originalProjectApiUrl = Deno.env.get("VERYFRONT_PROJECT_API_URL");

      try {
        Deno.env.set(
          "VERYFRONT_TASK_ENV_JSON",
          JSON.stringify({
            SERVICENOW_USERNAME: "automation@example.com",
            AI_GATEWAY_TOKEN: "project-token",
            VERYFRONT_API_TOKEN: "should-be-filtered",
          }),
        );
        Deno.env.set("VERYFRONT_PROJECT_API_URL", "https://api.veryfront.com");

        const handle = await client.start("test-workflow", { topic: "test" });
        const run = await backend.getRun(handle.runId);

        assertExists(run);
        assertEquals(run.context.env, {
          SERVICENOW_USERNAME: "automation@example.com",
          AI_GATEWAY_TOKEN: "project-token",
        });
      } finally {
        if (originalTaskEnvJson === undefined) {
          Deno.env.delete("VERYFRONT_TASK_ENV_JSON");
        } else {
          Deno.env.set("VERYFRONT_TASK_ENV_JSON", originalTaskEnvJson);
        }

        if (originalProjectApiUrl === undefined) {
          Deno.env.delete("VERYFRONT_PROJECT_API_URL");
        } else {
          Deno.env.set("VERYFRONT_PROJECT_API_URL", originalProjectApiUrl);
        }
      }
    });

    it("does not expose captured tenant metadata in completed output or context", async () => {
      const tenantWorkflow = workflow({
        id: "tenant-output-workflow",
        steps: [
          step("tenant-step", {
            tool: createMockTool("tenant-tool", { result: "ok" }),
          }),
        ],
      });

      client.register(tenantWorkflow);

      const handle = await runWithRequestContext(
        {
          projectSlug: "tests-1d0745b0",
          projectId: "project-1",
          token: "internal-runtime-token",
          productionMode: false,
          branch: "main",
        },
        () => client.start("tenant-output-workflow", { topic: "test" }),
      );

      const output = await handle.result();
      const run = await backend.getRun(handle.runId);

      assertExists(run);
      assertEquals(run._tenant?.token, "internal-runtime-token");
      assertEquals((output as Record<string, unknown>)["_tenant"], undefined);
      assertEquals((run.output as Record<string, unknown>)["_tenant"], undefined);
      assertEquals((run.context as Record<string, unknown>)["_tenant"], undefined);
      assertEquals(run.output, { "tenant-step": { result: "ok" } });
    });

    it("resolves project-scoped tools from stored tenant context when resuming a run", async () => {
      const scopedTool = createMockTool("scoped-tool", { result: "ok" });
      const scopedBackend = new MemoryBackend();
      const scopedClient = createWorkflowClient({
        backend: scopedBackend,
        executor: {
          stepExecutor: {
            toolRegistry,
          },
        },
      });

      try {
        runWithCacheKeyContext(
          { projectId: "project-123", mode: "preview", versionId: "branch-123" },
          () => {
            toolRegistry.register(scopedTool.id, scopedTool);
          },
        );

        const tenantWorkflow = workflow({
          id: "tenant-scoped-tool-workflow",
          steps: [step("tenant-step", { tool: "scoped-tool" })],
        });
        scopedClient.register(tenantWorkflow);

        const run: WorkflowRun = {
          id: "run-scoped-tool",
          workflowId: tenantWorkflow.id,
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
            productionMode: false,
            releaseId: null,
            branch: "branch-123",
          },
        };
        await scopedBackend.createRun(run);

        await scopedClient.resume(run.id);

        const completedRun = await scopedBackend.getRun(run.id);
        assertEquals(completedRun?.status, "completed");
        assertEquals(completedRun?.output, { "tenant-step": { result: "ok" } });
      } finally {
        toolRegistry.clearAll();
        await scopedClient.destroy();
      }
    });
  });

  describe("getRun()", () => {
    it("should retrieve a workflow run", async () => {
      const handle = await client.start("test-workflow", { input: "data" });
      const run = await client.getRun(handle.runId);

      assertExists(run);
      assertEquals(run.id, handle.runId);
      assertEquals(run.workflowId, "test-workflow");
    });

    it("should return null for non-existent run", async () => {
      const run = await client.getRun("non-existent");
      assertEquals(run, null);
    });
  });

  describe("listRuns()", () => {
    async function seedRuns(): Promise<void> {
      await client.start("test-workflow", {});
      await client.start("test-workflow", {});
      await client.start("approval-workflow", {});
    }

    it("should list workflow runs", async () => {
      await seedRuns();

      const all = await client.listRuns();
      assertEquals(all.length, 3);
    });

    it("should filter by workflowId", async () => {
      await seedRuns();

      const filtered = await client.listRuns({ workflowId: "test-workflow" });
      assertEquals(filtered.length, 2);
    });
  });

  describe("cancel()", () => {
    it("should cancel a workflow", async () => {
      const handle = await client.start("test-workflow", {});
      await client.cancel(handle.runId);

      const run = await backend.getRun(handle.runId);
      assertEquals(run?.status, "cancelled");
    });
  });

  describe("approve() and reject()", () => {
    async function createWaitingApprovalRun(runId: string, approvalId: string): Promise<void> {
      await backend.createRun({
        id: runId,
        workflowId: "approval-workflow",
        status: "waiting",
        input: {},
        nodeStates: {},
        currentNodes: ["review"],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
      });

      await backend.savePendingApproval(runId, {
        id: approvalId,
        nodeId: "review",
        status: "pending",
        message: "Please review",
        payload: {},
        requestedAt: new Date(),
      });
    }

    it("should approve a pending approval", async () => {
      // Create run directly in waiting state (avoid async execution race)
      const runId = "test-run-approval";
      await createWaitingApprovalRun(runId, "approval-1");

      await client.approve(runId, "approval-1", "admin@test.com", "Looks good!");

      const approval = await backend.getPendingApproval(runId, "approval-1");
      assertEquals(approval?.status, "approved");
      assertEquals(approval?.decidedBy, "admin@test.com");
      assertEquals(approval?.comment, "Looks good!");
    });

    it("should reject a pending approval", async () => {
      // Create run directly in waiting state (avoid async execution race)
      const runId = "test-run-rejection";
      await createWaitingApprovalRun(runId, "approval-2");

      await client.reject(runId, "approval-2", "reviewer@test.com", "Needs changes");

      const approval = await backend.getPendingApproval(runId, "approval-2");
      assertEquals(approval?.status, "rejected");
      assertEquals(approval?.comment, "Needs changes");
    });
  });

  describe("WorkflowHandle", () => {
    it("should provide status method", async () => {
      const handle = await client.start("test-workflow", {});
      const status = await handle.status();

      assertExists(status);
      assertEquals(status.id, handle.runId);
    });

    it("should provide cancel method", async () => {
      const handle = await client.start("test-workflow", {});
      await handle.cancel();

      const run = await backend.getRun(handle.runId);
      assertEquals(run?.status, "cancelled");
    });
  });
});

describe("createWorkflowClient()", () => {
  it("should create a client with default backend", async () => {
    const client = createWorkflowClient();
    assertExists(client);
    await client.destroy();
  });

  it("should create a client with custom backend", async () => {
    const backend = new MemoryBackend();
    const client = createWorkflowClient({ backend });
    assertExists(client);
    await client.destroy();
  });
});
