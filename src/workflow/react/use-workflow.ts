import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  NodeState,
  PendingApproval,
  WorkflowRun,
  WorkflowStatus,
} from "#veryfront/workflow/types.ts";
import { ORCHESTRATION_ERROR, REQUEST_ERROR } from "#veryfront/errors/error-registry.ts";
import {
  encodeWorkflowPathSegment,
  normalizeWorkflowApiBase,
  useStableWorkflowHeaders,
  workflowMutationHeaders,
} from "./mutation-headers.ts";

/** Default polling interval for workflow status updates */
const DEFAULT_POLL_INTERVAL_MS = 2_000;

/** Options accepted by use workflow. */
export interface UseWorkflowOptions {
  runId: string;
  apiBase?: string;
  /** Additional headers, such as a cross-origin authorization token. */
  headers?: HeadersInit;
  /** Fetch credential mode for cross-origin cookie-backed sessions. */
  credentials?: RequestCredentials;
  pollInterval?: number;
  autoRefresh?: boolean;
  onStatusChange?: (status: WorkflowStatus, previousStatus: WorkflowStatus) => void;
  onComplete?: (run: WorkflowRun) => void;
  onError?: (error: Error, run?: WorkflowRun) => void;
  onApprovalRequired?: (approval: PendingApproval) => void;
}

/** Result returned from use workflow. */
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

/** React hook for workflow. */
export function useWorkflow(options: UseWorkflowOptions): UseWorkflowResult {
  const {
    runId,
    apiBase = "/api/workflows",
    headers,
    credentials,
    pollInterval = DEFAULT_POLL_INTERVAL_MS,
    autoRefresh = true,
    onStatusChange,
    onComplete,
    onError,
    onApprovalRequired,
  } = options;
  const normalizedApiBase = normalizeWorkflowApiBase(apiBase);
  const stableHeaders = useStableWorkflowHeaders(headers);
  const requestContext = useMemo(
    () => ({ credentials, normalizedApiBase, runId, stableHeaders }),
    [credentials, normalizedApiBase, runId, stableHeaders],
  );

  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [runRequestContext, setRunRequestContext] = useState(requestContext);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const previousStatusRef = useRef<WorkflowStatus | null>(null);
  const previousApprovalsRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Run details and approval identities belong to one request context. Clear
    // them before a replacement fetch can fail and leave old session data.
    setRun(null);
    setError(null);
    previousStatusRef.current = null;
    previousApprovalsRef.current.clear();
  }, [requestContext]);

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
      const response = await fetch(
        `${normalizedApiBase}/runs/${encodeWorkflowPathSegment(runId, "Workflow run ID")}`,
        {
          signal: abortControllerRef.current?.signal,
          headers: stableHeaders,
          credentials,
        },
      );

      if (!response.ok) {
        throw REQUEST_ERROR.create({
          detail: `Failed to fetch workflow: ${response.status}`,
          status: response.status,
        });
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

      setRunRequestContext(requestContext);
      setRun(workflowRun);
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;

      const fetchError = err instanceof Error ? err : new Error(String(err));
      setError(fetchError);
      onError?.(fetchError);
    }
  }, [
    credentials,
    normalizedApiBase,
    onApprovalRequired,
    onComplete,
    onError,
    onStatusChange,
    requestContext,
    runId,
    stableHeaders,
  ]);

  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    await fetchRun();
    setIsLoading(false);
  }, [fetchRun]);

  const cancel = useCallback(async (): Promise<void> => {
    if (!runId) return;

    try {
      const requestUrl = `${normalizedApiBase}/runs/${
        encodeWorkflowPathSegment(runId, "Workflow run ID")
      }/cancel`;
      const response = await fetch(requestUrl, {
        method: "POST",
        headers: workflowMutationHeaders(requestUrl, stableHeaders),
        credentials,
      });
      if (!response.ok) {
        throw REQUEST_ERROR.create({
          detail: `Failed to cancel workflow: ${response.status}`,
          status: response.status,
        });
      }
      await refresh();
    } catch (err) {
      const cancelError = err instanceof Error ? err : new Error(String(err));
      setError(cancelError);
      throw cancelError;
    }
  }, [credentials, normalizedApiBase, refresh, runId, stableHeaders]);

  const retry = useCallback(async (): Promise<void> => {
    if (!runId) return;

    try {
      const requestUrl = `${normalizedApiBase}/runs/${
        encodeWorkflowPathSegment(runId, "Workflow run ID")
      }/retry`;
      const response = await fetch(requestUrl, {
        method: "POST",
        headers: workflowMutationHeaders(requestUrl, stableHeaders),
        credentials,
      });
      if (!response.ok) {
        throw REQUEST_ERROR.create({
          detail: `Failed to retry workflow: ${response.status}`,
          status: response.status,
        });
      }
      await refresh();
    } catch (err) {
      const retryError = err instanceof Error ? err : new Error(String(err));
      setError(retryError);
      throw retryError;
    }
  }, [credentials, normalizedApiBase, refresh, runId, stableHeaders]);

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
        // Terminal: stop polling entirely instead of firing forever until the
        // component unmounts.
        clearInterval(intervalId);
        return;
      }

      fetchRun();
    }, pollInterval);

    return () => {
      abortControllerRef.current?.abort();
      clearInterval(intervalId);
    };
  }, [autoRefresh, fetchRun, pollInterval, refresh]);

  const visibleRun = runRequestContext === requestContext ? run : null;

  return {
    run: visibleRun,
    status: visibleRun?.status ?? "pending",
    progress: calculateProgress(visibleRun),
    currentNodes: visibleRun?.currentNodes ?? [],
    nodeStates: visibleRun?.nodeStates ?? {},
    pendingApprovals: visibleRun?.pendingApprovals?.filter((a) => a.status === "pending") ?? [],
    refresh,
    cancel,
    retry,
    isLoading,
    error,
  };
}
