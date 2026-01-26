import * as dntShim from "../../../_dnt.shims.js";
import { useCallback, useRef, useState } from "react";
import { createError, toError } from "../../errors/veryfront-error.js";
export function useStreaming(options) {
    const [data, setData] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState(null);
    const abortControllerRef = useRef(null);
    const start = useCallback(async (body) => {
        setIsStreaming(true);
        setError(null);
        setData("");
        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        try {
            const response = await dntShim.fetch(options.url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: body ? JSON.stringify(body) : undefined,
                signal: abortController.signal,
            });
            if (!response.ok) {
                throw toError(createError({
                    type: "agent",
                    message: `Streaming error: ${response.status}`,
                }));
            }
            const reader = response.body?.getReader();
            if (!reader) {
                throw toError(createError({
                    type: "agent",
                    message: "No response body",
                }));
            }
            const decoder = new TextDecoder();
            let accumulatedData = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                const chunk = decoder.decode(value, { stream: true });
                accumulatedData += chunk;
                setData(accumulatedData);
                options.onChunk?.(chunk);
            }
            options.onComplete?.();
        }
        catch (error) {
            if (error instanceof Error && error.name === "AbortError")
                return;
            const nextError = error instanceof Error ? error : new Error(String(error));
            setError(nextError);
            options.onError?.(nextError);
        }
        finally {
            setIsStreaming(false);
            abortControllerRef.current = null;
        }
    }, [options]);
    const stop = useCallback(() => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setIsStreaming(false);
    }, []);
    const reset = useCallback(() => {
        setData("");
        setError(null);
    }, []);
    return { data, isStreaming, error, start, stop, reset };
}
