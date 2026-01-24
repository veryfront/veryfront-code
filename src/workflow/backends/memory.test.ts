import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryBackend } from "./memory.ts";
import type { Checkpoint, PendingApproval, WorkflowJob, WorkflowRun } from "../types.ts";

describe("MemoryBackend", () => {
  let backend: MemoryBackend;

  function createTestRun(id: string): WorkflowRun {
    return {
      id,
      workflowId: "test-workflow",
      status: "pending",
      input: { topic: "test" },
      nodeStates: {},
      currentNodes: [],
      context: { runId: id, workflowId: "test-workflow", input: { topic: "test" } },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
    };
  }

  beforeEach(() => {
    backend = new MemoryBackend();
  });

  describe("Run Management", () => {
    it("should create and retrieve a run", async () => {
      await backend.createRun(createTestRun("run-1"));

      const retrieved = await backend.getRun("run-1");
      assertExists(retrieved);
      assertEquals(retrieved.id, "run-1");
      assertEquals(retrieved.workflowId, "test-workflow");
      assertEquals(retrieved.status, "pending");
    });

    it("should return null for non-existent run", async () => {
      assertEquals(await backend.getRun("non-existent"), null);
    });

    it("should update a run", async () => {
      await backend.createRun(createTestRun("run-2"));

      await backend.updateRun("run-2", { status: "running", startedAt: new Date() });

      const updated = await backend.getRun("run-2");
      assertEquals(updated?.status, "running");
      assertExists(updated?.startedAt);
    });

    it("should list runs with filters", async () => {
      await backend.createRun(createTestRun("run-a"));
      await backend.createRun({ ...createTestRun("run-b"), status: "running" });
      await backend.createRun({ ...createTestRun("run-c"), workflowId: "other-workflow" });

      assertEquals((await backend.listRuns({})).length, 3);

      assertEquals((await backend.listRuns({ workflowId: "test-workflow" })).length, 2);

      const byStatus = await backend.listRuns({ status: "running" });
      assertEquals(byStatus.length, 1);
      assertEquals(byStatus[0]?.id, "run-b");

      assertEquals((await backend.listRuns({ limit: 2 })).length, 2);
    });
  });

  describe("Checkpointing", () => {
    function createCheckpoint(id: string, nodeId: string, timestamp: Date): Checkpoint {
      return {
        id,
        nodeId,
        timestamp,
        context: { runId: "run-1", workflowId: "test", input: {} },
        nodeStates: {},
      };
    }

    it("should save and retrieve checkpoints", async () => {
      await backend.saveCheckpoint("run-1", createCheckpoint("cp-1", "step-1", new Date()));

      const latest = await backend.getLatestCheckpoint("run-1");
      assertExists(latest);
      assertEquals(latest.id, "cp-1");
      assertEquals(latest.nodeId, "step-1");
    });

    it("should return latest checkpoint", async () => {
      await backend.saveCheckpoint(
        "run-1",
        createCheckpoint("cp-1", "step-1", new Date(Date.now() - 1000)),
      );
      await backend.saveCheckpoint("run-1", createCheckpoint("cp-2", "step-2", new Date()));

      assertEquals((await backend.getLatestCheckpoint("run-1"))?.id, "cp-2");
    });

    it("should return null for no checkpoints", async () => {
      assertEquals(await backend.getLatestCheckpoint("no-checkpoints"), null);
    });
  });

  describe("Approvals", () => {
    it("should save and retrieve pending approvals", async () => {
      const approval: PendingApproval = {
        id: "approval-1",
        nodeId: "review-step",
        status: "pending",
        message: "Please review",
        payload: { data: "test" },
        requestedAt: new Date(),
      };

      await backend.savePendingApproval("run-1", approval);

      const approvals = await backend.getPendingApprovals("run-1");
      assertEquals(approvals.length, 1);
      assertEquals(approvals[0]?.id, "approval-1");
      assertEquals(approvals[0]?.status, "pending");
    });

    it("should update approval status", async () => {
      const approval: PendingApproval = {
        id: "approval-2",
        nodeId: "review",
        status: "pending",
        message: "Review needed",
        payload: {},
        requestedAt: new Date(),
      };

      await backend.savePendingApproval("run-2", approval);

      await backend.updateApproval("run-2", "approval-2", {
        approved: true,
        approver: "admin@example.com",
        comment: "Looks good!",
      });

      const updatedApproval = await backend.getPendingApproval("run-2", "approval-2");
      assertEquals(updatedApproval?.status, "approved");
      assertEquals(updatedApproval?.decidedBy, "admin@example.com");
      assertEquals(updatedApproval?.comment, "Looks good!");
    });
  });

  describe("Queue Operations", () => {
    it("should enqueue and dequeue jobs", async () => {
      const job: WorkflowJob = {
        runId: "run-1",
        workflowId: "test-workflow",
        input: { data: "test" },
        createdAt: new Date(),
      };

      await backend.enqueue(job);

      const dequeued = await backend.dequeue();
      assertExists(dequeued);
      assertEquals(dequeued.runId, "run-1");
    });

    it("should return null when queue is empty", async () => {
      assertEquals(await backend.dequeue(), null);
    });

    it("should process jobs in FIFO order", async () => {
      const createdAt = new Date();
      await backend.enqueue({ runId: "first", workflowId: "wf", input: {}, createdAt });
      await backend.enqueue({ runId: "second", workflowId: "wf", input: {}, createdAt });
      await backend.enqueue({ runId: "third", workflowId: "wf", input: {}, createdAt });

      assertEquals((await backend.dequeue())?.runId, "first");
      assertEquals((await backend.dequeue())?.runId, "second");
      assertEquals((await backend.dequeue())?.runId, "third");
    });

    it("should respect priority", async () => {
      const createdAt = new Date();
      await backend.enqueue({
        runId: "normal",
        workflowId: "wf",
        input: {},
        priority: 0,
        createdAt,
      });
      await backend.enqueue({
        runId: "high",
        workflowId: "wf",
        input: {},
        priority: 10,
        createdAt,
      });
      await backend.enqueue({ runId: "low", workflowId: "wf", input: {}, priority: -5, createdAt });

      assertEquals((await backend.dequeue())?.runId, "high");
      assertEquals((await backend.dequeue())?.runId, "normal");
      assertEquals((await backend.dequeue())?.runId, "low");
    });
  });

  describe("Locking", () => {
    it("should acquire and release locks", async () => {
      assertEquals(await backend.acquireLock("resource-1", 5000), true);
      await backend.releaseLock("resource-1");
    });

    it("should prevent concurrent locks on same resource", async () => {
      assertEquals(await backend.acquireLock("resource-2", 5000), true);
      assertEquals(await backend.acquireLock("resource-2", 100), false);
      await backend.releaseLock("resource-2");
    });

    it("should allow lock after release", async () => {
      assertEquals(await backend.acquireLock("resource-3", 5000), true);
      await backend.releaseLock("resource-3");
      assertEquals(await backend.acquireLock("resource-3", 5000), true);
    });
  });

  describe("Cleanup", () => {
    it("should destroy without errors", async () => {
      await backend.createRun({
        id: "temp",
        workflowId: "wf",
        status: "pending",
        input: {},
        nodeStates: {},
        currentNodes: [],
        context: { runId: "temp", workflowId: "wf", input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
      });

      await backend.destroy();
    });
  });
});
