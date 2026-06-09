/**
 * React Hook for Claude Code Streaming
 *
 * Provides real-time streaming of Claude Code agent execution.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClaudeCodeEvent, ClaudeCodeResult } from "../types.ts";
import {
  type ClaudeCodeAllToolCall,
  type ClaudeCodeEventState,
  createClaudeCodeEventState,
  reduceClaudeCodeEventState,
} from "./event-state-reducer.ts";
import { REQUEST_ERROR } from "#veryfront/errors";

/** Default delay before reconnecting after disconnect */
const DEFAULT_RECONNECT_DELAY_MS = 1_000;

/** Default maximum number of events to retain in history */
const DEFAULT_MAX_EVENT_HISTORY = 100;

/**
 * State for Claude Code streaming
 */
export interface UseClaudeCodeStreamState extends ClaudeCodeEventState {
  /** Whether currently connected to stream */
  isConnected: boolean;

  /** All tool calls across all iterations */
  allToolCalls: ClaudeCodeAllToolCall[];

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
    ...createClaudeCodeEventState(),
    isConnected: false,
    allToolCalls: [],
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
        const newState = reduceClaudeCodeEventState(prev, event, {
          keepEventHistory,
          maxEventHistory,
          trackAllToolCalls: true,
        });

        if (event.type === "complete") {
          onComplete?.(event.result);
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
