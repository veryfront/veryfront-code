import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { REQUEST_ERROR } from "#veryfront/errors/error-registry.ts";
import { parseWorkflowStartResponse, readWorkflowErrorDetail } from "./workflow-wire.ts";

/** Options accepted by use workflow start. */
export interface UseWorkflowStartOptions {
  workflowId: string;
  apiBase?: string;
  onStart?: (runId: string) => void;
  onError?: (error: Error) => void;
}

/** Result returned from use workflow start. */
export interface UseWorkflowStartResult<TInput = unknown> {
  start: (input: TInput) => Promise<string>;
  isStarting: boolean;
  lastRunId: string | null;
  error: Error | null;
  resetError: () => void;
}

interface WorkflowStartIdentity {
  readonly workflowId: string;
  readonly apiBase: string;
  active: boolean;
  pendingCount: number;
  controllers: Set<AbortController>;
}

function workflowStartAbortError(cause?: unknown): Error {
  if (cause instanceof Error && cause.name === "AbortError") return cause;
  const error = new Error("Workflow start request became obsolete");
  error.name = "AbortError";
  return error;
}

/** React hook for workflow start. */
export function useWorkflowStart<TInput = unknown>(
  options: UseWorkflowStartOptions,
): UseWorkflowStartResult<TInput> {
  const { workflowId, apiBase = "/api/workflows", onStart, onError } = options;

  const [isStarting, setIsStarting] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const committedIdentityRef = useRef<WorkflowStartIdentity | null>(null);
  const identity = useMemo<WorkflowStartIdentity>(() => ({
    workflowId,
    apiBase,
    active: false,
    pendingCount: 0,
    controllers: new Set(),
  }), [apiBase, workflowId]);

  useEffect(() => {
    committedIdentityRef.current = identity;
    identity.active = true;
    identity.pendingCount = 0;
    setIsStarting(false);
    setLastRunId(null);
    setError(null);

    return () => {
      identity.active = false;
      identity.pendingCount = 0;
      for (const controller of identity.controllers) controller.abort();
      identity.controllers.clear();
      if (committedIdentityRef.current === identity) committedIdentityRef.current = null;
    };
  }, [identity]);

  const start = useCallback(
    async (input: TInput): Promise<string> => {
      if (!identity.active || committedIdentityRef.current !== identity) {
        throw workflowStartAbortError();
      }
      const controller = new AbortController();
      identity.controllers.add(controller);
      identity.pendingCount += 1;
      setIsStarting(true);
      setError(null);

      try {
        const response = await fetch(
          `${identity.apiBase}/${encodeURIComponent(identity.workflowId)}/start`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input }),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw REQUEST_ERROR.create({
            detail: await readWorkflowErrorDetail(
              response,
              `Failed to start workflow: ${response.status}`,
            ),
            status: response.status,
          });
        }

        const runId = parseWorkflowStartResponse(await response.json());
        if (
          controller.signal.aborted || !identity.active ||
          committedIdentityRef.current !== identity
        ) {
          throw workflowStartAbortError();
        }

        setLastRunId(runId);
        setError(null);
        onStart?.(runId);

        return runId;
      } catch (err) {
        const startError = err instanceof Error ? err : new Error(String(err));
        const obsolete = controller.signal.aborted || !identity.active ||
          committedIdentityRef.current !== identity || startError.name === "AbortError";
        if (obsolete) throw workflowStartAbortError(startError);
        setError(startError);
        onError?.(startError);
        throw startError;
      } finally {
        identity.controllers.delete(controller);
        if (identity.active && committedIdentityRef.current === identity) {
          identity.pendingCount = Math.max(0, identity.pendingCount - 1);
          setIsStarting(identity.pendingCount > 0);
        }
      }
    },
    [identity, onError, onStart],
  );

  const resetError = useCallback((): void => {
    if (identity.active && committedIdentityRef.current === identity) setError(null);
  }, [identity]);

  const ownsState = identity.active && committedIdentityRef.current === identity;
  return {
    start,
    isStarting: ownsState ? isStarting : false,
    lastRunId: ownsState ? lastRunId : null,
    error: ownsState ? error : null,
    resetError,
  };
}
