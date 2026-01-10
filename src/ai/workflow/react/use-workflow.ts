/**
 * useWorkflow Hook
 *
 * React hook for tracking and interacting with workflow runs.
 *
 * @example
 * ```tsx
 * import { useWorkflow } from 'veryfront/ai/workflow/react';
 *
 * function WorkflowDashboard({ runId }: { runId: string }) {
 *   const {
 *     run,
 *     status,
 *     progress,
 *     currentNodes,
 *     pendingApprovals,
 *     cancel,
 *     retry,
 *     isLoading,
 *     error,
 *   } = useWorkflow({ runId });
 *
 *   return (
 *     <div>
 *       <h2>Status: {status}</h2>
 *       <p>Progress: {progress}%</p>
 *       {pendingApprovals.length > 0 && (
 *         <p>{pendingApprovals.length} approvals pending</p>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { NodeState, PendingApproval, WorkflowRun, WorkflowStatus } from "../types.ts";

/**
 * Options for useWorkflow hook
 */
export interface UseWorkflowOptions {
  /** Run ID to track */
  runId: string;

  /** API endpoint base (defaults to /api/workflows) */
  apiBase?: string;

  /** Polling interval in ms (defaults to 2000) */
  pollInterval?: number;

  /** Enable automatic polling */
  autoRefresh?: boolean;

  /** Callback when status changes */
  onStatusChange?: (status: WorkflowStatus, previousStatus: WorkflowStatus) => void;

  /** Callback when workflow completes */
  onComplete?: (run: WorkflowRun) => void;

  /** Callback when workflow fails */
  onError?: (error: Error, run?: WorkflowRun) => void;

  /** Callback when approval is required */
  onApprovalRequired?: (approval: PendingApproval) => void;
}

/**
 * Result from useWorkflow hook
 */
export interface UseWorkflowResult {
  /** The workflow run data */
  run: WorkflowRun | null;

  /** Current workflow status */
  status: WorkflowStatus;

  /** Progress percentage (0-100) */
  progress: number;

  /** Currently executing node IDs */
  currentNodes: string[];

  /** Node states by node ID */
  nodeStates: Record<string, NodeState>;

  /** Pending approvals */
  pendingApprovals: PendingApproval[];

  /** Refresh the workflow data */
  refresh: () => Promise<void>;

  /** Cancel the workflow */
  cancel: () => Promise<void>;

  /** Retry a failed workflow */
  retry: () => Promise<void>;

  /** Loading state */
  isLoading: boolean;

  /** Error state */
  error: Error | null;
}

/**
 * useWorkflow - Track and interact with a workflow run
 */
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

  /**
   * Fetch workflow data
   */
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

      // Check for status changes
      if (previousStatusRef.current && previousStatusRef.current !== workflowRun.status) {
        onStatusChange?.(workflowRun.status, previousStatusRef.current);
      }
      previousStatusRef.current = workflowRun.status;

      // Check for completion
      if (workflowRun.status === "completed") {
        onComplete?.(workflowRun);
      }

      // Check for failures
      if (workflowRun.status === "failed") {
        const failedError = new Error("Workflow failed");
        onError?.(failedError, workflowRun);
      }

      // Check for new approvals
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

  /**
   * Initial fetch and polling setup
   */
  useEffect(() => {
    abortControllerRef.current = new AbortController();

    const doFetch = async () => {
      setIsLoading(true);
      await fetchRun();
      setIsLoading(false);
    };

    doFetch();

    // Set up polling for active workflows
    let intervalId: ReturnType<typeof setInterval> | undefined;
    if (autoRefresh) {
      intervalId = setInterval(() => {
        // Only poll if workflow is still active
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

  /**
   * Refresh workflow data
   */
  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchRun();
    setIsLoading(false);
  }, [fetchRun]);

  /**
   * Cancel the workflow
   */
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

  /**
   * Retry a failed workflow
   */
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

  // Calculate progress
  const calculateProgress = (): number => {
    const states = Object.values(run?.nodeStates ?? {});
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
