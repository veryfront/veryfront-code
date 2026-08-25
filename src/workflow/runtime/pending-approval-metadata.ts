import type { PendingApproval, WorkflowRun } from "../types.ts";
import type { PersistedPendingApproval } from "../backends/types.ts";

/** Read the internal schema identity retained by workflow backends. */
export function getPendingApprovalResponseSchemaId(
  approval: PendingApproval,
): string | undefined {
  const value = (approval as PersistedPendingApproval).responseSchemaId;
  return typeof value === "string" ? value : undefined;
}

/** Remove backend-only metadata before an approval crosses a public boundary. */
export function projectPendingApproval(approval: PendingApproval): PendingApproval {
  return {
    id: approval.id,
    nodeId: approval.nodeId,
    message: approval.message,
    payload: approval.payload,
    ...(approval.approvers === undefined ? {} : { approvers: approval.approvers }),
    requestedAt: approval.requestedAt,
    ...(approval.expiresAt === undefined ? {} : { expiresAt: approval.expiresAt }),
    status: approval.status,
    ...(approval.decidedBy === undefined ? {} : { decidedBy: approval.decidedBy }),
    ...(approval.decidedAt === undefined ? {} : { decidedAt: approval.decidedAt }),
    ...(approval.comment === undefined ? {} : { comment: approval.comment }),
    ...(approval.notificationError === undefined
      ? {}
      : { notificationError: approval.notificationError }),
  };
}

/** Remove approval metadata while retaining the rest of a run snapshot. */
export function projectRunPendingApprovals(run: WorkflowRun): WorkflowRun {
  return {
    ...run,
    pendingApprovals: run.pendingApprovals.map(projectPendingApproval),
  };
}
