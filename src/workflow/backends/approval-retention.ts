import type { PendingApproval } from "../types.ts";
import { MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES } from "../limits.ts";
import { ORCHESTRATION_ERROR } from "#veryfront/errors";

function isDecided(approval: PendingApproval): boolean {
  return approval.status !== "pending";
}

/**
 * Append a detached approval record and retain a bounded history. The per-run
 * approval list is append-only: decisions rewrite records in place, so decided
 * approvals stay in the list and dominate its growth.
 *
 * Retention is state-aware because a live pending approval must never be
 * evicted: a run waiting on an evicted ID could never be decided or expired
 * and would wait forever. At the bound, the oldest decided record is evicted
 * first. An expired record remains pending until expiration reconciliation
 * decides it, so it is retained too. When there are not enough decided records
 * to make room, the append is rejected without changing existing history
 * instead of silently dropping a decidable approval.
 */
export function appendRetainedPendingApproval(
  approvals: PendingApproval[],
  approval: PendingApproval,
): void {
  const snapshot = structuredClone(approval);
  const evictionsRequired = approvals.length - MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES + 1;
  if (evictionsRequired <= 0) {
    approvals.push(snapshot);
    return;
  }
  const decidedIndexes: number[] = [];
  for (let index = 0; index < approvals.length; index++) {
    if (isDecided(approvals[index]!)) decidedIndexes.push(index);
    if (decidedIndexes.length === evictionsRequired) break;
  }
  if (decidedIndexes.length < evictionsRequired) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Approval list full (max: ${MAX_WORKFLOW_PENDING_APPROVAL_ENTRIES}) and ` +
        `not enough decided records can be evicted without dropping a pending approval. ` +
        `Cannot append approval: ${approval.id}`,
    });
  }
  for (let index = decidedIndexes.length - 1; index >= 0; index--) {
    approvals.splice(decidedIndexes[index]!, 1);
  }
  approvals.push(snapshot);
}
