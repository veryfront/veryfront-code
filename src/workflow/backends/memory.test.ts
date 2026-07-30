import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryBackend } from "./memory.ts";
import type { Checkpoint, PendingApproval, WorkflowQueueItem, WorkflowRun } from "../types.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { registerWorkflowBackendPersistenceContract } from "./conformance.test-utils.ts";
import { hasLockSupport, hasWorkerSupport, updateRunIfStatus } from "./types.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);
const UNEXPIRED_DECISION_TIMING = {
  decidedAt: new Date("2026-01-01T00:00:00.000Z"),
  expiryCondition: "unexpired",
} as const;

describe("MemoryBackend", () => {
  let backend: MemoryBackend;

  function createTestRun(id: string, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
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
      ...overrides,
      sourceIntegrationPolicy: overrides.sourceIntegrationPolicy ??
        UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
    };
  }

  function createCheckpoint(id: string, nodeId: string, timestamp: Date): Checkpoint {
    return {
      id,
      nodeId,
      timestamp,
      context: { runId: "run-1", workflowId: "test", input: {} },
      nodeStates: {},
    };
  }

  beforeEach((): void => {
    backend = new MemoryBackend();
  });

  registerWorkflowBackendPersistenceContract("Memory", () => backend, {
    seedDuplicateApproval(runId, approval) {
      const approvalStore = (
        backend as unknown as { approvals: Map<string, PendingApproval[]> }
      ).approvals;
      approvalStore.get(runId)?.push(structuredClone(approval));
    },
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

    it("rejects repeated creates without overwriting the original run", async () => {
      const original = createTestRun("run-duplicate", {
        workflowId: "original-workflow",
        status: "pending",
        input: { owner: "original" },
      });
      const replacement = createTestRun("run-duplicate", {
        workflowId: "replacement-workflow",
        status: "running",
        input: { owner: "replacement" },
      });

      await backend.createRun(original);
      const conflicts = await Promise.allSettled([
        backend.createRun(replacement),
        backend.createRun(replacement),
      ]);

      assertEquals(conflicts.map((result) => result.status), ["rejected", "rejected"]);
      for (const conflict of conflicts) {
        if (conflict.status !== "rejected") throw new Error("Expected create conflict");
        assertEquals(conflict.reason instanceof Error, true);
        assertEquals(conflict.reason.message, "Workflow run already exists: run-duplicate");
        assertEquals(conflict.reason.status, 409);
        assertEquals(conflict.reason.slug, "workflow-run-conflict");
      }

      const stored = await backend.getRun(original.id);
      assertEquals(stored?.workflowId, "original-workflow");
      assertEquals(stored?.status, "pending");
      assertEquals(stored?.input, { owner: "original" });
      assertEquals((await backend.listRuns({})).map((run) => run.id), [original.id]);
      assertEquals(await backend.countRuns({}), 1);
    });

    it("allows exactly one concurrent create for a new run id", async () => {
      const first = createTestRun("run-concurrent-create", {
        workflowId: "workflow-first",
        input: { owner: "first" },
      });
      const second = createTestRun("run-concurrent-create", {
        workflowId: "workflow-second",
        status: "running",
        input: { owner: "second" },
      });

      const results = await Promise.allSettled([
        backend.createRun(first),
        backend.createRun(second),
      ]);

      assertEquals(results.filter((result) => result.status === "fulfilled").length, 1);
      assertEquals(results.filter((result) => result.status === "rejected").length, 1);
      const stored = await backend.getRun(first.id);
      assertExists(stored);
      assertEquals((await backend.listRuns({})).map((run) => run.id), [first.id]);
      assertEquals(await backend.countRuns({}), 1);
      assertEquals(
        await backend.countRuns({ workflowId: stored.workflowId, status: stored.status }),
        1,
      );
    });

    it("rejects a malformed source policy before persisting a run", async () => {
      const run = createTestRun("run-malformed-policy", {
        sourceIntegrationPolicy: {
          schemaVersion: 1,
          mode: "allowlist",
          integrations: {
            confluence: { allowedToolIds: ["get_page", "get_page"] },
          },
        },
      });

      await assertRejects(
        () => backend.createRun(run),
        Error,
        "invalid source integration policy snapshot",
      );
      assertEquals(await backend.getRun(run.id), null);
    });

    it("should return null for non-existent run", async () => {
      assertEquals(await backend.getRun("non-existent"), null);
    });

    it("should update a run", async () => {
      await backend.createRun(createTestRun("run-2", { status: "waiting" }));

      await backend.updateRun("run-2", { status: "running", startedAt: new Date() });

      const updated = await backend.getRun("run-2");
      assertEquals(updated?.status, "running");
      assertExists(updated?.startedAt);
    });

    it("should conditionally update only the expected worker owner", async () => {
      await backend.createRun(createTestRun("run-owned", {
        status: "running",
        workerId: "worker-new",
      }));

      assertEquals(
        await backend.updateRunIfStatusAndWorker(
          "run-owned",
          ["running"],
          "worker-old",
          { status: "failed" },
        ),
        false,
      );
      assertEquals((await backend.getRun("run-owned"))?.status, "running");

      assertEquals(
        await backend.updateRunIfStatusAndWorker(
          "run-owned",
          ["running"],
          "worker-new",
          { status: "failed" },
        ),
        true,
      );
      assertEquals((await backend.getRun("run-owned"))?.status, "failed");
    });

    it("fails closed on non-boolean conditional update results", async () => {
      const runId = "run-invalid-conditional-result";
      await backend.createRun(createTestRun(runId, {
        workerId: "worker",
      }));
      const invalidBackend = new Proxy(backend, {
        get(target, property, receiver) {
          if (
            property === "updateRunIfStatus" ||
            property === "updateRunIfStatusAndWorker" ||
            property === "updateRunIfStatusAndLock"
          ) {
            return () => Promise.resolve(undefined as unknown as boolean);
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      await assertRejects(
        () => updateRunIfStatus(invalidBackend, runId, ["pending"], { status: "running" }),
        Error,
        "non-boolean status update result",
      );
      await assertRejects(
        () =>
          updateRunIfStatus(
            invalidBackend,
            runId,
            ["pending"],
            { status: "running" },
            "worker",
          ),
        Error,
        "non-boolean owner-fenced update result",
      );
      const lockToken = await backend.acquireLock(runId, 5_000);
      if (!lockToken) throw new Error("Expected the lock fixture to acquire a token");
      await assertRejects(
        () =>
          updateRunIfStatus(
            invalidBackend,
            runId,
            ["pending"],
            { status: "running" },
            "worker",
            lockToken,
          ),
        Error,
        "non-boolean lock-fenced update result",
      );
      assertEquals((await backend.getRun(runId))?.status, "pending");
    });

    it("rejects attempts to mutate the source policy after run creation", async () => {
      const run = createTestRun("run-immutable-policy");
      await backend.createRun(run);
      const unsafeUpdateRun = backend.updateRun.bind(backend) as (
        runId: string,
        patch: Record<string, unknown>,
      ) => Promise<void>;

      await assertRejects(
        () =>
          unsafeUpdateRun(run.id, {
            sourceIntegrationPolicy: normalizeSourceIntegrationPolicy({ allow: {} }),
          }),
        Error,
        "immutable",
      );

      assertEquals(
        (await backend.getRun(run.id))?.sourceIntegrationPolicy,
        run.sourceIntegrationPolicy,
      );
    });

    it("should list runs with filters", async () => {
      await backend.createRun(createTestRun("run-a"));
      await backend.createRun(createTestRun("run-b", { status: "running" }));
      await backend.createRun(createTestRun("run-c", { workflowId: "other-workflow" }));

      assertEquals((await backend.listRuns({})).length, 3);
      assertEquals((await backend.listRuns({ workflowId: "test-workflow" })).length, 2);

      const byStatus = await backend.listRuns({ status: "running" });
      assertEquals(byStatus.length, 1);
      assertEquals(byStatus[0]?.id, "run-b");

      assertEquals((await backend.listRuns({ limit: 2 })).length, 2);
    });
  });

  describe("Checkpointing", () => {
    it("should save and retrieve checkpoints", async () => {
      await backend.createRun(createTestRun("run-1", { status: "waiting" }));
      await backend.saveCheckpoint("run-1", createCheckpoint("cp-1", "step-1", new Date()));

      const latest = await backend.getLatestCheckpoint("run-1");
      assertExists(latest);
      assertEquals(latest.id, "cp-1");
      assertEquals(latest.nodeId, "step-1");
    });

    it("should return latest checkpoint", async () => {
      await backend.createRun(createTestRun("run-1"));
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

    it("rejects checkpoints for a missing run", async () => {
      await assertRejects(
        () =>
          backend.saveCheckpoint(
            "missing-run",
            createCheckpoint("cp-missing", "step-missing", new Date()),
          ),
        Error,
        "Run not found: missing-run",
      );
    });

    it("should condition checkpoint appends on the canonical run owner", async () => {
      await backend.createRun(createTestRun("run-owned-checkpoint", {
        status: "running",
        workerId: "worker-new",
      }));
      const checkpoint = createCheckpoint("cp-owned", "step-owned", new Date());

      assertEquals(
        await backend.saveCheckpointIfStatusAndWorker(
          "synthetic-child-run",
          "run-owned-checkpoint",
          ["running"],
          "worker-old",
          checkpoint,
        ),
        false,
      );
      assertEquals(await backend.getCheckpoints("synthetic-child-run"), []);

      assertEquals(
        await backend.saveCheckpointIfStatusAndWorker(
          "synthetic-child-run",
          "run-owned-checkpoint",
          ["running"],
          "worker-new",
          checkpoint,
        ),
        true,
      );
      assertEquals((await backend.getCheckpoints("synthetic-child-run"))[0]?.id, "cp-owned");
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

      await backend.createRun(createTestRun("run-1", { status: "waiting" }));
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

      await backend.createRun(createTestRun("run-2", { status: "waiting" }));
      await backend.savePendingApproval("run-2", approval);

      await backend.updateApproval("run-2", "approval-2", {
        approved: true,
        approver: "admin@example.com",
        comment: "Looks good!",
      }, UNEXPIRED_DECISION_TIMING);

      const updatedApproval = await backend.getApproval("run-2", "approval-2");
      assertEquals(updatedApproval?.status, "approved");
      assertEquals(updatedApproval?.decidedBy, "admin@example.com");
      assertEquals(updatedApproval?.comment, "Looks good!");
    });

    it("fails closed when legacy state contains duplicate approval ids", async () => {
      const runId = "run-duplicate-approval-state";
      const approval: PendingApproval = {
        id: "duplicate-approval-state",
        nodeId: "review",
        status: "pending",
        message: "Review needed",
        payload: {},
        requestedAt: new Date(),
      };
      await backend.createRun(createTestRun(runId));
      const unsafeState = backend as unknown as {
        approvals: Map<string, PendingApproval[]>;
      };
      unsafeState.approvals.set(runId, [structuredClone(approval), structuredClone(approval)]);

      await assertRejects(
        () =>
          backend.updateApproval(runId, approval.id, {
            approved: true,
            approver: "reviewer",
          }, UNEXPIRED_DECISION_TIMING),
        Error,
        "Duplicate approval id stored",
      );
      await assertRejects(
        () =>
          backend.updatePendingApproval(runId, approval.id, {
            notificationError: "delivery failed",
          }),
        Error,
        "Duplicate approval id stored",
      );
      assertEquals(
        unsafeState.approvals.get(runId)?.map((stored) => stored.status),
        ["pending", "pending"],
      );
    });

    it("rejects approvals for a missing run", async () => {
      await assertRejects(
        () =>
          backend.savePendingApproval("missing-run", {
            id: "approval-missing",
            nodeId: "review",
            status: "pending",
            message: "Review needed",
            requestedAt: new Date(),
          }),
        Error,
        "Run not found: missing-run",
      );
    });

    it("should condition approval appends on owner and patch notification metadata", async () => {
      await backend.createRun(createTestRun("run-owned-approval", {
        status: "waiting",
        workerId: "worker-new",
      }));
      const approval: PendingApproval = {
        id: "approval-owned",
        nodeId: "review",
        status: "pending",
        message: "Review needed",
        payload: {},
        requestedAt: new Date(),
      };

      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          "run-owned-approval",
          ["waiting"],
          "worker-old",
          approval,
        ),
        false,
      );
      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          "run-owned-approval",
          ["waiting"],
          "worker-new",
          approval,
        ),
        true,
      );
      await backend.updatePendingApproval("run-owned-approval", approval.id, {
        notificationError: "delivery failed",
      });
      assertEquals(
        (await backend.getApproval("run-owned-approval", approval.id))?.notificationError,
        "delivery failed",
      );
    });
  });

  describe("Queue Operations", () => {
    it("should enqueue and dequeue jobs", async () => {
      const job: WorkflowQueueItem = {
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
    it("requires renewal as part of lock and worker capabilities", () => {
      assertEquals(hasLockSupport(backend), true);
      assertEquals(hasWorkerSupport(backend), true);
      const incomplete = new Proxy(backend, {
        get(target, property, receiver) {
          if (property === "extendLock") return undefined;
          return Reflect.get(target, property, receiver);
        },
      });

      assertEquals(hasLockSupport(incomplete), false);
      assertEquals(hasWorkerSupport(incomplete), false);
    });

    it("should acquire and release locks", async () => {
      const token = await backend.acquireLock("resource-1", 5000);
      assertExists(token);
      assertEquals(await backend.releaseLock("resource-1", token), true);
    });

    it("should prevent concurrent locks on same resource", async () => {
      const token = await backend.acquireLock("resource-2", 5000);
      assertExists(token);
      assertEquals(await backend.acquireLock("resource-2", 100), null);
      assertEquals(await backend.releaseLock("resource-2", token), true);
    });

    it("should allow lock after release", async () => {
      const token = await backend.acquireLock("resource-3", 5000);
      assertExists(token);
      assertEquals(await backend.releaseLock("resource-3", token), true);
      assertExists(await backend.acquireLock("resource-3", 5000));
    });

    it("should reject stale lock tokens after a lease is reacquired", async () => {
      const staleToken = await backend.acquireLock("resource-4", 0);
      const currentToken = await backend.acquireLock("resource-4", 5000);
      assertExists(staleToken);
      assertExists(currentToken);

      assertEquals(await backend.extendLock("resource-4", 5000, staleToken), false);
      assertEquals(await backend.extendLock("resource-4", 5000, currentToken), true);

      assertEquals(await backend.releaseLock("resource-4", staleToken), false);
      assertEquals(await backend.isLocked("resource-4"), true);
      assertEquals(await backend.releaseLock("resource-4", currentToken), true);
      assertEquals(await backend.isLocked("resource-4"), false);
    });
  });

  describe("Stalled Run Recovery", () => {
    it("should find stalled running runs", async () => {
      await backend.createRun(
        createTestRun("run-fresh", {
          status: "running",
          startedAt: new Date(Date.now() - 120_000),
          heartbeatAt: new Date(),
        }),
      );
      await backend.createRun(
        createTestRun("run-stalled", {
          status: "running",
          startedAt: new Date(Date.now() - 120_000),
        }),
      );

      const stalled = await backend.findStalledRuns(60_000);
      assertEquals(stalled.map((run) => run.id), ["run-stalled"]);
    });

    it("should claim a stalled run only once", async () => {
      await backend.createRun(
        createTestRun("run-claim", {
          status: "running",
          startedAt: new Date(Date.now() - 120_000),
        }),
      );

      assertEquals(await backend.claimStalledRun("run-claim", "worker-a", 60_000), true);
      assertEquals(await backend.claimStalledRun("run-claim", "worker-b", 60_000), false);

      const run = await backend.getRun("run-claim");
      assertEquals(run?.workerId, "worker-a");
      assertExists(run?.heartbeatAt);
    });
  });

  describe("Cleanup", () => {
    it("should destroy without errors", async () => {
      await backend.createRun(createTestRun("temp", {
        workflowId: "wf",
        input: {},
        context: { runId: "temp", workflowId: "wf", input: {} },
      }));

      await backend.destroy();
    });
  });
});
