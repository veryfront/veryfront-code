import { useCallback, useMemo, useRef, useState } from "react";
import { REQUEST_ERROR } from "#veryfront/errors/error-registry.ts";
import {
  encodeWorkflowPathSegment,
  normalizeWorkflowApiBase,
  useStableWorkflowHeaders,
  workflowJsonMutationHeaders,
} from "./mutation-headers.ts";

/** Options accepted by use workflow start. */
export interface UseWorkflowStartOptions {
  workflowId: string;
  apiBase?: string;
  /** Additional headers, such as a cross-origin authorization token. */
  headers?: HeadersInit;
  /** Fetch credential mode for cross-origin cookie-backed sessions. */
  credentials?: RequestCredentials;
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

/** React hook for workflow start. */
export function useWorkflowStart<TInput = unknown>(
  options: UseWorkflowStartOptions,
): UseWorkflowStartResult<TInput> {
  const {
    workflowId,
    apiBase = "/api/workflows",
    headers,
    credentials,
    onStart,
    onError,
  } = options;
  const normalizedApiBase = normalizeWorkflowApiBase(apiBase);
  const stableHeaders = useStableWorkflowHeaders(headers);
  const requestContext = useMemo(
    () => ({ credentials, normalizedApiBase, stableHeaders, workflowId }),
    [credentials, normalizedApiBase, stableHeaders, workflowId],
  );
  const currentRequestContext = useRef(requestContext);
  currentRequestContext.current = requestContext;

  const [startingState, setStartingState] = useState<
    {
      count: number;
      requestContext: typeof requestContext;
    } | null
  >(null);
  const [lastRun, setLastRun] = useState<
    {
      requestContext: typeof requestContext;
      runId: string;
    } | null
  >(null);
  const [errorState, setErrorState] = useState<
    {
      error: Error;
      requestContext: typeof requestContext;
    } | null
  >(null);

  const start = useCallback(
    async (input: TInput): Promise<string> => {
      const startedRequestContext = requestContext;
      const isCurrentRequest = (): boolean =>
        startedRequestContext === currentRequestContext.current;
      setStartingState((current) =>
        current?.requestContext === startedRequestContext
          ? { ...current, count: current.count + 1 }
          : { count: 1, requestContext: startedRequestContext }
      );
      setErrorState(null);

      try {
        const requestUrl = `${normalizedApiBase}/${
          encodeWorkflowPathSegment(workflowId, "Workflow ID")
        }/start`;
        const response = await fetch(requestUrl, {
          method: "POST",
          headers: workflowJsonMutationHeaders(requestUrl, stableHeaders),
          credentials,
          body: JSON.stringify({ input }),
        });

        if (!response.ok) {
          const errorData = (await response.json().catch(() => ({}))) as {
            message?: string;
          };

          throw REQUEST_ERROR.create({
            detail: errorData.message ?? `Failed to start workflow: ${response.status}`,
            status: response.status,
          });
        }

        const data = (await response.json()) as { runId?: string; id?: string };
        const runId = data.runId ?? data.id ?? "";

        if (isCurrentRequest()) {
          setLastRun({ requestContext: startedRequestContext, runId });
          onStart?.(runId);
        }

        return runId;
      } catch (err) {
        const startError = err instanceof Error ? err : new Error(String(err));
        if (isCurrentRequest()) {
          setErrorState({ error: startError, requestContext: startedRequestContext });
          onError?.(startError);
        }
        throw startError;
      } finally {
        setStartingState((current) => {
          if (current?.requestContext !== startedRequestContext) return current;
          return current.count === 1 ? null : { ...current, count: current.count - 1 };
        });
      }
    },
    [credentials, normalizedApiBase, onError, onStart, requestContext, stableHeaders, workflowId],
  );

  const resetError = useCallback((): void => {
    setErrorState(null);
  }, []);

  const isStarting = startingState?.requestContext === requestContext && startingState.count > 0;
  const lastRunId = lastRun?.requestContext === requestContext ? lastRun.runId : null;
  const error = errorState?.requestContext === requestContext ? errorState.error : null;

  return { start, isStarting, lastRunId, error, resetError };
}
