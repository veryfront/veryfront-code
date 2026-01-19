import { useCallback, useEffect, useState } from "react";
import type { ApprovalDecision, PendingApproval } from "#veryfront/workflow/types.ts";

export interface UseApprovalOptions {
  runId: string;
  approvalId: string;
  apiBase?: string;
  approver?: string;
  onDecision?: (decision: ApprovalDecision) => void;
  onError?: (error: Error) => void;
}

export interface UseApprovalResult {
  approval: PendingApproval | null;
  approve: (comment?: string) => Promise<void>;
  reject: (comment?: string) => Promise<void>;
  submitDecision: (decision: ApprovalDecision) => Promise<void>;
  isSubmitting: boolean;
  isLoading: boolean;
  error: Error | null;
  isPending: boolean;
  isResolved: boolean;
}

/**
 * Handle workflow approval interactions.
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
