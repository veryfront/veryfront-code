/**
 * useAgent Hook - Layer 1 (Headless)
 *
 * Agent orchestration with tool execution visualization.
 */

import { useCallback, useRef, useState } from "react";
import type { AgentStatus, Message, ToolCall } from "../../types/agent.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

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

/**
 * useAgent hook for agent orchestration
 */
export function useAgent(options: UseAgentOptions): UseAgentResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [thinking, setThinking] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Invoke the agent
   */
  const invoke = useCallback(
    async (input: string) => {
      setIsLoading(true);
      setError(null);
      setStatus("thinking");
      setToolCalls([]);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        // Call agent API
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

        // Parse response
        const data = await response.json();

        // Update state
        setMessages(data.messages || []);
        setToolCalls(data.toolCalls || []);
        setStatus(data.status || "completed");
        setThinking(data.thinking);

        // Call callbacks for tool calls
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

  /**
   * Stop agent execution
   */
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
