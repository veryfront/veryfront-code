/**
 * Workflow Client Tests
 */

import { assertEquals, assertExists, assertRejects } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { describe, it, beforeEach, afterEach } from "https://deno.land/std@0.220.0/testing/bdd.ts";
import { WorkflowClient, createWorkflowClient } from "./workflow-client.ts";
import { MemoryBackend } from "../backends/memory.ts";
import { workflow } from "../dsl/workflow.ts";
import { step } from "../dsl/step.ts";
import { waitForApproval } from "../dsl/wait.ts";
import type { Workflow } from "../dsl/workflow.ts";

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
    client.register(testWorkflow as Workflow);
    client.register(approvalWorkflow as Workflow);
  });

  afterEach(async () => {
    await client.destroy();
  });

  describe("register()", () => {
    it("should register a workflow", async () => {
      const newClient = createWorkflowClient({ backend: new MemoryBackend() });
      newClient.register(testWorkflow as Workflow);
      // Should not throw
      await newClient.destroy();
    });

    it("should register workflow definition directly", async () => {
      const newClient = createWorkflowClient({ backend: new MemoryBackend() });
      newClient.register(testWorkflow.definition);
      // Should not throw
      await newClient.destroy();
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
        "Workflow not found"
      );
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
    it("should list workflow runs", async () => {
      await client.start("test-workflow", {});
      await client.start("test-workflow", {});
      await client.start("approval-workflow", {});

      const all = await client.listRuns();
      assertEquals(all.length, 3);
    });

    it("should filter by workflowId", async () => {
      await client.start("test-workflow", {});
      await client.start("test-workflow", {});
      await client.start("approval-workflow", {});

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
    it("should approve a pending approval", async () => {
      const handle = await client.start("approval-workflow", {});

      // Manually add a pending approval and set workflow to waiting state
      await backend.updateRun(handle.runId, {
        status: "waiting",
      });

      await backend.savePendingApproval(handle.runId, {
        id: "approval-1",
        nodeId: "review",
        status: "pending",
        message: "Please review",
        payload: {},
        requestedAt: new Date(),
      });

      await client.approve(handle.runId, "approval-1", "admin@test.com", "Looks good!");

      const approval = await backend.getPendingApproval(handle.runId, "approval-1");
      assertEquals(approval?.status, "approved");
      assertEquals(approval?.decidedBy, "admin@test.com");
      assertEquals(approval?.comment, "Looks good!");
    });

    it("should reject a pending approval", async () => {
      const handle = await client.start("approval-workflow", {});

      // Set workflow to waiting state
      await backend.updateRun(handle.runId, {
        status: "waiting",
      });

      await backend.savePendingApproval(handle.runId, {
        id: "approval-2",
        nodeId: "review",
        status: "pending",
        message: "Please review",
        payload: {},
        requestedAt: new Date(),
      });

      await client.reject(handle.runId, "approval-2", "reviewer@test.com", "Needs changes");

      const approval = await backend.getPendingApproval(handle.runId, "approval-2");
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
