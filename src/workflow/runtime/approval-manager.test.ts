import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ApprovalManager } from "./approval-manager.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { PendingApproval, WaitNodeConfig, WorkflowContext, WorkflowRun } from "../types.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

describe("ApprovalManager", () => {
  let backend: MemoryBackend;
  let manager: ApprovalManager;

  function createTestRun(id: string, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
    return {
      id,
      workflowId: "test-workflow",
      status: "running",
      input: { topic: "test" },
      nodeStates: {},
      currentNodes: [],
      context: { runId: id, workflowId: "test-workflow", input: { topic: "test" } },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      ...overrides,
      sourceIntegrationPolicy: overrides.sourceIntegrationPolicy ??
        UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
    };
  }

  function createContext(runId: string): WorkflowContext {
    return { input: { topic: "test" }, runId, workflowId: "test-workflow" };
  }

  function pastDate(msAgo = 1000): Date {
    return new Date(Date.now() - msAgo);
  }

  beforeEach(() => {
    backend = new MemoryBackend();
  });

  afterEach(() => {
    manager?.stop();
  });

  describe("constructor", () => {
    it("does not auto-expire approvals when expirationCheckInterval is 0", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });

      const runId = "run-no-timer";
      await backend.createRun(createTestRun(runId));

      const expiredApproval: PendingApproval = {
        id: "apr-expired",
        nodeId: "review",
        message: "Old approval",
        payload: {},
        requestedAt: pastDate(2000),
        expiresAt: pastDate(1000),
        status: "pending",
      };
      await backend.savePendingApproval(runId, expiredApproval);

      // Wait briefly. Without a timer the approval must remain pending.
      await new Promise((resolve) => setTimeout(resolve, 20));

      const stillPending = await backend.getPendingApproval(runId, "apr-expired");
      assertEquals(stillPending?.status, "pending");

      // stop() should be safe (no timer to clear).
      manager.stop();
      manager = undefined as unknown as ApprovalManager;
    });
  });

  describe("checkExpiredApprovals", () => {
    // NOTE: currently fails because ApprovalManager detaches `this` when calling
    // `backend.listPendingApprovals` (approval-manager.ts:274). The same shape
    // exists in listAllPending() at approval-manager.ts:257. Both break for any
    // backend whose listPendingApprovals reads `this` (MemoryBackend does).
    it("expires only approvals past their expiresAt", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });

      await backend.createRun(createTestRun("run-a"));
      await backend.createRun(createTestRun("run-b"));
      await backend.createRun(createTestRun("run-c"));

      const expiredA: PendingApproval = {
        id: "apr-a",
        nodeId: "review",
        message: "expired a",
        payload: {},
        requestedAt: pastDate(3000),
        expiresAt: pastDate(2000),
        status: "pending",
      };
      const expiredB: PendingApproval = {
        id: "apr-b",
        nodeId: "review",
        message: "expired b",
        payload: {},
        requestedAt: pastDate(3000),
        expiresAt: pastDate(1500),
        status: "pending",
      };
      const futureC: PendingApproval = {
        id: "apr-c",
        nodeId: "review",
        message: "still valid",
        payload: {},
        requestedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        status: "pending",
      };

      await backend.savePendingApproval("run-a", expiredA);
      await backend.savePendingApproval("run-b", expiredB);
      await backend.savePendingApproval("run-c", futureC);

      await manager.checkExpiredApprovals();

      const a = await backend.getPendingApproval("run-a", "apr-a");
      const b = await backend.getPendingApproval("run-b", "apr-b");
      const c = await backend.getPendingApproval("run-c", "apr-c");

      // Expired approvals get flipped to "rejected" (decision approved=false)
      assertEquals(a?.status, "rejected");
      assertEquals(a?.decidedBy, "system");
      assertEquals(b?.status, "rejected");
      assertEquals(b?.decidedBy, "system");

      // The future approval is untouched
      assertEquals(c?.status, "pending");

      // Expired runs marked as failed
      const runA = await backend.getRun("run-a");
      const runB = await backend.getRun("run-b");
      const runC = await backend.getRun("run-c");
      assertEquals(runA?.status, "failed");
      assertEquals(runB?.status, "failed");
      assertEquals(runC?.status, "running");
    });
  });

  describe("createApproval", () => {
    it("persists approval with computed expiresAt and resolved payload", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });

      const runId = "run-create";
      await backend.createRun(createTestRun(runId));

      const before = Date.now();
      const waitConfig: WaitNodeConfig = {
        type: "wait",
        waitType: "approval",
        message: "Please approve",
        payload: (ctx) => ({
          data: "resolved",
          inputTopic: (ctx.input as { topic: string }).topic,
        }),
        approvers: ["alice@example.com", "bob@example.com"],
        timeout: "1h",
      };

      const request = await manager.createApproval(
        await backend.getRun(runId) as WorkflowRun,
        "review-node",
        waitConfig,
        createContext(runId),
      );

      const after = Date.now();

      assertExists(request.approvalId);
      assertEquals(request.runId, runId);
      assertEquals(request.nodeId, "review-node");
      assertEquals(request.message, "Please approve");

      const persisted = await backend.getPendingApproval(runId, request.approvalId);
      assertExists(persisted);
      assertEquals(persisted.status, "pending");
      assertEquals(persisted.nodeId, "review-node");
      assertEquals(persisted.message, "Please approve");
      assertEquals(persisted.approvers, ["alice@example.com", "bob@example.com"]);
      assertEquals(persisted.payload, { data: "resolved", inputTopic: "test" });

      assertExists(persisted.expiresAt);
      const expiresMs = persisted.expiresAt.getTime();
      // 1 hour from "before" .. "after" (small clock drift tolerance)
      const minExpected = before + 60 * 60 * 1000;
      const maxExpected = after + 60 * 60 * 1000;
      if (expiresMs < minExpected || expiresMs > maxExpected) {
        throw new Error(
          `expiresAt ${expiresMs} not within [${minExpected}, ${maxExpected}]`,
        );
      }
    });

    it("omits expiresAt when no timeout is supplied", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });

      const runId = "run-no-timeout";
      await backend.createRun(createTestRun(runId));

      const waitConfig: WaitNodeConfig = {
        type: "wait",
        waitType: "approval",
        message: "No timeout",
        payload: { foo: "bar" },
        approvers: ["alice"],
      };

      const request = await manager.createApproval(
        await backend.getRun(runId) as WorkflowRun,
        "node-x",
        waitConfig,
        createContext(runId),
      );

      assertEquals(request.expiresAt, undefined);

      const persisted = await backend.getPendingApproval(runId, request.approvalId);
      assertExists(persisted);
      assertEquals(persisted.expiresAt, undefined);
      assertEquals(persisted.payload, { foo: "bar" });
    });
  });

  describe("processDecision", () => {
    it("updates approval and run state without an executor", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });

      const runId = "run-decide";
      await backend.createRun(createTestRun(runId));

      const waitConfig: WaitNodeConfig = {
        type: "wait",
        waitType: "approval",
        message: "Approve please",
        payload: { ticket: 1 },
        approvers: ["alice"],
      };

      const request = await manager.createApproval(
        await backend.getRun(runId) as WorkflowRun,
        "decision-node",
        waitConfig,
        createContext(runId),
      );

      await manager.processDecision(runId, request.approvalId, {
        approved: true,
        approver: "alice",
        comment: "looks good",
      });

      const updated = await backend.getPendingApproval(runId, request.approvalId);
      assertExists(updated);
      assertEquals(updated.status, "approved");
      assertEquals(updated.decidedBy, "alice");
      assertEquals(updated.comment, "looks good");

      const run = await backend.getRun(runId);
      assertExists(run);
      // No executor was provided, so the run stays in "running" (resume short-circuited).
      assertEquals(run.status, "running");
      // The decision node state is recorded as completed.
      const nodeState = run.nodeStates["decision-node"];
      assertExists(nodeState);
      assertEquals(nodeState.status, "completed");
      const output = nodeState.output as { approved: boolean; approver: string; comment: string };
      assertEquals(output.approved, true);
      assertEquals(output.approver, "alice");
      assertEquals(output.comment, "looks good");
      // Decision context recorded on the run context.
      const decisionContext = run.context["decision-node"] as { approved: boolean };
      assertEquals(decisionContext.approved, true);
    });
  });
});
