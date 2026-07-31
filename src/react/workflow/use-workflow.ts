import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  NodeState,
  PendingApproval,
  WorkflowRun,
  WorkflowStatus,
} from "#veryfront/workflow/types.ts";
import { ORCHESTRATION_ERROR, REQUEST_ERROR } from "#veryfront/errors/error-registry.ts";
import { normalizeActiveTimerDelayMs } from "./option-normalization.ts";
import { parseWorkflowRunResponse } from "./workflow-wire.ts";

/** Default polling interval for workflow status updates */
const DEFAULT_POLL_INTERVAL_MS = 2_000;

interface CommittedWorkflowCallbacks {
  onStatusChange?: UseWorkflowOptions["onStatusChange"];
  onComplete?: UseWorkflowOptions["onComplete"];
  onError?: UseWorkflowOptions["onError"];
  onApprovalRequired?: UseWorkflowOptions["onApprovalRequired"];
}

interface WorkflowIdentity {
  readonly runId: string;
  readonly apiBase: string;
  active: boolean;
  previousStatus: WorkflowStatus | null;
  previousApprovals: Set<string>;
  requestController: AbortController | null;
  requestPromise: Promise<void> | null;
  actionControllers: Set<AbortController>;
}

function workflowAbortError(cause?: unknown): Error {
  if (cause instanceof Error && cause.name === "AbortError") return cause;
  const error = new Error("Workflow request no longer belongs to the committed run");
  error.name = "AbortError";
  return error;
}

