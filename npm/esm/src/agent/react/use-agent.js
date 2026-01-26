import * as dntShim from "../../../_dnt.shims.js";
import { useCallback, useRef, useState } from "react";
import { createError, ensureError, toError } from "../../errors/veryfront-error.js";
export function useAgent(options) {
    const [messages, setMessages] = useState([]);
    const [toolCalls, setToolCalls] = useState([]);
    const [status, setStatus] = useState("idle");
    const [thinking, setThinking] = useState();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const abortControllerRef = useRef(null);
    const invoke = useCallback(async (input) => {
        setIsLoading(true);
        setError(null);
        setStatus("thinking");
        setToolCalls([]);
        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        try {
            const response = await dntShim.fetch(`/api/agents/${options.agent}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ input, messages }),
                signal: abortController.signal,
            });
            if (!response.ok) {
                throw toError(createError({
                    type: "agent",
                    message: `Agent error: ${response.status}`,
                }));
            }
            const data = await response.json();
            setMessages(data.messages ?? []);
            setToolCalls(data.toolCalls ?? []);
            setStatus(data.status ?? "completed");
            setThinking(data.thinking);
            for (const tc of data.toolCalls ?? []) {
                options.onToolCall?.(tc);
                if (tc.result)
                    options.onToolResult?.(tc, tc.result);
            }
        }
        catch (error) {
            if (error instanceof Error && error.name === "AbortError")
                return;
            const nextError = ensureError(error);
            setError(nextError);
            setStatus("error");
            options.onError?.(nextError);
        }
        finally {
            setIsLoading(false);
            abortControllerRef.current = null;
        }
    }, [messages, options]);
    const stop = useCallback(() => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setIsLoading(false);
        setStatus("idle");
    }, []);
    return {
        messages,
        toolCalls,
        status,
        thinking,
        invoke,
        stop,
        isLoading,
        error,
    };
}
