import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ApprovalManager, reconcileApprovalDecisionClaimsBeforeRetry } from "./approval-manager.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { PersistedPendingApproval } from "../backends/types.ts";
import type { WorkflowExecutor } from "../executor/workflow-executor.ts";
import type {
  ApprovalDecision,
  PendingApproval,
  WaitNodeConfig,
  WorkflowContext,
  WorkflowRun,
} from "../types.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { FakeTime } from "#std/testing/time";
import { getPendingApprovalResponseSchemaId } from "./pending-approval-metadata.ts";
import { __subscribeLogRecordEmitter } from "#veryfront/utils/logger/index.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

class CancelOnApprovalDecisionBackend extends MemoryBackend {
  override async updateApproval(
    runId: string,
    approvalId: string,
    decision: Parameters<MemoryBackend["updateApproval"]>[2],
  ): Promise<boolean> {
    const applied = await super.updateApproval(runId, approvalId, decision);
    await super.updateRun(runId, { status: "cancelled", completedAt: new Date() });
    return applied;
  }
}

class FailOnApprovalDecisionBackend extends MemoryBackend {
  override async updateApproval(
    runId: string,
    approvalId: string,
    decision: Parameters<MemoryBackend["updateApproval"]>[2],
  ): Promise<boolean> {
    const applied = await super.updateApproval(runId, approvalId, decision);
    await super.updateRun(runId, {
      status: "failed",
      error: { message: "sibling failed" },
      completedAt: new Date(),
    });
    return applied;
  }
}

class ReclaimDuringDecisionBackend extends MemoryBackend {
  reclaimed = false;

  override async updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (!this.reclaimed) {
      this.reclaimed = true;
      await super.updateRun(runId, { workerId: "worker-replacement-owner" });
    }
    return await super.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
  }
}

class DecisionDuringSaveBackend extends MemoryBackend {
  manager?: ApprovalManager;
  decisionError?: unknown;

  override async savePendingApprovalIfAbsent(
    runId: string,
    approval: PendingApproval,
  ): Promise<boolean> {
    const saved = await super.savePendingApprovalIfAbsent(runId, approval);
    if (!saved) return false;

    try {
      await this.manager?.approve(runId, approval.id, "reviewer", undefined, {
        confirmed: "yes",
      });
    } catch (error) {
      this.decisionError = error;
    }
    return true;
  }
}

class DecisionClaimDuringApprovalSaveBackend extends MemoryBackend {
  override async savePendingApprovalIfAbsent(
    runId: string,
    approval: PendingApproval,
  ): Promise<boolean> {
    const saved = await super.savePendingApprovalIfAbsent(runId, approval);
    if (!saved) return false;
    await super.updateApproval(runId, approval.id, {
      approved: true,
      approver: "reviewer",
    });
    return false;
  }
}

class RejectOwnerBoundApprovalSaveBackend extends MemoryBackend {
  override savePendingApprovalIfStatusAndWorker(): Promise<boolean> {
    return Promise.reject(new Error("approval save failed"));
  }
}

