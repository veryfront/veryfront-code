import * as dntShim from "../../../_dnt.shims.js";
import { useCallback, useEffect, useState } from "react";
import type { ApprovalDecision, PendingApproval } from "../types.js";

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
    if (!runId || !approvalId) return;

    async function fetchApproval(): Promise<void> {
      try {
        const response = await dntShim.fetch(`${apiBase}/runs/${runId}/approvals/${approvalId}`);

        if (!response.ok) {
          throw new Error(`Failed to fetch approval: ${response.status}`);
        }

        const data: PendingApproval = await response.json();
        setApproval(data);
        setError(null);
      } catch (error) {
        const fetchError = error instanceof Error ? error : new Error(String(error));
        setError(fetchError);
        onError?.(fetchError);
      } finally {
        setIsLoading(false);
      }
    }

    fetchApproval();
  }, [runId, approvalId, apiBase, onError]);

  const submitDecision = useCallback(
    async (decision: ApprovalDecision): Promise<void> => {
      if (!runId || !approvalId) return;

      setIsSubmitting(true);
      setError(null);

      try {
        const response = await dntShim.fetch(`${apiBase}/runs/${runId}/approvals/${approvalId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(decision),
        });

        if (!response.ok) {
          throw new Error(`Failed to submit decision: ${response.status}`);
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
      } catch (error) {
        const submitError = error instanceof Error ? error : new Error(String(error));
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
    async (comment?: string): Promise<void> => {
      await submitDecision({ approved: true, approver, comment });
    },
    [submitDecision, approver],
  );

  const reject = useCallback(
    async (comment?: string): Promise<void> => {
      await submitDecision({ approved: false, approver, comment });
    },
    [submitDecision, approver],
  );

  const status = approval?.status;

  return {
    approval,
    approve,
    reject,
    submitDecision,
    isSubmitting,
    isLoading,
    error,
    isPending: status === "pending",
    isResolved: status !== "pending",
  };
}
