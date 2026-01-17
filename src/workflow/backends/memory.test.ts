/**
 * Memory Backend Tests
 */

import { assertEquals, assertExists } from "@std/assert";
import { beforeEach, describe, it } from "@std/testing/bdd.ts";
import { MemoryBackend } from "./memory.ts";
import type { Checkpoint, PendingApproval, WorkflowJob, WorkflowRun } from "../types.ts";

describe("MemoryBackend", () => {
  let backend: MemoryBackend;

  beforeEach(() => {
    backend = new MemoryBackend();
  });

  describe("Run Management", () => {
    const createTestRun = (id: string): WorkflowRun => ({
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
    });

    it("should create and retrieve a run", async () => {
      const run = createTestRun("run-1");
      await backend.createRun(run);

      const retrieved = await backend.getRun("run-1");
      assertExists(retrieved);
      assertEquals(retrieved.id, "run-1");
      assertEquals(retrieved.workflowId, "test-workflow");
      assertEquals(retrieved.status, "pending");
    });

    it("should return null for non-existent run", async () => {
      const result = await backend.getRun("non-existent");
      assertEquals(result, null);
    });

    it("should update a run", async () => {
      const run = createTestRun("run-2");
      await backend.createRun(run);

      await backend.updateRun("run-2", {
        status: "running",
        startedAt: new Date(),
      });

      const updated = await backend.getRun("run-2");
      assertEquals(updated?.status, "running");
      assertExists(updated?.startedAt);
    });

    it("should list runs with filters", async () => {
      await backend.createRun(createTestRun("run-a"));
      await backend.createRun({ ...createTestRun("run-b"), status: "running" });
      await backend.createRun({ ...createTestRun("run-c"), workflowId: "other-workflow" });

      // List all
      const all = await backend.listRuns({});
      assertEquals(all.length, 3);

      // Filter by workflow
      const byWorkflow = await backend.listRuns({ workflowId: "test-workflow" });
      assertEquals(byWorkflow.length, 2);

      // Filter by status
      const byStatus = await backend.listRuns({ status: "running" });
      assertEquals(byStatus.length, 1);
      assertEquals(byStatus[0]?.id, "run-b");

      // With limit
      const limited = await backend.listRuns({ limit: 2 });
      assertEquals(limited.length, 2);
    });
  });

  describe("Checkpointing", () => {
    it("should save and retrieve checkpoints", async () => {
      const checkpoint: Checkpoint = {
        id: "cp-1",
        nodeId: "step-1",
        timestamp: new Date(),
        context: { runId: "run-1", workflowId: "test", input: {} },
        nodeStates: {},
      };

      await backend.saveCheckpoint("run-1", checkpoint);

      const latest = await backend.getLatestCheckpoint("run-1");
      assertExists(latest);
      assertEquals(latest.id, "cp-1");
      assertEquals(latest.nodeId, "step-1");
    });

    it("should return latest checkpoint", async () => {
      const cp1: Checkpoint = {
        id: "cp-1",
        nodeId: "step-1",
        timestamp: new Date(Date.now() - 1000),
        context: { runId: "run-1", workflowId: "test", input: {} },
        nodeStates: {},
      };
      const cp2: Checkpoint = {
        id: "cp-2",
        nodeId: "step-2",
        timestamp: new Date(),
        context: { runId: "run-1", workflowId: "test", input: {} },
        nodeStates: {},
      };

      await backend.saveCheckpoint("run-1", cp1);
      await backend.saveCheckpoint("run-1", cp2);

      const latest = await backend.getLatestCheckpoint("run-1");
      assertEquals(latest?.id, "cp-2");
    });

    it("should return null for no checkpoints", async () => {
      const result = await backend.getLatestCheckpoint("no-checkpoints");
      assertEquals(result, null);
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
      const result = await backend.dequeue();
      assertEquals(result, null);
    });

    it("should process jobs in FIFO order", async () => {
      await backend.enqueue({ runId: "first", workflowId: "wf", input: {}, createdAt: new Date() });
      await backend.enqueue({
        runId: "second",
        workflowId: "wf",
        input: {},
        createdAt: new Date(),
      });
      await backend.enqueue({ runId: "third", workflowId: "wf", input: {}, createdAt: new Date() });

      const first = await backend.dequeue();
      const second = await backend.dequeue();
      const third = await backend.dequeue();

      assertEquals(first?.runId, "first");
      assertEquals(second?.runId, "second");
      assertEquals(third?.runId, "third");
    });

    it("should respect priority", async () => {
      await backend.enqueue({
        runId: "normal",
        workflowId: "wf",
        input: {},
        priority: 0,
        createdAt: new Date(),
      });
      await backend.enqueue({
        runId: "high",
        workflowId: "wf",
        input: {},
        priority: 10,
        createdAt: new Date(),
      });
      await backend.enqueue({
        runId: "low",
        workflowId: "wf",
        input: {},
        priority: -5,
        createdAt: new Date(),
      });

      const first = await backend.dequeue();
      const second = await backend.dequeue();
      const third = await backend.dequeue();

      assertEquals(first?.runId, "high");
      assertEquals(second?.runId, "normal");
      assertEquals(third?.runId, "low");
    });
  });

  describe("Locking", () => {
    it("should acquire and release locks", async () => {
      const acquired = await backend.acquireLock("resource-1", 5000);
      assertEquals(acquired, true);

      await backend.releaseLock("resource-1");
    });

    it("should prevent concurrent locks on same resource", async () => {
      const lock1 = await backend.acquireLock("resource-2", 5000);
      assertEquals(lock1, true);

      const lock2 = await backend.acquireLock("resource-2", 100);
      assertEquals(lock2, false);

      await backend.releaseLock("resource-2");
    });

    it("should allow lock after release", async () => {
      const lock1 = await backend.acquireLock("resource-3", 5000);
      assertEquals(lock1, true);
      await backend.releaseLock("resource-3");

      const lock2 = await backend.acquireLock("resource-3", 5000);
      assertEquals(lock2, true);
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
      // Should not throw
    });
  });
});
