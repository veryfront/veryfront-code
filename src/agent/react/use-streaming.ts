/**
 * useStreaming Hook - Layer 1 (Headless)
 *
 * Low-level streaming control for custom implementations.
 */

import { useCallback, useRef, useState } from "react";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

export interface UseStreamingOptions {
  /** URL to stream from */
  url: string;

  /** Callback for each chunk */
  onChunk?: (chunk: string) => void;

  /** Callback when stream completes */
  onComplete?: () => void;

  /** Callback when error occurs */
  onError?: (error: Error) => void;
}

export interface UseStreamingResult {
  /** Streaming data */
  data: string;

  /** Streaming state */
  isStreaming: boolean;

  /** Error state */
  error: Error | null;

  /** Start streaming */
  start: (body?: Record<string, unknown>) => Promise<void>;

  /** Stop streaming */
  stop: () => void;

  /** Reset data */
  reset: () => void;
}

/**
 * useStreaming hook for low-level streaming control
 */
export function useStreaming(
  options: UseStreamingOptions,
): UseStreamingResult {
  const [data, setData] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Start streaming
   */
  const start = useCallback(
    async (body?: Record<string, unknown>) => {
      setIsStreaming(true);
      setError(null);
      setData("");

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await fetch(options.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw toError(createError({
            type: "agent",
            message: `Streaming error: ${response.status}`,
          }));
        }

        if (!response.body) {
          throw toError(createError({
            type: "agent",
            message: "No response body",
          }));
        }

        // Read stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedData = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          accumulatedData += chunk;
          setData(accumulatedData);
          options.onChunk?.(chunk);
        }

        options.onComplete?.();
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }

        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        options.onError?.(error);
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [options],
  );

  /**
   * Stop streaming
   */
  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  /**
   * Reset data
   */
  const reset = useCallback(() => {
    setData("");
    setError(null);
  }, []);

  return {
    data,
    isStreaming,
    error,
    start,
    stop,
    reset,
  };
}
