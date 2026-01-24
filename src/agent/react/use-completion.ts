/**
 * useCompletion Hook - Layer 1 (Headless)
 *
 * Single text completion with streaming support.
 */

import { useCallback, useRef, useState } from "react";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

export interface UseCompletionOptions {
  /** API endpoint for completion */
  api: string;

  /** Additional data to send */
  body?: Record<string, unknown>;

  /** Custom headers */
  headers?: Record<string, string>;

  /** Callback when response received */
  onResponse?: (response: Response) => void;

  /** Callback when completion finished */
  onFinish?: (completion: string) => void;

  /** Callback when error occurs */
  onError?: (error: Error) => void;
}

export interface UseCompletionResult {
  /** Generated completion text */
  completion: string;

  /** Loading state */
  isLoading: boolean;

  /** Error state */
  error: Error | null;

  /** Complete a prompt */
  complete: (prompt: string) => Promise<void>;

  /** Stop generation */
  stop: () => void;

  /** Set completion manually */
  setCompletion: (completion: string) => void;
}

/**
 * useCompletion hook for single text generation
 */
export function useCompletion(options: UseCompletionOptions): UseCompletionResult {
  const [completion, setCompletion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const complete = useCallback(
    async (prompt: string): Promise<void> => {
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
          body: JSON.stringify({ prompt, ...options.body }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw toError(
            createError({
              type: "agent",
              message: `API error: ${response.status}`,
            }),
          );
        }

        options.onResponse?.(response);

        const body = response.body;
        if (!body) return;

        const reader = body.getReader();
        const decoder = new TextDecoder();
        let accumulatedText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          accumulatedText += decoder.decode(value, { stream: true });
          setCompletion(accumulatedText);
        }

        options.onFinish?.(accumulatedText);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;

        const nextError = error instanceof Error ? error : new Error(String(error));
        setError(nextError);
        options.onError?.(nextError);
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [options],
  );

  const stop = useCallback((): void => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
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
