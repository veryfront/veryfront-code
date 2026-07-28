import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import type { PendingApproval, WorkflowRun } from "../types.ts";
import type { WorkflowBackend } from "./types.ts";

const SOURCE_POLICY = normalizeSourceIntegrationPolicy(undefined);

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

/** Register the observable snapshot contract shared by every built-in backend. */
export function registerWorkflowBackendSnapshotContract(
  name: string,
  getBackend: () => WorkflowBackend,
): void {
  describe(`${name} workflow backend snapshot contract`, () => {
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

    it("hydrates only current pending approvals from the approval store", async () => {
      const backend = getBackend();
      const embedded = createApproval("embedded-create-value");
      const run = createContractRun("approval-contract", {
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
      });
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
