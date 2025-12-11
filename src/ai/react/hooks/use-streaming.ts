
import { useCallback, useRef, useState } from "react";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

export interface UseStreamingOptions {
  url: string;

  onChunk?: (chunk: string) => void;

  onComplete?: () => void;

  onError?: (error: Error) => void;
}

export interface UseStreamingResult {
  data: string;

  isStreaming: boolean;

  error: Error | null;

  start: (body?: Record<string, unknown>) => Promise<void>;

  stop: () => void;

  reset: () => void;
}

export function useStreaming(
  options: UseStreamingOptions,
): UseStreamingResult {
  const [data, setData] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedData = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          accumulatedData += chunk;
          setData(accumulatedData);

          if (options.onChunk) {
            options.onChunk(chunk);
          }
        }

        if (options.onComplete) {
          options.onComplete();
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }

        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);

        if (options.onError) {
          options.onError(error);
        }
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [options],
  );

  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

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
