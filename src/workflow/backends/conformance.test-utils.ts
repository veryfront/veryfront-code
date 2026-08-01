import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import type { PendingApproval, WorkflowRun } from "../types.ts";
import { hasLockSupport, type WorkflowBackend } from "./types.ts";

const SOURCE_POLICY = normalizeSourceIntegrationPolicy(undefined);
const UNEXPIRED_DECISION_TIMING = {
  decidedAt: new Date("2026-01-01T00:00:00.000Z"),
  expiryCondition: "unexpired",
} as const;

function createContractRun(
  id: string,
  overrides: Partial<WorkflowRun> = {},
): WorkflowRun {
  return {
    id,
    workflowId: "contract-workflow",
    status: "pending",
    input: { nested: { value: "created" } },
    nodeStates: {
      created: {
        nodeId: "created",
        status: "pending",
        input: { nested: { value: "created" } },
        attempt: 0,
      },
    },
    currentNodes: ["created"],
    context: {
      input: { nested: { value: "created" } },
      created: { nested: { value: "created" } },
    },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    sourceIntegrationPolicy: SOURCE_POLICY,
    ...overrides,
  };
}

function createApproval(id: string): PendingApproval {
  return {
    id,
    nodeId: "approval-node",
    status: "pending",
    message: "Approve?",
    payload: { nested: { value: id } },
    requestedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

export interface WorkflowBackendPersistenceContractOptions {
  /** Test-only legacy-corruption hook used to prove exact reads fail closed. */
  seedDuplicateApproval?: (
    runId: string,
    approval: PendingApproval,
  ) => void | Promise<void>;
}

/** Register the observable persistence contract shared by every built-in backend. */
export function registerWorkflowBackendPersistenceContract(
  name: string,
  getBackend: () => WorkflowBackend,
  options: WorkflowBackendPersistenceContractOptions = {},
): void {
  describe(`${name} workflow backend persistence contract`, () => {
    it("stores detached replacement snapshots and returns detached get/list values", async () => {
      const backend = getBackend();
      const created = createContractRun("snapshot-contract");
      await backend.createRun(created);

      (created.input as { nested: { value: string } }).nested.value = "mutated-after-create";
      (created.context.created as { nested: { value: string } }).nested.value =
        "mutated-after-create";
      created.nodeStates.created!.attempt = 99;

      const replacementContext = {
        input: { nested: { value: "replacement" } },
        replacement: { nested: { value: "replacement" } },
      };
      const replacementNodeStates = {
        replacement: {
          nodeId: "replacement",
          status: "running" as const,
          input: { nested: { value: "replacement" } },
          attempt: 1,
        },
      };
      await backend.updateRun(created.id, {
        context: replacementContext,
        nodeStates: replacementNodeStates,
      });

      replacementContext.replacement.nested.value = "mutated-after-update";
      replacementNodeStates.replacement.input.nested.value = "mutated-after-update";
      replacementNodeStates.replacement.attempt = 99;

      const first = await backend.getRun(created.id);
      assertEquals(first?.input, { nested: { value: "created" } });
      assertEquals(first?.context, {
        input: { nested: { value: "replacement" } },
        replacement: { nested: { value: "replacement" } },
      });
      assertEquals(first?.nodeStates, {
        replacement: {
          nodeId: "replacement",
          status: "running",
          input: { nested: { value: "replacement" } },
          attempt: 1,
        },
      });

      (first!.context.replacement as { nested: { value: string } }).nested.value = "mutated-return";
      first!.nodeStates.replacement!.attempt = 77;
      const listed = await backend.listRuns({ limit: 1 });
      (listed[0]!.context.replacement as { nested: { value: string } }).nested.value =
        "mutated-list";

      const second = await backend.getRun(created.id);
      assertEquals(second?.context.replacement, { nested: { value: "replacement" } });
      assertEquals(second?.nodeStates.replacement?.attempt, 1);
    });

    it("allows exactly one concurrent transition from an expected run status", async () => {
      const backend = getBackend();
      const run = createContractRun("run-status-decision-contract");
      await backend.createRun(run);

      const transitions = await Promise.all([
        backend.updateRunIfStatus(run.id, ["pending"], { status: "running" }),
        backend.updateRunIfStatus(run.id, ["pending"], { status: "failed" }),
      ]);

      assertEquals(transitions.every((updated) => typeof updated === "boolean"), true);
      assertEquals(transitions.filter((updated) => updated === true).length, 1);
      assertEquals(transitions.filter((updated) => updated === false).length, 1);
      assertEquals((await backend.getRun(run.id))?.status, transitions[0] ? "running" : "failed");
    });

    it("hydrates only current pending approvals from the approval store", async () => {
      const backend = getBackend();
      const embedded = createApproval("embedded-create-value");
      const run = createContractRun("approval-contract", {
        status: "waiting",
        pendingApprovals: [embedded],
      });
      await backend.createRun(run);

      const first = createApproval("first-persisted");
      await backend.savePendingApproval(run.id, first);
      first.payload = { mutated: true };

      assertEquals(
        (await backend.getRun(run.id))?.pendingApprovals.map((approval) => approval.id),
        ["first-persisted"],
      );

      await backend.updateApproval(run.id, "first-persisted", {
        approved: true,
        approver: "reviewer",
      }, UNEXPIRED_DECISION_TIMING);
      const second = createApproval("second-persisted");
      await backend.savePendingApproval(run.id, second);

      const listed = await backend.listRuns({ workflowId: run.workflowId });
      assertEquals(
        listed[0]?.pendingApprovals.map((approval) => approval.id),
        ["second-persisted"],
      );
      listed[0]!.pendingApprovals[0]!.message = "mutated-return";
      assertEquals((await backend.getPendingApprovals(run.id))[0]?.message, "Approve?");
    });

    it("allows exactly one concurrent decision for a pending approval", async () => {
      const backend = getBackend();
      const run = createContractRun("approval-decision-contract", { status: "waiting" });
      const approval = createApproval("approval-decision-race");
      await backend.createRun(run);
      await backend.savePendingApproval(run.id, approval);

      const decisions = await Promise.all([
        backend.updateApproval(run.id, approval.id, {
          approved: true,
          approver: "first-reviewer",
        }, UNEXPIRED_DECISION_TIMING),
        backend.updateApproval(run.id, approval.id, {
          approved: false,
          approver: "second-reviewer",
        }, UNEXPIRED_DECISION_TIMING),
      ]);

      assertEquals(decisions.every((applied) => typeof applied === "boolean"), true);
      assertEquals(decisions.filter((applied) => applied === true).length, 1);
      assertEquals(decisions.filter((applied) => applied === false).length, 1);
      assertEquals(await backend.getPendingApprovals(run.id), []);
    });

    if (options.seedDuplicateApproval) {
      it("rejects ambiguous exact reads from duplicate legacy approval rows", async () => {
        const backend = getBackend();
        const run = createContractRun("duplicate-approval-read-contract", {
          status: "waiting",
        });
        const approval = createApproval("duplicate-approval-read");
        await backend.createRun(run);
        await backend.savePendingApproval(run.id, approval);
        await options.seedDuplicateApproval!(run.id, approval);

        await assertRejects(
          () => backend.getApproval(run.id, approval.id),
          Error,
          "Duplicate approval id stored",
        );
      });
    }

    it("atomically compares persisted approval expiry at the canonical decision time", async () => {
      const backend = getBackend();
      const run = createContractRun("approval-expiry-contract", { status: "waiting" });
      const approval = {
        ...createApproval("approval-expiry-gate"),
        expiresAt: new Date("2026-01-01T00:00:10.000Z"),
      };
      await backend.createRun(run);
      await backend.savePendingApproval(run.id, approval);

      assertEquals(
        await backend.updateApproval(
          run.id,
          approval.id,
          { approved: true, approver: "late-reviewer" },
          {
            decidedAt: new Date("2026-01-01T00:00:10.001Z"),
            expiryCondition: "unexpired",
          },
        ),
        false,
      );
      assertEquals((await backend.getApproval(run.id, approval.id))?.status, "pending");

      const expiredAt = new Date("2026-01-01T00:00:10.001Z");
      assertEquals(
        await backend.updateApproval(
          run.id,
          approval.id,
          { approved: false, approver: "system", comment: "Approval expired" },
          { decidedAt: expiredAt, expiryCondition: "expired" },
        ),
        true,
      );
      const stored = await backend.getApproval(run.id, approval.id);
      assertEquals(stored?.status, "rejected");
      assertEquals(stored?.decidedAt, expiredAt);
    });

    it("treats the exact expiry boundary as unexpired", async () => {
      const backend = getBackend();
      const run = createContractRun("approval-expiry-boundary-contract", { status: "waiting" });
      const boundary = new Date("2026-01-01T00:00:10.000Z");
      const approval = {
        ...createApproval("approval-expiry-boundary"),
        expiresAt: boundary,
      };
      await backend.createRun(run);
      await backend.savePendingApproval(run.id, approval);

      assertEquals(
        await backend.updateApproval(
          run.id,
          approval.id,
          { approved: true, approver: "boundary-reviewer" },
          { decidedAt: boundary, expiryCondition: "unexpired" },
        ),
        true,
      );
      assertEquals(
        (await backend.getApproval(run.id, approval.id))?.decidedAt,
        boundary,
      );
    });

    it("hides historical pending rows and rejects decisions after the run leaves waiting", async () => {
      const backend = getBackend();
      for (const status of ["completed", "failed", "cancelled"] as const) {
        const run = createContractRun(`terminal-approval-contract-${status}`, {
          status: "waiting",
        });
        const approval = createApproval(`terminal-approval-${status}`);
        await backend.createRun(run);
        await backend.savePendingApproval(run.id, approval);
        await backend.updateRun(run.id, {
          status,
          completedAt: new Date("2026-01-01T00:01:00.000Z"),
        });

        assertEquals((await backend.getRun(run.id))?.pendingApprovals, []);
        assertEquals(
          (await backend.listRuns({ workflowId: run.workflowId })).find(
            ({ id }) => id === run.id,
          )?.pendingApprovals,
          [],
        );
        assertEquals(await backend.getPendingApprovals(run.id), []);
        assertEquals(
          (await backend.listPendingApprovals({ status: "pending" })).filter(
            ({ runId }) => runId === run.id,
          ),
          [],
        );
        // Exact lookup intentionally retains the historical record needed for
        // idempotent decision recovery and operator audit.
        assertEquals((await backend.getApproval(run.id, approval.id))?.status, "pending");
        assertEquals(
          await backend.updateApproval(
            run.id,
            approval.id,
            { approved: true, approver: "late-reviewer" },
            UNEXPIRED_DECISION_TIMING,
          ),
          false,
        );
      }
    });

    it("rejects unconditional approval appends unless the run is waiting", async () => {
      const backend = getBackend();
      const run = createContractRun("non-waiting-approval-append", {
        status: "cancelled",
      });
      await backend.createRun(run);

      await assertRejects(
        () => backend.savePendingApproval(run.id, createApproval("late-approval")),
        Error,
        "only while run is waiting",
      );
      assertEquals(await backend.getApproval(run.id, "late-approval"), null);
    });

    it("atomically reserves approval ids for unconditional appends", async () => {
      const backend = getBackend();
      const run = createContractRun("approval-id-contract", { status: "waiting" });
      await backend.createRun(run);

      const attempts = await Promise.allSettled([
        backend.savePendingApproval(run.id, createApproval("duplicate-approval")),
        backend.savePendingApproval(run.id, createApproval("duplicate-approval")),
      ]);

      assertEquals(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
      assertEquals(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
      assertEquals(
        (await backend.getPendingApprovals(run.id)).map((approval) => approval.id),
        ["duplicate-approval"],
      );

      assertEquals(
        await backend.updateApproval(run.id, "duplicate-approval", {
          approved: true,
          approver: "reviewer",
        }, UNEXPIRED_DECISION_TIMING),
        true,
      );
      await assertRejects(
        () => backend.savePendingApproval(run.id, createApproval("duplicate-approval")),
        Error,
        "Approval already exists",
      );
    });

    it("atomically reserves approval ids for owner-conditional appends", async () => {
      const backend = getBackend();
      const run = createContractRun("owned-approval-id-contract", {
        status: "waiting",
        workerId: "approval-owner",
      });
      await backend.createRun(run);
      const saveOwned = backend.savePendingApprovalIfStatusAndWorker?.bind(backend);
      if (!saveOwned) throw new Error("Backend does not implement owned approval appends");

      const attempts = await Promise.allSettled([
        saveOwned(
          run.id,
          ["waiting"],
          "approval-owner",
          createApproval("owned-duplicate-approval"),
        ),
        saveOwned(
          run.id,
          ["waiting"],
          "approval-owner",
          createApproval("owned-duplicate-approval"),
        ),
      ]);

      const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
      assertEquals(fulfilled.length, 1);
      assertEquals(fulfilled[0]?.value, true);
      assertEquals(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
      assertEquals(
        (await backend.getPendingApprovals(run.id)).map((approval) => approval.id),
        ["owned-duplicate-approval"],
      );
    });

    it("does not let owner predicates append an approval to a terminal run", async () => {
      const backend = getBackend();
      const run = createContractRun("terminal-owned-approval-contract", {
        status: "cancelled",
        workerId: "approval-owner",
      });
      await backend.createRun(run);
      const saveOwned = backend.savePendingApprovalIfStatusAndWorker?.bind(backend);
      if (!saveOwned) throw new Error("Backend does not implement owned approval appends");

      assertEquals(
        await saveOwned(
          run.id,
          ["cancelled"],
          "approval-owner",
          createApproval("terminal-owned-approval"),
        ),
        false,
      );
      assertEquals(
        await backend.getApproval(run.id, "terminal-owned-approval"),
        null,
      );
    });

    it("does not expose approval decision state through metadata updates", async () => {
      const backend = getBackend();
      const run = createContractRun("approval-metadata-contract", { status: "waiting" });
      const approval = createApproval("approval-metadata");
      await backend.createRun(run);
      await backend.savePendingApproval(run.id, approval);
      const updateMetadata = backend.updatePendingApproval.bind(backend);
      const unsafeUpdate = updateMetadata as unknown as (
        runId: string,
        approvalId: string,
        patch: Record<string, unknown>,
      ) => Promise<void>;

      await assertRejects(
        () => unsafeUpdate(run.id, approval.id, { status: "approved" }),
        Error,
        "must contain only notificationError",
      );
      assertEquals((await backend.getApproval(run.id, approval.id))?.status, "pending");

      let getterCalled = false;
      const accessorPatch = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(accessorPatch, "notificationError", {
        enumerable: true,
        get() {
          getterCalled = true;
          return "must not run";
        },
      });
      await assertRejects(
        () => unsafeUpdate(run.id, approval.id, accessorPatch),
        Error,
        "must contain only notificationError",
      );
      assertEquals(getterCalled, false);

      await updateMetadata(run.id, approval.id, { notificationError: "delivery failed" });
      assertEquals(
        (await backend.getApproval(run.id, approval.id))?.notificationError,
        "delivery failed",
      );
    });

    it("lists detached pending approvals through the mandatory backend contract", async () => {
      const backend = getBackend();
      const includedRun = createContractRun("listed-approval-contract", { status: "waiting" });
      const excludedRun = createContractRun("excluded-approval-contract", {
        workflowId: "other-workflow",
        status: "waiting",
      });
      const included = {
        ...createApproval("listed-approval"),
        approvers: ["reviewer@example.com"],
      };
      await backend.createRun(includedRun);
      await backend.createRun(excludedRun);
      await backend.savePendingApproval(includedRun.id, included);
      await backend.savePendingApproval(excludedRun.id, createApproval("excluded-approval"));

      const rows = await backend.listPendingApprovals({
        workflowId: includedRun.workflowId,
        approver: "reviewer@example.com",
        status: "pending",
      });
      assertEquals(rows.map(({ runId, approval }) => [runId, approval.id]), [
        [includedRun.id, included.id],
      ]);
      rows[0]!.approval.message = "mutated-return";
      assertEquals(
        (await backend.getPendingApprovals(includedRun.id))[0]?.message,
        "Approve?",
      );
    });

    it("fences lock renewal and release with the acquired ownership token", async () => {
      const backend = getBackend();
      if (!hasLockSupport(backend)) {
        throw new Error(
          "Built-in workflow backend does not implement the complete lock capability",
        );
      }

      const token = await backend.acquireLock("lock-ownership-contract", 5_000);
      if (typeof token !== "string" || token.length === 0) {
        throw new Error("Lock acquisition did not return a non-empty ownership token");
      }
      assertEquals(await backend.acquireLock("lock-ownership-contract", 5_000), null);

      assertEquals(
        await backend.extendLock("lock-ownership-contract", 5_000, "stale-token"),
        false,
      );
      assertEquals(await backend.releaseLock("lock-ownership-contract", "stale-token"), false);
      assertEquals(await backend.acquireLock("lock-ownership-contract", 5_000), null);

      assertEquals(await backend.extendLock("lock-ownership-contract", 5_000, token), true);
      assertEquals(await backend.releaseLock("lock-ownership-contract", token), true);
      assertEquals(await backend.releaseLock("lock-ownership-contract", token), false);

      const replacement = await backend.acquireLock("lock-ownership-contract", 5_000);
      if (typeof replacement !== "string" || replacement.length === 0) {
        throw new Error("Replacement lock acquisition did not return an ownership token");
      }
      assertEquals(replacement === token, false);
      assertEquals(await backend.releaseLock("lock-ownership-contract", replacement), true);
    });

    it("atomically fences run updates and consumes terminal leases", async () => {
      const backend = getBackend();
      if (!hasLockSupport(backend)) {
        throw new Error(
          "Built-in workflow backend does not implement the complete lock capability",
        );
      }

      const run = createContractRun("lock-fenced-run-update-contract", {
        status: "running",
        workerId: "run-execution:owner",
      });
      await backend.createRun(run);
      const token = await backend.acquireLock(run.id, 5_000);
      if (typeof token !== "string" || token.length === 0) {
        throw new Error("Lock acquisition did not return an ownership token");
      }

      await assertRejects(
        () => backend.updateRunIfStatusAndLock(run.id, ["running"], "", {}),
        Error,
        "lock id must be a non-empty string",
      );
      await assertRejects(
        () =>
          backend.updateRunIfStatusAndLock(
            run.id,
            ["running"],
            token,
            {},
            " ",
          ),
        Error,
        "worker id must be a canonical non-empty string",
      );
      assertEquals(
        await backend.updateRunIfStatusAndLock(
          run.id,
          ["running"],
          "stale-token",
          { output: { stale: true } },
          run.workerId,
        ),
        false,
      );
      assertEquals(
        await backend.updateRunIfStatusAndLock(
          run.id,
          ["running"],
          token,
          { output: { wrongOwner: true } },
          "run-execution:replacement",
        ),
        false,
      );
      assertEquals((await backend.getRun(run.id))?.output, undefined);

      assertEquals(
        await backend.updateRunIfStatusAndLock(
          run.id,
          ["running"],
          token,
          { heartbeatAt: new Date("2026-01-01T00:00:01.000Z") },
          run.workerId,
        ),
        true,
      );
      assertEquals(await backend.acquireLock(run.id, 5_000), null);

      assertEquals(
        await backend.updateRunIfStatusAndLock(
          run.id,
          ["running"],
          token,
          { status: "completed", output: { committed: true } },
          run.workerId,
        ),
        true,
      );
      assertEquals((await backend.getRun(run.id))?.output, { committed: true });
      assertEquals(await backend.releaseLock(run.id, token), false);

      const replacement = await backend.acquireLock(run.id, 5_000);
      if (typeof replacement !== "string" || replacement.length === 0) {
        throw new Error("Terminal transition did not consume its workflow lease");
      }
      assertEquals(await backend.releaseLock(run.id, replacement), true);
    });

    it("defaults list pages to 100 and rejects limits above 1000", async () => {
      const backend = getBackend();
      for (let index = 0; index < 101; index++) {
        await backend.createRun(createContractRun(`bounded-${String(index).padStart(3, "0")}`, {
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
        }));
      }

      assertEquals((await backend.listRuns({})).length, 100);
      assertEquals((await backend.listRuns({ limit: 1_000 })).length, 101);
      await assertRejects(
        () => backend.listRuns({ limit: 1_001 }),
        Error,
        "limit must be an integer between 1 and 1000",
      );
      for (const limit of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        await assertRejects(
          () => backend.listRuns({ limit }),
          Error,
          "limit must be an integer between 1 and 1000",
        );
      }
      assertEquals((await backend.listRuns({ limit: 1, offset: 10_000 })).length, 0);
      for (const offset of [-1, 1.5, Number.NaN, 10_001, Number.MAX_SAFE_INTEGER + 1]) {
        await assertRejects(
          () => backend.listRuns({ offset }),
          Error,
          "offset must be an integer between 0 and 10000",
        );
      }
    });

    it("orders equal creation timestamps by descending run id", async () => {
      const backend = getBackend();
      const createdAt = new Date("2026-02-01T00:00:00.000Z");
      for (const id of ["tie-a", "tie-\uE000", "tie-😀"]) {
        await backend.createRun(createContractRun(id, { createdAt }));
      }

      assertEquals(
        (await backend.listRuns({ limit: 3 })).map((run) => run.id),
        ["tie-😀", "tie-\uE000", "tie-a"],
      );
    });

    it("keyset-pages waiting runs across equal timestamps and a removed cursor", async () => {
      const backend = getBackend();
      if (!backend.listRunsAfterCursor) {
        throw new Error("Built-in workflow backend is missing managed recovery pagination");
      }
      const createdAt = new Date("2026-02-02T00:00:00.000Z");
      for (const id of ["cursor-a", "cursor-\uE000", "cursor-😀"]) {
        await backend.createRun(createContractRun(id, { status: "waiting", createdAt }));
      }
      await backend.createRun(createContractRun("cursor-not-waiting", { createdAt }));

      const first = await backend.listRunsAfterCursor({ status: "waiting", limit: 2 });
      assertEquals(first.map((run) => run.id), ["cursor-😀", "cursor-\uE000"]);
      first[0]!.context.input = "mutated-page";

      // The cursor row may leave the waiting index between polls. Its immutable
      // tuple must still define the next exclusive position.
      await backend.updateRun("cursor-\uE000", { status: "pending" });
      await backend.createRun(createContractRun("cursor-new-head", {
        status: "waiting",
        createdAt: new Date(createdAt.getTime() + 1),
      }));
      await backend.createRun(createContractRun("cursor-old-tail", {
        status: "waiting",
        createdAt: new Date(createdAt.getTime() - 1),
      }));

      const second = await backend.listRunsAfterCursor({
        status: "waiting",
        limit: 10,
        cursor: { createdAt, runId: "cursor-\uE000" },
      });
      assertEquals(second.map((run) => run.id), ["cursor-a", "cursor-old-tail"]);
      assertEquals((await backend.getRun("cursor-😀"))?.context.input, {
        nested: { value: "created" },
      });
      assertEquals(
        (await backend.listRunsAfterCursor({ status: "waiting", limit: 10 })).map((run) => run.id),
        ["cursor-new-head", "cursor-😀", "cursor-a", "cursor-old-tail"],
      );

      await assertRejects(
        () => backend.listRunsAfterCursor!({ status: "waiting", limit: 0 }),
        Error,
        "limit must be an integer between 1 and 1000",
      );
      await assertRejects(
        () =>
          backend.listRunsAfterCursor!({
            status: "waiting",
            limit: 1,
            cursor: { createdAt: new Date(Number.NaN), runId: "cursor-a" },
          }),
        Error,
        "cursor createdAt must be a valid date",
      );
    });

    it("uses inclusive creation bounds and rejects invalid dates", async () => {
      const backend = getBackend();
      const boundary = new Date("2026-03-01T00:00:00.000Z");
      await backend.createRun(createContractRun("date-boundary", { createdAt: boundary }));

      assertEquals(
        (await backend.listRuns({ createdAfter: boundary, createdBefore: boundary, limit: 10 }))
          .map((run) => run.id),
        ["date-boundary"],
      );
      assertEquals(
        await backend.countRuns?.({ createdAfter: boundary, createdBefore: boundary }),
        1,
      );

      const invalidDate = new Date(Number.NaN);
      await assertRejects(
        () => backend.listRuns({ createdAfter: invalidDate }),
        Error,
        "createdAfter must be a valid date",
      );
      await assertRejects(
        () => backend.countRuns!({ createdBefore: invalidDate }),
        Error,
        "createdBefore must be a valid date",
      );
    });
  });
}
