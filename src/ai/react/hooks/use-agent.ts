
import { useCallback, useRef, useState } from "react";
import type { AgentStatus, Message, ToolCall } from "../../types/agent.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

export interface UseAgentOptions {
  agent: string;

  onToolCall?: (toolCall: ToolCall) => void;

  onToolResult?: (toolCall: ToolCall, result: unknown) => void;

  onError?: (error: Error) => void;
}

export interface UseAgentResult {
  messages: Message[];

  toolCalls: ToolCall[];

  status: AgentStatus;

  thinking?: string;

  invoke: (input: string) => Promise<void>;

  stop: () => void;

  isLoading: boolean;

  error: Error | null;
}

export function useAgent(options: UseAgentOptions): UseAgentResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [thinking, setThinking] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const invoke = useCallback(
    async (input: string) => {
      setIsLoading(true);
      setError(null);
      setStatus("thinking");
      setToolCalls([]);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await fetch(`/api/agents/${options.agent}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input,
            messages,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw toError(createError({
            type: "agent",
            message: `Agent error: ${response.status}`,
          }));
        }

        const data = await response.json();

        setMessages(data.messages || []);
        setToolCalls(data.toolCalls || []);
        setStatus(data.status || "completed");
        setThinking(data.thinking);

        if (data.toolCalls && options.onToolCall) {
          data.toolCalls.forEach((tc: ToolCall) => {
            options.onToolCall!(tc);

            if (tc.result && options.onToolResult) {
              options.onToolResult(tc, tc.result);
            }
          });
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }

        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setStatus("error");

        if (options.onError) {
          options.onError(error);
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [messages, options],
  );

  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
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
