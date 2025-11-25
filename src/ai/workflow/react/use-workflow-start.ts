/**
 * useWorkflowStart Hook
 *
 * React hook for starting workflow runs.
 *
 * @example
 * ```tsx
 * import { useWorkflowStart } from 'veryfront/ai/workflow/react';
 *
 * function StartWorkflowButton() {
 *   const { start, isStarting, error, lastRunId } = useWorkflowStart({
 *     workflowId: 'content-pipeline',
 *     onStart: (runId) => {
 *       console.log('Started:', runId);
 *     },
 *   });
 *
 *   return (
 *     <button
 *       onClick={() => start({ topic: 'AI Safety' })}
 *       disabled={isStarting}
 *     >
 *       {isStarting ? 'Starting...' : 'Start Workflow'}
 *     </button>
 *   );
 * }
 * ```
 */

import { useCallback, useState } from "react";

/**
 * Options for useWorkflowStart hook
 */
export interface UseWorkflowStartOptions {
  /** Workflow ID to start */
  workflowId: string;

  /** API endpoint base (defaults to /api/workflows) */
  apiBase?: string;

  /** Callback when workflow starts successfully */
  onStart?: (runId: string) => void;

  /** Callback on error */
  onError?: (error: Error) => void;
}

/**
 * Result from useWorkflowStart hook
 */
export interface UseWorkflowStartResult<TInput = unknown> {
  /** Start a new workflow run */
  start: (input: TInput) => Promise<string>;

  /** Whether a start is in progress */
  isStarting: boolean;

  /** Last started run ID */
  lastRunId: string | null;

  /** Error state */
  error: Error | null;

  /** Reset error state */
  resetError: () => void;
}

/**
 * useWorkflowStart - Start new workflow runs
 */
export function useWorkflowStart<TInput = unknown>(
  options: UseWorkflowStartOptions
): UseWorkflowStartResult<TInput> {
  const { workflowId, apiBase = "/api/workflows", onStart, onError } = options;

  const [isStarting, setIsStarting] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Start a new workflow run
   */
  const start = useCallback(
    async (input: TInput): Promise<string> => {
      setIsStarting(true);
      setError(null);

      try {
        const response = await fetch(`${apiBase}/${workflowId}/start`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ input }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.message || `Failed to start workflow: ${response.status}`
          );
        }

        const data = await response.json();
        const runId = data.runId || data.id;

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
    [workflowId, apiBase, onStart, onError]
  );

  /**
   * Reset error state
   */
  const resetError = useCallback(() => {
    setError(null);
  }, []);

  return {
    start,
    isStarting,
    lastRunId,
    error,
    resetError,
  };
}
