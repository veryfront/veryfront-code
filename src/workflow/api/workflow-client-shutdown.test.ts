import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __subscribeLogRecordEmitter } from "#veryfront/utils/logger/logger.ts";
import { MemoryBackend } from "../backends/memory.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { createWorkflowClient } from "./workflow-client.ts";

class BlockingApprovalScanBackend extends MemoryBackend {
  readonly scanStarted = Promise.withResolvers<void>();
  readonly continueScan = Promise.withResolvers<void>();
  closed = false;
  recovered = false;

  override async listApprovalDecisionClaims(runId?: string) {
    this.scanStarted.resolve();
    await this.continueScan.promise;
    if (this.closed) throw new Error("The client is closed");
    return await super.listApprovalDecisionClaims(runId);
  }

  override async finalizeApprovalDecision(
    ...args: Parameters<MemoryBackend["finalizeApprovalDecision"]>
  ) {
    const finalized = await super.finalizeApprovalDecision(...args);
    this.recovered = (await super.listApprovalDecisionClaims(args[0])).length === 0;
    return finalized;
  }

  override async destroy(): Promise<void> {
    this.closed = true;
    await super.destroy();
  }
}

describe("WorkflowClient shutdown", () => {
  it("finishes approval claim recovery before closing a short-lived client", async () => {
    const backend = new BlockingApprovalScanBackend();
    await backend.createRun({
      id: "completed-run",
      workflowId: "approval-flow",
      sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
      status: "completed",
      input: {},
      context: {},
      nodeStates: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await backend.savePendingApproval("completed-run", {
      id: "stale-approval",
      nodeId: "review",
      message: "Review",
      payload: {},
      requestedAt: new Date(0),
      status: "pending",
    });
    await backend.updateApproval("completed-run", "stale-approval", {
      approved: true,
      approver: "reviewer",
    });
    const messages: string[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => messages.push(entry.message));
    const client = createWorkflowClient({ backend, approval: { decisionClaimRecoveryDelay: 0 } });
    try {
      await backend.scanStarted.promise;
      const shutdown = client.destroy();
      try {
        assertEquals(backend.closed, false, "the recovery scan still needs the open backend");
      } finally {
        backend.continueScan.resolve();
        await shutdown;
        await client.getApprovalManager().checkApprovalDecisionClaims();
      }
      assertEquals(backend.closed, true);
      assertEquals(backend.recovered, true, "the stale claim must be recovered during shutdown");
      assertEquals(
        messages.some((message) => message.includes("Approval decision claim recovery failed")),
        false,
      );
    } finally {
      backend.continueScan.resolve();
      await client.destroy();
      unsubscribe();
    }
  });
});
