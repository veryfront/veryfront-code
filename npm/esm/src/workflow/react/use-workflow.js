import * as dntShim from "../../../_dnt.shims.js";
import { useCallback, useEffect, useRef, useState } from "react";
export function useWorkflow(options) {
    const { runId, apiBase = "/api/workflows", pollInterval = 2000, autoRefresh = true, onStatusChange, onComplete, onError, onApprovalRequired, } = options;
    const [run, setRun] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const previousStatusRef = useRef(null);
    const previousApprovalsRef = useRef(new Set());
    const abortControllerRef = useRef(null);
    const calculateProgress = useCallback((workflowRun) => {
        const states = Object.values(workflowRun?.nodeStates ?? {});
        if (states.length === 0)
            return 0;
        const completed = states.filter((s) => s.status === "completed" || s.status === "skipped").length;
        return Math.round((completed / states.length) * 100);
    }, []);
    const fetchRun = useCallback(async () => {
        if (!runId)
            return;
        try {
            const response = await dntShim.fetch(`${apiBase}/runs/${runId}`, {
                signal: abortControllerRef.current?.signal,
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch workflow: ${response.status}`);
            }
            const workflowRun = (await response.json());
            const previousStatus = previousStatusRef.current;
            if (previousStatus && previousStatus !== workflowRun.status) {
                onStatusChange?.(workflowRun.status, previousStatus);
            }
            previousStatusRef.current = workflowRun.status;
            if (workflowRun.status === "completed") {
                onComplete?.(workflowRun);
            }
            else if (workflowRun.status === "failed") {
                onError?.(new Error("Workflow failed"), workflowRun);
            }
            for (const approval of workflowRun.pendingApprovals ?? []) {
                if (approval.status !== "pending")
                    continue;
                if (previousApprovalsRef.current.has(approval.id))
                    continue;
                previousApprovalsRef.current.add(approval.id);
                onApprovalRequired?.(approval);
            }
            setRun(workflowRun);
            setError(null);
        }
        catch (error) {
            if (error instanceof Error && error.name === "AbortError")
                return;
            const fetchError = error instanceof Error ? error : new Error(String(error));
            setError(fetchError);
            onError?.(fetchError);
        }
    }, [apiBase, onApprovalRequired, onComplete, onError, onStatusChange, runId]);
    const refresh = useCallback(async () => {
        setIsLoading(true);
        await fetchRun();
        setIsLoading(false);
    }, [fetchRun]);
    const cancel = useCallback(async () => {
        if (!runId)
            return;
        try {
            const response = await dntShim.fetch(`${apiBase}/runs/${runId}/cancel`, { method: "POST" });
            if (!response.ok) {
                throw new Error(`Failed to cancel workflow: ${response.status}`);
            }
            await refresh();
        }
        catch (error) {
            const cancelError = error instanceof Error ? error : new Error(String(error));
            setError(cancelError);
            throw cancelError;
        }
    }, [apiBase, refresh, runId]);
    const retry = useCallback(async () => {
        if (!runId)
            return;
        try {
            const response = await dntShim.fetch(`${apiBase}/runs/${runId}/retry`, { method: "POST" });
            if (!response.ok) {
                throw new Error(`Failed to retry workflow: ${response.status}`);
            }
            await refresh();
        }
        catch (error) {
            const retryError = error instanceof Error ? error : new Error(String(error));
            setError(retryError);
            throw retryError;
        }
    }, [apiBase, refresh, runId]);
    useEffect(() => {
        abortControllerRef.current = new AbortController();
        refresh();
        if (!autoRefresh) {
            return () => {
                abortControllerRef.current?.abort();
            };
        }
        const intervalId = dntShim.setInterval(() => {
            const currentStatus = previousStatusRef.current;
            if (!currentStatus)
                return;
            if (currentStatus === "completed" || currentStatus === "failed" || currentStatus === "cancelled") {
                return;
            }
            fetchRun();
        }, pollInterval);
        return () => {
            abortControllerRef.current?.abort();
            clearInterval(intervalId);
        };
    }, [autoRefresh, fetchRun, pollInterval, refresh, runId]);
    return {
        run,
        status: run?.status ?? "pending",
        progress: calculateProgress(run),
        currentNodes: run?.currentNodes ?? [],
        nodeStates: run?.nodeStates ?? {},
        pendingApprovals: run?.pendingApprovals?.filter((a) => a.status === "pending") ?? [],
        refresh,
        cancel,
        retry,
        isLoading,
        error,
    };
}
