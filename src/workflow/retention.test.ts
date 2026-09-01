import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { MemoryBackend } from "./backends/memory.ts";
import {
  hasTerminalRunRetentionSupport,
  type TerminalRunRetentionCandidate,
  type WorkflowBackend,
} from "./backends/types.ts";
import { reapTerminalRuns } from "./retention.ts";
import type { WorkflowRun, WorkflowStatus } from "./types.ts";

const SOURCE_POLICY = normalizeSourceIntegrationPolicy(undefined);

function run(
  id: string,
  status: WorkflowStatus,
  completedAt?: Date,
): WorkflowRun {
  return {
    id,
    workflowId: "retention-workflow",
    status,
    input: {},
    nodeStates: {},
    currentNodes: [],
    context: { input: {} },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date(0),
    completedAt,
    sourceIntegrationPolicy: SOURCE_POLICY,
  };
}

describe("workflow terminal-run retention", () => {
  it("reaps only old terminal runs in bounded oldest-first batches", async () => {
    const backend = new MemoryBackend();
    await backend.createRun(run("active", "waiting", new Date(1)));
    await backend.createRun(run("old-failed", "failed", new Date(2)));
    await backend.createRun(run("old-completed", "completed", new Date(3)));
    await backend.createRun(run("old-cancelled", "cancelled", new Date(4)));
    await backend.createRun(run("recent", "completed", new Date(20)));

    const first = await reapTerminalRuns(backend, {
      completedBefore: new Date(10),
      limit: 2,
    });

    assertEquals(first, { supported: true, examined: 2, deleted: 2, hasMore: true });
    assertEquals(await backend.getRun("old-failed"), null);
    assertEquals(await backend.getRun("old-completed"), null);
    assertEquals((await backend.getRun("old-cancelled"))?.status, "cancelled");
    assertEquals((await backend.getRun("active"))?.status, "waiting");
    assertEquals((await backend.getRun("recent"))?.status, "completed");

    const second = await reapTerminalRuns(backend, {
      completedBefore: new Date(10),
      limit: 2,
    });
    assertEquals(second, { supported: true, examined: 1, deleted: 1, hasMore: false });
    assertEquals(await backend.getRun("old-cancelled"), null);
  });

  it("removes in-memory auxiliary state owned by a retained run", async () => {
    const backend = new MemoryBackend();
    const retained = run("with-state", "failed", new Date(2));
    await backend.createRun(retained);
    await backend.saveCheckpoint(retained.id, {
      id: "checkpoint",
      nodeId: "gate",
      timestamp: new Date(1),
      context: { input: {} },
      nodeStates: {},
    });
    await backend.savePendingApproval(retained.id, {
      id: "approval",
      nodeId: "gate",
      status: "pending",
      message: "Continue?",
      requestedAt: new Date(1),
    });
    await backend.savePendingEventWait(retained.id, {
      id: "wait",
      runId: retained.id,
      nodeId: "gate",
      eventName: "continue",
      waitKind: "event",
      requestedAt: new Date(1),
      status: "pending",
    });
    await backend.appendRunEvent(retained.id, {
      id: "event",
      eventName: "continue",
      payload: {},
      publishedAt: new Date(1),
    });
    await backend.acquireLock(retained.id, 60_000);

    await reapTerminalRuns(backend, { completedBefore: new Date(10) });

    assertEquals(await backend.getRun(retained.id), null);
    assertEquals(await backend.getCheckpoints(retained.id), []);
    assertEquals(await backend.getPendingApprovals(retained.id), []);
    assertEquals(await backend.getPendingEventWaits(retained.id), []);
    assertEquals(await backend.peekRunEvent(retained.id, "continue"), null);
    assertEquals(await backend.isLocked(retained.id), false);
  });

  it("does not select a terminal run with an accepted retry queued or pending", async () => {
    const backend = new MemoryBackend();
    const retained = run("accepted-retry", "failed", new Date(2));
    await backend.createRun(retained);
    await backend.enqueue({
      runId: retained.id,
      workflowId: retained.workflowId,
      input: {},
      createdAt: new Date(3),
    });
    await backend.enqueue({
      runId: retained.id,
      workflowId: retained.workflowId,
      input: { attempt: 2 },
      createdAt: new Date(4),
    });

    assertEquals(
      await reapTerminalRuns(backend, { completedBefore: new Date(10) }),
      { supported: true, examined: 0, deleted: 0, hasMore: false },
    );
    assertEquals((await backend.dequeue())?.runId, retained.id);
    assertEquals((await backend.dequeue())?.runId, retained.id);
    assertEquals(
      await reapTerminalRuns(backend, { completedBefore: new Date(10) }),
      { supported: true, examined: 0, deleted: 0, hasMore: false },
    );

    await backend.acknowledge(retained.id);
    assertEquals(
      await reapTerminalRuns(backend, { completedBefore: new Date(10) }),
      { supported: true, examined: 0, deleted: 0, hasMore: false },
    );
    await backend.acknowledge(retained.id);
    assertEquals(
      await reapTerminalRuns(backend, { completedBefore: new Date(10) }),
      { supported: true, examined: 1, deleted: 1, hasMore: false },
    );
  });

  it("does not delete a failed run that reactivates before the fenced delete", async () => {
    class RetryRaceBackend extends MemoryBackend {
      override async deleteTerminalRunIfUnchanged(
        candidate: TerminalRunRetentionCandidate,
      ): Promise<boolean> {
        await this.updateRun(candidate.runId, {
          status: "pending",
          completedAt: undefined,
        });
        return await super.deleteTerminalRunIfUnchanged(candidate);
      }
    }

    const backend = new RetryRaceBackend();
    await backend.createRun(run("retrying", "failed", new Date(2)));

    const result = await reapTerminalRuns(backend, { completedBefore: new Date(10) });

    assertEquals(result, { supported: true, examined: 1, deleted: 0, hasMore: false });
    assertEquals((await backend.getRun("retrying"))?.status, "pending");
  });

  it("does not delete terminal state changed after candidate discovery", async () => {
    class LatePatchBackend extends MemoryBackend {
      private patched = false;

      override async deleteTerminalRunIfUnchanged(
        candidate: TerminalRunRetentionCandidate,
      ): Promise<boolean> {
        if (!this.patched) {
          this.patched = true;
          await this.updateRun(candidate.runId, {
            error: { message: "Late diagnostic" },
          });
        }
        return await super.deleteTerminalRunIfUnchanged(candidate);
      }
    }

    const backend = new LatePatchBackend();
    await backend.createRun(run("late-patch", "failed", new Date(2)));

    const result = await reapTerminalRuns(backend, { completedBefore: new Date(10) });

    assertEquals(result, { supported: true, examined: 1, deleted: 0, hasMore: false });
    assertEquals((await backend.getRun("late-patch"))?.error?.message, "Late diagnostic");
  });

  it("does not delete an approval decision accepted after discovery", async () => {
    class ApprovalRaceBackend extends MemoryBackend {
      override async deleteTerminalRunIfUnchanged(
        candidate: TerminalRunRetentionCandidate,
      ): Promise<boolean> {
        await this.updateApproval(candidate.runId, "approval", {
          approved: true,
          approver: "operator",
        });
        return await super.deleteTerminalRunIfUnchanged(candidate);
      }
    }

    const backend = new ApprovalRaceBackend();
    await backend.createRun(run("approval-race", "failed", new Date(2)));
    await backend.savePendingApproval("approval-race", {
      id: "approval",
      nodeId: "gate",
      status: "pending",
      message: "Continue?",
      requestedAt: new Date(1),
    });

    assertEquals(
      await reapTerminalRuns(backend, { completedBefore: new Date(10) }),
      { supported: true, examined: 1, deleted: 0, hasMore: false },
    );
    assertEquals((await backend.getPendingApprovals("approval-race")).length, 0);
    assertEquals((await backend.getRun("approval-race"))?.status, "failed");
  });

  it("does not delete approval metadata patched after discovery", async () => {
    class ApprovalPatchRaceBackend extends MemoryBackend {
      override async deleteTerminalRunIfUnchanged(
        candidate: TerminalRunRetentionCandidate,
      ): Promise<boolean> {
        await this.updatePendingApproval(candidate.runId, "approval", {
          notificationError: "late delivery failure",
        });
        return await super.deleteTerminalRunIfUnchanged(candidate);
      }
    }

    const backend = new ApprovalPatchRaceBackend();
    await backend.createRun(run("approval-patch-race", "failed", new Date(2)));
    await backend.savePendingApproval("approval-patch-race", {
      id: "approval",
      nodeId: "gate",
      status: "pending",
      message: "Continue?",
      requestedAt: new Date(1),
    });

    assertEquals(
      await reapTerminalRuns(backend, { completedBefore: new Date(10) }),
      { supported: true, examined: 1, deleted: 0, hasMore: false },
    );
    assertEquals(
      (await backend.getPendingApproval("approval-patch-race", "approval"))
        ?.notificationError,
      "late delivery failure",
    );
  });

  it("does not delete a checkpoint appended after discovery", async () => {
    class CheckpointRaceBackend extends MemoryBackend {
      override async deleteTerminalRunIfUnchanged(
        candidate: TerminalRunRetentionCandidate,
      ): Promise<boolean> {
        await this.saveCheckpoint(candidate.runId, {
          id: "late-checkpoint",
          nodeId: "retry",
          timestamp: new Date(3),
          context: { input: {} },
          nodeStates: {},
        });
        return await super.deleteTerminalRunIfUnchanged(candidate);
      }
    }

    const backend = new CheckpointRaceBackend();
    await backend.createRun(run("checkpoint-race", "failed", new Date(2)));

    assertEquals(
      await reapTerminalRuns(backend, { completedBefore: new Date(10) }),
      { supported: true, examined: 1, deleted: 0, hasMore: false },
    );
    assertEquals((await backend.getLatestCheckpoint("checkpoint-race"))?.id, "late-checkpoint");
  });

  it("does not delete a retry queued after discovery", async () => {
    class QueueRaceBackend extends MemoryBackend {
      override async deleteTerminalRunIfUnchanged(
        candidate: TerminalRunRetentionCandidate,
      ): Promise<boolean> {
        await this.enqueue({
          runId: candidate.runId,
          workflowId: candidate.workflowId,
          input: {},
          createdAt: new Date(3),
        });
        return await super.deleteTerminalRunIfUnchanged(candidate);
      }
    }

    const backend = new QueueRaceBackend();
    await backend.createRun(run("queue-race", "failed", new Date(2)));

    assertEquals(
      await reapTerminalRuns(backend, { completedBefore: new Date(10) }),
      { supported: true, examined: 1, deleted: 0, hasMore: false },
    );
    assertEquals((await backend.dequeue())?.runId, "queue-race");
  });

  it("does not delete a failed run when an event is buffered after discovery", async () => {
    class EventRaceBackend extends MemoryBackend {
      override async deleteTerminalRunIfUnchanged(
        candidate: TerminalRunRetentionCandidate,
      ): Promise<boolean> {
        await this.appendRunEvent(candidate.runId, {
          id: "late-event",
          eventName: "retry.ready",
          payload: { attempt: 2 },
          publishedAt: new Date(3),
        });
        return await super.deleteTerminalRunIfUnchanged(candidate);
      }
    }

    const backend = new EventRaceBackend();
    await backend.createRun(run("event-race", "failed", new Date(2)));

    assertEquals(
      await reapTerminalRuns(backend, { completedBefore: new Date(10) }),
      { supported: true, examined: 1, deleted: 0, hasMore: false },
    );
    assertEquals((await backend.peekRunEvent("event-race", "retry.ready"))?.id, "late-event");
    assertEquals((await backend.getRun("event-race"))?.status, "failed");
  });

  it("does not delete an exact recreation through a stale candidate", async () => {
    const backend = new MemoryBackend();
    const retained = run("memory-reused-id", "failed", new Date(2));
    await backend.createRun(retained);
    await backend.updateRun(retained.id, { error: { message: "first mutation" } });
    await backend.updateRun(retained.id, { error: { message: "second mutation" } });
    const candidate = (await backend.listTerminalRunRetentionCandidates(new Date(10), 1))
      .candidates[0]!;
    await backend.deleteRun(retained.id);
    await backend.createRun(run("memory-generation-filler", "pending"));
    await backend.createRun(retained);

    assertEquals(await backend.deleteTerminalRunIfUnchanged(candidate), false);
    assertEquals((await backend.getRun(retained.id))?.status, "failed");
  });

  it("does not delete orphan state accepted after the selected run disappeared", async () => {
    const backend = new MemoryBackend();
    const retained = run("memory-stale-orphan", "failed", new Date(2));
    await backend.createRun(retained);
    const candidate = (await backend.listTerminalRunRetentionCandidates(new Date(10), 1))
      .candidates[0]!;
    await backend.deleteRun(retained.id);
    await backend.appendRunEvent(retained.id, {
      id: "orphan-event",
      eventName: "retry.ready",
      payload: {},
      publishedAt: new Date(3),
    });

    assertEquals(await backend.deleteTerminalRunIfUnchanged(candidate), false);
    assertEquals((await backend.peekRunEvent(retained.id, "retry.ready"))?.id, "orphan-event");
  });

  it("uses the bounded retention query instead of hydrating every run", async () => {
    class NoFullListBackend extends MemoryBackend {
      override listRuns(): Promise<WorkflowRun[]> {
        throw new Error("full run listing must not be used by retention");
      }
    }

    const backend = new NoFullListBackend();
    await backend.createRun(run("bounded", "completed", new Date(1)));

    assertEquals(
      await reapTerminalRuns(backend, { completedBefore: new Date(10), limit: 1 }),
      { supported: true, examined: 1, deleted: 1, hasMore: false },
    );
  });

  it("returns false for an invalid direct deletion candidate", async () => {
    const backend = new MemoryBackend();
    const retained = run("invalid-candidate", "completed", new Date(1));
    await backend.createRun(retained);

    assertEquals(
      await backend.deleteTerminalRunIfUnchanged({
        runId: retained.id,
        workflowId: retained.workflowId,
        createdAt: undefined as unknown as Date,
        status: "completed",
        completedAt: retained.completedAt!,
        revision: 0,
      }),
      false,
    );
    assertEquals((await backend.getRun(retained.id))?.status, "completed");
  });

  it("reports unsupported backends without invoking partial cleanup", async () => {
    const backend = new MemoryBackend();
    Object.defineProperty(backend, "deleteTerminalRunIfUnchanged", { value: undefined });
    const unsupported = backend as WorkflowBackend;
    await backend.createRun(run("retained", "completed", new Date(1)));

    assertEquals(hasTerminalRunRetentionSupport(unsupported), false);
    assertEquals(
      await reapTerminalRuns(unsupported, { completedBefore: new Date(10) }),
      { supported: false, reason: "unsupported" },
    );
    assertEquals((await backend.getRun("retained"))?.status, "completed");
  });

  it("validates sweep bounds and treats completedBefore as exclusive", async () => {
    const backend = new MemoryBackend();
    await backend.createRun(run("boundary", "completed", new Date(10)));

    await assertRejects(
      () => reapTerminalRuns(backend, { completedBefore: new Date(20), limit: 0 }),
      Error,
      "limit must be an integer",
    );
    await assertRejects(
      () => reapTerminalRuns(backend, { completedBefore: new Date(Number.NaN) }),
      Error,
      "must be a valid Date",
    );
    assertEquals(
      await reapTerminalRuns(backend, { completedBefore: new Date(10) }),
      { supported: true, examined: 0, deleted: 0, hasMore: false },
    );
    assertEquals((await backend.getRun("boundary"))?.status, "completed");
  });
});
