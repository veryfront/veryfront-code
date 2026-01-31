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

export function useStreaming(options: UseStreamingOptions): UseStreamingResult {
  const [data, setData] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const start = useCallback(
    async (body?: Record<string, unknown>): Promise<void> => {
      setIsStreaming(true);
      setError(null);
      setData("");

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await fetch(options.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw toError(
            createError({
              type: "agent",
              message: `Streaming error: ${response.status}`,
            }),
          );
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw toError(
            createError({
              type: "agent",
              message: "No response body",
            }),
          );
        }

        const decoder = new TextDecoder();
        let accumulatedData = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          accumulatedData += chunk;
          setData(accumulatedData);
          options.onChunk?.(chunk);
        }

        options.onComplete?.();
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;

        const nextError = error instanceof Error ? error : new Error(String(error));
        setError(nextError);
        options.onError?.(nextError);
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [options],
  );

  const stop = useCallback((): void => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
  }, []);

  const reset = useCallback((): void => {
    setData("");
    setError(null);
  }, []);

  return { data, isStreaming, error, start, stop, reset };
}
