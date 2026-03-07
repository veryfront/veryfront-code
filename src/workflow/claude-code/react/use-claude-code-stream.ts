/**
 * React Hook for Claude Code Streaming
 *
 * Provides real-time streaming of Claude Code agent execution.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClaudeCodeEvent, ClaudeCodeResult } from "../types.ts";
import { REQUEST_ERROR } from "#veryfront/errors";

/** Default delay before reconnecting after disconnect */
const DEFAULT_RECONNECT_DELAY_MS = 1_000;

/** Default maximum number of events to retain in history */
const DEFAULT_MAX_EVENT_HISTORY = 100;

/**
 * State for Claude Code streaming
 */
export interface UseClaudeCodeStreamState {
  /** Whether currently connected to stream */
  isConnected: boolean;

  /** Whether agent is currently executing */
  isRunning: boolean;

  /** Current iteration number */
  currentIteration: number;

  /** Maximum iterations allowed */
  maxIterations: number;

  /** Accumulated text output */
  text: string;

  /** Current tool being executed (if any) */
  currentTool: {
    id: string;
    name: string;
    input: Record<string, unknown>;
  } | null;

  /** Tool calls in current iteration */
  toolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    output?: string;
    isError?: boolean;
  }>;

  /** All tool calls across all iterations */
  allToolCalls: Array<{
    iteration: number;
    id: string;
    name: string;
    input: Record<string, unknown>;
    output?: string;
    isError?: boolean;
  }>;

  /** Final result (when complete) */
  result: ClaudeCodeResult | null;

  /** Error message (if any) */
  error: string | null;

  /** Raw events (for debugging) */
  events: ClaudeCodeEvent[];
}

/**
 * Options for useClaudeCodeStream hook
 */
export interface UseClaudeCodeStreamOptions {
  /** SSE endpoint URL */
  url: string;

  /** Run ID to stream */
  runId: string;

  /** Auto-connect on mount */
  autoConnect?: boolean;

  /** Reconnect on disconnect */
  autoReconnect?: boolean;

  /** Max reconnect attempts */
  maxReconnectAttempts?: number;

  /** Reconnect delay (ms) */
  reconnectDelay?: number;

  /** Keep event history */
  keepEventHistory?: boolean;

  /** Max events to keep in history */
  maxEventHistory?: number;

