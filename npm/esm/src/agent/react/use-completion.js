/**
 * useCompletion Hook - Layer 1 (Headless)
 *
 * Single text completion with streaming support.
 */
import * as dntShim from "../../../_dnt.shims.js";
import { useCallback, useRef, useState } from "react";
import { createError, toError } from "../../errors/veryfront-error.js";
/**
 * useCompletion hook for single text generation
 */
export function useCompletion(options) {
    const [completion, setCompletion] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const abortControllerRef = useRef(null);
    const complete = useCallback(async (prompt) => {
        setIsLoading(true);
        setError(null);
        setCompletion("");
        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        try {
            const response = await dntShim.fetch(options.api, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...options.headers,
                },
                body: JSON.stringify({ prompt, ...options.body }),
                signal: abortController.signal,
            });
            if (!response.ok) {
                throw toError(createError({
                    type: "agent",
                    message: `API error: ${response.status}`,
                }));
            }
            options.onResponse?.(response);
            const body = response.body;
            if (!body)
                return;
            const reader = body.getReader();
            const decoder = new TextDecoder();
            let accumulatedText = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                accumulatedText += decoder.decode(value, { stream: true });
                setCompletion(accumulatedText);
            }
            options.onFinish?.(accumulatedText);
        }
        catch (error) {
            if (error instanceof Error && error.name === "AbortError")
                return;
            const nextError = error instanceof Error ? error : new Error(String(error));
            setError(nextError);
            options.onError?.(nextError);
        }
        finally {
            setIsLoading(false);
            abortControllerRef.current = null;
        }
    }, [options]);
    const stop = useCallback(() => {
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