class RejectNotificationErrorUpdateBackend extends MemoryBackend {
  override updatePendingApproval(): Promise<void> {
    return Promise.reject(new Error("notification annotation unavailable"));
  }
}

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
      using time = new FakeTime(new Date("2026-08-24T10:00:00.000Z"));
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

      await time.tickAsync(120_000);

      const stillPending = await backend.getPendingApproval(runId, "apr-expired");
      assertEquals(stillPending?.status, "pending");

      // stop() should be safe (no timer to clear).
      manager.stop();
      manager = undefined as unknown as ApprovalManager;
    });
  });

  describe("checkExpiredApprovals", () => {
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

    it("does not overwrite cancellation while expiring an approval", async () => {
      backend = new CancelOnApprovalDecisionBackend();
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-expiry-cancelled";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));
      await backend.savePendingApproval(runId, {
        id: "apr-expiry-cancelled",
        nodeId: "review",
        message: "expired",
        payload: {},
        requestedAt: pastDate(2000),
        expiresAt: pastDate(1000),
        status: "pending",
      });

      await manager.checkExpiredApprovals();

      const run = await backend.getRun(runId);
      assertExists(run);
      assertEquals(run.status, "cancelled");
      assertEquals(run.error, undefined);
    });

    it("retains an expired decision claim when a sibling failure wins", async () => {
      backend = new FailOnApprovalDecisionBackend();
      manager = new ApprovalManager({
        backend,
        expirationCheckInterval: 0,
        decisionClaimRecoveryDelay: 0,
      });
      const runId = "run-expiry-sibling-failure";
      await backend.createRun(createTestRun(runId, {
        status: "waiting",
        nodeStates: {
          review: { nodeId: "review", status: "running", attempt: 1 },
        },
      }));
      await backend.savePendingApproval(runId, {
        id: "apr-expiry-sibling-failure",
        nodeId: "review",
        message: "Expired review",
        requestedAt: pastDate(2_000),
        expiresAt: pastDate(1_000),
        status: "pending",
      });

      await manager.checkExpiredApprovals();

      assertEquals((await backend.getRun(runId))?.status, "failed");
      assertEquals((await backend.listApprovalDecisionClaims(runId)).length, 1);
    });
  });

  describe("createApproval", () => {
    it("coalesces concurrent approval creation for the same live node", async () => {
      let notifications = 0;
      manager = new ApprovalManager({
        backend,
        expirationCheckInterval: 0,
        notifier: () => {
          notifications++;
          return Promise.resolve();
        },
      });
      const run = createTestRun("run-concurrent-approval", {
        status: "waiting",
        workerId: "run-execution:owner",
      });
      await backend.createRun(run);

      const requests = await Promise.all([
        manager.createApproval(
          run,
          "review-node",
          { type: "wait", waitType: "approval", message: "Please approve" },
          run.context,
        ),
        manager.createApproval(
          run,
          "review-node",
          { type: "wait", waitType: "approval", message: "Please approve" },
          run.context,
        ),
      ]);

      assertEquals(requests[0]?.approvalId, requests[1]?.approvalId);
      assertEquals((await backend.getPendingApprovals(run.id)).length, 1);
      assertEquals(notifications, 1, "only the atomically persisted winner may notify");
    });

    it("coalesces ownerless creation across independent managers", async () => {
      let notifications = 0;
      const first = new ApprovalManager({
        backend,
        expirationCheckInterval: 0,
        notifier: () => {
          notifications++;
          return Promise.resolve();
        },
      });
      const second = new ApprovalManager({
        backend,
        expirationCheckInterval: 0,
        notifier: () => {
          notifications++;
          return Promise.resolve();
        },
      });
      const run = createTestRun("run-ownerless-concurrent-approval", { status: "waiting" });
      await backend.createRun(run);

      try {
        const requests = await Promise.all([
          first.createApproval(
            run,
            "review-node",
            { type: "wait", waitType: "approval", message: "Please approve" },
            run.context,
          ),
          second.createApproval(
            run,
            "review-node",
            { type: "wait", waitType: "approval", message: "Please approve" },
            run.context,
          ),
        ]);

        assertEquals(requests[0]?.approvalId, requests[1]?.approvalId);
        assertEquals((await backend.getPendingApprovals(run.id)).length, 1);
        assertEquals(notifications, 1);
      } finally {
        first.stop();
        second.stop();
      }
    });

    it("recognizes a decision claim that wins during ownerless approval persistence", async () => {
      backend = new DecisionClaimDuringApprovalSaveBackend();
      let notifications = 0;
      manager = new ApprovalManager({
        backend,
        expirationCheckInterval: 0,
        decisionClaimCheckInterval: 0,
        notifier: () => {
          notifications++;
          return Promise.resolve();
        },
      });
      const run = createTestRun("run-decision-during-approval-save", { status: "waiting" });
      await backend.createRun(run);

      const request = await manager.createApproval(
        run,
        "review-node",
        { type: "wait", waitType: "approval", message: "Please approve" },
        run.context,
      );

      const [claim] = await backend.listApprovalDecisionClaims(run.id);
      assertExists(claim);
      assertEquals(request.approvalId, claim.approval.id);
      assertEquals(await backend.getPendingApprovals(run.id), []);
      assertEquals(notifications, 0, "the losing creator must not notify for a decided approval");
    });

    it("fails closed when ownerless creation lacks an atomic backend operation", async () => {
      Object.defineProperty(backend, "savePendingApprovalIfAbsent", { value: undefined });
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const run = createTestRun("run-legacy-ownerless-approval", { status: "waiting" });
      await backend.createRun(run);

      await assertRejects(
        () =>
          manager.createApproval(
            run,
            "review-node",
            { type: "wait", waitType: "approval", message: "Please approve" },
            run.context,
          ),
        Error,
        "atomic ownerless approval creation",
      );
      assertEquals(await backend.getPendingApprovals(run.id), []);
    });

    it("validates the timeout before resolving a dynamic payload", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const run = createTestRun("run-invalid-approval-timeout");
      let payloadCalls = 0;
      await backend.createRun(run);

      await assertRejects(
        () =>
          manager.createApproval(
            run,
            "review-node",
            {
              type: "wait",
              waitType: "approval",
              timeout: "not-a-duration",
              payload: () => {
                payloadCalls++;
                return { shouldNotRun: true };
              },
            },
            run.context,
          ),
        Error,
        "Invalid duration format",
      );

      assertEquals(payloadCalls, 0);
      assertEquals(await backend.getPendingApprovals(run.id), []);
    });

    it("isolates persisted approval identity and state from notifier mutation", async () => {
      let notifiedApprovalId: string | undefined;
      let notifiedSchemaIdentity = false;
      manager = new ApprovalManager({
        backend,
        expirationCheckInterval: 0,
        notifier: (approval, notifiedRun) => {
          notifiedApprovalId = approval.id;
          notifiedSchemaIdentity = Object.hasOwn(approval, "responseSchemaId");
          approval.id = "notifier-mutated-approval";
          approval.status = "approved";
          notifiedRun.id = "notifier-mutated-run";
          return Promise.resolve();
        },
      });
      const run = createTestRun("run-notifier-isolation");
      await backend.createRun(run);

      const request = await manager.createApproval(
        run,
        "review-node",
        { type: "wait", waitType: "approval", message: "Please approve" },
        run.context,
        { responseSchemaId: '["steps","review-node"]' },
      );

      assertEquals(request.runId, run.id);
      assertEquals(request.approvalId, notifiedApprovalId);
      assertEquals(notifiedSchemaIdentity, false);
      const persisted = await backend.getPendingApproval(run.id, request.approvalId);
      assertExists(persisted);
      assertEquals(
        getPendingApprovalResponseSchemaId(persisted),
        '["steps","review-node"]',
      );
      assertEquals(persisted.id, request.approvalId);
      assertEquals(persisted.status, "pending");
      assertEquals(await backend.getPendingApprovals("notifier-mutated-run"), []);
    });

    it("keeps a durable owner-bound approval when notification annotation fails", async () => {
      backend = new RejectNotificationErrorUpdateBackend();
      manager = new ApprovalManager({
        backend,
        expirationCheckInterval: 0,
        notifier: () => Promise.reject(new Error("approval delivery unavailable")),
      });
      const run = createTestRun("run-notification-annotation-failure", {
        status: "waiting",
        workerId: "run-execution:current-owner",
      });
      await backend.createRun(run);

      const request = await manager.createApproval(
        run,
        "review-node",
        { type: "wait", waitType: "approval", message: "Please approve" },
        run.context,
      );

      assertEquals(request.notificationError, "approval delivery unavailable");
      const persisted = await backend.getPendingApproval(run.id, request.approvalId);
      assertExists(persisted);
      assertEquals(persisted.status, "pending");
    });

    it("rejects a stale owner before notifying or persisting approval", async () => {
      let notifications = 0;
      manager = new ApprovalManager({
        backend,
        expirationCheckInterval: 0,
        notifier: () => {
          notifications++;
          return Promise.resolve();
        },
      });

      const runId = "run-stale-approval";
      const staleRun = createTestRun(runId, {
        status: "waiting",
        workerId: "run-execution:old-owner",
      });
      await backend.createRun({
        ...staleRun,
        workerId: "run-execution:new-owner",
      });

      await assertRejects(
        () =>
          manager.createApproval(
            staleRun,
            "review-node",
            {
              type: "wait",
              waitType: "approval",
              message: "Please approve",
            },
            staleRun.context,
          ),
        Error,
        "ownership changed",
      );

      assertEquals(notifications, 0);
      assertEquals(await backend.getPendingApprovals(runId), []);
    });

    it("rejects an owner-bound approval unless the run is still waiting", async () => {
      let notifications = 0;
      manager = new ApprovalManager({
        backend,
        expirationCheckInterval: 0,
        notifier: () => {
          notifications++;
          return Promise.resolve();
        },
      });
      const run = createTestRun("run-not-waiting-approval", {
        status: "running",
        workerId: "run-execution:current-owner",
      });
      await backend.createRun(run);

      await assertRejects(
        () =>
          manager.createApproval(
            run,
            "review-node",
            { type: "wait", waitType: "approval", message: "Please approve" },
            run.context,
          ),
        Error,
        "ownership changed before approval persistence",
      );

      assertEquals(notifications, 0);
      assertEquals(await backend.getPendingApprovals(run.id), []);
    });

    it("drops an owner-bound approval schema when the save rejects", async () => {
      backend = new RejectOwnerBoundApprovalSaveBackend();
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const run = createTestRun("run-owner-bound-save-reject", {
        status: "waiting",
        workerId: "run-execution:current-owner",
      });
      await backend.createRun(run);

      await assertRejects(
        () =>
          manager.createApproval(
            run,
            "review-node",
            {
              type: "wait",
              waitType: "approval",
              message: "Please approve",
              responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
            },
            run.context,
          ),
        Error,
        "approval save failed",
      );

      assertEquals(
        (manager as unknown as { responseSchemas: Map<string, unknown> }).responseSchemas.size,
        0,
      );
      assertEquals(await backend.getPendingApprovals(run.id), []);
    });

    it("persists approval with computed expiresAt and resolved payload", async () => {
      using _time = new FakeTime(new Date("2026-08-24T10:00:00.000Z"));
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });

      const runId = "run-create";
      await backend.createRun(createTestRun(runId));

      const waitConfig: WaitNodeConfig = {
        type: "wait",
        waitType: "approval",
        message: "Please approve",
        payload: (ctx: WorkflowContext) => ({
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
      assertEquals(persisted.expiresAt, new Date("2026-08-24T11:00:00.000Z"));
    });

    it("anchors expiresAt to when the approval node started", async () => {
      using _time = new FakeTime(new Date("2026-08-24T10:00:00.000Z"));
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-started-approval-timeout";
      const run = createTestRun(runId, {
        status: "waiting",
        nodeStates: {
          review: {
            nodeId: "review",
            status: "running",
            attempt: 1,
            startedAt: new Date("2026-08-24T09:50:00.000Z"),
          },
        },
      });
      await backend.createRun(run);

      const request = await manager.createApproval(
        run,
        "review",
        { type: "wait", waitType: "approval", timeout: "1h" },
        run.context,
      );

      assertEquals(request.expiresAt, new Date("2026-08-24T10:50:00.000Z"));
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

  describe("createApproval notification failures", () => {
    const failingNotifier = () => Promise.reject(new Error("pager down"));

    it("records a notifier failure on an owner-bound approval", async () => {
      manager = new ApprovalManager({
        backend,
        expirationCheckInterval: 0,
        notifier: failingNotifier,
      });

      const runId = "run-owner-bound-notify-failure";
      await backend.createRun(createTestRun(runId, {
        status: "waiting",
        workerId: "run-execution:current-owner",
      }));

      const request = await manager.createApproval(
        await backend.getRun(runId) as WorkflowRun,
        "review-node",
        { type: "wait", waitType: "approval", message: "Approve please", payload: {} },
        createContext(runId),
      );

      assertEquals(
        request.notificationError,
        "pager down",
        "a failed notification is reported to the caller so it can re-notify",
      );

      const persisted = await backend.getPendingApproval(runId, request.approvalId);
      assertExists(persisted);
      assertEquals(persisted.status, "pending", "the approval survives a failed notification");
      assertEquals(
        persisted.notificationError,
        "pager down",
        "the owner-bound write-back records the delivery failure",
      );
    });

    it("records a notifier failure on an ownerless approval", async () => {
      manager = new ApprovalManager({
        backend,
        expirationCheckInterval: 0,
        notifier: failingNotifier,
      });

      const runId = "run-ownerless-notify-failure";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));

      const request = await manager.createApproval(
        await backend.getRun(runId) as WorkflowRun,
        "review-node",
        { type: "wait", waitType: "approval", message: "Approve please", payload: {} },
        createContext(runId),
      );

      assertEquals(
        request.notificationError,
        "pager down",
        "a failed notification is reported to the caller so it can re-notify",
      );

      const persisted = await backend.getPendingApproval(runId, request.approvalId);
      assertExists(persisted);
      assertEquals(persisted.status, "pending", "the approval survives a failed notification");
      assertEquals(
        persisted.notificationError,
        "pager down",
        "the initial append records the delivery failure",
      );
    });

    it("warns when a backend cannot persist a notifier failure", async () => {
      Object.defineProperty(backend, "updatePendingApproval", { value: undefined });
      manager = new ApprovalManager({
        backend,
        expirationCheckInterval: 0,
        notifier: failingNotifier,
      });
      const messages: string[] = [];
      const unsubscribe = __subscribeLogRecordEmitter((entry) => messages.push(entry.message));
      try {
        const runId = "run-notify-failure-without-patch-support";
        await backend.createRun(createTestRun(runId, { status: "waiting" }));
        await manager.createApproval(
          await backend.getRun(runId) as WorkflowRun,
          "review-node",
          { type: "wait", waitType: "approval", message: "Approve please", payload: {} },
          createContext(runId),
        );
      } finally {
        unsubscribe();
      }

      assertEquals(
        messages.some((message) => message.includes("cannot persist approval notification state")),
        true,
      );
    });
  });

  describe("approval lookup", () => {
    it("falls back to the pending list when direct lookup is unavailable", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-legacy-approval-lookup";
      const approval: PendingApproval = {
        id: "apr-legacy-lookup",
        nodeId: "review",
        message: "Please approve",
        payload: {},
        requestedAt: new Date(),
        status: "pending",
      };
      await backend.createRun(createTestRun(runId));
      await backend.savePendingApproval(runId, approval);
      Object.defineProperty(backend, "getPendingApproval", { value: undefined });

      assertEquals(await manager.getApproval(runId, approval.id), approval);
    });

    it("lists only pending approvals through the backend receiver and filters", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      await backend.createRun(createTestRun("run-list-a", { workflowId: "workflow-a" }));
      await backend.createRun(createTestRun("run-list-b", { workflowId: "workflow-b" }));
      await backend.savePendingApproval("run-list-a", {
        id: "apr-alice",
        nodeId: "review-a",
        message: "Alice",
        payload: {},
        approvers: ["alice"],
        requestedAt: new Date(),
        status: "pending",
      });
      await backend.savePendingApproval("run-list-a", {
        id: "apr-decided",
        nodeId: "review-decided",
        message: "Decided",
        payload: {},
        requestedAt: new Date(),
        status: "pending",
      });
      await backend.updateApproval("run-list-a", "apr-decided", {
        approved: true,
        approver: "alice",
      });
      await backend.savePendingApproval("run-list-b", {
        id: "apr-bob",
        nodeId: "review-b",
        message: "Bob",
        payload: {},
        approvers: ["bob"],
        requestedAt: new Date(),
        status: "pending",
      });

      const all = await manager.listAllPending();
      assertEquals(all.map(({ approval }) => approval.id), ["apr-alice", "apr-bob"]);
      const filtered = await manager.listAllPending({
        workflowId: "workflow-a",
        approver: "alice",
      });
      assertEquals(filtered.map(({ approval }) => approval.id), ["apr-alice"]);
    });
  });

  describe("processDecision", () => {
    it("rejects expired and unauthorized decisions without changing approvals", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-decision-guards";
      await backend.createRun(createTestRun(runId));
      await backend.savePendingApproval(runId, {
        id: "apr-expired-decision",
        nodeId: "expired-review",
        message: "Expired",
        payload: {},
        requestedAt: pastDate(2_000),
        expiresAt: pastDate(1_000),
        status: "pending",
      });
      await backend.savePendingApproval(runId, {
        id: "apr-restricted-decision",
        nodeId: "restricted-review",
        message: "Restricted",
        payload: {},
        approvers: ["alice"],
        requestedAt: new Date(),
        status: "pending",
      });

      await assertRejects(
        () => manager.approve(runId, "apr-expired-decision", "alice"),
        Error,
        "Approval has expired",
      );
      await assertRejects(
        () => manager.approve(runId, "apr-restricted-decision", "mallory"),
        Error,
        "Not authorized",
      );

      assertEquals(
        (await backend.getPendingApproval(runId, "apr-expired-decision"))?.status,
        "pending",
      );
      assertEquals(
        (await backend.getPendingApproval(runId, "apr-restricted-decision"))?.status,
        "pending",
      );
      assertEquals((await backend.getRun(runId))?.nodeStates, {});
    });

    it("rejects a malformed direct decision before changing the approval", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-malformed-direct-decision";
      await backend.createRun(createTestRun(runId));
      const request = await manager.createApproval(
        await backend.getRun(runId) as WorkflowRun,
        "review",
        { type: "wait", waitType: "approval", message: "Please approve" },
        createContext(runId),
      );

      await assertRejects(() =>
        manager.processDecision(runId, request.approvalId, {
          approved: "yes",
          approver: "reviewer",
        } as unknown as ApprovalDecision)
      );

      const persisted = await backend.getPendingApproval(runId, request.approvalId);
      assertExists(persisted);
      assertEquals(persisted.status, "pending");
    });

    it("rejects invalid structured approval data before persisting a direct approval", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-direct-invalid-data";
      await backend.createRun(createTestRun(runId));

      const request = await manager.createApproval(
        await backend.getRun(runId) as WorkflowRun,
        "review",
        {
          type: "wait",
          waitType: "approval",
          message: "Please approve",
          responseSchema: defineSchema((v) =>
            v.object({ correctedName: v.string(), confirmed: v.boolean() })
          )(),
        },
        createContext(runId),
      );

      await assertRejects(() =>
        manager.approve(runId, request.approvalId, "reviewer", undefined, {
          correctedName: 42,
        })
      );

      const pending = await backend.getPendingApprovals(runId);
      assertEquals(pending.length, 1);
      assertEquals(pending[0]?.status, "pending");
    });

    it("rejects omitted structured approval data when the response schema requires it", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-direct-missing-data";
      await backend.createRun(createTestRun(runId));

      const request = await manager.createApproval(
        await backend.getRun(runId) as WorkflowRun,
        "review",
        {
          type: "wait",
          waitType: "approval",
          message: "Please approve",
          responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
        },
        createContext(runId),
      );

      await assertRejects(() => manager.approve(runId, request.approvalId, "reviewer"));

      const pending = await backend.getPendingApprovals(runId);
      assertEquals(pending.length, 1);
      assertEquals(pending[0]?.status, "pending");
    });

    it("projects persisted approvals before invoking the response schema resolver", async () => {
      let resolverSawPrivateSchemaId = false;
      manager = new ApprovalManager({
        backend,
        expirationCheckInterval: 0,
        responseSchemaResolver: ({ approval }) => {
          resolverSawPrivateSchemaId = Object.hasOwn(approval, "responseSchemaId");
          return defineSchema((v) => v.object({ confirmed: v.boolean() }))();
        },
      });
      const runId = "run-direct-resolver-projection";
      await backend.createRun(createTestRun(runId));
      await backend.savePendingApproval(
        runId,
        {
          id: "apr-direct-resolver-projection",
          nodeId: "review",
          message: "Please approve",
          payload: {},
          requestedAt: new Date(),
          status: "pending",
          responseSchemaId: '["steps","review"]',
        } satisfies PersistedPendingApproval,
      );

      await manager.approve(runId, "apr-direct-resolver-projection", "reviewer", undefined, {
        confirmed: true,
      });

      assertEquals(resolverSawPrivateSchemaId, false);
    });

    it("registers a direct approval schema before the persisted approval can be decided", async () => {
      const racingBackend = new DecisionDuringSaveBackend();
      backend = racingBackend;
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      racingBackend.manager = manager;
      const runId = "run-direct-schema-race";
      await backend.createRun(createTestRun(runId));

      const request = await manager.createApproval(
        await backend.getRun(runId) as WorkflowRun,
        "review",
        {
          type: "wait",
          waitType: "approval",
          message: "Please approve",
          responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
        },
        createContext(runId),
      );

      assertExists(racingBackend.decisionError);
      const pending = await backend.getPendingApprovals(runId);
      assertEquals(pending.length, 1);
      assertEquals(pending[0]?.id, request.approvalId);
      assertEquals(pending[0]?.status, "pending");
    });

    it("drops a direct approval schema after a decision is persisted", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-direct-schema-cleanup";
      await backend.createRun(createTestRun(runId));

      const request = await manager.createApproval(
        await backend.getRun(runId) as WorkflowRun,
        "review",
        {
          type: "wait",
          waitType: "approval",
          message: "Please approve",
          responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
        },
        createContext(runId),
      );
      assertEquals(
        (manager as unknown as { responseSchemas: Map<string, unknown> }).responseSchemas.size,
        1,
      );

      await manager.approve(runId, request.approvalId, "reviewer", undefined, {
        confirmed: true,
      });

      assertEquals(
        (manager as unknown as { responseSchemas: Map<string, unknown> }).responseSchemas.size,
        0,
      );
    });

    it("drops a direct approval schema after expiration is persisted", async () => {
      using time = new FakeTime(new Date("2026-08-24T10:00:00.000Z"));
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-expired-schema-cleanup";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));

      const request = await manager.createApproval(
        await backend.getRun(runId) as WorkflowRun,
        "review",
        {
          type: "wait",
          waitType: "approval",
          message: "Please approve",
          timeout: "1ms",
          responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
        },
        createContext(runId),
      );
      assertEquals(
        (manager as unknown as { responseSchemas: Map<string, unknown> }).responseSchemas.size,
        1,
      );

      assertExists(await backend.getPendingApproval(runId, request.approvalId));
      await time.tickAsync(2);

      await manager.checkExpiredApprovals();

      assertEquals(
        (manager as unknown as { responseSchemas: Map<string, unknown> }).responseSchemas.size,
        0,
      );
    });

    it("resumes an owner-bound run with the same worker ID", async () => {
      const resumeCalls: unknown[][] = [];
      const executor = {
        resume: (...args: unknown[]) => {
          resumeCalls.push(args);
          return Promise.resolve();
        },
      } as unknown as WorkflowExecutor;
      manager = new ApprovalManager({ backend, executor, expirationCheckInterval: 0 });
      const runId = "run-owner-bound-decision";
      await backend.createRun(createTestRun(runId, {
        status: "waiting",
        workerId: "worker-current-owner",
      }));
      await backend.savePendingApproval(runId, {
        id: "apr-owner-bound-decision",
        nodeId: "review",
        message: "approve me",
        payload: {},
        requestedAt: new Date(),
        status: "pending",
      });

      await manager.approve(runId, "apr-owner-bound-decision", "reviewer");

      assertEquals(resumeCalls, [[runId, undefined, "worker-current-owner"]]);
      assertEquals(await backend.listApprovalDecisionClaims(runId), []);
    });

    it("recovers a durable approval decision after the deciding process exits", async () => {
      const runId = "run-recover-decision";
      await backend.createRun(createTestRun(runId, {
        status: "waiting",
        workerId: "worker-current-owner",
        nodeStates: {
          review: { nodeId: "review", status: "running", attempt: 1 },
        },
      }));
      await backend.savePendingApproval(runId, {
        id: "apr-recover-decision",
        nodeId: "review",
        message: "approve me",
        payload: {},
        requestedAt: new Date(),
        status: "pending",
      });
      await backend.updateApproval(runId, "apr-recover-decision", {
        approved: true,
        approver: "reviewer",
        comment: "approved after review",
        data: { confirmed: true },
      });
      const resumeCalls: unknown[][] = [];
      const executor = {
        resume: (...args: unknown[]) => {
          resumeCalls.push(args);
          return Promise.resolve();
        },
      } as unknown as WorkflowExecutor;

      manager = new ApprovalManager({
        backend,
        executor,
        expirationCheckInterval: 0,
        decisionClaimRecoveryDelay: 0,
      });
      await manager.checkApprovalDecisionClaims();

      const run = await backend.getRun(runId);
      assertEquals(run?.nodeStates.review?.status, "completed");
      assertEquals(run?.context.review, {
        approved: true,
        approver: "reviewer",
        comment: "approved after review",
        data: { confirmed: true },
        decidedAt: (run?.context.review as { decidedAt: string }).decidedAt,
      });
      assertEquals(resumeCalls, [[runId, undefined, "worker-current-owner"]]);
      assertEquals(await backend.listApprovalDecisionClaims(runId), []);
    });

    it("does not apply an old decision claim to a newer wait instance", async () => {
      const runId = "run-repeated-approval-claim-recovery";
      await backend.createRun(createTestRun(runId, {
        status: "waiting",
        nodeStates: {
          review: {
            nodeId: "review",
            status: "running",
            attempt: 1,
            _waitInstanceId: "wait-2",
          },
        },
      }));
      await backend.savePendingApproval(runId, {
        id: "apr-old-iteration",
        nodeId: "review",
        waitInstanceId: "wait-1",
        message: "approve iteration one",
        requestedAt: new Date(),
        status: "pending",
      });
      await backend.updateApproval(runId, "apr-old-iteration", {
        approved: true,
        approver: "reviewer",
      });
      await backend.savePendingApproval(runId, {
        id: "apr-current-iteration",
        nodeId: "review",
        waitInstanceId: "wait-2",
        message: "approve iteration two",
        requestedAt: new Date(),
        status: "pending",
      });
      const resumeCalls: unknown[][] = [];
      const executor = {
        resume: (...args: unknown[]) => {
          resumeCalls.push(args);
          return Promise.resolve();
        },
      } as unknown as WorkflowExecutor;
      manager = new ApprovalManager({
        backend,
        executor,
        expirationCheckInterval: 0,
        decisionClaimRecoveryDelay: 0,
      });

      await manager.checkApprovalDecisionClaims();

      const run = await backend.getRun(runId);
      assertEquals(run?.nodeStates.review?._waitInstanceId, "wait-2");
      assertEquals(run?.nodeStates.review?.status, "running");
      assertEquals(run?.context.review, undefined);
      assertEquals(resumeCalls, []);
      assertEquals(
        (await backend.getPendingApprovals(runId)).map(({ id }) => id),
        ["apr-current-iteration"],
      );
      assertEquals(await backend.listApprovalDecisionClaims(runId), []);
    });

    it("does not replay an old decision claim while preparing a newer wait for retry", async () => {
      const runId = "run-retry-newer-wait-instance";
      await backend.createRun(createTestRun(runId, {
        status: "pending",
        nodeStates: {
          review: {
            nodeId: "review",
            status: "running",
            attempt: 1,
            _waitInstanceId: "wait-2",
          },
        },
      }));
      await backend.savePendingApproval(runId, {
        id: "apr-retry-old-iteration",
        nodeId: "review",
        message: "approve the old iteration",
        requestedAt: new Date(),
        status: "pending",
        waitInstanceId: "wait-1",
      });
      await backend.updateApproval(runId, "apr-retry-old-iteration", {
        approved: true,
        approver: "reviewer",
      });

      await reconcileApprovalDecisionClaimsBeforeRetry(backend, runId);

      const run = await backend.getRun(runId);
      assertEquals(run?.nodeStates.review?._waitInstanceId, "wait-2");
      assertEquals(run?.nodeStates.review?.status, "running");
      assertEquals(run?.context.review, undefined);
      assertEquals(await backend.listApprovalDecisionClaims(runId), []);
    });

    it("reschedules a young decision claim when periodic sweeping is disabled", async () => {
      using time = new FakeTime(new Date("2026-08-26T10:00:00.000Z"));
      const runId = "run-young-decision-claim";
      await backend.createRun(createTestRun(runId, {
        status: "waiting",
        nodeStates: {
          review: { nodeId: "review", status: "running", attempt: 1 },
        },
      }));
      await backend.savePendingApproval(runId, {
        id: "apr-young-decision-claim",
        nodeId: "review",
        message: "approve me",
        requestedAt: new Date(),
        status: "pending",
      });
      await backend.updateApproval(runId, "apr-young-decision-claim", {
        approved: true,
        approver: "reviewer",
      });
      const executor = { resume: () => Promise.resolve() } as unknown as WorkflowExecutor;

      manager = new ApprovalManager({
        backend,
        executor,
        expirationCheckInterval: 0,
        decisionClaimRecoveryDelay: 30_000,
      });
      await manager.checkApprovalDecisionClaims();
      assertEquals((await backend.getRun(runId))?.nodeStates.review?.status, "running");

      await time.tickAsync(30_000);
      await manager.checkApprovalDecisionClaims();

      assertEquals((await backend.getRun(runId))?.nodeStates.review?.status, "completed");
      assertEquals(await backend.listApprovalDecisionClaims(runId), []);
    });

    it("discovers a decision claim created after no-sweep startup", async () => {
      const resumeCalls: unknown[][] = [];
      const executor = {
        resume: (...args: unknown[]) => {
          resumeCalls.push(args);
          return Promise.resolve();
        },
      } as unknown as WorkflowExecutor;
      manager = new ApprovalManager({
        backend,
        executor,
        expirationCheckInterval: 0,
        decisionClaimRecoveryDelay: 0,
        decisionClaimCheckInterval: 5,
      });
      await manager.checkApprovalDecisionClaims();

      const runId = "run-late-decision-claim";
      await backend.createRun(createTestRun(runId, {
        status: "waiting",
        nodeStates: {
          review: { nodeId: "review", status: "running", attempt: 1 },
        },
      }));
      await backend.savePendingApproval(runId, {
        id: "apr-late-decision-claim",
        nodeId: "review",
        message: "approve me",
        requestedAt: new Date(),
        status: "pending",
      });
      await backend.updateApproval(runId, "apr-late-decision-claim", {
        approved: true,
        approver: "reviewer",
      });

      for (let attempt = 0; attempt < 20; attempt++) {
        if ((await backend.getRun(runId))?.nodeStates.review?.status === "completed") break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      assertEquals((await backend.getRun(runId))?.nodeStates.review?.status, "completed");
      assertEquals(await backend.listApprovalDecisionClaims(runId), []);
      assertEquals(resumeCalls.length, 1);
    });

    it("retains a decision claim when a retryable run failure wins the race", async () => {
      backend = new FailOnApprovalDecisionBackend();
      const executor = { resume: () => Promise.resolve() } as unknown as WorkflowExecutor;
      manager = new ApprovalManager({
        backend,
        executor,
        expirationCheckInterval: 0,
        decisionClaimRecoveryDelay: 0,
      });
      const runId = "run-failed-decision-race";
      await backend.createRun(createTestRun(runId, {
        status: "waiting",
        nodeStates: {
          review: { nodeId: "review", status: "running", attempt: 1 },
        },
      }));
      await backend.savePendingApproval(runId, {
        id: "apr-failed-decision-race",
        nodeId: "review",
        message: "approve me",
        payload: {},
        requestedAt: new Date(),
        status: "pending",
      });

      await manager.approve(runId, "apr-failed-decision-race", "reviewer");

      assertEquals((await backend.listApprovalDecisionClaims(runId)).length, 1);
      await backend.updateRun(runId, {
        status: "waiting",
        error: undefined,
        completedAt: undefined,
      });
      await manager.checkApprovalDecisionClaims();
      assertEquals((await backend.getRun(runId))?.nodeStates.review?.status, "completed");
      assertEquals(await backend.listApprovalDecisionClaims(runId), []);
    });

    it("retains a failed run decision claim beyond one day for a later retry", async () => {
      using time = new FakeTime(new Date("2026-08-26T10:00:00.000Z"));
      backend = new FailOnApprovalDecisionBackend();
      const executor = { resume: () => Promise.resolve() } as unknown as WorkflowExecutor;
      manager = new ApprovalManager({
        backend,
        executor,
        expirationCheckInterval: 0,
        decisionClaimRecoveryDelay: 0,
      });
      const runId = "run-abandoned-failed-decision";
      await backend.createRun(createTestRun(runId, {
        status: "waiting",
        nodeStates: {
          review: { nodeId: "review", status: "running", attempt: 1 },
        },
      }));
      await backend.savePendingApproval(runId, {
        id: "apr-abandoned-failed-decision",
        nodeId: "review",
        message: "approve me",
        payload: {},
        requestedAt: new Date(),
        status: "pending",
      });

      await manager.approve(runId, "apr-abandoned-failed-decision", "reviewer");
      assertEquals((await backend.listApprovalDecisionClaims(runId)).length, 1);

      await time.tickAsync(30 * 24 * 60 * 60 * 1_000);
      await manager.checkApprovalDecisionClaims();

      assertEquals((await backend.listApprovalDecisionClaims(runId)).length, 1);
      assertEquals((await backend.getRun(runId))?.status, "failed");
    });

    it("reconciles a decision when ownership changes during the run patch", async () => {
      backend = new ReclaimDuringDecisionBackend();
      const resumeCalls: unknown[][] = [];
      const executor = {
        resume: (...args: unknown[]) => {
          resumeCalls.push(args);
          return Promise.resolve();
        },
      } as unknown as WorkflowExecutor;
      manager = new ApprovalManager({ backend, executor, expirationCheckInterval: 0 });
      const runId = "run-reclaimed-during-decision";
      await backend.createRun(createTestRun(runId, {
        status: "waiting",
        workerId: "worker-original-owner",
      }));
      await backend.savePendingApproval(runId, {
        id: "apr-reclaimed-during-decision",
        nodeId: "review",
        message: "approve me",
        payload: {},
        requestedAt: new Date(),
        status: "pending",
      });

      await manager.approve(runId, "apr-reclaimed-during-decision", "reviewer");

      const reconciledRun = await backend.getRun(runId);
      assertEquals(reconciledRun?.workerId, "worker-replacement-owner");
      assertEquals(
        (reconciledRun?.context.review as { approved?: boolean })?.approved,
        true,
      );
      assertEquals(resumeCalls, [[runId, undefined, "worker-replacement-owner"]]);
    });

    it("retries resume when ownership changes after the run patch", async () => {
      const resumeCalls: unknown[][] = [];
      const executor = {
        resume: async (...args: unknown[]) => {
          resumeCalls.push(args);
          if (resumeCalls.length === 1) {
            await backend.updateRun(String(args[0]), { workerId: "worker-replacement-owner" });
            throw new Error("execution ownership has changed");
          }
        },
      } as unknown as WorkflowExecutor;
      manager = new ApprovalManager({ backend, executor, expirationCheckInterval: 0 });
      const runId = "run-reclaimed-before-resume";
      await backend.createRun(createTestRun(runId, {
        status: "waiting",
        workerId: "worker-original-owner",
      }));
      await backend.savePendingApproval(runId, {
        id: "apr-reclaimed-before-resume",
        nodeId: "review",
        message: "approve me",
        payload: {},
        requestedAt: new Date(),
        status: "pending",
      });

      await manager.approve(runId, "apr-reclaimed-before-resume", "reviewer");

      assertEquals(resumeCalls, [
        [runId, undefined, "worker-original-owner"],
        [runId, undefined, "worker-replacement-owner"],
      ]);
    });

    it("refuses a decision from an approver outside the approvers list", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });

      const runId = "run-unauthorized-approver";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));

      const request = await manager.createApproval(
        await backend.getRun(runId) as WorkflowRun,
        "decision-node",
        {
          type: "wait",
          waitType: "approval",
          message: "Approve please",
          payload: { ticket: 1 },
          approvers: ["alice"],
        },
        createContext(runId),
      );

      await assertRejects(
        () => manager.approve(runId, request.approvalId, "mallory"),
        Error,
        "Not authorized to approve this request",
      );

      const untouched = await backend.getPendingApproval(runId, request.approvalId);
      assertExists(untouched);
      assertEquals(
        untouched.status,
        "pending",
        "a refused approver must not resolve the approval",
      );

      const run = await backend.getRun(runId);
      assertExists(run);
      assertEquals(run.status, "waiting", "a refused approver must not advance the run");
      assertEquals(
        run.context["decision-node"],
        undefined,
        "a refused approver must not record a decision on the run context",
      );
    });

    it("refuses concurrent approvals before mutating a replacement-semantics backend", async () => {
      Object.defineProperty(backend, "supportsRunPatchKeyMerge", { value: false });
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-replacement-concurrent-approvals";
      await backend.createRun(createTestRun(runId, {
        status: "waiting",
        nodeStates: {
          reviewA: { nodeId: "reviewA", status: "running", attempt: 1 },
          reviewB: { nodeId: "reviewB", status: "running", attempt: 1 },
        },
      }));
      await backend.savePendingApproval(runId, {
        id: "apr-replacement-a",
        nodeId: "reviewA",
        message: "approve A",
        requestedAt: new Date(),
        status: "pending",
      });
      await backend.savePendingApproval(runId, {
        id: "apr-replacement-b",
        nodeId: "reviewB",
        message: "approve B",
        requestedAt: new Date(),
        status: "pending",
      });

      await assertRejects(
        () => manager.approve(runId, "apr-replacement-a", "reviewer"),
        Error,
        "Concurrent approval outcomes require",
      );

      assertEquals(
        (await backend.getPendingApprovals(runId)).map(({ status }) => status),
        ["pending", "pending"],
      );
      assertEquals(await backend.listApprovalDecisionClaims(runId), []);
      assertEquals((await backend.getRun(runId))?.context.reviewA, undefined);
      assertEquals((await backend.getRun(runId))?.context.reviewB, undefined);
    });

    it("refuses a decision on an already-expired approval", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });

      const runId = "run-expired-decision";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));
      await backend.savePendingApproval(runId, {
        id: "apr-expired-decision",
        nodeId: "review",
        message: "approve me",
        payload: {},
        requestedAt: pastDate(2000),
        expiresAt: pastDate(1000),
        status: "pending",
      });

      await assertRejects(
        () => manager.approve(runId, "apr-expired-decision", "reviewer"),
        Error,
        "Approval has expired",
      );

      const untouched = await backend.getPendingApproval(runId, "apr-expired-decision");
      assertExists(untouched);
      assertEquals(
        untouched.status,
        "pending",
        "a decision past expiresAt must leave the approval pending",
      );

      const run = await backend.getRun(runId);
      assertExists(run);
      assertEquals(run.status, "waiting", "an expired decision must not advance the run");
      assertEquals(
        run.context.review,
        undefined,
        "an expired decision must not be recorded on the run context",
      );
    });

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

    it("does not overwrite cancellation while rejecting an approval", async () => {
      backend = new CancelOnApprovalDecisionBackend();
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-rejection-cancelled";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));
      await backend.savePendingApproval(runId, {
        id: "apr-rejection-cancelled",
        nodeId: "review",
        message: "reject me",
        payload: {},
        requestedAt: new Date(),
        status: "pending",
      });

      await manager.reject(runId, "apr-rejection-cancelled", "reviewer", "no");

      const run = await backend.getRun(runId);
      assertExists(run);
      assertEquals(run.status, "cancelled");
      assertEquals(run.error, undefined);
    });
  });
});