  /** Callbacks */
  onEvent?: (event: ClaudeCodeEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onComplete?: (result: ClaudeCodeResult) => void;
}

/**
 * React hook for streaming Claude Code execution
 *
 * @example
 * ```tsx
 * function AgentViewer({ runId }: { runId: string }) {
 *   const {
 *     isRunning,
 *     text,
 *     currentTool,
 *     toolCalls,
 *     result,
 *     error,
 *   } = useClaudeCodeStream({
 *     url: '/api/workflows/stream',
 *     runId,
 *   });
 *
 *   return (
 *     <div>
 *       {isRunning && <Spinner />}
 *       <pre>{text}</pre>
 *       {currentTool && (
 *         <div>Running: {currentTool.name}</div>
 *       )}
 *       {toolCalls.map(tc => (
 *         <ToolCallCard key={tc.id} {...tc} />
 *       ))}
 *       {error && <ErrorBanner>{error}</ErrorBanner>}
 *       {result && <ResultCard result={result} />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useClaudeCodeStream(
  options: UseClaudeCodeStreamOptions,
): UseClaudeCodeStreamState & {
  connect: () => void;
  disconnect: () => void;
} {
  const {
    url,
    runId,
    autoConnect = true,
    autoReconnect = true,
    maxReconnectAttempts = 5,
    reconnectDelay = DEFAULT_RECONNECT_DELAY_MS,
    keepEventHistory = false,
    maxEventHistory = DEFAULT_MAX_EVENT_HISTORY,
    onEvent,
    onConnect,
    onDisconnect,
    onError,
    onComplete,
  } = options;

  const [state, setState] = useState<UseClaudeCodeStreamState>({
    isConnected: false,
    isRunning: false,
    currentIteration: 0,
    maxIterations: 20,
    text: "",
    currentTool: null,
    toolCalls: [],
    allToolCalls: [],
    result: null,
    error: null,
    events: [],
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);

  // Process incoming event
  const processEvent = useCallback(
    (event: ClaudeCodeEvent) => {
      onEvent?.(event);

      setState((prev) => {
        const newState = { ...prev };

        // Keep event history if enabled
        if (keepEventHistory) {
          newState.events = [...prev.events, event].slice(-maxEventHistory);
        }

        switch (event.type) {
          case "iteration_start":
            newState.isRunning = true;
            newState.currentIteration = event.iteration;
            newState.maxIterations = event.maxIterations;
            newState.toolCalls = [];
            newState.currentTool = null;
            break;

          case "text_delta":
            newState.text = prev.text + event.content;
            break;

          case "text_complete":
            newState.text = event.content;
            break;

          case "tool_call_start":
            newState.currentTool = {
              id: event.toolCallId,
              name: event.toolName,
              input: {},
            };
            break;

          case "tool_call_complete":
            newState.currentTool = null;
            newState.toolCalls = [
              ...prev.toolCalls,
              {
                id: event.toolCallId,
                name: event.toolName,
                input: event.input,
              },
            ];
            break;

          case "tool_result":
            // Update the tool call with its result
            newState.toolCalls = prev.toolCalls.map((tc) =>
              tc.id === event.toolCallId
                ? { ...tc, output: event.output, isError: event.isError }
                : tc
            );
            // Add to all tool calls
            newState.allToolCalls = [
              ...prev.allToolCalls,
              {
                iteration: event.iteration || prev.currentIteration,
                id: event.toolCallId,
                name: event.toolName,
                input: prev.toolCalls.find((tc) => tc.id === event.toolCallId)?.input || {},
                output: event.output,
                isError: event.isError,
              },
            ];
            break;

          case "iteration_complete":
            newState.currentTool = null;
            break;

          case "complete":
            newState.isRunning = false;
            newState.result = event.result;
            newState.currentTool = null;
            onComplete?.(event.result);
            break;

          case "error":
            newState.error = event.message;
            if (!event.recoverable) {
              newState.isRunning = false;
            }
            break;
        }

        return newState;
      });
    },
    [onEvent, onComplete, keepEventHistory, maxEventHistory],
  );

  // Connect to SSE stream
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const streamUrl = `${url}?runId=${encodeURIComponent(runId)}`;
    const eventSource = new EventSource(streamUrl);

    eventSource.onopen = () => {
      setState((prev) => ({ ...prev, isConnected: true }));
      reconnectAttemptsRef.current = 0;
      onConnect?.();
    };

    eventSource.onmessage = (e) => {
      try {
        const parsed: unknown = JSON.parse(e.data);
        if (!parsed || typeof parsed !== "object") return;
        const event = parsed as ClaudeCodeEvent;
        processEvent(event);
      } catch (error) {
        console.error("[useClaudeCodeStream] Failed to parse event:", error);
      }
    };

    eventSource.onerror = () => {
      setState((prev) => ({ ...prev, isConnected: false }));
      onDisconnect?.();

      // Attempt reconnect
      if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current++;
        reconnectTimeoutRef.current = globalThis.setTimeout(() => {
          connect();
        }, reconnectDelay * reconnectAttemptsRef.current);
      } else {
        onError?.(REQUEST_ERROR.create({ detail: "Connection failed" }));
      }
    };

    eventSourceRef.current = eventSource;
  }, [
    url,
    runId,
    processEvent,
    autoReconnect,
    maxReconnectAttempts,
    reconnectDelay,
    onConnect,
    onDisconnect,
    onError,
  ]);

  // Disconnect from stream
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setState((prev) => ({ ...prev, isConnected: false }));
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    ...state,
    connect,
    disconnect,
  };
}

/**
 * Simplified hook that returns just the streaming text
 */
export function useClaudeCodeText(
  options: Omit<UseClaudeCodeStreamOptions, "keepEventHistory" | "maxEventHistory">,
): {
  text: string;
  isRunning: boolean;
  error: string | null;
} {
  const { text, isRunning, error } = useClaudeCodeStream(options);
  return { text, isRunning, error };
}
