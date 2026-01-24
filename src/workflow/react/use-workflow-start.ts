import { useCallback, useState } from "react";

export interface UseWorkflowStartOptions {
  workflowId: string;
  apiBase?: string;
  onStart?: (runId: string) => void;
  onError?: (error: Error) => void;
}

export interface UseWorkflowStartResult<TInput = unknown> {
  start: (input: TInput) => Promise<string>;
  isStarting: boolean;
  lastRunId: string | null;
  error: Error | null;
  resetError: () => void;
}

export function useWorkflowStart<TInput = unknown>(
  options: UseWorkflowStartOptions,
): UseWorkflowStartResult<TInput> {
  const { workflowId, apiBase = "/api/workflows", onStart, onError } = options;

  const [isStarting, setIsStarting] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const start = useCallback(
    async (input: TInput): Promise<string> => {
      setIsStarting(true);
      setError(null);

      try {
        const response = await fetch(`${apiBase}/${workflowId}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input }),
        });

        if (!response.ok) {
          const errorData: { message?: string } = await response
            .json()
            .catch(() => ({}));
          throw new Error(
            errorData.message ?? `Failed to start workflow: ${response.status}`,
          );
        }

        const data: { runId?: string; id?: string } = await response.json();
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
    [apiBase, onError, onStart, workflowId],
  );

  const resetError = useCallback((): void => {
    setError(null);
  }, []);

  return { start, isStarting, lastRunId, error, resetError };
}