/** Options accepted by use workflow. */
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
    pollInterval = DEFAULT_POLL_INTERVAL_MS,
    autoRefresh = true,
    onStatusChange,
    onComplete,
    onError,
    onApprovalRequired,
  } = options;
  const normalizedPollInterval = normalizeActiveTimerDelayMs(pollInterval, "pollInterval");

  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const committedIdentityRef = useRef<WorkflowIdentity | null>(null);
  const committedCallbacksRef = useRef<CommittedWorkflowCallbacks>({});
  const identity = useMemo<WorkflowIdentity>(() => ({
    runId,
    apiBase,
    active: false,
    previousStatus: null,
    previousApprovals: new Set(),
    requestController: null,
    requestPromise: null,
    actionControllers: new Set(),
  }), [apiBase, runId]);

  useEffect(() => {
    committedCallbacksRef.current = {
      onStatusChange,
      onComplete,
      onError,
      onApprovalRequired,
    };
  }, [onApprovalRequired, onComplete, onError, onStatusChange]);

  const calculateProgress = useCallback((workflowRun: WorkflowRun | null): number => {
    const states = Object.values(workflowRun?.nodeStates ?? {});
    if (states.length === 0) return 0;

    const completed = states.filter(
      (s) => s.status === "completed" || s.status === "skipped",
    ).length;

    return Math.round((completed / states.length) * 100);
  }, []);

  const fetchRun = useCallback((
    owner: WorkflowIdentity,
    supersede: boolean,
    rejectObsolete = false,
  ): Promise<void> => {
    if (
      !owner.runId || !owner.active ||
      committedIdentityRef.current !== owner
    ) {
      return rejectObsolete ? Promise.reject(workflowAbortError()) : Promise.resolve();
    }
    if (owner.requestPromise) {
      if (!supersede) return Promise.resolve();
      owner.requestController?.abort();
    }

    const controller = new AbortController();
    owner.requestController = controller;
    setIsLoading(true);
    const request = (async (): Promise<void> => {
      try {
        const response = await fetch(
          `${owner.apiBase}/runs/${encodeURIComponent(owner.runId)}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw REQUEST_ERROR.create({
            detail: `Failed to fetch workflow: ${response.status}`,
            status: response.status,
          });
        }

        const workflowRun = parseWorkflowRunResponse(await response.json());
        if (workflowRun.id !== owner.runId) {
          throw REQUEST_ERROR.create({
            detail: "Workflow response identity does not match the requested run",
            status: 502,
          });
        }
        if (
          controller.signal.aborted || !owner.active ||
          committedIdentityRef.current !== owner
        ) return;

        const previousStatus = owner.previousStatus;
        if (previousStatus && previousStatus !== workflowRun.status) {
          committedCallbacksRef.current.onStatusChange?.(workflowRun.status, previousStatus);
        }

        if (workflowRun.status === "completed" && previousStatus !== "completed") {
          committedCallbacksRef.current.onComplete?.(workflowRun);
        } else if (workflowRun.status === "failed" && previousStatus !== "failed") {
          committedCallbacksRef.current.onError?.(
            ORCHESTRATION_ERROR.create({ detail: "Workflow failed" }),
            workflowRun,
          );
        }
        owner.previousStatus = workflowRun.status;

        for (const approval of workflowRun.pendingApprovals) {
          if (approval.status !== "pending") continue;
          if (owner.previousApprovals.has(approval.id)) continue;
          owner.previousApprovals.add(approval.id);
          committedCallbacksRef.current.onApprovalRequired?.(approval);
        }

        setRun(workflowRun);
        setError(null);
      } catch (err) {
        if (
          controller.signal.aborted || !owner.active ||
          committedIdentityRef.current !== owner ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          if (rejectObsolete) throw workflowAbortError(err);
          return;
        }

        const fetchError = err instanceof Error ? err : new Error(String(err));
        setError(fetchError);
        committedCallbacksRef.current.onError?.(fetchError);
      } finally {
        if (owner.requestController === controller) {
          owner.requestController = null;
          owner.requestPromise = null;
          if (owner.active && committedIdentityRef.current === owner) {
            setIsLoading(false);
          }
        }
      }
    })();
    owner.requestPromise = request;
    return request;
  }, []);

  const refresh = useCallback((): Promise<void> => {
    return fetchRun(identity, true, true);
  }, [fetchRun, identity]);

  const runAction = useCallback(async (
    owner: WorkflowIdentity,
    action: "cancel" | "retry",
  ): Promise<void> => {
    if (!owner.runId) return;
    if (!owner.active || committedIdentityRef.current !== owner) {
      throw workflowAbortError();
    }
    const controller = new AbortController();
    owner.actionControllers.add(controller);

    try {
      const response = await fetch(
        `${owner.apiBase}/runs/${encodeURIComponent(owner.runId)}/${action}`,
        { method: "POST", signal: controller.signal },
      );
      if (!response.ok) {
        throw REQUEST_ERROR.create({
          detail: `Failed to ${action} workflow: ${response.status}`,
          status: response.status,
        });
      }
      if (
        controller.signal.aborted || !owner.active ||
        committedIdentityRef.current !== owner
      ) throw workflowAbortError();
      await fetchRun(owner, true, true);
    } catch (err) {
      if (
        controller.signal.aborted || !owner.active ||
        committedIdentityRef.current !== owner ||
        (err instanceof Error && err.name === "AbortError")
      ) throw workflowAbortError(err);
      const actionError = err instanceof Error ? err : new Error(String(err));
      setError(actionError);
      throw actionError;
    } finally {
      owner.actionControllers.delete(controller);
    }
  }, [fetchRun]);

  const cancel = useCallback(
    (): Promise<void> => runAction(identity, "cancel"),
    [identity, runAction],
  );

  const retry = useCallback(
    (): Promise<void> => runAction(identity, "retry"),
    [identity, runAction],
  );

  useEffect(() => {
    committedIdentityRef.current = identity;
    identity.active = true;
    identity.previousStatus = null;
    identity.previousApprovals = new Set();
    setRun(null);
    setError(null);

    if (!identity.runId) {
      setIsLoading(false);
      return () => {
        identity.active = false;
        if (committedIdentityRef.current === identity) committedIdentityRef.current = null;
      };
    }

    void fetchRun(identity, true);

    return () => {
      identity.active = false;
      identity.requestController?.abort();
      for (const controller of identity.actionControllers) controller.abort();
      identity.actionControllers.clear();
      if (committedIdentityRef.current === identity) committedIdentityRef.current = null;
    };
  }, [fetchRun, identity]);

  useEffect(() => {
    if (!autoRefresh || !identity.runId) return;
    const intervalId = setInterval(() => {
      if (!identity.active || committedIdentityRef.current !== identity) return;
      const currentStatus = identity.previousStatus;
      if (
        currentStatus === "completed" || currentStatus === "failed" || currentStatus === "cancelled"
      ) {
        // Keep the timer installed but idle. A successful retry can move the
        // same run back to a non-terminal state without recreating this effect.
        return;
      }

      if (!identity.requestPromise) void fetchRun(identity, false);
    }, normalizedPollInterval);

    return () => clearInterval(intervalId);
  }, [autoRefresh, fetchRun, identity, normalizedPollInterval]);

  const ownsState = identity.active && committedIdentityRef.current === identity;
  const visibleRun = ownsState ? run : null;
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
    isLoading: ownsState ? isLoading : Boolean(runId),
    error: ownsState ? error : null,
  };
}
