import type { PendingApproval } from "../types.ts";
import { MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES } from "../limits.ts";
import { ORCHESTRATION_ERROR } from "#veryfront/errors";

function isDecided(approval: PendingApproval): boolean {
  return approval.status !== "pending";
}

function isExpired(approval: PendingApproval, now: Date): boolean {
  return approval.status === "pending" &&
    approval.expiresAt !== undefined &&
    approval.expiresAt <= now;
}

/**
 * Append a detached approval record and retain a bounded history. The per-run
 * approval list is append-only: decisions rewrite records in place, so decided
 * approvals stay in the list and dominate its growth.
 *
 * Retention is state-aware because a live pending approval must never be
 * evicted: a run waiting on an evicted ID could never be decided or expired
 * and would wait forever. At the bound, the oldest decided record is evicted
 * first, then the oldest expired one. When every retained record is still
 * live, the append is rejected instead of silently dropping a live approval.
 */
export function appendRetainedPendingApproval(
  approvals: PendingApproval[],
  approval: PendingApproval,
): void {
  const snapshot = structuredClone(approval);
  const now = new Date();
  while (approvals.length >= MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES) {
    const decidedIndex = approvals.findIndex(isDecided);
    const evictIndex = decidedIndex !== -1
      ? decidedIndex
      : approvals.findIndex((entry) => isExpired(entry, now));
    if (evictIndex === -1) {
      throw ORCHESTRATION_ERROR.create({
        detail: `Approval list full (max: ${MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES}) and ` +
          `every retained approval is still pending. Cannot append approval: ${approval.id}`,
      });
    }
    approvals.splice(evictIndex, 1);
  }
  approvals.push(snapshot);
}
