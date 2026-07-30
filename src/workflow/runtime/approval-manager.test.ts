import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ApprovalManager } from "./approval-manager.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { WorkflowExecutor } from "../executor/workflow-executor.ts";
import type { PendingApproval, WaitNodeConfig, WorkflowContext, WorkflowRun } from "../types.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS } from "../limits.ts";
import {
  captureApprovalDecisionTiming,
  capturePendingApprovalMetadataUpdate,
} from "../backends/types.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

class CancelOnApprovalDecisionBackend extends MemoryBackend {
  override async updateApproval(
    runId: string,
    approvalId: string,
    decision: Parameters<MemoryBackend["updateApproval"]>[2],
    timing: Parameters<MemoryBackend["updateApproval"]>[3],
  ): Promise<boolean> {
    const applied = await super.updateApproval(runId, approvalId, decision, timing);
    await super.updateRun(runId, { status: "cancelled", completedAt: new Date() });
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

class NonBooleanApprovalDecisionBackend extends MemoryBackend {
  override updateApproval(): Promise<boolean> {
    return Promise.resolve(undefined as unknown as boolean);
  }
}

class DelayedApprovalReadBackend extends MemoryBackend {
  readonly readStarted = Promise.withResolvers<void>();
  readonly continueRead = Promise.withResolvers<void>();

  override async getApproval(
    runId: string,
    approvalId: string,
  ): Promise<PendingApproval | null> {
    this.readStarted.resolve();
    await this.continueRead.promise;
    return await super.getApproval(runId, approvalId);
  }
}

type ApprovalReadSurface = "getApproval" | "getPendingApprovals" | "listAllPending";

class GatedApprovalReadSurfaceBackend extends MemoryBackend {
  readonly readStarted = Promise.withResolvers<void>();
  readonly continueRead = Promise.withResolvers<void>();
  readonly calls: Record<ApprovalReadSurface, number> = {
    getApproval: 0,
    getPendingApprovals: 0,
    listAllPending: 0,
  };

  constructor(private readonly gatedSurface?: ApprovalReadSurface) {
    super();
  }

  private async gate(surface: ApprovalReadSurface): Promise<void> {
    if (surface !== this.gatedSurface) return;
    this.readStarted.resolve();
    await this.continueRead.promise;
  }

  override async getApproval(
    runId: string,
    approvalId: string,
  ): Promise<PendingApproval | null> {
    this.calls.getApproval++;
    await this.gate("getApproval");
    return await super.getApproval(runId, approvalId);
  }

  override async getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    this.calls.getPendingApprovals++;
    await this.gate("getPendingApprovals");
    return await super.getPendingApprovals(runId);
  }

  override async listPendingApprovals(filter?: {
    workflowId?: string;
    approver?: string;
    status?: "pending" | "expired";
  }): Promise<Array<{ runId: string; approval: PendingApproval }>> {
    this.calls.listAllPending++;
    await this.gate("listAllPending");
    return await super.listPendingApprovals(filter);
  }
}

class GatedApprovalDecisionBackend extends MemoryBackend {
  readonly decisionStarted = Promise.withResolvers<void>();
  readonly continueDecision = Promise.withResolvers<void>();

  override async updateApproval(
    runId: string,
    approvalId: string,
    decision: Parameters<MemoryBackend["updateApproval"]>[2],
    timing: Parameters<MemoryBackend["updateApproval"]>[3],
  ): Promise<boolean> {
    this.decisionStarted.resolve();
    await this.continueDecision.promise;
    return await super.updateApproval(runId, approvalId, decision, timing);
  }
}

class FailOnceAfterApprovalBackend extends MemoryBackend {
  private armed = false;
  private failed = false;

  constructor(private readonly failure: "get-run" | "update-run") {
    super();
  }

  override async updateApproval(
    runId: string,
    approvalId: string,
    decision: Parameters<MemoryBackend["updateApproval"]>[2],
    timing: Parameters<MemoryBackend["updateApproval"]>[3],
  ): Promise<boolean> {
    const applied = await super.updateApproval(runId, approvalId, decision, timing);
    if (applied) this.armed = true;
    return applied;
  }

  override getRun(runId: string): Promise<WorkflowRun | null> {
    if (this.armed && !this.failed && this.failure === "get-run") {
      this.failed = true;
      return Promise.reject(new Error("transient run read failure"));
    }
    return super.getRun(runId);
  }

  override updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (this.armed && !this.failed && this.failure === "update-run") {
      this.failed = true;
      return Promise.reject(new Error("transient run update failure"));
    }
    return super.updateRunIfStatus(runId, expectedStatuses, patch);
  }
}

