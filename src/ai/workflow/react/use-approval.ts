/**
 * useApproval Hook
 *
 * React hook for handling workflow approval interactions.
 *
 * @example
 * ```tsx
 * import { useApproval } from 'veryfront/ai/workflow/react';
 *
 * function ApprovalUI({ runId, approvalId }: Props) {
 *   const {
 *     approval,
 *     approve,
 *     reject,
 *     isSubmitting,
 *     error,
 *   } = useApproval({ runId, approvalId });
 *
 *   if (!approval) return <p>Loading...</p>;
 *
 *   return (
 *     <div>
 *       <h3>{approval.message}</h3>
 *       <p>Requested by: {approval.stepId}</p>
 *       <button onClick={() => approve('Looks good!')}>
 *         Approve
 *       </button>
 *       <button onClick={() => reject('Needs changes')}>
 *         Reject
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */

import { useCallback, useEffect, useState } from "react";
import type { ApprovalDecision, PendingApproval } from "../types.ts";

/**
 * Options for useApproval hook
 */
export interface UseApprovalOptions {
  /** Workflow run ID */
  runId: string;

  /** Approval ID */
  approvalId: string;

  /** API endpoint base (defaults to /api/workflows) */
  apiBase?: string;

  /** Current user/approver name */
  approver?: string;

  /** Callback on successful approval/rejection */
  onDecision?: (decision: ApprovalDecision) => void;

  /** Callback on error */
  onError?: (error: Error) => void;
}

/**
 * Result from useApproval hook
 */
export interface UseApprovalResult {
  /** The approval data */
  approval: PendingApproval | null;

  /** Approve the request */
  approve: (comment?: string) => Promise<void>;

  /** Reject the request */
  reject: (comment?: string) => Promise<void>;

  /** Submit a custom decision */
  submitDecision: (decision: ApprovalDecision) => Promise<void>;

  /** Whether a submission is in progress */
  isSubmitting: boolean;

  /** Loading state for initial fetch */
  isLoading: boolean;

  /** Error state */
  error: Error | null;

  /** Whether the approval is still pending */
  isPending: boolean;

  /** Whether the approval has been resolved */
  isResolved: boolean;
}

/**
 * useApproval - Handle workflow approval interactions
 */
export function useApproval(options: UseApprovalOptions): UseApprovalResult {
  const {
    runId,
    approvalId,
    apiBase = "/api/workflows",
    approver = "unknown",
    onDecision,
    onError,
  } = options;

  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Fetch approval data
   */
  useEffect(() => {
    const fetchApproval = async () => {
      try {
        const response = await fetch(
          `${apiBase}/runs/${runId}/approvals/${approvalId}`,
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch approval: ${response.status}`);
        }

        const data = await response.json();
        setApproval(data as PendingApproval);
        setError(null);
      } catch (err) {
        const fetchError = err instanceof Error ? err : new Error(String(err));
        setError(fetchError);
        onError?.(fetchError);
      } finally {
        setIsLoading(false);
      }
    };

    if (runId && approvalId) {
      fetchApproval();
    }
  }, [runId, approvalId, apiBase, onError]);

  /**
   * Submit a decision
   */
  const submitDecision = useCallback(
    async (decision: ApprovalDecision) => {
      if (!runId || !approvalId) return;

      setIsSubmitting(true);
      setError(null);

      try {
        const response = await fetch(
          `${apiBase}/runs/${runId}/approvals/${approvalId}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(decision),
          },
        );

        if (!response.ok) {
          throw new Error(`Failed to submit decision: ${response.status}`);
        }

        // Update local state
        setApproval((prev) =>
          prev
            ? {
              ...prev,
              status: decision.approved ? "approved" : "rejected",
              resolvedAt: new Date(),
              resolvedBy: decision.approver,
              comment: decision.comment,
            }
            : null
        );

        onDecision?.(decision);
      } catch (err) {
        const submitError = err instanceof Error ? err : new Error(String(err));
        setError(submitError);
        onError?.(submitError);
        throw submitError;
      } finally {
        setIsSubmitting(false);
      }
    },
    [runId, approvalId, apiBase, onDecision, onError],
  );

  /**
   * Approve the request
   */
  const approve = useCallback(
    async (comment?: string) => {
      await submitDecision({
        approved: true,
        approver,
        comment,
      });
    },
    [submitDecision, approver],
  );

  /**
   * Reject the request
   */
  const reject = useCallback(
    async (comment?: string) => {
      await submitDecision({
        approved: false,
        approver,
        comment,
      });
    },
    [submitDecision, approver],
  );

  return {
    approval,
    approve,
    reject,
    submitDecision,
    isSubmitting,
    isLoading,
    error,
    isPending: approval?.status === "pending",
    isResolved: approval?.status !== "pending",
  };
}
