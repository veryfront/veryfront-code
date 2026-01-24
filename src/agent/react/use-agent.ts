import { useCallback, useRef, useState } from "react";
import type { AgentStatus, Message, ToolCall } from "#veryfront/agent/types.ts";
import { createError, ensureError, toError } from "#veryfront/errors/veryfront-error.ts";

export interface UseAgentOptions {
  /** Agent ID or endpoint */
  agent: string;

  /** Callback when tool is called */
  onToolCall?: (toolCall: ToolCall) => void;

  /** Callback when tool result received */
  onToolResult?: (toolCall: ToolCall, result: unknown) => void;

  /** Callback when error occurs */
  onError?: (error: Error) => void;
}

export interface UseAgentResult {
  /** Message history */
  messages: Message[];

  /** Active tool calls */
  toolCalls: ToolCall[];

  /** Agent status */
  status: AgentStatus;

  /** Thinking/reasoning text */
  thinking?: string;

  /** Invoke the agent */
  invoke: (input: string) => Promise<void>;

  /** Stop agent execution */
  stop: () => void;

  /** Loading state */
  isLoading: boolean;

  /** Error state */
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
    async (input: string): Promise<void> => {
      setIsLoading(true);
      setError(null);
      setStatus("thinking");
      setToolCalls([]);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await fetch(`/api/agents/${options.agent}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input, messages }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw toError(
            createError({
              type: "agent",
              message: `Agent error: ${response.status}`,
            }),
          );
        }

        const data: {
          messages?: Message[];
          toolCalls?: ToolCall[];
          status?: AgentStatus;
          thinking?: string;
        } = await response.json();

        setMessages(data.messages ?? []);
        setToolCalls(data.toolCalls ?? []);
        setStatus(data.status ?? "completed");
        setThinking(data.thinking);

        for (const tc of data.toolCalls ?? []) {
          options.onToolCall?.(tc);
          if (tc.result) options.onToolResult?.(tc, tc.result);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;

        const nextError = ensureError(error);
        setError(nextError);
        setStatus("error");
        options.onError?.(nextError);
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [messages, options],
  );

  const stop = useCallback((): void => {
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
