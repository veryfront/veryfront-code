import { useCallback, useEffect, useState } from "react";
import { REQUEST_ERROR } from "#veryfront/errors";
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

  const toError = useCallback((err: unknown): Error => {
    return err instanceof Error ? err : new Error(String(err));
  }, []);

  useEffect((): void => {
    if (!runId || !approvalId) return;

    async function fetchApproval(): Promise<void> {
      try {
        const response = await fetch(`${apiBase}/runs/${runId}/approvals/${approvalId}`);

        if (!response.ok) {
          throw REQUEST_ERROR.create({
            detail: `Failed to fetch approval: ${response.status}`,
            status: response.status,
          });
        }

        const data: PendingApproval = await response.json();
        setApproval(data);
        setError(null);
      } catch (err) {
        const fetchError = toError(err);
        setError(fetchError);
        onError?.(fetchError);
      } finally {
        setIsLoading(false);
      }
    }

    fetchApproval();
  }, [runId, approvalId, apiBase, onError, toError]);

  const submitDecision = useCallback(
    async (decision: ApprovalDecision): Promise<void> => {
      if (!runId || !approvalId) return;

      setIsSubmitting(true);
      setError(null);

      try {
        const response = await fetch(`${apiBase}/runs/${runId}/approvals/${approvalId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(decision),
        });

        if (!response.ok) {
          throw REQUEST_ERROR.create({
            detail: `Failed to submit decision: ${response.status}`,
            status: response.status,
          });
        }

        setApproval((prev) => {
          if (!prev) return null;

          return {
            ...prev,
            status: decision.approved ? "approved" : "rejected",
            resolvedAt: new Date(),
            resolvedBy: decision.approver,
            comment: decision.comment,
          };
        });

        onDecision?.(decision);
      } catch (err) {
        const submitError = toError(err);
        setError(submitError);
        onError?.(submitError);
        throw submitError;
      } finally {
        setIsSubmitting(false);
      }
    },
    [runId, approvalId, apiBase, onDecision, onError, toError],
  );

  const approve = useCallback(
    async (comment?: string): Promise<void> => {
      return submitDecision({ approved: true, approver, comment });
    },
    [submitDecision, approver],
  );

  const reject = useCallback(
    async (comment?: string): Promise<void> => {
      return submitDecision({ approved: false, approver, comment });
    },
    [submitDecision, approver],
  );

  const isPending = approval?.status === "pending";

  return {
    approval,
    approve,
    reject,
    submitDecision,
    isSubmitting,
    isLoading,
    error,
    isPending,
    isResolved: !isPending,
  };
}
