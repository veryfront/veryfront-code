/**
 * useCompletion Hook - Layer 1 (Headless)
 *
 * Single text completion with streaming support.
 */

import { useCallback, useRef, useState } from "react";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";

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
export function useCompletion(
  options: UseCompletionOptions,
): UseCompletionResult {
  const [completion, setCompletion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Complete a prompt
   */
  const complete = useCallback(
    async (prompt: string) => {
      setIsLoading(true);
      setError(null);
      setCompletion("");

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        // Call API
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

        options.onResponse?.(response);

        // Handle streaming response
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

          options.onFinish?.(accumulatedText);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }

        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        options.onError?.(error);
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [options],
  );

  /**
   * Stop generation
   */
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
