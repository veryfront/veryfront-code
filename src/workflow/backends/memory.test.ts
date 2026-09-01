import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryBackend } from "./memory.ts";
import type { Checkpoint, PendingApproval, WorkflowQueueItem, WorkflowRun } from "../types.ts";
import { MAX_TRAVERSAL_DEPTH } from "../context-serialization.ts";
import type {
  PersistedPendingApproval,
  PersistedPendingEventWait,
  WorkflowRunUpdate,
} from "./types.ts";
import {
  MAX_WORKFLOW_PENDING_EVENT_WAIT_ENTRIES,
  MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES,
  MAX_WORKFLOW_RUN_EVENT_MAILBOXES,
} from "../limits.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);
const jsonRawSupport = JSON as typeof JSON & {
  rawJSON?: (source: string) => unknown;
};

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

  function deepLeaf(value: unknown, depth: number): unknown {
    let current = value;
    for (let index = 0; index < depth; index++) {
      if (current === null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>).nested;
    }
    if (current === null || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>).leaf;
  }

  function setDeepLeaf(value: unknown, depth: number, leaf: unknown): void {
    let current = value;
    for (let index = 0; index < depth; index++) {
      if (current === null || typeof current !== "object") return;
      current = (current as Record<string, unknown>).nested;
    }
    if (current !== null && typeof current === "object") {
      (current as Record<string, unknown>).leaf = leaf;
    }
  }

  async function assertRejectsAsynchronously<T>(
    operation: () => Promise<T>,
    message: string,
  ): Promise<void> {
    let promise: Promise<T>;
    try {
      promise = operation();
    } catch (error) {
      throw new Error("Expected operation to return a rejected Promise instead of throwing", {
        cause: error,
      });
    }
    await assertRejects(() => promise, Error, message);
  }

  beforeEach((): void => {
    backend = new MemoryBackend();
  });

  /** Bound an observed-state read so a missing publish fails instead of hanging. */
  async function nextWithin<T>(iterator: AsyncIterator<T>, ms = 2_000): Promise<IteratorResult<T>> {
    const timeout = Promise.withResolvers<never>();
    const timeoutId = setTimeout(
      () => timeout.reject(new Error("Timed out waiting for an observed run state")),
      ms,
    );
    try {
      return await Promise.race([iterator.next(), timeout.promise]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

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

    it("publishes an approval append as its own contiguous revision with a minimal projection", async () => {
      const run = createTestRun("run-approval-observed");
      await backend.createRun(run);
      const observation = await backend.openRunObservation(run.id);
      assertExists(observation);

      await backend.updateRun(run.id, { status: "waiting" });
      await backend.savePendingApproval(run.id, {
        id: "apr-1",
        nodeId: "review",
        message: "Please review",
        payload: { secret: "approval-payload" },
        requestedAt: new Date(),
        status: "pending",
      });

      const iterator = observation.changes[Symbol.asyncIterator]();
      assertEquals((await nextWithin(iterator)).value, {
        revision: 1,
        status: "waiting",
        nodes: {},
      });
      // The approval write is its own revision, carrying only identifiers:
      // a subscriber learns which approval blocks the run without a second
      // fetch, and without the approval payload leaking into the stream.
      assertEquals((await nextWithin(iterator)).value, {
        revision: 2,
        status: "waiting",
        nodes: {},
        approvals: [{ id: "apr-1", nodeId: "review", message: "Please review" }],
      });
      await observation.close();
    });

    it("keeps observation revisions contiguous across an unobserved approval decision", async () => {
      const run = createTestRun("run-approval-decision-revision");
      await backend.createRun(run);
      const observation = await backend.openRunObservation(run.id);
      assertExists(observation);
      const iterator = observation.changes[Symbol.asyncIterator]();

      await backend.updateRun(run.id, { status: "waiting" });
      await backend.savePendingApproval(run.id, {
        id: "approval",
        nodeId: "gate",
        status: "pending",
        message: "Continue?",
        requestedAt: new Date(1),
      });
      await backend.updateApproval(run.id, "approval", {
        approved: true,
        approver: "operator",
      });
      await backend.updateRun(run.id, { status: "failed", completedAt: new Date(2) });

      assertEquals((await nextWithin(iterator)).value?.revision, 1);
      assertEquals((await nextWithin(iterator)).value?.revision, 2);
      assertEquals((await nextWithin(iterator)).value?.revision, 3);
      await observation.close();
    });

    it("publishes owned approval appends only when ownership holds", async () => {
      const run = createTestRun("run-owned-approval", { status: "waiting", workerId: "w1" });
      await backend.createRun(run);
      const observation = await backend.openRunObservation(run.id);
      assertExists(observation);

      const approval = (id: string): PendingApproval => ({
        id,
        nodeId: "review",
        message: "Please review",
        payload: undefined,
        requestedAt: new Date(),
        status: "pending",
      });

      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          run.id,
          ["waiting"],
          "other-worker",
          approval("apr-denied"),
        ),
        false,
      );
      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          run.id,
          ["waiting"],
          "w1",
          approval("apr-owned"),
        ),
        true,
      );

      // The denied append must publish nothing: revision 1 is the owned
      // append, and it projects only the approval that was actually saved.
      const iterator = observation.changes[Symbol.asyncIterator]();
      assertEquals((await nextWithin(iterator)).value, {
        revision: 1,
        status: "waiting",
        nodes: {},
        approvals: [{ id: "apr-owned", nodeId: "review", message: "Please review" }],
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

    it("reads the source context once while creating a run", async () => {
      const source = createTestRun("run-context-single-read");
      let contextReads = 0;
      Object.defineProperty(source, "context", {
        configurable: true,
        enumerable: true,
        get() {
          contextReads++;
          if (contextReads > 1) throw new Error("context read more than once");
          return { input: {}, stored: true };
        },
      });

      await backend.createRun(source);

      assertEquals(contextReads, 1);
      assertEquals((await backend.getRun(source.id))?.context, { input: {}, stored: true });
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

    it("rejects revoked update patches asynchronously after the run check", async () => {
      const { proxy, revoke } = Proxy.revocable<WorkflowRunUpdate>({ status: "waiting" }, {});
      revoke();

      await assertRejectsAsynchronously(
        () => backend.updateRun("run-missing-revoked-patch", proxy),
        "Run not found",
      );

      await backend.createRun(createTestRun("run-existing-revoked-patch"));
      await assertRejectsAsynchronously(
        () => backend.updateRun("run-existing-revoked-patch", proxy),
        "revoked",
      );
    });

    it("merges context sets while applying explicit top-level deletions", async () => {
      await backend.createRun(createTestRun("run-context-delete", {
        context: { input: {}, removed: "stale", concurrent: "preserve" },
      }));

      await backend.updateRun("run-context-delete", {
        context: { kept: "updated" },
        contextDeletes: ["removed"],
      });

      assertEquals((await backend.getRun("run-context-delete"))?.context, {
        input: {},
        concurrent: "preserve",
        kept: "updated",
      });
    });

    it("deletes context keys omitted by JSON persistence", async () => {
      await backend.createRun(createTestRun("run-context-omitted-values", {
        context: {
          input: {},
          removedUndefined: "stale",
          removedFunction: "stale",
          removedSymbol: "stale",
          preserved: "kept",
        },
      }));

      await backend.updateRun("run-context-omitted-values", {
        context: {
          removedUndefined: undefined,
          removedFunction: () => "omitted",
          removedSymbol: Symbol("omitted"),
          added: "stored",
        },
      });

      assertEquals((await backend.getRun("run-context-omitted-values"))?.context, {
        input: {},
        preserved: "kept",
        added: "stored",
      });
    });

    it("derives omitted context keys from the pre-serialization key snapshot", async () => {
      const runId = "run-context-key-snapshot";
      await backend.createRun(createTestRun(runId, {
        context: { input: {}, preserve: "existing" },
      }));
      const contextPatch: Record<string, unknown> = {};
      Object.defineProperty(contextPatch, "trigger", {
        configurable: true,
        enumerable: true,
        get() {
          contextPatch.preserve = undefined;
          return "stored";
        },
      });

      await backend.updateRun(runId, { context: contextPatch });

      assertEquals((await backend.getRun(runId))?.context, {
        input: {},
        preserve: "existing",
        trigger: "stored",
      });
    });

    it("applies a context hook patch to the latest canonical run", async () => {
      const runId = "run-context-reentrant-update";
      await backend.createRun(createTestRun(runId, {
        status: "running",
        workerId: "worker-original",
      }));
      const dynamic = {
        toJSON() {
          void backend.updateRun(runId, {
            status: "completed",
            workerId: "worker-replaced",
          });
          return "stored";
        },
      };

      await backend.updateRun(runId, { context: { dynamic } });

      const updated = await backend.getRun(runId);
      assertEquals(updated?.status, "completed");
      assertEquals(updated?.workerId, "worker-replaced");
      assertEquals(updated?.context.dynamic, "stored");
    });

    it("deletes context keys omitted by JSON through conditional updates", async () => {
      await backend.createRun(createTestRun("run-context-conditional-omitted", {
        status: "running",
        workerId: "worker-current",
        context: {
          input: {},
          removedByStatus: "stale",
          removedByOwner: "stale",
          preserved: "kept",
        },
      }));

      assertEquals(
        await backend.updateRunIfStatus("run-context-conditional-omitted", ["running"], {
          context: { input: {}, removedByStatus: undefined },
        }),
        true,
      );
      assertEquals(
        await backend.updateRunIfStatusAndWorker(
          "run-context-conditional-omitted",
          ["running"],
          "worker-current",
          { context: { input: {}, removedByOwner: Symbol("omitted") } },
        ),
        true,
      );

      assertEquals((await backend.getRun("run-context-conditional-omitted"))?.context, {
        input: {},
        preserved: "kept",
      });
    });

    it("rechecks conditional status and worker ownership after context hooks", async () => {
      const statusRunId = "run-context-conditional-status-hook";
      await backend.createRun(createTestRun(statusRunId, {
        status: "running",
        workerId: "worker-original",
      }));
      const statusHook = {
        toJSON() {
          void backend.updateRun(statusRunId, { status: "waiting" });
          return "outer-status";
        },
      };

      assertEquals(
        await backend.updateRunIfStatus(statusRunId, ["running"], {
          status: "failed",
          context: { statusHook },
        }),
        false,
      );
      const statusRun = await backend.getRun(statusRunId);
      assertEquals(statusRun?.status, "waiting");
      assertEquals(statusRun?.context.statusHook, undefined);

      const workerRunId = "run-context-conditional-worker-hook";
      await backend.createRun(createTestRun(workerRunId, {
        status: "running",
        workerId: "worker-original",
      }));
      const workerHook = {
        toJSON() {
          void backend.updateRun(workerRunId, { workerId: "worker-replacement" });
          return "outer-worker";
        },
      };

      assertEquals(
        await backend.updateRunIfStatusAndWorker(
          workerRunId,
          ["running"],
          "worker-original",
          { status: "failed", context: { workerHook } },
        ),
        false,
      );
      const workerRun = await backend.getRun(workerRunId);
      assertEquals(workerRun?.status, "running");
      assertEquals(workerRun?.workerId, "worker-replacement");
      assertEquals(workerRun?.context.workerHook, undefined);
    });

    it("keeps conditional updates on the backend atomic path", async () => {
      class BookkeepingUpdateBackend extends MemoryBackend {
        updateCalls = 0;

        override async updateRun(runId: string, patch: WorkflowRunUpdate): Promise<void> {
          this.updateCalls++;
          await super.updateRun(runId, { heartbeatAt: new Date() });
          await super.updateRun(runId, patch);
        }
      }

      const bookkeepingBackend = new BookkeepingUpdateBackend();
      const runId = "run-conditional-override-bookkeeping";
      await bookkeepingBackend.createRun(createTestRun(runId, { status: "running" }));

      assertEquals(
        await bookkeepingBackend.updateRunIfStatus(runId, ["running"], {
          status: "failed",
        }),
        true,
      );
      assertEquals(bookkeepingBackend.updateCalls, 0);
      assertEquals((await bookkeepingBackend.getRun(runId))?.status, "failed");
    });

    it("does not evaluate a conditional patch when its initial guard fails", async () => {
      const runId = "run-conditional-initial-guard";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));
      let patchReads = 0;
      const patch = Object.defineProperty({}, "status", {
        enumerable: true,
        get() {
          patchReads++;
          return "failed";
        },
      }) as Partial<WorkflowRun>;

      assertEquals(await backend.updateRunIfStatus(runId, ["running"], patch), false);
      assertEquals(patchReads, 0);
      assertEquals((await backend.getRun(runId))?.status, "waiting");
    });

    it("rechecks conditional guards after materializing patch containers", async () => {
      const runId = "run-conditional-node-state-proxy";
      await backend.createRun(createTestRun(runId, {
        status: "running",
        nodeStates: {},
      }));
      const nodeStates = new Proxy({
        step: { nodeId: "step", status: "completed" as const, attempt: 1 },
      }, {
        ownKeys(target) {
          void backend.updateRun(runId, { status: "waiting" });
          return Reflect.ownKeys(target);
        },
      });

      assertEquals(
        await backend.updateRunIfStatus(runId, ["running"], {
          status: "failed",
          nodeStates,
        }),
        false,
      );
      const stored = await backend.getRun(runId);
      assertEquals(stored?.status, "waiting");
      assertEquals(stored?.nodeStates, {});
    });

    it("snapshots conditional statuses before context hooks can replace includes", async () => {
      const runId = "run-context-conditional-status-snapshot";
      await backend.createRun(createTestRun(runId, { status: "running" }));
      const expectedStatuses: WorkflowRun["status"][] = ["running"];
      let replacementCalls = 0;
      const statusHook = {
        toJSON() {
          expectedStatuses.includes = () => {
            replacementCalls++;
            void backend.updateRun(runId, { status: "waiting" });
            return true;
          };
          return "stored";
        },
      };

      assertEquals(
        await backend.updateRunIfStatus(runId, expectedStatuses, {
          context: { statusHook },
        }),
        true,
      );
      assertEquals(replacementCalls, 0);
      const stored = await backend.getRun(runId);
      assertEquals(stored?.status, "running");
      assertEquals(stored?.context.statusHook, "stored");
    });

    it("snapshots conditional statuses by index without invoking their iterator", async () => {
      const runId = "run-context-conditional-status-iterator";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));
      const expectedStatuses: WorkflowRun["status"][] = ["running"];
      let iteratorCalls = 0;
      Object.defineProperty(expectedStatuses, Symbol.iterator, {
        configurable: true,
        value: function* () {
          iteratorCalls++;
          yield "waiting";
        },
      });

      assertEquals(
        await backend.updateRunIfStatus(runId, expectedStatuses, { status: "failed" }),
        false,
      );
      assertEquals(iteratorCalls, 0);
      assertEquals((await backend.getRun(runId))?.status, "waiting");
    });

    it("normalizes fractional status-array lengths before indexed reads", async () => {
      const runId = "run-context-conditional-status-length";
      await backend.createRun(createTestRun(runId, { status: "waiting" }));
      let secondIndexReads = 0;
      const expectedStatuses = new Proxy<WorkflowRun["status"][]>(["running", "waiting"], {
        get(target, key, receiver) {
          if (key === "length") return 1.5;
          if (key === "1") secondIndexReads++;
          return Reflect.get(target, key, receiver);
        },
      });

      assertEquals(
        await backend.updateRunIfStatus(runId, expectedStatuses, { status: "failed" }),
        false,
      );
      assertEquals(secondIndexReads, 0);
      assertEquals((await backend.getRun(runId))?.status, "waiting");
    });

    it("rejects BigInt status-array lengths asynchronously", async () => {
      const runId = "run-context-conditional-status-bigint-length";
      await backend.createRun(createTestRun(runId, { status: "running" }));
      const expectedStatuses = new Proxy<WorkflowRun["status"][]>(["running"], {
        get(target, key, receiver) {
          if (key === "length") return 1n;
          return Reflect.get(target, key, receiver);
        },
      });

      await assertRejectsAsynchronously(
        () => backend.updateRunIfStatus(runId, expectedStatuses, { status: "failed" }),
        "BigInt",
      );
      assertEquals((await backend.getRun(runId))?.status, "running");
    });

    it("checks run existence before reading conditional status elements", async () => {
      function reentrantStatuses(runId: string): {
        statuses: WorkflowRun["status"][];
        reads: () => number;
      } {
        let reads = 0;
        const statuses: WorkflowRun["status"][] = ["running"];
        Object.defineProperty(statuses, 0, {
          configurable: true,
          get() {
            reads++;
            void backend.createRun(createTestRun(runId, {
              status: "running",
              workerId: "worker-current",
            }));
            return "running";
          },
        });
        return { statuses, reads: () => reads };
      }

      const checkpointRunId = "run-missing-checkpoint-status";
      const checkpointStatuses = reentrantStatuses(checkpointRunId);
      assertEquals(
        await backend.saveCheckpointIfStatusAndWorker(
          "run-checkpoint-storage",
          checkpointRunId,
          checkpointStatuses.statuses,
          "worker-current",
          createCheckpoint("cp-missing-status", "step", new Date()),
        ),
        false,
      );
      assertEquals(checkpointStatuses.reads(), 0);

      const approvalRunId = "run-missing-approval-status";
      const approvalStatuses = reentrantStatuses(approvalRunId);
      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          approvalRunId,
          approvalStatuses.statuses,
          "worker-current",
          {
            id: "approval-missing-status",
            nodeId: "review",
            status: "pending",
            message: "Review",
            requestedAt: new Date(),
          },
        ),
        false,
      );
      assertEquals(approvalStatuses.reads(), 0);

      const waitRunId = "run-missing-event-wait-status";
      const waitStatuses = reentrantStatuses(waitRunId);
      await assertRejectsAsynchronously(
        () =>
          backend.savePendingEventWaitIfStatusAndWorker(
            waitRunId,
            waitStatuses.statuses,
            "worker-current",
            {
              id: "wait-missing-status",
              runId: waitRunId,
              nodeId: "await-event",
              eventName: "event.ready",
              waitKind: "event",
              requestedAt: new Date(),
              status: "pending",
            },
          ),
        "Run not found",
      );
      assertEquals(waitStatuses.reads(), 0);
    });

    it("persists context through the same JSON contract as Redis", async () => {
      class Receipt {
        constructor(readonly id: string) {}
      }

      const initialContext = {
        input: {},
        when: new Date(0),
        tags: new Map([["a", 1]]),
        receipt: new Receipt("r-1"),
        missing: undefined,
        ratio: Number.NaN,
      };
      const patchContext = {
        later: new Date("2025-06-15T12:00:00Z"),
        skipped: undefined,
        invalidRatio: Number.NaN,
      };

      await backend.createRun(createTestRun("run-json-context", {
        context: initialContext,
      }));
      assertEquals((await backend.getRun("run-json-context"))?.context, {
        input: {},
        when: "1970-01-01T00:00:00.000Z",
        tags: {},
        receipt: { id: "r-1" },
        ratio: null,
      });

      await backend.updateRun("run-json-context", { context: patchContext });
      assertEquals((await backend.getRun("run-json-context"))?.context, {
        input: {},
        when: "1970-01-01T00:00:00.000Z",
        tags: {},
        receipt: { id: "r-1" },
        ratio: null,
        later: "2025-06-15T12:00:00.000Z",
        invalidRatio: null,
      });
    });

    it("stores accepted deep context without a stack-limited whole-run clone", async () => {
      const depth = MAX_TRAVERSAL_DEPTH + 1_500;
      const originalLeaf: Record<string, unknown> = { leaf: "stored" };
      let deep: unknown = originalLeaf;
      for (let index = 0; index < depth; index++) deep = { nested: deep };
      const context = { input: {}, deep } as WorkflowRun["context"];
      if (jsonRawSupport.rawJSON) context.exact = jsonRawSupport.rawJSON("-0");

      await backend.createRun(createTestRun("run-deep-context", {
        status: "running",
        context,
        startedAt: new Date(0),
        heartbeatAt: new Date(0),
      }));
      originalLeaf.leaf = "mutated after create";

      const firstRead = await backend.getRun("run-deep-context");
      assertExists(firstRead);
      assertEquals(deepLeaf(firstRead.context.deep, depth), "stored");
      if (jsonRawSupport.rawJSON) assertEquals(Object.is(firstRead.context.exact, -0), true);
      const listed = (await backend.listRuns({}))[0];
      assertEquals(deepLeaf(listed?.context.deep, depth), "stored");
      if (jsonRawSupport.rawJSON) assertEquals(Object.is(listed?.context.exact, -0), true);
      const observation = await backend.openRunObservation("run-deep-context");
      assertExists(observation);
      assertEquals(deepLeaf(observation.initial.context.deep, depth), "stored");
      assertEquals(Object.is(observation.initial.context.exact, -0), true);
      await observation.close();
      const stalled = (await backend.findStalledRuns(0))[0];
      assertEquals(deepLeaf(stalled?.context.deep, depth), "stored");
      assertEquals(Object.is(stalled?.context.exact, -0), true);

      setDeepLeaf(firstRead.context.deep, depth, "mutated after read");
      const secondRead = await backend.getRun("run-deep-context");
      assertExists(secondRead);
      assertEquals(deepLeaf(secondRead.context.deep, depth), "stored");
      assertEquals(Object.is(secondRead.context.exact, -0), true);
    });

    it("rejects context values the durable JSON contract cannot encode", async () => {
      await assertRejects(
        () =>
          backend.createRun(createTestRun("run-fatal-context", {
            context: { input: {}, total: 1n },
          })),
        Error,
        "context.<redacted>",
      );
      assertEquals(await backend.getRun("run-fatal-context"), null);
    });

    it("rejects lossy context values when strictContext is enabled", async () => {
      const strictBackend = new MemoryBackend({ strictContext: true });
      const rows: unknown[] = [{ id: 1 }];
      Object.defineProperty(rows, "meta", {
        value: "required",
        enumerable: true,
      });
      let deep: unknown = { when: new Date(0) };
      for (let index = 0; index < MAX_TRAVERSAL_DEPTH + 25; index++) deep = { n: deep };

      for (
        const testCase of [
          {
            id: "run-strict-date-context",
            context: { input: {}, when: new Date(0) },
            message: "strictContext",
          },
          {
            id: "run-strict-array-context",
            context: { input: {}, rows },
            message: "array property",
          },
          {
            id: "run-strict-deep-context",
            context: { input: {}, deep },
            message: "uninspected value",
          },
        ]
      ) {
        await assertRejects(
          () =>
            strictBackend.createRun(createTestRun(testCase.id, {
              context: testCase.context,
            })),
          Error,
          testCase.message,
        );
        assertEquals(await strictBackend.getRun(testCase.id), null);
      }
    });

    it("rejects invalid context from Promise-returning mutation methods asynchronously", async () => {
      const strictBackend = new MemoryBackend({ strictContext: true });

      await strictBackend.createRun(createTestRun("run-strict-mutation", {
        status: "running",
        workerId: "worker-1",
      }));

      await assertRejectsAsynchronously(
        () =>
          strictBackend.updateRun("run-strict-mutation", {
            context: { input: {}, when: new Date(0) },
          }),
        "strictContext",
      );
      assertEquals((await strictBackend.getRun("run-strict-mutation"))?.context.when, undefined);

      await assertRejectsAsynchronously(
        () =>
          strictBackend.restoreRunStateIfStatus(
            "run-strict-mutation",
            ["running"],
            {
              status: "waiting",
              context: { input: {}, when: new Date(0) },
              nodeStates: {},
            },
            "worker-1",
          ),
        "strictContext",
      );
      assertEquals((await strictBackend.getRun("run-strict-mutation"))?.status, "running");

      await assertRejectsAsynchronously(
        () =>
          strictBackend.saveCheckpoint("run-strict-mutation", {
            ...createCheckpoint("cp-strict", "step-1", new Date()),
            context: { input: {}, when: new Date(0) },
          }),
        "strictContext",
      );
      assertEquals(await strictBackend.getCheckpoints("run-strict-mutation"), []);

      await assertRejectsAsynchronously(
        () =>
          strictBackend.saveCheckpointIfStatusAndWorker(
            "run-strict-child",
            "run-strict-mutation",
            ["running"],
            "worker-1",
            {
              ...createCheckpoint("cp-strict-child", "step-1", new Date()),
              context: { input: {}, when: new Date(0) },
            },
          ),
        "strictContext",
      );
      assertEquals(await strictBackend.getCheckpoints("run-strict-child"), []);
    });

    it("merges node-state sets while applying explicit deletions", async () => {
      await backend.createRun(createTestRun("run-node-state-delete", {
        nodeStates: {
          removed: { nodeId: "removed", status: "completed", attempt: 1 },
          concurrent: { nodeId: "concurrent", status: "completed", attempt: 1 },
        },
      }));

      await backend.updateRun("run-node-state-delete", {
        nodeStates: {
          kept: { nodeId: "kept", status: "completed", attempt: 1 },
        },
        nodeStateDeletes: ["removed"],
      });

      assertEquals((await backend.getRun("run-node-state-delete"))?.nodeStates, {
        concurrent: { nodeId: "concurrent", status: "completed", attempt: 1 },
        kept: { nodeId: "kept", status: "completed", attempt: 1 },
      });
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

    it("replaces context and node states wholesale on a snapshot restore", async () => {
      await backend.createRun(createTestRun("run-restore", {
        status: "waiting",
        workerId: "worker-owner",
        context: { input: {}, early: "kept", late: "post-checkpoint" },
        nodeStates: {
          early: { nodeId: "early", status: "completed", attempt: 1 },
          late: { nodeId: "late", status: "completed", attempt: 1 },
        },
      }));
      const snapshot = {
        status: "running" as const,
        context: { input: {}, early: "kept" },
        nodeStates: { early: { nodeId: "early", status: "completed" as const, attempt: 1 } },
      };

      assertEquals(
        await backend.restoreRunStateIfStatus("run-restore", ["waiting"], snapshot, "worker-else"),
        false,
        "a restore fenced on a stale worker owner must not apply",
      );
      assertEquals(
        await backend.restoreRunStateIfStatus("run-restore", ["running"], snapshot, "worker-owner"),
        false,
        "a restore against an unexpected status must not apply",
      );

      assertEquals(
        await backend.restoreRunStateIfStatus("run-restore", ["waiting"], snapshot, "worker-owner"),
        true,
      );
      const restored = await backend.getRun("run-restore");
      assertEquals(restored?.status, "running");
      assertEquals(
        restored?.context,
        { input: {}, early: "kept" },
        "a snapshot restore must drop context keys written after the checkpoint, " +
          "unlike the per-key merge updateRun applies",
      );
      assertEquals(
        restored?.nodeStates,
        { early: { nodeId: "early", status: "completed", attempt: 1 } },
        "a node completed after the checkpoint must not survive the restore, " +
          "or replay skips it instead of re-running it",
      );
    });

    it("rechecks restore ownership after serializing snapshot context", async () => {
      const runId = "run-restore-context-hook-owner";
      await backend.createRun(createTestRun(runId, {
        status: "waiting",
        workerId: "worker-original",
        context: { input: {}, preserved: "current" },
      }));
      const hook = {
        toJSON() {
          void backend.updateRun(runId, { workerId: "worker-replacement" });
          return "outer-restore";
        },
      };

      assertEquals(
        await backend.restoreRunStateIfStatus(
          runId,
          ["waiting"],
          {
            status: "running",
            context: { input: { hook } },
            nodeStates: {},
          },
          "worker-original",
        ),
        false,
      );
      const stored = await backend.getRun(runId);
      assertEquals(stored?.status, "waiting");
      assertEquals(stored?.workerId, "worker-replacement");
      assertEquals(stored?.context, { input: {}, preserved: "current" });
    });

    it("rechecks restore status after materializing snapshot fields", async () => {
      const runId = "run-restore-field-accessor";
      await backend.createRun(createTestRun(runId, {
        status: "waiting",
        context: { input: {}, preserved: "current" },
      }));
      const snapshot = Object.defineProperty(
        {
          context: { input: { restored: true } },
          nodeStates: {},
        },
        "status",
        {
          enumerable: true,
          get() {
            void backend.updateRun(runId, { status: "cancelled" });
            return "running";
          },
        },
      );

      assertEquals(
        await backend.restoreRunStateIfStatus(runId, ["waiting"], snapshot),
        false,
      );
      const stored = await backend.getRun(runId);
      assertEquals(stored?.status, "cancelled");
      assertEquals(stored?.context, { input: {}, preserved: "current" });
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
    it("preserves the historical append semantics of savePendingApproval", async () => {
      const approval = (id: string): PendingApproval => ({
        id,
        nodeId: "review",
        message: "Review",
        requestedAt: new Date(),
        status: "pending",
      });

      await backend.savePendingApproval("approval-append", approval("first"));
      await backend.savePendingApproval("approval-append", approval("second"));

      assertEquals(
        (await backend.getPendingApprovals("approval-append")).map(({ id }) => id),
        ["first", "second"],
      );
    });

    it("atomically elects one ownerless approval creator", async () => {
      const runId = "approval-ownerless-uniqueness";
      const approval = (id: string): PendingApproval => ({
        id,
        nodeId: "review",
        message: "Review",
        requestedAt: new Date(),
        status: "pending",
      });

      assertEquals(await backend.savePendingApprovalIfAbsent(runId, approval("first")), true);
      assertEquals(await backend.savePendingApprovalIfAbsent(runId, approval("second")), false);
      assertEquals((await backend.getPendingApprovals(runId)).map(({ id }) => id), ["first"]);
    });

    it("preserves the historical append contract for unconditional approval saves", async () => {
      const runId = "approval-unconditional-append";
      const approval = (id: string): PendingApproval => ({
        id,
        nodeId: "review",
        message: "Review",
        requestedAt: new Date(),
        status: "pending",
      });

      await backend.savePendingApproval(runId, approval("first"));
      await backend.savePendingApproval(runId, approval("second"));

      assertEquals(
        (await backend.getPendingApprovals(runId)).map(({ id }) => id),
        ["first", "second"],
      );
    });

    it("allows a new wait instance while the previous decision is reconciling", async () => {
      const runId = "approval-repeated-wait-instance";
      const approval = (id: string, waitInstanceId: string): PersistedPendingApproval => ({
        id,
        nodeId: "review",
        waitInstanceId,
        message: "Review",
        requestedAt: new Date(),
        status: "pending",
      });

      assertEquals(
        await backend.savePendingApprovalIfAbsent(runId, approval("first", "wait-1")),
        true,
      );
      await backend.updateApproval(runId, "first", { approved: true, approver: "reviewer" });
      assertEquals(
        await backend.savePendingApprovalIfAbsent(runId, approval("second", "wait-2")),
        true,
      );
      assertEquals(
        await backend.savePendingApprovalIfAbsent(runId, approval("duplicate", "wait-2")),
        false,
      );
      assertEquals((await backend.getPendingApprovals(runId)).map(({ id }) => id), ["second"]);
    });

    it("keeps one pending approval per node until the first is decided", async () => {
      const run = createTestRun("approval-node-uniqueness", {
        status: "waiting",
        workerId: "worker-a",
      });
      await backend.createRun(run);
      const approval = (id: string): PendingApproval => ({
        id,
        nodeId: "review",
        message: "Review",
        payload: {},
        requestedAt: new Date(),
        status: "pending",
      });

      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          run.id,
          ["waiting"],
          "worker-a",
          approval("first"),
        ),
        true,
      );
      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          run.id,
          ["waiting"],
          "worker-a",
          approval("duplicate"),
        ),
        false,
      );
      assertEquals((await backend.getPendingApprovals(run.id)).map(({ id }) => id), ["first"]);

      await backend.updateApproval(run.id, "first", { approved: true, approver: "reviewer" });
      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          run.id,
          ["waiting"],
          "worker-a",
          approval("retry-before-finalize"),
        ),
        false,
      );
      await backend.finalizeApprovalDecision(run.id, "first");
      assertEquals(
        await backend.savePendingApprovalIfStatusAndWorker(
          run.id,
          ["waiting"],
          "worker-a",
          approval("retry"),
        ),
        true,
      );
      assertEquals((await backend.getPendingApprovals(run.id)).map(({ id }) => id), ["retry"]);
    });

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
          data: { confirmed: true },
        }),
        true,
        "the first decision on a pending approval must report that it was written",
      );

      const updatedApproval = await backend.getPendingApproval("run-2", "approval-2");
      assertEquals(updatedApproval?.status, "approved");
      assertEquals(updatedApproval?.decidedBy, "admin@example.com");
      assertEquals(updatedApproval?.comment, "Looks good!");
      assertEquals(updatedApproval?.decisionData, { confirmed: true });

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

    it("rechecks approval status after serializing decision data", async () => {
      const runId = "run-reentrant-approval-decision";
      const approval: PendingApproval = {
        id: "approval-reentrant-decision",
        nodeId: "review",
        status: "pending",
        message: "Review needed",
        payload: {},
        requestedAt: new Date(),
      };
      await backend.savePendingApproval(runId, approval);

      let nestedDecision: Promise<boolean> | undefined;
      const data = {
        toJSON() {
          nestedDecision = backend.updateApproval(runId, approval.id, {
            approved: true,
            approver: "first@example.com",
            comment: "first decision",
            data: { winner: "first" },
          });
          return { winner: "outer" };
        },
      };

      assertEquals(
        await backend.updateApproval(runId, approval.id, {
          approved: false,
          approver: "outer@example.com",
          comment: "outer decision",
          data,
        }),
        false,
      );
      assertEquals(await nestedDecision, true);
      const stored = await backend.getPendingApproval(runId, approval.id);
      assertEquals(stored?.status, "approved");
      assertEquals(stored?.decidedBy, "first@example.com");
      assertEquals(stored?.comment, "first decision");
      assertEquals(stored?.decisionData, { winner: "first" });
    });

    it("rechecks approval status after reading decision accessors", async () => {
      const runId = "run-reentrant-approval-accessor";
      const approval: PendingApproval = {
        id: "approval-reentrant-accessor",
        nodeId: "review",
        status: "pending",
        message: "Review needed",
        payload: {},
        requestedAt: new Date(),
      };
      await backend.savePendingApproval(runId, approval);

      let nestedDecision: Promise<boolean> | undefined;
      const decision = Object.defineProperty(
        {
          approved: false,
          approver: "outer@example.com",
          comment: "outer decision",
        },
        "approved",
        {
          enumerable: true,
          get() {
            nestedDecision = backend.updateApproval(runId, approval.id, {
              approved: true,
              approver: "first@example.com",
              comment: "first decision",
            });
            return false;
          },
        },
      );

      assertEquals(await backend.updateApproval(runId, approval.id, decision), false);
      assertEquals(await nestedDecision, true);
      const stored = await backend.getPendingApproval(runId, approval.id);
      assertEquals(stored?.status, "approved");
      assertEquals(stored?.decidedBy, "first@example.com");
      assertEquals(stored?.comment, "first decision");
    });

    it("rejects reentrant approval deletion asynchronously", async () => {
      const runId = "run-reentrant-approval-deletion";
      const approval: PendingApproval = {
        id: "approval-reentrant-deletion",
        nodeId: "review",
        status: "pending",
        message: "Review needed",
        payload: {},
        requestedAt: new Date(),
      };
      await backend.savePendingApproval(runId, approval);

      await assertRejectsAsynchronously(
        () =>
          backend.updateApproval(runId, approval.id, {
            approved: true,
            approver: "reviewer@example.com",
            data: {
              toJSON() {
                void backend.deleteRun(runId);
                return "deleted";
              },
            },
          }),
        "Approval not found",
      );
    });

    it("rejects a replacement approval created during decision serialization", async () => {
      const runId = "run-reentrant-approval-replacement";
      const approval: PendingApproval = {
        id: "approval-reentrant-replacement",
        nodeId: "review",
        status: "pending",
        message: "Original approval",
        payload: {},
        requestedAt: new Date(),
      };
      await backend.savePendingApproval(runId, approval);

      await assertRejectsAsynchronously(
        () =>
          backend.updateApproval(runId, approval.id, {
            approved: true,
            approver: "stale-reviewer@example.com",
            data: {
              toJSON() {
                void backend.deleteRun(runId);
                void backend.createRun(createTestRun(runId));
                void backend.savePendingApproval(runId, {
                  ...approval,
                  message: "Replacement approval",
                });
                return "stale-decision";
              },
            },
          }),
        "Approval not found",
      );

      const replacement = await backend.getPendingApproval(runId, approval.id);
      assertEquals(replacement?.status, "pending");
      assertEquals(replacement?.message, "Replacement approval");
      assertEquals(replacement?.decidedBy, undefined);
    });

    it("uses the JSON persistence contract for non-strict approval decision data", async () => {
      const approval: PendingApproval = {
        id: "approval-json-decision",
        nodeId: "review",
        status: "pending",
        message: "Review needed",
        payload: {},
        requestedAt: new Date(),
      };
      await backend.savePendingApproval("run-json-approval", approval);

      assertEquals(
        await backend.updateApproval("run-json-approval", approval.id, {
          approved: true,
          approver: "admin@example.com",
          data: {
            when: new Date("2026-01-01T00:00:00.000Z"),
            missing: undefined,
            ratio: Number.NaN,
          },
        }),
        true,
      );
      assertEquals(
        (await backend.getPendingApproval("run-json-approval", approval.id))?.decisionData,
        { when: "2026-01-01T00:00:00.000Z", ratio: null },
      );

      const bigintApproval: PendingApproval = {
        ...approval,
        id: "approval-json-bigint",
      };
      await backend.savePendingApproval("run-json-bigint", bigintApproval);
      await assertRejectsAsynchronously(
        () =>
          backend.updateApproval("run-json-bigint", bigintApproval.id, {
            approved: true,
            approver: "admin@example.com",
            data: { value: 1n },
          }),
        "BigInt",
      );
      assertEquals(
        (await backend.getPendingApproval("run-json-bigint", bigintApproval.id))?.status,
        "pending",
      );
    });

    it("preserves raw numeric approval decision data when reading approvals", async () => {
      const rawJSON = jsonRawSupport.rawJSON;
      if (!rawJSON) return;
      const runId = "run-approval-raw-number-read";
      const approval: PendingApproval = {
        id: "approval-raw-number-read",
        nodeId: "review",
        status: "pending",
        message: "Review needed",
        payload: {},
        requestedAt: new Date(),
      };
      await backend.savePendingApproval(runId, approval);

      assertEquals(
        await backend.updateApproval(runId, approval.id, {
          approved: true,
          approver: "admin@example.com",
          data: { exact: rawJSON("-0") },
        }),
        true,
      );

      const stored = await backend.getPendingApproval(runId, approval.id);
      assertEquals(
        Object.is((stored?.decisionData as { exact?: unknown } | undefined)?.exact, -0),
        true,
      );
    });

    it("preserves raw numeric approval decision data for reconciliation claims", async () => {
      const rawJSON = jsonRawSupport.rawJSON;
      if (!rawJSON) return;
      const runId = "run-approval-raw-number-claim";
      const approval: PendingApproval = {
        id: "approval-raw-number-claim",
        nodeId: "review",
        status: "pending",
        message: "Review needed",
        payload: {},
        requestedAt: new Date(),
      };
      await backend.savePendingApproval(runId, approval);

      assertEquals(
        await backend.updateApproval(runId, approval.id, {
          approved: true,
          approver: "admin@example.com",
          data: { exact: rawJSON("-0") },
        }),
        true,
      );

      const [claim] = await backend.listApprovalDecisionClaims(runId);
      assertExists(claim);
      assertEquals(
        Object.is((claim.approval.decisionData as { exact?: unknown } | undefined)?.exact, -0),
        true,
      );
    });

    it("keeps deep approval decision data cloneable for reconciliation", async () => {
      const depth = MAX_TRAVERSAL_DEPTH + 1_500;
      const originalLeaf: Record<string, unknown> = { leaf: "stored" };
      let deep: unknown = originalLeaf;
      for (let index = 0; index < depth; index++) deep = { nested: deep };

      const runId = "run-deep-approval-decision";
      const approval: PendingApproval = {
        id: "approval-deep-decision",
        nodeId: "review",
        status: "pending",
        message: "Review needed",
        payload: {},
        requestedAt: new Date(),
      };
      await backend.savePendingApproval(runId, approval);

      assertEquals(
        await backend.updateApproval(runId, approval.id, {
          approved: true,
          approver: "admin@example.com",
          data: { deep },
        }),
        true,
      );
      originalLeaf.leaf = "mutated after update";

      const [firstClaim] = await backend.listApprovalDecisionClaims(runId);
      assertExists(firstClaim);
      assertEquals(
        deepLeaf((firstClaim.approval.decisionData as Record<string, unknown>).deep, depth),
        "stored",
      );
      assertEquals(
        await backend.reserveApprovalDecisionClaim(
          runId,
          approval.id,
          "recovery-1",
          new Date(),
          new Date(0),
        ),
        true,
      );
      await backend.releaseApprovalDecisionClaim(runId, approval.id, "recovery-1");
      setDeepLeaf(
        (firstClaim.approval.decisionData as Record<string, unknown>).deep,
        depth,
        "mutated after claim",
      );

      const [secondClaim] = await backend.listApprovalDecisionClaims(runId);
      assertExists(secondClaim);
      assertEquals(
        deepLeaf((secondClaim.approval.decisionData as Record<string, unknown>).deep, depth),
        "stored",
      );

      await backend.finalizeApprovalDecision(runId, approval.id);
      assertEquals(await backend.listApprovalDecisionClaims(runId), []);
    });

    it("rejects strict approval decision data before mutating the approval", async () => {
      const strictBackend = new MemoryBackend({ strictContext: true });
      const approval: PendingApproval = {
        id: "approval-strict-decision",
        nodeId: "review",
        status: "pending",
        message: "Review needed",
        payload: {},
        requestedAt: new Date(),
      };
      await strictBackend.savePendingApproval("run-strict-approval", approval);

      await assertRejectsAsynchronously(
        () =>
          strictBackend.updateApproval("run-strict-approval", approval.id, {
            approved: true,
            approver: "admin@example.com",
            data: { when: new Date(0) },
          }),
        "strictContext",
      );

      const stored = await strictBackend.getPendingApproval("run-strict-approval", approval.id);
      assertEquals(stored?.status, "pending");
      assertEquals(stored?.decidedBy, undefined);
      assertEquals(stored?.decidedAt, undefined);
      assertEquals(stored?.decisionData, undefined);
      assertEquals(stored?.reconciliationPending, undefined);
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

  describe("Durable event waits", () => {
    function createEventWait(
      id: string,
      overrides: Partial<PersistedPendingEventWait> = {},
    ): PersistedPendingEventWait {
      return {
        id,
        runId: "run-events",
        nodeId: "await-payment",
        eventName: "payment.confirmed",
        waitKind: "event",
        requestedAt: new Date(),
        status: "pending",
        ...overrides,
      };
    }

    beforeEach(async () => {
      await backend.createRun(createTestRun("run-events", { status: "waiting" }));
    });

    it("returns a saved wait as pending for its run", async () => {
      await backend.savePendingEventWait("run-events", createEventWait("evw-1"));

      const waits = await backend.getPendingEventWaits("run-events");
      assertEquals(waits.length, 1, "the saved wait must be readable back as pending");
      assertEquals(waits[0]?.eventName, "payment.confirmed", "the event name must round-trip");
    });

    it("keeps one pending event wait per node until the first is resolved", async () => {
      await backend.savePendingEventWait("run-events", createEventWait("first"));
      await backend.savePendingEventWait("run-events", createEventWait("duplicate"));
      assertEquals(
        (await backend.getPendingEventWaits("run-events")).map(({ id }) => id),
        ["first"],
      );

      assertEquals(
        await backend.resolvePendingEventWait("run-events", "first", "delivered"),
        true,
      );
      await backend.finalizeTimedEventWaitClaim("run-events", "first");
      await backend.savePendingEventWait("run-events", createEventWait("retry"));
      assertEquals(
        (await backend.getPendingEventWaits("run-events")).map(({ id }) => id),
        ["retry"],
      );
    });

    it("allows a new event-wait instance while the previous timeout claim is live", async () => {
      await backend.savePendingEventWait(
        "run-events",
        createEventWait("first", { waitInstanceId: "wait-1" }),
      );
      await backend.resolvePendingEventWait("run-events", "first", "expired");

      await backend.savePendingEventWait(
        "run-events",
        createEventWait("second", { waitInstanceId: "wait-2" }),
      );
      await backend.savePendingEventWait(
        "run-events",
        createEventWait("duplicate", { waitInstanceId: "wait-2" }),
      );

      assertEquals(
        (await backend.getPendingEventWaits("run-events")).map(({ id }) => id),
        ["second"],
      );
      assertEquals((await backend.listTimedEventWaitClaims("run-events"))[0]?.id, "first");
    });

    it("takes a buffered event only for the matching event name, oldest first", async () => {
      await backend.appendRunEvent("run-events", {
        id: "evt-1",
        eventName: "payment.confirmed",
        payload: { seq: 1 },
        publishedAt: new Date(),
      });
      await backend.appendRunEvent("run-events", {
        id: "evt-2",
        eventName: "other.event",
        payload: { seq: 2 },
        publishedAt: new Date(),
      });
      await backend.appendRunEvent("run-events", {
        id: "evt-3",
        eventName: "payment.confirmed",
        payload: { seq: 3 },
        publishedAt: new Date(),
      });

      const first = await backend.takeRunEvent("run-events", "payment.confirmed");
      assertEquals(first?.payload, { seq: 1 }, "the oldest matching event must be taken first");

      const second = await backend.takeRunEvent("run-events", "payment.confirmed");
      assertEquals(second?.payload, { seq: 3 }, "the next matching event must be taken next");

      assertEquals(
        await backend.takeRunEvent("run-events", "payment.confirmed"),
        null,
        "an exhausted mailbox must report no matching event",
      );
      assertEquals(
        (await backend.takeRunEvent("run-events", "other.event"))?.payload,
        { seq: 2 },
        "a non-matching event must stay buffered for its own name",
      );
    });

    it("refuses a wait append that would drop a still-pending wait", async () => {
      for (let index = 0; index < MAX_WORKFLOW_PENDING_EVENT_WAIT_ENTRIES; index++) {
        await backend.savePendingEventWait(
          "run-events",
          createEventWait(`evw-${index}`, { nodeId: `await-payment-${index}` }),
        );
      }

      await assertRejects(
        () =>
          backend.savePendingEventWait(
            "run-events",
            createEventWait("evw-overflow", { nodeId: "await-payment-overflow" }),
          ),
        Error,
        "Event wait list full",
      );
      assertEquals(
        (await backend.getPendingEventWaits("run-events")).length,
        MAX_WORKFLOW_PENDING_EVENT_WAIT_ENTRIES,
        "a refused append must leave existing waits untouched",
      );
    });

    it("refuses a publish at the mailbox bound instead of dropping a buffered event", async () => {
      for (let index = 0; index < MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES; index++) {
        await backend.appendRunEvent("run-events", {
          id: "evt-4",
          eventName: "payment.confirmed",
          payload: { seq: index },
          publishedAt: new Date(),
        });
      }

      await assertRejects(
        () =>
          backend.appendRunEvent("run-events", {
            id: "evt-5",
            eventName: "payment.confirmed",
            payload: { seq: MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES },
            publishedAt: new Date(),
          }),
        Error,
        "Run event mailbox full",
      );

      const oldestRetained = await backend.takeRunEvent("run-events", "payment.confirmed");
      assertEquals(
        oldestRetained?.payload,
        { seq: 0 },
        "a refused publish must leave the oldest buffered event in place, since a wait " +
          "that has not parked yet may still claim it",
      );
    });

    it("reserves mailbox capacity for in-flight delivery claims", async () => {
      await backend.savePendingEventWait("run-events", createEventWait("evw-capacity-claim"));
      for (let index = 0; index < MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES; index++) {
        await backend.appendRunEvent("run-events", {
          id: `evt-capacity-${index}`,
          eventName: "payment.confirmed",
          payload: { seq: index },
          publishedAt: new Date(index),
        });
      }
      const claimed = await backend.claimRunEventForWait(
        "run-events",
        "evw-capacity-claim",
        "payment.confirmed",
      );
      assertExists(claimed);

      await assertRejects(
        () =>
          backend.appendRunEvent("run-events", {
            id: "evt-capacity-overflow",
            eventName: "payment.confirmed",
            payload: { overflow: true },
            publishedAt: new Date(MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES),
          }),
        Error,
        "Run event mailbox full",
      );
      assertEquals(
        await backend.restoreRunEventDelivery(
          "run-events",
          "evw-capacity-claim",
          claimed,
        ),
        true,
      );

      let retained = 0;
      while (await backend.takeRunEvent("run-events", "payment.confirmed")) retained++;
      assertEquals(
        retained,
        MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES,
        "rolling back a reserved claim must restore the mailbox to, not beyond, its bound",
      );
    });

    it("drops orphan mailboxes past the bound but keeps one whose run exists", async () => {
      await backend.appendRunEvent("run-events", {
        id: "evt-6",
        eventName: "payment.confirmed",
        payload: { kept: true },
        publishedAt: new Date(),
      });
      for (let index = 0; index <= MAX_WORKFLOW_RUN_EVENT_MAILBOXES; index++) {
        await backend.appendRunEvent(`run-never-started-${index}`, {
          id: "evt-7",
          eventName: "payment.confirmed",
          payload: { index },
          publishedAt: new Date(),
        });
      }

      assertEquals(
        (await backend.takeRunEvent("run-events", "payment.confirmed"))?.payload,
        { kept: true },
        "a mailbox whose run exists must survive orphan eviction",
      );
      assertEquals(
        await backend.takeRunEvent("run-never-started-0", "payment.confirmed"),
        null,
        "the oldest mailbox belonging to no run must be evicted at the bound",
      );
    });

    it("rejects a new orphan mailbox when active runs occupy the global bound", async () => {
      await backend.appendRunEvent("run-events", {
        id: "evt-active-0",
        eventName: "ready",
        payload: undefined,
        publishedAt: new Date(),
      });
      for (let index = 1; index < MAX_WORKFLOW_RUN_EVENT_MAILBOXES; index++) {
        const runId = `run-active-${index}`;
        await backend.createRun(createTestRun(runId, { status: "waiting" }));
        await backend.appendRunEvent(runId, {
          id: `evt-active-${index}`,
          eventName: "ready",
          payload: undefined,
          publishedAt: new Date(),
        });
      }

      await assertRejects(
        () =>
          backend.appendRunEvent("run-not-created", {
            id: "evt-refused",
            eventName: "ready",
            payload: undefined,
            publishedAt: new Date(),
          }),
        Error,
        "mailbox capacity",
      );
      assertEquals(await backend.takeRunEvent("run-not-created", "ready"), null);

      await backend.savePendingEventWait(
        "run-events",
        createEventWait("evw-claimed-mailbox", { eventName: "ready" }),
      );
      const claimed = await backend.claimRunEventForWait(
        "run-events",
        "evw-claimed-mailbox",
        "ready",
      );
      assertExists(claimed);

      await assertRejects(
        () =>
          backend.appendRunEvent("run-racing-publisher", {
            id: "evt-racing-publisher",
            eventName: "ready",
            payload: undefined,
            publishedAt: new Date(),
          }),
        Error,
        "mailbox capacity",
      );
      assertEquals(
        await backend.restoreRunEventDelivery(
          "run-events",
          "evw-claimed-mailbox",
          claimed,
        ),
        true,
      );
      assertEquals(
        (await backend.takeRunEvent("run-events", "ready"))?.id,
        "evt-active-0",
        "a claimed last event must retain its mailbox slot until delivery commits",
      );

      await backend.savePendingEventWait(
        "run-events",
        createEventWait("evw-finalized-mailbox", {
          nodeId: "await-finalized-mailbox",
          eventName: "ready",
        }),
      );
      await backend.appendRunEvent("run-events", {
        id: "evt-finalized-mailbox",
        eventName: "ready",
        payload: undefined,
        publishedAt: new Date(),
      });
      const delivered = await backend.claimRunEventForWait(
        "run-events",
        "evw-finalized-mailbox",
        "ready",
      );
      assertExists(delivered);
      await backend.finalizeRunEventDelivery("run-events", delivered.id, true);
      await backend.appendRunEvent("run-after-finalize", {
        id: "evt-after-finalize",
        eventName: "ready",
        payload: undefined,
        publishedAt: new Date(),
      });
      assertEquals(
        (await backend.takeRunEvent("run-after-finalize", "ready"))?.id,
        "evt-after-finalize",
        "successful delivery must release an empty mailbox reservation",
      );
    });

    it("clears waits and buffered events when the run is deleted", async () => {
      await backend.savePendingEventWait("run-events", createEventWait("evw-1"));
      await backend.appendRunEvent("run-events", {
        id: "evt-8",
        eventName: "payment.confirmed",
        payload: {},
        publishedAt: new Date(),
      });

      await backend.deleteRun("run-events");

      assertEquals(
        (await backend.getPendingEventWaits("run-events")).length,
        0,
        "deleting a run must drop its pending event waits",
      );
      assertEquals(
        await backend.takeRunEvent("run-events", "payment.confirmed"),
        null,
        "deleting a run must drop its buffered events",
      );
    });

    it("lets exactly one caller resolve a pending wait", async () => {
      await backend.savePendingEventWait("run-events", createEventWait("evw-1"));

      assertEquals(
        await backend.resolvePendingEventWait("run-events", "evw-1", "delivered"),
        true,
        "the first resolver must win",
      );
      assertEquals(
        await backend.resolvePendingEventWait("run-events", "evw-1", "expired"),
        false,
        "a second resolver must lose rather than resolve the wait twice",
      );
    });

    it("returns a delivered wait to pending so a failed delivery can be retried", async () => {
      await backend.savePendingEventWait("run-events", createEventWait("evw-1"));
      await backend.resolvePendingEventWait("run-events", "evw-1", "delivered");

      assertEquals(
        await backend.restorePendingEventWait("run-events", "evw-1"),
        true,
        "a delivery claim must be givable back when the delivery itself failed",
      );
      assertEquals(
        (await backend.getPendingEventWaits("run-events")).map((wait) => wait.id),
        ["evw-1"],
        "a restored wait must be pending again, or nothing can wake the run",
      );
    });

    it("refuses to reopen a wait that was never claimed", async () => {
      await backend.savePendingEventWait("run-events", createEventWait("evw-1"));

      assertEquals(
        await backend.restorePendingEventWait("run-events", "evw-1"),
        false,
        "a wait nobody claimed has nothing to give back",
      );
      assertEquals(
        await backend.restorePendingEventWait("run-events", "evw-missing"),
        false,
        "a wait id that does not exist must report that rather than throw",
      );

      await backend.resolvePendingEventWait("run-events", "evw-1", "cancelled");
      assertEquals(
        await backend.restorePendingEventWait("run-events", "evw-1"),
        false,
        "a cancelled wait belongs to a terminal run and must not be resurrected",
      );
    });

    it("returns an expired wait to pending so a lost run failure can be replayed", async () => {
      await backend.savePendingEventWait("run-events", createEventWait("evw-1"));
      await backend.resolvePendingEventWait("run-events", "evw-1", "expired");

      assertEquals(
        await backend.restorePendingEventWait("run-events", "evw-1"),
        true,
        "an expired claim whose run failure did not commit must stay replayable",
      );
      assertEquals(
        (await backend.getPendingEventWaits("run-events")).map((wait) => wait.id),
        ["evw-1"],
        "the restored wait must be pending again so the sweep can expire it again",
      );
    });

    it("claims an event and resolves its wait as one step, or does nothing at all", async () => {
      await backend.savePendingEventWait("run-events", createEventWait("evw-1"));

      assertEquals(
        await backend.claimRunEventForWait("run-events", "evw-1", "payment.confirmed"),
        null,
        "an empty mailbox must leave the wait pending rather than half-claim it",
      );
      assertEquals(
        (await backend.getPendingEventWaits("run-events")).length,
        1,
        "a claim that found no event must not resolve the wait",
      );

      await backend.appendRunEvent("run-events", {
        id: "evt-claim",
        eventName: "payment.confirmed",
        payload: { seq: 1 },
        publishedAt: new Date(),
      });
      const claimed = await backend.claimRunEventForWait(
        "run-events",
        "evw-1",
        "payment.confirmed",
      );
      assertEquals(claimed?.id, "evt-claim", "the claim must return the taken envelope");
      assertEquals(
        (await backend.getPendingEventWaits("run-events")).length,
        0,
        "the claim must resolve the wait in the same step that took the event",
      );
      assertEquals(
        await backend.takeRunEvent("run-events", "payment.confirmed"),
        null,
        "the claimed event must be out of the mailbox",
      );

      await backend.appendRunEvent("run-events", {
        id: "evt-after",
        eventName: "payment.confirmed",
        payload: { seq: 2 },
        publishedAt: new Date(),
      });
      assertEquals(
        await backend.claimRunEventForWait("run-events", "evw-1", "payment.confirmed"),
        null,
        "a wait no longer pending must not claim anything",
      );
      assertEquals(
        (await backend.takeRunEvent("run-events", "payment.confirmed"))?.id,
        "evt-after",
        "a refused claim must leave the event buffered",
      );
    });

    it("persists an exact delivery receipt when finalization releases a claim", async () => {
      await backend.savePendingEventWait("run-events", createEventWait("evw-receipt"));
      await backend.appendRunEvent("run-events", {
        id: "evt-receipt",
        eventName: "payment.confirmed",
        payload: { accepted: true },
        publishedAt: new Date(),
      });
      assertExists(
        await backend.claimRunEventForWait(
          "run-events",
          "evw-receipt",
          "payment.confirmed",
        ),
      );
      assertEquals(
        await backend.hasRunEventDeliveryReceipt("run-events", "evt-receipt"),
        false,
        "an in-flight claim is not a committed delivery",
      );

      await backend.finalizeRunEventDelivery("run-events", "evt-receipt", true);

      assertEquals(
        await backend.hasRunEventDeliveryReceipt("run-events", "evt-receipt"),
        true,
      );
      assertEquals(await backend.listRunEventDeliveryClaims("run-events"), []);
    });

    it("does not record a delivery receipt for a terminally discarded claim", async () => {
      await backend.savePendingEventWait("run-events", createEventWait("evw-discarded"));
      await backend.appendRunEvent("run-events", {
        id: "evt-discarded",
        eventName: "payment.confirmed",
        payload: undefined,
        publishedAt: new Date(),
      });
      assertExists(
        await backend.claimRunEventForWait(
          "run-events",
          "evw-discarded",
          "payment.confirmed",
        ),
      );

      await backend.finalizeRunEventDelivery("run-events", "evt-discarded", false);

      assertEquals(
        await backend.hasRunEventDeliveryReceipt("run-events", "evt-discarded"),
        false,
      );
      assertEquals(await backend.listRunEventDeliveryClaims("run-events"), []);
    });

    it("does not evict an in-flight timed claim at the wait-history bound", async () => {
      await backend.savePendingEventWait(
        "run-events",
        createEventWait("evw-in-flight", {
          nodeId: "delay",
          eventName: "__delay__",
          waitKind: "delay",
        }),
      );
      await backend.resolvePendingEventWait("run-events", "evw-in-flight", "delivered");
      for (let index = 1; index < MAX_WORKFLOW_PENDING_EVENT_WAIT_ENTRIES; index++) {
        const waitId = `evw-resolved-${index}`;
        await backend.savePendingEventWait(
          "run-events",
          createEventWait(waitId, {
            nodeId: `node-${index}`,
          }),
        );
        await backend.resolvePendingEventWait("run-events", waitId, "cancelled");
      }

      await backend.savePendingEventWait(
        "run-events",
        createEventWait("evw-new", { nodeId: "new-node" }),
      );

      assertEquals(
        (await backend.listTimedEventWaitClaims("run-events")).map((wait) => wait.id),
        ["evw-in-flight"],
      );
    });

    it("claims only mail published on or before a wait deadline", async () => {
      await backend.savePendingEventWait("run-events", createEventWait("evw-deadline"));
      const deadline = new Date(10);
      await backend.appendRunEvent("run-events", {
        id: "evt-late",
        eventName: "payment.confirmed",
        payload: { timing: "late" },
        publishedAt: new Date(11),
      });
      await backend.appendRunEvent("run-events", {
        id: "evt-on-time",
        eventName: "payment.confirmed",
        payload: { timing: "on-time" },
        publishedAt: deadline,
      });

      assertEquals(
        (await backend.claimRunEventForWait(
          "run-events",
          "evw-deadline",
          "payment.confirmed",
          deadline,
        ))?.id,
        "evt-on-time",
      );
      assertEquals(
        (await backend.takeRunEvent("run-events", "payment.confirmed"))?.id,
        "evt-late",
        "a post-deadline event must remain buffered after the eligible claim",
      );
    });

    it("enumerates delivered delays and expired event waits as recoverable claims", async () => {
      await backend.savePendingEventWait(
        "run-events",
        createEventWait("evw-delay", {
          nodeId: "pause",
          eventName: "__delay__",
          waitKind: "delay",
        }),
      );
      await backend.savePendingEventWait("run-events", createEventWait("evw-timeout"));
      await backend.resolvePendingEventWait("run-events", "evw-delay", "delivered");
      await backend.resolvePendingEventWait("run-events", "evw-timeout", "expired");

      const claims = await backend.listTimedEventWaitClaims("run-events");
      assertEquals(claims.map((wait) => wait.id), ["evw-delay", "evw-timeout"]);
      assert(claims.every((wait) => wait.claimedAt instanceof Date));

      await backend.restorePendingEventWait("run-events", "evw-delay");
      assertEquals(
        (await backend.listTimedEventWaitClaims("run-events")).map((wait) => wait.id),
        ["evw-timeout"],
      );

      await backend.finalizeTimedEventWaitClaim("run-events", "evw-timeout");
      assertEquals(await backend.listTimedEventWaitClaims("run-events"), []);
    });

    it("does not yield between taking an event and claiming its wait", async () => {
      await backend.savePendingEventWait("run-events", createEventWait("evw-1"));
      for (const [id, seq] of [["evt-oldest", 1], ["evt-newer", 2]] as const) {
        await backend.appendRunEvent("run-events", {
          id,
          eventName: "payment.confirmed",
          payload: { seq },
          publishedAt: new Date(),
        });
      }

      const firstClaim = backend.claimRunEventForWait(
        "run-events",
        "evw-1",
        "payment.confirmed",
      );
      const secondClaim = backend.claimRunEventForWait(
        "run-events",
        "evw-1",
        "payment.confirmed",
      );
      assertEquals((await firstClaim)?.id, "evt-oldest");
      assertEquals(await secondClaim, null);
      assertEquals(
        (await backend.takeRunEvent("run-events", "payment.confirmed"))?.id,
        "evt-newer",
      );
    });

    it("restores a claimed wait and its event together as one delivery rollback", async () => {
      await backend.savePendingEventWait("run-events", createEventWait("evw-1"));
      await backend.appendRunEvent("run-events", {
        id: "evt-claim",
        eventName: "payment.confirmed",
        payload: { seq: 1 },
        publishedAt: new Date(),
      });
      await backend.appendRunEvent("run-events", {
        id: "evt-later",
        eventName: "payment.confirmed",
        payload: { seq: 2 },
        publishedAt: new Date(),
      });
      const claimed = await backend.claimRunEventForWait(
        "run-events",
        "evw-1",
        "payment.confirmed",
      );
      assertExists(claimed);

      assertEquals(
        await backend.restoreRunEventDelivery("run-events", "evw-1", claimed),
        true,
        "the rollback must report the wait returned to pending",
      );
      assertEquals(
        await backend.restoreRunEventDelivery("run-events", "evw-1", claimed),
        false,
        "a replacement manager repeating the rollback must not restore the envelope twice",
      );
      assertEquals(
        (await backend.getPendingEventWaits("run-events")).map((wait) => wait.id),
        ["evw-1"],
        "the wait must be pending again so a later publish can wake the run",
      );
      assertEquals(
        (await backend.takeRunEvent("run-events", "payment.confirmed"))?.id,
        "evt-claim",
        "the rolled-back event must be back at the head of the mailbox",
      );
      assertEquals(
        (await backend.takeRunEvent("run-events", "payment.confirmed"))?.id,
        "evt-later",
        "an idempotent rollback must leave exactly one copy of the claimed envelope",
      );
    });

    it("does not expose a restored wait before its claimed event is back in the mailbox", async () => {
      await backend.savePendingEventWait("run-events", createEventWait("evw-1"));
      await backend.appendRunEvent("run-events", {
        id: "evt-oldest",
        eventName: "payment.confirmed",
        payload: { seq: 1 },
        publishedAt: new Date(),
      });
      await backend.appendRunEvent("run-events", {
        id: "evt-newer",
        eventName: "payment.confirmed",
        payload: { seq: 2 },
        publishedAt: new Date(),
      });
      const claimed = await backend.claimRunEventForWait(
        "run-events",
        "evw-1",
        "payment.confirmed",
      );
      assertExists(claimed);

      const rollback = backend.restoreRunEventDelivery("run-events", "evw-1", claimed);
      const racedClaim = backend.claimRunEventForWait(
        "run-events",
        "evw-1",
        "payment.confirmed",
      );

      assertEquals(await rollback, true);
      assertEquals(
        (await racedClaim)?.id,
        "evt-oldest",
        "a concurrent drain must see the restored event with the restored wait",
      );
    });

    it("puts the event back even when the rolled-back wait belongs to another actor", async () => {
      await backend.savePendingEventWait("run-events", createEventWait("evw-1"));
      await backend.appendRunEvent("run-events", {
        id: "evt-claim",
        eventName: "payment.confirmed",
        payload: { seq: 1 },
        publishedAt: new Date(),
      });
      const claimed = await backend.claimRunEventForWait(
        "run-events",
        "evw-1",
        "payment.confirmed",
      );
      assertExists(claimed);
      // Another actor resolves the record before the rollback lands: the wait
      // is theirs now, but the event still held its mailbox place.
      await backend.restorePendingEventWait("run-events", "evw-1");
      await backend.resolvePendingEventWait("run-events", "evw-1", "cancelled");

      assertEquals(
        await backend.restoreRunEventDelivery("run-events", "evw-1", claimed),
        false,
        "a wait held by another actor must not be reported as restored",
      );
      assertEquals(
        (await backend.takeRunEvent("run-events", "payment.confirmed"))?.id,
        "evt-claim",
        "the event must go back regardless: it was accepted before the claim",
      );
    });

    it("restores a claimed event to its publication position", async () => {
      await backend.appendRunEvent("run-events", {
        id: "evt-old",
        eventName: "payment.confirmed",
        payload: { seq: 1 },
        publishedAt: new Date(),
      });
      await backend.appendRunEvent("run-events", {
        id: "evt-new",
        eventName: "payment.confirmed",
        payload: { seq: 2 },
        publishedAt: new Date(),
      });

      const taken = await backend.takeRunEvent("run-events", "payment.confirmed");
      assertEquals(taken?.id, "evt-old");
      await backend.restoreRunEvent("run-events", taken!);

      assertEquals(
        (await backend.takeRunEvent("run-events", "payment.confirmed"))?.id,
        "evt-old",
        "a restored event must be consumed before events published after it, or a " +
          "transient delivery failure reorders the run's mail",
      );
    });

    it("preserves publication order when concurrent claims roll back", async () => {
      await backend.savePendingEventWait(
        "run-events",
        createEventWait("evw-first", { nodeId: "first-wait" }),
      );
      await backend.savePendingEventWait(
        "run-events",
        createEventWait("evw-second", { nodeId: "second-wait" }),
      );
      await backend.appendRunEvent("run-events", {
        id: "evt-first",
        eventName: "payment.confirmed",
        payload: { seq: 1 },
        publishedAt: new Date(1),
      });
      await backend.appendRunEvent("run-events", {
        id: "evt-second",
        eventName: "payment.confirmed",
        payload: { seq: 2 },
        publishedAt: new Date(2),
      });

      const first = await backend.claimRunEventForWait(
        "run-events",
        "evw-first",
        "payment.confirmed",
      );
      const second = await backend.claimRunEventForWait(
        "run-events",
        "evw-second",
        "payment.confirmed",
      );
      assertExists(first);
      assertExists(second);

      // This completion order used to prepend second after first and reverse
      // the mailbox to evt-second,evt-first.
      await backend.restoreRunEventDelivery("run-events", "evw-first", first);
      await backend.restoreRunEventDelivery("run-events", "evw-second", second);

      assertEquals(
        (await backend.takeRunEvent("run-events", "payment.confirmed"))?.id,
        "evt-first",
      );
      assertEquals(
        (await backend.takeRunEvent("run-events", "payment.confirmed"))?.id,
        "evt-second",
      );
    });

    it("reclaims a run's mailbox when the run reaches a terminal status", async () => {
      await backend.appendRunEvent("run-events", {
        id: "evt-terminal",
        eventName: "payment.confirmed",
        payload: {},
        publishedAt: new Date(),
      });

      await backend.updateRun("run-events", { status: "cancelled", completedAt: new Date() });

      assertEquals(
        await backend.takeRunEvent("run-events", "payment.confirmed"),
        null,
        "a terminal run can never consume its mail, so the transition must reclaim it",
      );
    });

    it("evicts a terminal run's mailbox past the bound like an orphan's", async () => {
      await backend.createRun(createTestRun("run-finished", { status: "waiting" }));
      // Written after the terminal transition, so only eviction can reclaim it.
      await backend.updateRun("run-finished", { status: "completed", completedAt: new Date() });
      await backend.appendRunEvent("run-finished", {
        id: "evt-finished",
        eventName: "payment.confirmed",
        payload: {},
        publishedAt: new Date(),
      });

      for (let index = 0; index <= MAX_WORKFLOW_RUN_EVENT_MAILBOXES; index++) {
        await backend.appendRunEvent(`run-overflow-${index}`, {
          id: `evt-overflow-${index}`,
          eventName: "payment.confirmed",
          payload: { index },
          publishedAt: new Date(),
        });
      }

      assertEquals(
        await backend.takeRunEvent("run-finished", "payment.confirmed"),
        null,
        "a mailbox pinned by a terminal run must not be exempt from the global bound",
      );
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