class ExpirationTrackingBackend extends MemoryBackend {
  readonly firstExpirationCheck = Promise.withResolvers<void>();
  expirationChecks = 0;

  override listPendingApprovals(filter?: {
    workflowId?: string;
    approver?: string;
    status?: "pending" | "expired";
  }): Promise<Array<{ runId: string; approval: PendingApproval }>> {
    this.expirationChecks++;
    this.firstExpirationCheck.resolve();
    return super.listPendingApprovals(filter);
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

  function invokeApprovalRead(
    target: ApprovalManager,
    surface: ApprovalReadSurface,
  ): Promise<unknown> {
    switch (surface) {
      case "getApproval":
        return target.getApproval("missing-run", "missing-approval");
      case "getPendingApprovals":
        return target.getPendingApprovals("missing-run");
      case "listAllPending":
        return target.listAllPending();
    }
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
    it("rejects invalid expiration intervals and incomplete backends", () => {
      for (
        const interval of [
          -1,
          0.5,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          MAX_TIMER_DELAY_MS + 1,
          Number.MAX_SAFE_INTEGER,
        ]
      ) {
        assertThrows(
          () =>
            new ApprovalManager({
              backend,
              expirationCheckInterval: interval,
            }),
          Error,
          "expirationCheckInterval",
        );
      }

      const incompleteBackend = Object.create(backend) as MemoryBackend;
      Object.defineProperty(incompleteBackend, "listPendingApprovals", {
        value: undefined,
        configurable: true,
      });
      assertThrows(
        () =>
          new ApprovalManager({
            backend: incompleteBackend,
            expirationCheckInterval: 0,
          }),
        Error,
        "must implement listPendingApprovals",
      );

      const missingApprovalLookup = Object.create(backend) as MemoryBackend;
      Object.defineProperty(missingApprovalLookup, "getApproval", {
        value: undefined,
        configurable: true,
      });
      assertThrows(
        () =>
          new ApprovalManager({
            backend: missingApprovalLookup,
            expirationCheckInterval: 0,
          }),
        Error,
        "must implement getApproval",
      );
      assertThrows(
        () =>
          new ApprovalManager({
            backend,
            autoStartExpirationChecks: "yes" as never,
          }),
        Error,
        "autoStartExpirationChecks must be a boolean",
      );
    });

    it("starts expiration checks by default", async () => {
      const trackingBackend = new ExpirationTrackingBackend();
      manager = new ApprovalManager({
        backend: trackingBackend,
        expirationCheckInterval: 1,
      });

      await trackingBackend.firstExpirationCheck.promise;
      assertEquals(trackingBackend.expirationChecks > 0, true);
      await manager.destroy();
    });

    it("keeps paused checks dormant until an idempotent explicit start", async () => {
      const trackingBackend = new ExpirationTrackingBackend();
      manager = new ApprovalManager({
        backend: trackingBackend,
        expirationCheckInterval: 1,
        autoStartExpirationChecks: false,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      assertEquals(trackingBackend.expirationChecks, 0);

      manager.startExpirationChecks();
      manager.startExpirationChecks();
      await trackingBackend.firstExpirationCheck.promise;
      assertEquals(trackingBackend.expirationChecks > 0, true);
      await manager.destroy();
    });

    it("does not auto-expire approvals when expirationCheckInterval is 0", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });

      const runId = "run-no-timer";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));

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

      const stillPending = await backend.getApproval(runId, "apr-expired");
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

      await backend.createRun(createTestRun("run-a", { status: "waiting" }));
      await backend.createRun(createTestRun("run-b", { status: "waiting" }));
      await backend.createRun(createTestRun("run-c", { status: "waiting" }));

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

      const a = await backend.getApproval("run-a", "apr-a");
      const b = await backend.getApproval("run-b", "apr-b");
      const c = await backend.getApproval("run-c", "apr-c");

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
      assertEquals(runC?.status, "waiting");
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

    it("fails closed when expiry CAS returns a non-boolean", async () => {
      backend = new NonBooleanApprovalDecisionBackend();
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-expiry-invalid-result";
      const approvalId = "apr-expiry-invalid-result";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));
      await backend.savePendingApproval(runId, {
        id: approvalId,
        nodeId: "review",
        message: "expired",
        payload: {},
        requestedAt: pastDate(2_000),
        expiresAt: pastDate(1_000),
        status: "pending",
      });

      await assertRejects(
        () => manager.checkExpiredApprovals(),
        Error,
        "updateApproval must resolve to a boolean",
      );
      assertEquals((await backend.getRun(runId))?.status, "waiting");
      assertEquals(
        (await backend.getApproval(runId, approvalId))?.status,
        "pending",
      );
    });

    it("retries run reconciliation after a durable expiry decision", async () => {
      backend = new FailOnceAfterApprovalBackend("update-run");
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-expiry-reconciliation-retry";
      const approvalId = "apr-expiry-reconciliation-retry";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));
      await backend.savePendingApproval(runId, {
        id: approvalId,
        nodeId: "review",
        message: "expired",
        payload: {},
        requestedAt: pastDate(2_000),
        expiresAt: pastDate(1_000),
        status: "pending",
      });

      await assertRejects(
        () => manager.checkExpiredApprovals(),
        Error,
        "transient run update failure",
      );
      const durable = await backend.getApproval(runId, approvalId);
      assertEquals(durable?.status, "rejected");
      assertEquals(durable?.decidedBy, "system");
      const originalDecidedAt = durable?.decidedAt;
      assertExists(originalDecidedAt);
      assertEquals((await backend.getRun(runId))?.status, "waiting");

      await manager.checkExpiredApprovals();

      const recovered = await backend.getApproval(runId, approvalId);
      assertEquals(recovered?.decidedAt, originalDecidedAt);
      const run = await backend.getRun(runId);
      assertEquals(run?.status, "failed");
      assertEquals(run?.completedAt, originalDecidedAt);
    });
  });

  describe("createApproval", () => {
    it("durably records an owner-bound notification failure", async () => {
      manager = new ApprovalManager({
        backend,
        expirationCheckInterval: 0,
        notifier: () => Promise.reject(new Error("notification transport failed")),
      });
      const run = createTestRun("run-notification-failure", {
        status: "waiting",
        workerId: "worker-current-owner",
      });
      await backend.createRun(run);

      const request = await manager.createApproval(
        run,
        "review-node",
        { type: "wait", waitType: "approval", message: "Please approve" },
        run.context,
      );

      assertEquals(request.notificationError, "notification transport failed");
      assertEquals(
        (await backend.getApproval(run.id, request.approvalId))
          ?.notificationError,
        "notification transport failed",
      );
    });

    for (const ownerBound of [false, true]) {
      it(
        `isolates canonical ${
          ownerBound ? "owner-bound" : "ownerless"
        } approval state from notifier mutation`,
        async () => {
          let frozenSnapshots = 0;
          manager = new ApprovalManager({
            backend,
            expirationCheckInterval: 0,
            notifier: (approval, notifiedRun) => {
              for (
                const mutate of [
                  () => Object.assign(approval, { id: "forged", status: "approved" }),
                  () => Object.assign(notifiedRun, { id: "forged-run", workerId: "attacker" }),
                  () => {
                    (approval.payload as { nested: { value: string } }).nested.value = "forged";
                  },
                ]
              ) {
                try {
                  mutate();
                } catch {
                  frozenSnapshots++;
                }
              }
              return Promise.resolve();
            },
          });
          const run = createTestRun(`run-notifier-snapshot-${ownerBound}`, {
            status: "waiting",
            ...(ownerBound ? { workerId: "worker-current-owner" } : {}),
          });
          await backend.createRun(run);

          const request = await manager.createApproval(
            run,
            "review-node",
            {
              type: "wait",
              waitType: "approval",
              message: "Canonical message",
              payload: { nested: { value: "canonical" } },
            },
            run.context,
          );

          assertEquals(frozenSnapshots, 3);
          assertEquals(request.runId, run.id);
          assertEquals(request.nodeId, "review-node");
          const stored = await backend.getApproval(run.id, request.approvalId);
          assertEquals(stored?.id, request.approvalId);
          assertEquals(stored?.status, "pending");
          assertEquals(stored?.payload, { nested: { value: "canonical" } });
          assertEquals(await backend.getApproval("forged-run", "forged"), null);
        },
      );
    }

    it("reserves an ownerless approval before an asynchronous notifier", async () => {
      const notifierStarted = Promise.withResolvers<void>();
      const continueNotifier = Promise.withResolvers<void>();
      let persistedDuringNotification = false;
      manager = new ApprovalManager({
        backend,
        expirationCheckInterval: 0,
        notifier: async (approval, run) => {
          persistedDuringNotification =
            (await backend.getApproval(run.id, approval.id))?.status === "pending";
          notifierStarted.resolve();
          await continueNotifier.promise;
        },
      });
      const run = createTestRun("run-ownerless-notifier-reservation", {
        status: "waiting",
      });
      await backend.createRun(run);

      const creation = manager.createApproval(
        run,
        "review-node",
        { type: "wait", waitType: "approval", message: "Review" },
        run.context,
      );
      await notifierStarted.promise;
      await backend.updateRun(run.id, { status: "cancelled", completedAt: new Date() });
      continueNotifier.resolve();
      const request = await creation;

      assertEquals(persistedDuringNotification, true);
      assertEquals((await backend.getApproval(run.id, request.approvalId))?.status, "pending");
      assertEquals(await backend.getPendingApprovals(run.id), []);
      assertEquals((await backend.getRun(run.id))?.pendingApprovals, []);
    });

    it("captures run and wait configuration before an asynchronous payload resolves", async () => {
      const payloadStarted = Promise.withResolvers<void>();
      const continuePayload = Promise.withResolvers<void>();
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const run = createTestRun("run-gated-approval-capture", {
        status: "waiting",
        workerId: "worker-original",
      });
      await backend.createRun(run);
      const waitConfig: WaitNodeConfig = {
        type: "wait",
        waitType: "approval",
        message: "Original message",
        approvers: ["original-reviewer"],
        timeout: 10_000,
        payload: async () => {
          payloadStarted.resolve();
          await continuePayload.promise;
          return { nested: { value: "original" } };
        },
      };

      const creation = manager.createApproval(run, "review-node", waitConfig, run.context);
      await payloadStarted.promise;
      Object.assign(run, {
        id: "forged-run",
        status: "cancelled",
        workerId: "worker-attacker",
      });
      Object.assign(waitConfig, {
        message: "Forged message",
        approvers: ["attacker"],
        timeout: 0,
        payload: { forged: true },
      });
      continuePayload.resolve();

      const request = await creation;
      assertEquals(request.runId, "run-gated-approval-capture");
      assertEquals(request.message, "Original message");
      const stored = await backend.getApproval(request.runId, request.approvalId);
      assertEquals(stored?.approvers, ["original-reviewer"]);
      assertEquals(stored?.payload, { nested: { value: "original" } });
      assertExists(stored?.expiresAt);
    });

    it("rejects zero, empty, and overflowing approval timeouts before resolving payload", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const run = createTestRun("run-invalid-approval-timeout", { status: "waiting" });
      await backend.createRun(run);
      let payloadCalls = 0;
      const cases: Array<{ timeout: string | number; message: string }> = [
        { timeout: 0, message: "greater than zero" },
        { timeout: "", message: "Invalid duration format" },
        { timeout: MAX_TIMER_DELAY_MS + 1, message: "cannot exceed" },
      ];
      for (const { timeout, message } of cases) {
        await assertRejects(
          () =>
            manager.createApproval(
              run,
              "review-node",
              {
                type: "wait",
                waitType: "approval",
                timeout,
                payload: () => {
                  payloadCalls++;
                  return {};
                },
              },
              run.context,
            ),
          Error,
          message,
        );
      }
      assertEquals(payloadCalls, 0);
      assertEquals(await backend.getPendingApprovals(run.id), []);
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
        "only while run is waiting",
      );

      assertEquals(notifications, 0);
      assertEquals(await backend.getPendingApprovals(run.id), []);
    });

    it("persists approval with computed expiresAt and resolved payload", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });

      const runId = "run-create";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));

      const before = Date.now();
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

      const after = Date.now();

      assertExists(request.approvalId);
      assertEquals(request.runId, runId);
      assertEquals(request.nodeId, "review-node");
      assertEquals(request.message, "Please approve");

      const persisted = await backend.getApproval(runId, request.approvalId);
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
      await backend.createRun(createTestRun(runId, { status: "waiting" }));

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

      const persisted = await backend.getApproval(runId, request.approvalId);
      assertExists(persisted);
      assertEquals(persisted.expiresAt, undefined);
      assertEquals(persisted.payload, { foo: "bar" });
    });
  });

  describe("processDecision", () => {
    it("validates and snapshots the caller-supplied decision identity", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      for (const approver of ["", " ", " reviewer", "reviewer "]) {
        await assertRejects(
          () =>
            manager.processDecision("missing", "missing", {
              approved: true,
              approver,
            }),
          Error,
          "canonical non-empty string",
        );
      }
      await assertRejects(
        () =>
          manager.processDecision("missing", "missing", {
            approved: "yes",
            approver: "reviewer",
          } as never),
        Error,
        "approved must be a boolean",
      );

      backend = new DelayedApprovalReadBackend();
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-decision-snapshot";
      const approvalId = "apr-decision-snapshot";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));
      await backend.savePendingApproval(runId, {
        id: approvalId,
        nodeId: "review",
        message: "approve me",
        payload: {},
        approvers: ["reviewer"],
        requestedAt: new Date(),
        status: "pending",
      });
      const decision = { approved: true, approver: "reviewer", comment: "original" };
      const processing = manager.processDecision(runId, approvalId, decision);
      await (backend as DelayedApprovalReadBackend).readStarted.promise;
      decision.approver = "attacker";
      decision.comment = "mutated";
      (backend as DelayedApprovalReadBackend).continueRead.resolve();
      await processing;

      const persisted = await backend.getApproval(runId, approvalId);
      assertEquals(persisted?.decidedBy, "reviewer");
      assertEquals(persisted?.comment, "original");
    });

    it("rejects hostile decision shapes without invoking caller hooks", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      let proxyHooks = 0;
      const proxiedDecision = new Proxy(
        { approved: true, approver: "reviewer", comment: "safe" },
        {
          get(target, key, receiver) {
            proxyHooks++;
            return Reflect.get(target, key, receiver);
          },
          getOwnPropertyDescriptor(target, key) {
            proxyHooks++;
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
          getPrototypeOf(target) {
            proxyHooks++;
            return Reflect.getPrototypeOf(target);
          },
          ownKeys(target) {
            proxyHooks++;
            return Reflect.ownKeys(target);
          },
        },
      );

      await assertRejects(
        () => manager.processDecision("missing", "missing", proxiedDecision),
        Error,
        "plain data object",
      );
      assertEquals(proxyHooks, 0);

      let accessorHooks = 0;
      const accessorDecision = Object.create(null) as Record<string, unknown>;
      for (
        const [key, value] of [
          ["approved", true],
          ["approver", "reviewer"],
          ["comment", "safe"],
        ] as const
      ) {
        Object.defineProperty(accessorDecision, key, {
          enumerable: true,
          get() {
            accessorHooks++;
            return value;
          },
        });
      }
      await assertRejects(
        () => manager.processDecision("missing", "missing", accessorDecision as never),
        Error,
        "enumerable data properties",
      );
      assertEquals(accessorHooks, 0);

      await assertRejects(
        () =>
          manager.processDecision("missing", "missing", {
            approved: true,
            approver: "reviewer",
            unexpected: true,
          } as never),
        Error,
        "must contain only",
      );

      const hiddenApproved = { approver: "reviewer" } as Record<string, unknown>;
      Object.defineProperty(hiddenApproved, "approved", {
        value: true,
        enumerable: false,
      });
      await assertRejects(
        () => manager.processDecision("missing", "missing", hiddenApproved as never),
        Error,
        "enumerable data properties",
      );
    });

    it("bounds approval decision identity and comment snapshots", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const oversized = "x".repeat(MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS + 1);

      await assertRejects(
        () =>
          manager.processDecision("missing", "missing", {
            approved: true,
            approver: oversized,
          }),
        Error,
        "at most",
      );
      await assertRejects(
        () =>
          manager.processDecision("missing", "missing", {
            approved: true,
            approver: "reviewer",
            comment: oversized,
          }),
        Error,
        "at most",
      );
    });

    it("does not treat an empty persisted approver allowlist as unrestricted", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-empty-approvers";
      const approvalId = "apr-empty-approvers";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));
      await backend.savePendingApproval(runId, {
        id: approvalId,
        nodeId: "review",
        message: "approve me",
        payload: {},
        approvers: [],
        requestedAt: new Date(),
        status: "pending",
      });

      await assertRejects(
        () => manager.approve(runId, approvalId, "reviewer"),
        Error,
        "Persisted approval approvers",
      );
      assertEquals(
        (await backend.getApproval(runId, approvalId))?.status,
        "pending",
      );
    });

    it("fails closed when a backend violates the atomic decision contract", async () => {
      backend = new NonBooleanApprovalDecisionBackend();
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-invalid-decision-result";
      const approvalId = "apr-invalid-decision-result";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));
      await backend.savePendingApproval(runId, {
        id: approvalId,
        nodeId: "review",
        message: "approve me",
        payload: {},
        requestedAt: new Date(),
        status: "pending",
      });

      await assertRejects(
        () => manager.approve(runId, approvalId, "reviewer"),
        Error,
        "updateApproval must resolve to a boolean",
      );

      assertEquals((await backend.getRun(runId))?.status, "waiting");
      assertEquals(
        (await backend.getApproval(runId, approvalId))?.status,
        "pending",
      );
    });

    it("rejects a decision when persisted expiry changes before the atomic write", async () => {
      backend = new GatedApprovalDecisionBackend();
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-expiry-cas-race";
      const approvalId = "apr-expiry-cas-race";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));
      await backend.savePendingApproval(runId, {
        id: approvalId,
        nodeId: "review",
        message: "approve me",
        payload: {},
        requestedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        status: "pending",
      });

      const processing = manager.approve(runId, approvalId, "reviewer");
      await (backend as GatedApprovalDecisionBackend).decisionStarted.promise;
      const unsafeState = backend as unknown as {
        approvals: Map<string, PendingApproval[]>;
      };
      unsafeState.approvals.get(runId)![0]!.expiresAt = pastDate(1_000);
      (backend as GatedApprovalDecisionBackend).continueDecision.resolve();

      await assertRejects(() => processing, Error, "Approval has expired");
      assertEquals((await backend.getApproval(runId, approvalId))?.status, "pending");
      assertEquals((await backend.getRun(runId))?.status, "waiting");
    });

    for (const failure of ["get-run", "update-run"] as const) {
      it(`retries an identical durable decision after a transient ${failure} failure`, async () => {
        backend = new FailOnceAfterApprovalBackend(failure);
        manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
        const runId = `run-decision-retry-${failure}`;
        const approvalId = `apr-decision-retry-${failure}`;
        await backend.createRun(createTestRun(runId, { status: "waiting" }));
        await backend.savePendingApproval(runId, {
          id: approvalId,
          nodeId: "review",
          message: "approve me",
          payload: {},
          requestedAt: new Date(),
          status: "pending",
        });
        const decision = {
          approved: true,
          approver: "reviewer",
          comment: "same decision",
        };

        await assertRejects(
          () => manager.processDecision(runId, approvalId, decision),
          Error,
          failure === "get-run" ? "transient run read failure" : "transient run update failure",
        );
        const durable = await backend.getApproval(runId, approvalId);
        const originalDecidedAt = durable?.decidedAt;
        assertEquals(durable?.status, "approved");
        assertExists(originalDecidedAt);

        await manager.processDecision(runId, approvalId, decision);

        assertEquals(
          (await backend.getApproval(runId, approvalId))?.decidedAt,
          originalDecidedAt,
        );
        assertEquals(
          ((await backend.getRun(runId))?.context.review as { approved?: boolean })?.approved,
          true,
        );
      });
    }

    it("does not reconcile an idempotent retry from ambiguous duplicate history", async () => {
      backend = new FailOnceAfterApprovalBackend("get-run");
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-duplicate-history-retry";
      const approvalId = "apr-duplicate-history-retry";
      const decision = {
        approved: true,
        approver: "reviewer",
        comment: "same decision",
      };
      await backend.createRun(createTestRun(runId, { status: "waiting" }));
      await backend.savePendingApproval(runId, {
        id: approvalId,
        nodeId: "review",
        message: "approve me",
        payload: {},
        requestedAt: new Date(),
        status: "pending",
      });

      await assertRejects(
        () => manager.processDecision(runId, approvalId, decision),
        Error,
        "transient run read failure",
      );
      const unsafeState = backend as unknown as {
        approvals: Map<string, PendingApproval[]>;
      };
      const approvals = unsafeState.approvals.get(runId)!;
      approvals.push(structuredClone(approvals[0]!));

      await assertRejects(
        () => manager.processDecision(runId, approvalId, decision),
        Error,
        "Duplicate approval id stored",
      );
      assertEquals((await backend.getRun(runId))?.status, "waiting");
    });

    it("rejects a conflicting retry after the original decision is durable", async () => {
      backend = new FailOnceAfterApprovalBackend("get-run");
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-conflicting-decision-retry";
      const approvalId = "apr-conflicting-decision-retry";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));
      await backend.savePendingApproval(runId, {
        id: approvalId,
        nodeId: "review",
        message: "approve me",
        payload: {},
        requestedAt: new Date(),
        status: "pending",
      });

      await assertRejects(
        () => manager.approve(runId, approvalId, "reviewer", "original"),
        Error,
        "transient run read failure",
      );
      const original = await backend.getApproval(runId, approvalId);
      await assertRejects(
        () => manager.reject(runId, approvalId, "reviewer", "conflict"),
        Error,
        "different decision",
      );
      const durable = await backend.getApproval(runId, approvalId);
      assertEquals(durable?.status, "approved");
      assertEquals(durable?.comment, "original");
      assertEquals(durable?.decidedAt, original?.decidedAt);
    });

    it("retries resume after the exact approval decision is already durable", async () => {
      let resumeCalls = 0;
      const executor = {
        resume: () => {
          resumeCalls++;
          return resumeCalls === 1
            ? Promise.reject(new Error("transient resume failure"))
            : Promise.resolve();
        },
      } as unknown as WorkflowExecutor;
      manager = new ApprovalManager({ backend, executor, expirationCheckInterval: 0 });
      const runId = "run-resume-decision-retry";
      const approvalId = "apr-resume-decision-retry";
      await backend.createRun(createTestRun(runId, {
        status: "waiting",
        workerId: "worker-current-owner",
      }));
      await backend.savePendingApproval(runId, {
        id: approvalId,
        nodeId: "review",
        message: "approve me",
        payload: {},
        requestedAt: new Date(),
        status: "pending",
      });

      await assertRejects(
        () => manager.approve(runId, approvalId, "reviewer"),
        Error,
        "transient resume failure",
      );
      const originalDecidedAt = (await backend.getApproval(runId, approvalId))?.decidedAt;
      assertExists(originalDecidedAt);
      assertEquals((await backend.getRun(runId))?.status, "waiting");

      await manager.approve(runId, approvalId, "reviewer");

      assertEquals(resumeCalls, 2);
      assertEquals(
        (await backend.getApproval(runId, approvalId))?.decidedAt,
        originalDecidedAt,
      );
    });

    it("atomically rejects a pending decision after the run becomes terminal", async () => {
      backend = new GatedApprovalDecisionBackend();
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-terminal-decision-race";
      const approvalId = "apr-terminal-decision-race";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));
      await backend.savePendingApproval(runId, {
        id: approvalId,
        nodeId: "review",
        message: "approve me",
        payload: {},
        requestedAt: new Date(),
        status: "pending",
      });

      const processing = manager.approve(runId, approvalId, "reviewer");
      await (backend as GatedApprovalDecisionBackend).decisionStarted.promise;
      await backend.updateRun(runId, { status: "cancelled", completedAt: new Date() });
      (backend as GatedApprovalDecisionBackend).continueDecision.resolve();

      await assertRejects(() => processing, Error, "run is cancelled");
      assertEquals((await backend.getApproval(runId, approvalId))?.status, "pending");
      assertEquals(await backend.getPendingApprovals(runId), []);
      assertEquals((await backend.getRun(runId))?.pendingApprovals, []);
      assertEquals(await backend.listPendingApprovals({ status: "pending" }), []);
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

    it("updates approval and run state without an executor", async () => {
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });

      const runId = "run-decide";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));

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

      const updated = await backend.getApproval(runId, request.approvalId);
      assertExists(updated);
      assertEquals(updated.status, "approved");
      assertEquals(updated.decidedBy, "alice");
      assertEquals(updated.comment, "looks good");

      const run = await backend.getRun(runId);
      assertExists(run);
      // No executor was provided, so the run stays waiting after recording the decision.
      assertEquals(run.status, "waiting");
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

  describe("descriptor-safe backend inputs", () => {
    it("rejects Proxy timing and metadata records without invoking traps", () => {
      let hooks = 0;
      const handler: ProxyHandler<Record<string, unknown>> = {
        get(target, key, receiver) {
          hooks++;
          return Reflect.get(target, key, receiver);
        },
        getOwnPropertyDescriptor(target, key) {
          hooks++;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        getPrototypeOf(target) {
          hooks++;
          return Reflect.getPrototypeOf(target);
        },
        ownKeys(target) {
          hooks++;
          return Reflect.ownKeys(target);
        },
      };

      assertThrows(
        () =>
          captureApprovalDecisionTiming(
            new Proxy(
              { decidedAt: new Date(), expiryCondition: "unexpired" },
              handler,
            ) as never,
          ),
        Error,
        "must contain decidedAt and expiryCondition",
      );
      assertThrows(
        () =>
          capturePendingApprovalMetadataUpdate(
            new Proxy({ notificationError: "delivery failed" }, handler) as never,
          ),
        Error,
        "must contain only notificationError",
      );
      assertEquals(hooks, 0);
    });

    it("rejects accessor, hidden, unknown, and oversized backend input fields", () => {
      let accessorHooks = 0;
      const accessorTiming = Object.create(null) as Record<string, unknown>;
      for (
        const [key, value] of [
          ["decidedAt", new Date()],
          ["expiryCondition", "unexpired"],
        ] as const
      ) {
        Object.defineProperty(accessorTiming, key, {
          enumerable: true,
          get() {
            accessorHooks++;
            return value;
          },
        });
      }
      assertThrows(
        () => captureApprovalDecisionTiming(accessorTiming as never),
        Error,
        "must contain decidedAt and expiryCondition",
      );

      const accessorMetadata = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(accessorMetadata, "notificationError", {
        enumerable: true,
        get() {
          accessorHooks++;
          return "delivery failed";
        },
      });
      assertThrows(
        () => capturePendingApprovalMetadataUpdate(accessorMetadata as never),
        Error,
        "must contain only notificationError",
      );
      assertEquals(accessorHooks, 0);

      const hiddenTiming = { expiryCondition: "unexpired" } as Record<string, unknown>;
      Object.defineProperty(hiddenTiming, "decidedAt", {
        value: new Date(),
        enumerable: false,
      });
      assertThrows(
        () => captureApprovalDecisionTiming(hiddenTiming as never),
        Error,
        "must contain decidedAt and expiryCondition",
      );
      assertThrows(
        () =>
          captureApprovalDecisionTiming({
            decidedAt: new Date(),
            expiryCondition: "unexpired",
            unexpected: true,
          } as never),
        Error,
        "must contain decidedAt and expiryCondition",
      );
      assertThrows(
        () =>
          capturePendingApprovalMetadataUpdate({
            notificationError: "x".repeat(MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS + 1),
          }),
        Error,
        "must contain only notificationError",
      );
    });
  });

  describe("lifecycle", () => {
    for (
      const surface of [
        "getApproval",
        "getPendingApprovals",
        "listAllPending",
      ] as const
    ) {
      it(`destroy drains an admitted ${surface} read`, async () => {
        const gatedBackend = new GatedApprovalReadSurfaceBackend(surface);
        backend = gatedBackend;
        manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
        const read = invokeApprovalRead(manager, surface);
        await gatedBackend.readStarted.promise;
        let destroySettled = false;
        const destruction = manager.destroy().then(() => {
          destroySettled = true;
        });

        try {
          await Promise.resolve();
          assertEquals(destroySettled, false);
          assertEquals(gatedBackend.calls[surface], 1);
          gatedBackend.continueRead.resolve();
          await Promise.all([read, destruction]);
          assertEquals(destroySettled, true);
        } finally {
          gatedBackend.continueRead.resolve();
          await Promise.allSettled([read, destruction]);
        }
      });

      it(`rejects ${surface} after stop without calling the backend`, async () => {
        const trackingBackend = new GatedApprovalReadSurfaceBackend();
        backend = trackingBackend;
        manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
        await manager.destroy();

        const rejectedRead = invokeApprovalRead(manager, surface);
        assertEquals(trackingBackend.calls, {
          getApproval: 0,
          getPendingApprovals: 0,
          listAllPending: 0,
        });
        await assertRejects(
          () => rejectedRead,
          Error,
          "Approval manager is stopped",
        );
      });
    }

    it("does not let explicit start resurrect checks after destroy", async () => {
      const trackingBackend = new ExpirationTrackingBackend();
      manager = new ApprovalManager({
        backend: trackingBackend,
        expirationCheckInterval: 1,
        autoStartExpirationChecks: false,
      });

      await manager.destroy();
      assertThrows(
        () => manager.startExpirationChecks(),
        Error,
        "Approval manager is stopped",
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      assertEquals(trackingBackend.expirationChecks, 0);
    });

    it("destroy waits for admitted decisions and rejects new mutations", async () => {
      backend = new GatedApprovalDecisionBackend();
      manager = new ApprovalManager({ backend, expirationCheckInterval: 0 });
      const runId = "run-destroy-decision";
      const approvalId = "apr-destroy-decision";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));
      await backend.savePendingApproval(runId, {
        id: approvalId,
        nodeId: "review",
        message: "approve me",
        payload: {},
        requestedAt: new Date(),
        status: "pending",
      });

      const admitted = manager.approve(runId, approvalId, "reviewer");
      await (backend as GatedApprovalDecisionBackend).decisionStarted.promise;
      let destroyed = false;
      const destruction = manager.destroy().then(() => {
        destroyed = true;
      });
      await Promise.resolve();
      assertEquals(destroyed, false);
      await assertRejects(
        () => manager.reject(runId, approvalId, "reviewer"),
        Error,
        "Approval manager is stopped",
      );
      await assertRejects(
        () =>
          manager.createApproval(
            createTestRun("run-after-destroy", { status: "waiting" }),
            "review",
            { type: "wait", waitType: "approval" },
            createContext("run-after-destroy"),
          ),
        Error,
        "Approval manager is stopped",
      );

      (backend as GatedApprovalDecisionBackend).continueDecision.resolve();
      await admitted;
      await destruction;
      assertEquals(destroyed, true);
    });
  });
});
