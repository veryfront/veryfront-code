import { useCallback, useState } from "react";
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

  const [isStarting, setIsStarting] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const start = useCallback(
    async (input: TInput): Promise<string> => {
      setIsStarting(true);
      setError(null);

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

        setLastRunId(runId);
        onStart?.(runId);

        return runId;
      } catch (err) {
        const startError = err instanceof Error ? err : new Error(String(err));
        setError(startError);
        onError?.(startError);
        throw startError;
      } finally {
        setIsStarting(false);
      }
    },
    [credentials, normalizedApiBase, onError, onStart, stableHeaders, workflowId],
  );

  const resetError = useCallback((): void => {
    setError(null);
  }, []);

  return { start, isStarting, lastRunId, error, resetError };
}
