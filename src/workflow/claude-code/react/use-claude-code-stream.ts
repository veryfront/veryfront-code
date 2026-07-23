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
import { REQUEST_ERROR } from "#veryfront/errors/error-registry/server.ts";
import { type GenerationTimeout, invokeLifecycleCallback } from "./connection-lifecycle.ts";

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

function createStreamState(): UseClaudeCodeStreamState {
  return {
    ...createClaudeCodeEventState(),
    isConnected: false,
    allToolCalls: [],
    events: [],
  };
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

  const [state, setState] = useState<UseClaudeCodeStreamState>(createStreamState);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<GenerationTimeout | null>(null);
  const connectionGenerationRef = useRef(0);
  const shouldConnectRef = useRef(false);
  const connectionIdentity = JSON.stringify([url, runId]);
  const connectionIdentityRef = useRef(connectionIdentity);
  const startConnectionRef = useRef<(fresh: boolean) => void>(() => {});
  const callbacksRef = useRef({ onEvent, onConnect, onDisconnect, onError, onComplete });
  callbacksRef.current = { onEvent, onConnect, onDisconnect, onError, onComplete };

  const clearReconnectTimeout = useCallback(() => {
    const timeout = reconnectTimeoutRef.current;
    reconnectTimeoutRef.current = null;
    if (timeout) globalThis.clearTimeout(timeout.handle);
  }, []);

  // Process incoming event
  const processEvent = useCallback(
    (event: ClaudeCodeEvent, generation: number) => {
      setState((prev) => {
        if (connectionGenerationRef.current !== generation) return prev;
        const newState = reduceClaudeCodeEventState(prev, event, {
          keepEventHistory,
          maxEventHistory,
          trackAllToolCalls: true,
        });
        return newState;
      });

      const callbacks = callbacksRef.current;
      invokeLifecycleCallback("useClaudeCodeStream.onEvent", callbacks.onEvent, event);
      if (event.type === "complete") {
        invokeLifecycleCallback(
          "useClaudeCodeStream.onComplete",
          callbacks.onComplete,
          event.result,
        );
      }
    },
    [keepEventHistory, maxEventHistory],
  );

  // Connect to SSE stream
  const startConnection = useCallback((fresh: boolean) => {
    shouldConnectRef.current = true;
    if (fresh) reconnectAttemptsRef.current = 0;
    const generation = ++connectionGenerationRef.current;

    clearReconnectTimeout();

    const previousSource = eventSourceRef.current;
    if (previousSource) {
      previousSource.onopen = null;
      previousSource.onmessage = null;
      previousSource.onerror = null;
      previousSource.close();
    }
    setState((prev) => ({ ...prev, isConnected: false }));

    const streamUrl = `${url}?runId=${encodeURIComponent(runId)}`;
    const eventSource = new EventSource(streamUrl);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      if (
        connectionGenerationRef.current !== generation ||
        eventSourceRef.current !== eventSource ||
        !shouldConnectRef.current
      ) {
        eventSource.close();
        return;
      }
      setState((prev) => ({ ...prev, isConnected: true }));
      reconnectAttemptsRef.current = 0;
      invokeLifecycleCallback(
        "useClaudeCodeStream.onConnect",
        callbacksRef.current.onConnect,
      );
    };

    eventSource.onmessage = (e) => {
      if (
        connectionGenerationRef.current !== generation ||
        eventSourceRef.current !== eventSource
      ) return;
      try {
        const parsed: unknown = JSON.parse(e.data);
        if (!parsed || typeof parsed !== "object") return;
        const event = parsed as ClaudeCodeEvent;
        processEvent(event, generation);
      } catch (error) {
        console.error("[useClaudeCodeStream] Failed to parse event:", error);
      }
    };

    eventSource.onerror = () => {
      if (
        connectionGenerationRef.current !== generation ||
        eventSourceRef.current !== eventSource ||
        !shouldConnectRef.current
      ) return;
      eventSourceRef.current = null;
      eventSource.onopen = null;
      eventSource.onmessage = null;
      eventSource.onerror = null;
      eventSource.close();
      setState((prev) => ({ ...prev, isConnected: false }));

      // Attempt reconnect
      let terminalError = false;
      if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current++;
        const timeout: GenerationTimeout = {
          generation,
          handle: 0,
        };
        timeout.handle = globalThis.setTimeout(() => {
          if (reconnectTimeoutRef.current !== timeout) return;
          reconnectTimeoutRef.current = null;
          if (
            !shouldConnectRef.current ||
            connectionGenerationRef.current !== generation
          ) return;
          startConnectionRef.current(false);
        }, reconnectDelay * reconnectAttemptsRef.current);
        reconnectTimeoutRef.current = timeout;
      } else {
        terminalError = true;
      }

      invokeLifecycleCallback(
        "useClaudeCodeStream.onDisconnect",
        callbacksRef.current.onDisconnect,
      );
      if (terminalError) {
        invokeLifecycleCallback(
          "useClaudeCodeStream.onError",
          callbacksRef.current.onError,
          REQUEST_ERROR.create({ detail: "Connection failed" }),
        );
      }
    };
  }, [
    url,
    runId,
    processEvent,
    autoReconnect,
    maxReconnectAttempts,
    reconnectDelay,
    clearReconnectTimeout,
  ]);
  startConnectionRef.current = startConnection;

  const connect = useCallback(() => {
    startConnectionRef.current(true);
  }, []);

  // Disconnect from stream
  const disconnect = useCallback(() => {
    shouldConnectRef.current = false;
    connectionGenerationRef.current++;
    clearReconnectTimeout();
    const eventSource = eventSourceRef.current;
    eventSourceRef.current = null;
    if (eventSource) {
      eventSource.onopen = null;
      eventSource.onmessage = null;
      eventSource.onerror = null;
      eventSource.close();
      invokeLifecycleCallback(
        "useClaudeCodeStream.onDisconnect",
        callbacksRef.current.onDisconnect,
      );
    }
    setState((prev) => ({ ...prev, isConnected: false }));
  }, [clearReconnectTimeout]);

  // Auto-connect on mount
  useEffect(() => {
    if (connectionIdentityRef.current !== connectionIdentity) {
      connectionIdentityRef.current = connectionIdentity;
      reconnectAttemptsRef.current = 0;
      setState(createStreamState());
    }

    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, connectionIdentity, disconnect, startConnection]);

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
