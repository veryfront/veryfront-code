import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { PendingApproval, WorkflowRun } from "../types.ts";
import { MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES } from "../limits.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { appendRetainedPendingApproval } from "./approval-retention.ts";
import { MemoryBackend } from "./memory.ts";

function approval(id: string, overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id,
    nodeId: `wait-node-${id}`,
    status: "pending",
    message: "Approve this?",
    payload: {},
    requestedAt: new Date(0),
    ...overrides,
  };
}

function run(id: string, workerId?: string): WorkflowRun {
  return {
    id,
    workflowId: "approval-retention",
    status: workerId ? "waiting" : "pending",
    ...(workerId ? { workerId } : {}),
    input: {},
    nodeStates: {},
    currentNodes: [],
    context: { input: {} },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date(),
    sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
  };
}

describe("workflow approval retention", () => {
  it("appends a detached snapshot below the shared bound", () => {
    const history = [approval("first")];
    const second = approval("second");

    appendRetainedPendingApproval(history, second);

    assertEquals(history.map(({ id }) => id), ["first", "second"]);
    second.id = "mutated-source";
    assertEquals(history.at(-1)?.id, "second");
  });

  it("evicts the oldest decided record before any live one", () => {
    const history = [
      approval("live-oldest"),
      approval("decided-a", { status: "approved" }),
      approval("decided-b", { status: "rejected" }),
    ];
    while (history.length < MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES) {
      history.push(approval(`live-${history.length}`));
    }

    appendRetainedPendingApproval(history, approval("newest"));

    assertEquals(history.length, MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES);
    assertEquals(history[0]?.id, "live-oldest");
    assertEquals(history.some(({ id }) => id === "decided-a"), false);
    assertEquals(history.some(({ id }) => id === "decided-b"), true);
    assertEquals(history.at(-1)?.id, "newest");
  });

  it("retains expired pending records until expiration reconciliation decides them", () => {
    const history = [
      approval("live-oldest"),
      approval("expired", { expiresAt: new Date(Date.now() - 60_000) }),
    ];
    while (history.length < MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES) {
      history.push(approval(`live-${history.length}`));
    }

    assertThrows(
      () => appendRetainedPendingApproval(history, approval("newest")),
      Error,
      "pending approval",
    );

    assertEquals(history.length, MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES);
    assertEquals(history[0]?.id, "live-oldest");
    assertEquals(history.some(({ id }) => id === "expired"), true);
    assertEquals(history.some(({ id }) => id === "newest"), false);

    history.find(({ id }) => id === "expired")!.status = "rejected";
    appendRetainedPendingApproval(history, approval("newest"));
    assertEquals(history.some(({ id }) => id === "expired"), false);
    assertEquals(history.at(-1)?.id, "newest");
  });

  it("refuses the append when every retained record is live", () => {
    const history = Array.from(
      { length: MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES },
      (_, index) => approval(`live-${index}`),
    );

    assertThrows(
      () => appendRetainedPendingApproval(history, approval("overflow")),
      Error,
      "pending approval",
    );

    assertEquals(history.length, MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES);
    assertEquals(history[0]?.id, "live-0");
    assertEquals(history.some(({ id }) => id === "overflow"), false);
  });

  it("does not partially prune legacy overflow when too few records are decided", () => {
    const history = [
      approval("decided-a", { status: "approved" }),
      approval("decided-b", { status: "rejected" }),
      ...Array.from(
        { length: MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES },
        (_, index) => approval(`live-${index}`),
      ),
    ];
    const before = history.map(({ id }) => id);

    assertThrows(
      () => appendRetainedPendingApproval(history, approval("overflow")),
      Error,
      "pending approval",
    );

    assertEquals(history.map(({ id }) => id), before);
  });

  it("leaves existing history unchanged when approval capture fails", () => {
    const history = [approval("stable")];
    const invalid = approval("invalid");
    (invalid.payload as Record<string, unknown>).uncloneable = () => undefined;

    assertThrows(() => appendRetainedPendingApproval(history, invalid));
    assertEquals(history.map(({ id }) => id), ["stable"]);
  });

  it("bounds unconditional MemoryBackend appends by evicting decided records first", async () => {
    const backend = new MemoryBackend();
    await backend.createRun(run("unconditional"));
    await backend.savePendingApproval("unconditional", approval("live-oldest"));
    await backend.savePendingApproval("unconditional", approval("decided"));
    await backend.updateApproval("unconditional", "decided", {
      approved: true,
      approver: "ops",
    });
    await backend.finalizeApprovalDecision("unconditional", "decided");
    for (let index = 2; index < MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES; index++) {
      await backend.savePendingApproval("unconditional", approval(`live-${index}`));
    }

    await backend.savePendingApproval("unconditional", approval("newest"));

    assertEquals(await backend.getPendingApproval("unconditional", "decided"), null);
    const retained = await backend.getPendingApprovals("unconditional");
    assertEquals(retained.length, MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES);
    assertEquals(retained[0]?.id, "live-oldest");
    assertEquals(retained.at(-1)?.id, "newest");
  });

  it("refuses unconditional MemoryBackend appends when every record is live", async () => {
    const backend = new MemoryBackend();
    await backend.createRun(run("full"));
    for (let index = 0; index < MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES; index++) {
      await backend.savePendingApproval("full", approval(`live-${index}`));
    }

    await assertRejects(
      () => backend.savePendingApproval("full", approval("overflow")),
      Error,
      "pending approval",
    );

    const retained = await backend.getPendingApprovals("full");
    assertEquals(retained.length, MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES);
    assertEquals(retained[0]?.id, "live-0");
    assertEquals(retained.some(({ id }) => id === "overflow"), false);
  });

  it("bounds owned MemoryBackend appends and leaves failed fences unchanged", async () => {
    const backend = new MemoryBackend();
    const workerId = "run-execution:retention-owner";
    await backend.createRun(run("owned", workerId));
    const saveOwned = (approvalRecord: PendingApproval) =>
      backend.savePendingApprovalIfStatusAndWorker(
        "owned",
        ["waiting"],
        workerId,
        approvalRecord,
      );

    assertEquals(await saveOwned(approval("live-oldest")), true);
    assertEquals(await saveOwned(approval("decided")), true);
    await backend.updateApproval("owned", "decided", { approved: false, approver: "ops" });
    await backend.finalizeApprovalDecision("owned", "decided");
    for (let index = 2; index < MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES; index++) {
      assertEquals(await saveOwned(approval(`live-${index}`)), true);
    }

    assertEquals(await saveOwned(approval("newest")), true);
    assertEquals(await backend.getPendingApproval("owned", "decided"), null);

    await assertRejects(
      () => saveOwned(approval("overflow")),
      Error,
      "pending approval",
    );
    const beforeFailedFence = await backend.getPendingApprovals("owned");
    assertEquals(beforeFailedFence.length, MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES);
    assertEquals(beforeFailedFence[0]?.id, "live-oldest");
    assertEquals(beforeFailedFence.at(-1)?.id, "newest");

    assertEquals(
      await backend.savePendingApprovalIfStatusAndWorker(
        "owned",
        ["waiting"],
        "run-execution:stale-owner",
        approval("must-not-append"),
      ),
      false,
    );
    assertEquals(await backend.getPendingApprovals("owned"), beforeFailedFence);
  });
});
