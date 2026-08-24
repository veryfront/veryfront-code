import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryBackend } from "./memory.ts";
import type { Checkpoint, PendingApproval, WorkflowQueueItem, WorkflowRun } from "../types.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

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

  describe("Run Management", () => {
    it("observes exact cross-client run transitions in revision order", async () => {
      const run = createTestRun("run-observed");
      await backend.createRun(run);
      const observation = await backend.openRunObservation(run.id);
      assertExists(observation);

      await backend.updateRun(run.id, {
        status: "waiting",
        nodeStates: {
          review: {
            nodeId: "review",
            status: "running",
            attempt: 1,
            input: { secret: "input" },
            output: { secret: "output" },
          },
        },
      });
      await backend.updateRun(run.id, { status: "running" });

      const iterator = observation.changes[Symbol.asyncIterator]();
      assertEquals((await iterator.next()).value, {
        revision: 1,
        status: "waiting",
        nodes: { review: { status: "running", attempt: 1 } },
      });
      assertEquals((await iterator.next()).value, {
        revision: 2,
        status: "running",
        nodes: { review: { status: "running", attempt: 1 } },
      });
      await observation.close();
    });

    it("delivers the terminal state and then closes the observation", async () => {
      const run = createTestRun("run-terminal");
      await backend.createRun(run);
      const observation = await backend.openRunObservation(run.id);
      assertExists(observation);
      const iterator = observation.changes[Symbol.asyncIterator]();

      await backend.updateRun(run.id, { status: "completed" });

      assertEquals((await iterator.next()).value?.status, "completed");
      assertEquals(await iterator.next(), { value: undefined, done: true });
    });

    it("fails and detaches a slow observer without failing writes", async () => {
      const run = createTestRun("run-overflow");
      await backend.createRun(run);
      const slow = await backend.openRunObservation(run.id);
      const active = await backend.openRunObservation(run.id);
      assertExists(slow);
      assertExists(active);
      const activeIterator = active.changes[Symbol.asyncIterator]();

      for (let revision = 1; revision <= 66; revision++) {
        await backend.updateRun(run.id, { heartbeatAt: new Date(revision) });
        assertEquals((await activeIterator.next()).value?.revision, revision);
      }

      const iterator = slow.changes[Symbol.asyncIterator]();
      await assertRejects(() => iterator.next(), Error, "slow observer");
      await backend.updateRun(run.id, { status: "running" });
      assertEquals((await activeIterator.next()).value?.status, "running");
      await active.close();
    });

    it("closes observations on abort and explicit close", async () => {
      const run = createTestRun("run-abort");
      await backend.createRun(run);
      const controller = new AbortController();
      const aborted = await backend.openRunObservation(run.id, { signal: controller.signal });
      const closed = await backend.openRunObservation(run.id);
      assertExists(aborted);
      assertExists(closed);
      controller.abort();
      await closed.close();

      assertEquals(await aborted.changes[Symbol.asyncIterator]().next(), {
        value: undefined,
        done: true,
      });
      assertEquals(await closed.changes[Symbol.asyncIterator]().next(), {
        value: undefined,
        done: true,
      });
    });

    it("closes observations when the run is deleted or the backend is destroyed", async () => {
      await backend.createRun(createTestRun("run-delete"));
      const deleted = await backend.openRunObservation("run-delete");
      assertExists(deleted);
      await backend.deleteRun("run-delete");
      assertEquals(await deleted.changes[Symbol.asyncIterator]().next(), {
        value: undefined,
        done: true,
      });

      await backend.createRun(createTestRun("run-destroy"));
      const destroyed = await backend.openRunObservation("run-destroy");
      assertExists(destroyed);
      await backend.destroy();
      assertEquals(await destroyed.changes[Symbol.asyncIterator]().next(), {
        value: undefined,
        done: true,
      });
    });

    it("should create and retrieve a run", async () => {
      await backend.createRun(createTestRun("run-1"));

      const retrieved = await backend.getRun("run-1");
      assertExists(retrieved);
      assertEquals(retrieved.id, "run-1");
      assertEquals(retrieved.workflowId, "test-workflow");
      assertEquals(retrieved.status, "pending");
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
      await backend.createRun(createTestRun("run-2"));

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
    it("should hydrate pending approvals when retrieving a run", async () => {
      const run = createTestRun("run-with-approval", { status: "waiting" });
      const approval: PendingApproval = {
        id: "approval-on-run",
        nodeId: "review-step",
        status: "pending",
        message: "Please review",
        payload: { data: "test" },
        requestedAt: new Date(),
      };

      await backend.createRun(run);
      await backend.savePendingApproval(run.id, approval);

      const retrieved = await backend.getRun(run.id);
      assertEquals(retrieved?.pendingApprovals, [approval]);
    });

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

      assertEquals(
        await backend.updateApproval("run-2", "approval-2", {
          approved: true,
          approver: "admin@example.com",
          comment: "Looks good!",
        }),
        true,
        "the first decision on a pending approval must report that it was written",
      );

      const updatedApproval = await backend.getPendingApproval("run-2", "approval-2");
      assertEquals(updatedApproval?.status, "approved");
      assertEquals(updatedApproval?.decidedBy, "admin@example.com");
      assertEquals(updatedApproval?.comment, "Looks good!");

      assertEquals(
        await backend.updateApproval("run-2", "approval-2", {
          approved: false,
          approver: "mallory@example.com",
        }),
        false,
        "a decision on an already-resolved approval must be reported as skipped",
      );

      const afterLosingDecision = await backend.getPendingApproval("run-2", "approval-2");
      assertEquals(afterLosingDecision?.status, "approved", "the winning decision must stand");
      assertEquals(
        afterLosingDecision?.decidedBy,
        "admin@example.com",
        "a losing decision must not overwrite the recorded approver",
      );
      assertEquals(
        afterLosingDecision?.comment,
        "Looks good!",
        "a losing decision must not overwrite the recorded comment",
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
        (await backend.getPendingApproval("run-owned-approval", approval.id))?.notificationError,
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

    it("rejects enqueue once the queue cap is reached", async () => {
      const cappedBackend = new MemoryBackend({ maxQueueSize: 1 });
      const createdAt = new Date();

      await cappedBackend.enqueue({ runId: "first", workflowId: "wf", input: {}, createdAt });

      await assertRejects(
        () => cappedBackend.enqueue({ runId: "second", workflowId: "wf", input: {}, createdAt }),
        Error,
        "Queue full (max: 1)",
        "enqueue must apply back-pressure at the cap",
      );

      assertEquals(
        (await cappedBackend.dequeue())?.runId,
        "first",
        "the queued job must survive the rejected enqueue",
      );
      assertEquals(
        await cappedBackend.dequeue(),
        null,
        "the rejected job must never have entered the queue",
      );
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
      assertExists(await backend.acquireLock("resource-1", 5000));
      await backend.releaseLock("resource-1");
    });

    it("should prevent concurrent locks on same resource", async () => {
      assertExists(await backend.acquireLock("resource-2", 5000));
      assertEquals(await backend.acquireLock("resource-2", 100), null);
      await backend.releaseLock("resource-2");
    });

    it("should allow lock after release", async () => {
      assertExists(await backend.acquireLock("resource-3", 5000));
      await backend.releaseLock("resource-3");
      assertExists(await backend.acquireLock("resource-3", 5000));
    });

    it("should reject stale lock tokens after a lease is reacquired", async () => {
      const staleToken = await backend.acquireLock("resource-4", 0);
      const currentToken = await backend.acquireLock("resource-4", 5000);
      assertExists(staleToken);
      assertExists(currentToken);

      assertEquals(await backend.extendLock("resource-4", 5000, staleToken), false);
      assertEquals(await backend.extendLock("resource-4", 5000, currentToken), true);

      await backend.releaseLock("resource-4", staleToken);
      assertEquals(await backend.isLocked("resource-4"), true);
      await backend.releaseLock("resource-4", currentToken);
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
