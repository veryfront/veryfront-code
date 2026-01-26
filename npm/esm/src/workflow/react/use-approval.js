import * as dntShim from "../../../_dnt.shims.js";
import { useCallback, useEffect, useState } from "react";
/**
 * Handle workflow approval interactions.
 */
export function useApproval(options) {
    const { runId, approvalId, apiBase = "/api/workflows", approver = "unknown", onDecision, onError, } = options;
    const [approval, setApproval] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!runId || !approvalId)
            return;
        async function fetchApproval() {
            try {
                const response = await dntShim.fetch(`${apiBase}/runs/${runId}/approvals/${approvalId}`);
                if (!response.ok) {
                    throw new Error(`Failed to fetch approval: ${response.status}`);
                }
                const data = await response.json();
                setApproval(data);
                setError(null);
            }
            catch (error) {
                const fetchError = error instanceof Error ? error : new Error(String(error));
                setError(fetchError);
                onError?.(fetchError);
            }
            finally {
                setIsLoading(false);
            }
        }
        fetchApproval();
    }, [runId, approvalId, apiBase, onError]);
    const submitDecision = useCallback(async (decision) => {
        if (!runId || !approvalId)
            return;
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
                if (!prev)
                    return null;
                return {
                    ...prev,
                    status: decision.approved ? "approved" : "rejected",
                    resolvedAt: new Date(),
                    resolvedBy: decision.approver,
                    comment: decision.comment,
                };
            });
            onDecision?.(decision);
        }
        catch (error) {
            const submitError = error instanceof Error ? error : new Error(String(error));
            setError(submitError);
            onError?.(submitError);
            throw submitError;
        }
        finally {
            setIsSubmitting(false);
        }
    }, [runId, approvalId, apiBase, onDecision, onError]);
    const approve = useCallback(async (comment) => {
        await submitDecision({ approved: true, approver, comment });
    }, [submitDecision, approver]);
    const reject = useCallback(async (comment) => {
        await submitDecision({ approved: false, approver, comment });
    }, [submitDecision, approver]);
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
