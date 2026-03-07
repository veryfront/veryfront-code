import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NodeState,
  PendingApproval,
  WorkflowRun,
  WorkflowStatus,
} from "#veryfront/workflow/types.ts";
import { ORCHESTRATION_ERROR } from "#veryfront/errors";

/** Default polling interval for workflow status updates */
const DEFAULT_POLL_INTERVAL_MS = 2_000;

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
    pollInterval = DEFAULT_POLL_INTERVAL_MS,
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

  const calculateProgress = useCallback((workflowRun: WorkflowRun | null): number => {
    const states = Object.values(workflowRun?.nodeStates ?? {});
    if (states.length === 0) return 0;

    const completed = states.filter(
      (s) => s.status === "completed" || s.status === "skipped",
    ).length;

    return Math.round((completed / states.length) * 100);
  }, []);

  const fetchRun = useCallback(async (): Promise<void> => {
    if (!runId) return;

    try {
      const response = await fetch(`${apiBase}/runs/${runId}`, {
        signal: abortControllerRef.current?.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch workflow: ${response.status}`);
      }

      const workflowRun = (await response.json()) as WorkflowRun;

      const previousStatus = previousStatusRef.current;
      if (previousStatus && previousStatus !== workflowRun.status) {
        onStatusChange?.(workflowRun.status, previousStatus);
      }
      previousStatusRef.current = workflowRun.status;

      if (workflowRun.status === "completed") {
        onComplete?.(workflowRun);
      } else if (workflowRun.status === "failed") {
        onError?.(ORCHESTRATION_ERROR.create({ detail: "Workflow failed" }), workflowRun);
      }

      for (const approval of workflowRun.pendingApprovals ?? []) {
        if (approval.status !== "pending") continue;
        if (previousApprovalsRef.current.has(approval.id)) continue;

        previousApprovalsRef.current.add(approval.id);
        onApprovalRequired?.(approval);
      }

      setRun(workflowRun);
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;

      const fetchError = err instanceof Error ? err : new Error(String(err));
      setError(fetchError);
      onError?.(fetchError);
    }
  }, [apiBase, onApprovalRequired, onComplete, onError, onStatusChange, runId]);

  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    await fetchRun();
    setIsLoading(false);
  }, [fetchRun]);

  const cancel = useCallback(async (): Promise<void> => {
    if (!runId) return;

    try {
      const response = await fetch(`${apiBase}/runs/${runId}/cancel`, { method: "POST" });
      if (!response.ok) {
        throw new Error(`Failed to cancel workflow: ${response.status}`);
      }
      await refresh();
    } catch (err) {
      const cancelError = err instanceof Error ? err : new Error(String(err));
      setError(cancelError);
      throw cancelError;
    }
  }, [apiBase, refresh, runId]);

  const retry = useCallback(async (): Promise<void> => {
    if (!runId) return;

    try {
      const response = await fetch(`${apiBase}/runs/${runId}/retry`, { method: "POST" });
      if (!response.ok) {
        throw new Error(`Failed to retry workflow: ${response.status}`);
      }
      await refresh();
    } catch (err) {
      const retryError = err instanceof Error ? err : new Error(String(err));
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

    const intervalId = setInterval(() => {
      const currentStatus = previousStatusRef.current;
      if (!currentStatus) return;

      if (
        currentStatus === "completed" || currentStatus === "failed" || currentStatus === "cancelled"
      ) {
        return;
      }

      fetchRun();
    }, pollInterval);

    return () => {
      abortControllerRef.current?.abort();
      clearInterval(intervalId);
    };
  }, [autoRefresh, fetchRun, pollInterval, refresh]);

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
