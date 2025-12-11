
import { useCallback, useEffect, useRef, useState } from "react";
import type { NodeState, PendingApproval, WorkflowRun, WorkflowStatus } from "../types.ts";

export interface UseWorkflowOptions {
  runId: string;

  apiBase?: string;

  pollInterval?: number;

  autoRefresh?: boolean;

  onStatusChange?: (status: WorkflowStatus, previousStatus: WorkflowStatus) => void;

  onComplete?: (run: WorkflowRun) => void;

  onError?: (error: Error, run?: WorkflowRun) => void;

  onApprovalRequired?: (approval: PendingApproval) => void;
}

export interface UseWorkflowResult {
  run: WorkflowRun | null;

  status: WorkflowStatus;

  progress: number;

  currentNodes: string[];

  nodeStates: Record<string, NodeState>;

  pendingApprovals: PendingApproval[];

  refresh: () => Promise<void>;

  cancel: () => Promise<void>;

  retry: () => Promise<void>;

  isLoading: boolean;

  error: Error | null;
}

export function useWorkflow(options: UseWorkflowOptions): UseWorkflowResult {
  const {
    runId,
    apiBase = "/api/workflows",
    pollInterval = 2000,
    autoRefresh = true,
    onStatusChange,
    onComplete,
    onError,
    onApprovalRequired,
  } = options;

  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const previousStatusRef = useRef<WorkflowStatus | null>(null);
  const previousApprovalsRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchRun = useCallback(async () => {
    if (!runId) return;

    try {
      const response = await fetch(`${apiBase}/runs/${runId}`, {
        signal: abortControllerRef.current?.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch workflow: ${response.status}`);
      }

      const data = await response.json();
      const workflowRun = data as WorkflowRun;

      if (previousStatusRef.current && previousStatusRef.current !== workflowRun.status) {
        onStatusChange?.(workflowRun.status, previousStatusRef.current);
      }
      previousStatusRef.current = workflowRun.status;

      if (workflowRun.status === "completed") {
        onComplete?.(workflowRun);
      }

      if (workflowRun.status === "failed") {
        const failedError = new Error("Workflow failed");
        onError?.(failedError, workflowRun);
      }

      if (workflowRun.pendingApprovals) {
        for (const approval of workflowRun.pendingApprovals) {
          if (approval.status === "pending" && !previousApprovalsRef.current.has(approval.id)) {
            previousApprovalsRef.current.add(approval.id);
            onApprovalRequired?.(approval);
          }
        }
      }

      setRun(workflowRun);
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      const fetchError = err instanceof Error ? err : new Error(String(err));
      setError(fetchError);
      onError?.(fetchError);
    }
  }, [runId, apiBase, onStatusChange, onComplete, onError, onApprovalRequired]);

  useEffect(() => {
    abortControllerRef.current = new AbortController();

    const doFetch = async () => {
      setIsLoading(true);
      await fetchRun();
      setIsLoading(false);
    };

    doFetch();

    let intervalId: ReturnType<typeof setInterval> | undefined;
    if (autoRefresh) {
      intervalId = setInterval(() => {
        const currentStatus = previousStatusRef.current;
        if (currentStatus && !["completed", "failed", "cancelled"].includes(currentStatus)) {
          fetchRun();
        }
      }, pollInterval);
    }

    return () => {
      abortControllerRef.current?.abort();
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [runId, autoRefresh, pollInterval, fetchRun]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchRun();
    setIsLoading(false);
  }, [fetchRun]);

  const cancel = useCallback(async () => {
    if (!runId) return;

    try {
      const response = await fetch(`${apiBase}/runs/${runId}/cancel`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Failed to cancel workflow: ${response.status}`);
      }

      await refresh();
    } catch (err) {
      const cancelError = err instanceof Error ? err : new Error(String(err));
      setError(cancelError);
      throw cancelError;
    }
  }, [runId, apiBase, refresh]);

  const retry = useCallback(async () => {
    if (!runId) return;

    try {
      const response = await fetch(`${apiBase}/runs/${runId}/retry`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Failed to retry workflow: ${response.status}`);
      }

      await refresh();
    } catch (err) {
      const retryError = err instanceof Error ? err : new Error(String(err));
      setError(retryError);
      throw retryError;
    }
  }, [runId, apiBase, refresh]);

  const calculateProgress = (): number => {
    if (!run?.nodeStates) return 0;

    const states = Object.values(run.nodeStates);
    if (states.length === 0) return 0;

    const completed = states.filter(
      (s) => s.status === "completed" || s.status === "skipped",
    ).length;

    return Math.round((completed / states.length) * 100);
  };

  return {
    run,
    status: run?.status ?? "pending",
    progress: calculateProgress(),
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
