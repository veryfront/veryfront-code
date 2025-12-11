
import { useCallback, useRef, useState } from "react";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

export interface UseCompletionOptions {
  api: string;

  body?: Record<string, unknown>;

  headers?: Record<string, string>;

  onResponse?: (response: Response) => void;

  onFinish?: (completion: string) => void;

  onError?: (error: Error) => void;
}

export interface UseCompletionResult {
  completion: string;

  isLoading: boolean;

  error: Error | null;

  complete: (prompt: string) => Promise<void>;

  stop: () => void;

  setCompletion: (completion: string) => void;
}

export function useCompletion(
  options: UseCompletionOptions,
): UseCompletionResult {
  const [completion, setCompletion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const complete = useCallback(
    async (prompt: string) => {
      setIsLoading(true);
      setError(null);
      setCompletion("");

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await fetch(options.api, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...options.headers,
          },
          body: JSON.stringify({
            prompt,
            ...options.body,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw toError(createError({
            type: "agent",
            message: `API error: ${response.status}`,
          }));
        }

        if (options.onResponse) {
          options.onResponse(response);
        }

        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let accumulatedText = "";

          while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            accumulatedText += chunk;
            setCompletion(accumulatedText);
          }

          if (options.onFinish) {
            options.onFinish(accumulatedText);
          }
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
        setIsLoading(false);
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
    setIsLoading(false);
  }, []);

  return {
    completion,
    isLoading,
    error,
    complete,
    stop,
    setCompletion,
  };
}
