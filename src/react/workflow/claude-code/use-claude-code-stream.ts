/**
 * React Hook for Claude Code Streaming
 *
 * Provides real-time streaming of Claude Code agent execution.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClaudeCodeEvent, ClaudeCodeResult } from "#veryfront/workflow/claude-code/types.ts";
import {
  type ClaudeCodeAllToolCall,
  type ClaudeCodeEventState,
  createClaudeCodeEventState,
  isClaudeCodeCoreEvent,
  reduceClaudeCodeEventState,
} from "./event-state-reducer.ts";
import { admitClaudeCodeEventMessage, MAX_CLAUDE_CODE_EVENT_HISTORY } from "./event-protocol.ts";
import { REQUEST_ERROR } from "#veryfront/errors/error-registry.ts";
import {
  boundedReconnectDelayMs,
  normalizeActiveTimerDelayMs,
  normalizeHistoryLimit,
  normalizeReconnectAttempts,
} from "../option-normalization.ts";

/** Default delay before reconnecting after disconnect */
const DEFAULT_RECONNECT_DELAY_MS = 1_000;

/** Default maximum number of events to retain in history */
const DEFAULT_MAX_EVENT_HISTORY = 100;

function createStreamState(): UseClaudeCodeStreamState {
  return {
    ...createClaudeCodeEventState(),
    isConnected: false,
    allToolCalls: [],
    events: [],
  };
}

function withRunId(url: string, runId: string): string {
  const hashIndex = url.indexOf("#");
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const queryIndex = base.indexOf("?");
  const path = queryIndex === -1 ? base : base.slice(0, queryIndex);
  const params = new URLSearchParams(queryIndex === -1 ? "" : base.slice(queryIndex + 1));
  params.set("runId", runId);
  return `${path}?${params.toString()}${hash}`;
}

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
  /** Connect the active run; no-op after its terminal event. Change runId for a new lifecycle. */
  connect: () => void;
  /** Disconnect the active transport without changing accumulated event state. */
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
  const normalizedMaxReconnectAttempts = normalizeReconnectAttempts(maxReconnectAttempts);
  const normalizedReconnectDelay = normalizeActiveTimerDelayMs(
    reconnectDelay,
    "reconnectDelay",
  );
  const normalizedMaxEventHistory = normalizeHistoryLimit(
    maxEventHistory,
    MAX_CLAUDE_CODE_EVENT_HISTORY,
  );

  const [state, setState] = useState<UseClaudeCodeStreamState>(createStreamState);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const intentionalStopRef = useRef(true);
  const terminalRef = useRef(false);
  const identityRef = useRef({ url, runId });
  const optionsRef = useRef({
    autoReconnect,
    maxReconnectAttempts: normalizedMaxReconnectAttempts,
    reconnectDelay: normalizedReconnectDelay,
    keepEventHistory,
    maxEventHistory: normalizedMaxEventHistory,
    onEvent,
    onConnect,
    onDisconnect,
    onError,
    onComplete,
  });
  const connectRef = useRef<(retry: boolean) => void>(() => {});

  useEffect(() => {
    optionsRef.current = {
      autoReconnect,
      maxReconnectAttempts: normalizedMaxReconnectAttempts,
      reconnectDelay: normalizedReconnectDelay,
      keepEventHistory,
      maxEventHistory: normalizedMaxEventHistory,
      onEvent,
      onConnect,
      onDisconnect,
      onError,
      onComplete,
    };
  }, [
    autoReconnect,
    keepEventHistory,
    normalizedMaxEventHistory,
    normalizedMaxReconnectAttempts,
    normalizedReconnectDelay,
    onComplete,
    onConnect,
    onDisconnect,
    onError,
    onEvent,
  ]);

  const clearReconnectTimer = useCallback((): void => {
    if (reconnectTimeoutRef.current === null) return;
    clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = null;
  }, []);

  useEffect(() => {
    if (!autoReconnect) clearReconnectTimer();
  }, [autoReconnect, clearReconnectTimer]);

  const ownsGeneration = useCallback((generation: number): boolean => {
    return mountedRef.current && !intentionalStopRef.current &&
      generationRef.current === generation;
  }, []);

  const ownsSource = useCallback((generation: number, source: EventSource): boolean => {
    return ownsGeneration(generation) && eventSourceRef.current === source;
  }, [ownsGeneration]);

  const reportError = useCallback((error: Error, stateMessage: string): void => {
    if (!mountedRef.current) return;
    setState((prev) => ({ ...prev, error: stateMessage }));
    try {
      optionsRef.current.onError?.(error);
    } catch {
      // Consumer callbacks cannot interrupt transport ownership or cleanup.
    }
  }, []);

  // Process incoming event
  const processEvent = useCallback(
    (event: ClaudeCodeEvent, generation: number, source: EventSource) => {
      if (!ownsSource(generation, source)) return;

      const currentOptions = optionsRef.current;
      const terminal = event.type === "complete" ||
        (event.type === "error" && !event.recoverable);
      if (terminal) {
        terminalRef.current = true;
        intentionalStopRef.current = true;
        generationRef.current += 1;
        clearReconnectTimer();
        if (eventSourceRef.current === source) eventSourceRef.current = null;
        source.onopen = null;
        source.onmessage = null;
        source.onerror = null;
        source.close();
      }

      try {
        currentOptions.onEvent?.(structuredClone(event));
      } catch (error) {
        const detail = "Claude Code onEvent callback failed";
        reportError(error instanceof Error ? error : new Error(String(error)), detail);
      }
      if (event.type === "complete") {
        try {
          currentOptions.onComplete?.(structuredClone(event.result));
        } catch (error) {
          const detail = "Claude Code onComplete callback failed";
          reportError(error instanceof Error ? error : new Error(String(error)), detail);
        }
      }

      setState((prev) => {
        const newState = reduceClaudeCodeEventState(prev, event, {
          keepEventHistory: currentOptions.keepEventHistory,
          maxEventHistory: currentOptions.maxEventHistory,
          trackAllToolCalls: true,
        });
        if (terminal) newState.isConnected = false;
        return newState;
      });
    },
    [clearReconnectTimer, ownsSource, reportError],
  );

  const stopTransport = useCallback((updateState: boolean): void => {
    intentionalStopRef.current = true;
    generationRef.current += 1;
    reconnectAttemptsRef.current = 0;
    clearReconnectTimer();

    const source = eventSourceRef.current;
    eventSourceRef.current = null;
    if (source) {
      source.onopen = null;
      source.onmessage = null;
      source.onerror = null;
      source.close();
    }

    if (updateState && mountedRef.current) {
      setState((prev) => ({ ...prev, isConnected: false }));
    }
  }, [clearReconnectTimer]);

  connectRef.current = (retry: boolean): void => {
    if (!mountedRef.current) return;
    if (!retry) {
      reconnectAttemptsRef.current = 0;
      terminalRef.current = false;
    }
    intentionalStopRef.current = false;
    clearReconnectTimer();

    const previousSource = eventSourceRef.current;
    eventSourceRef.current = null;
    if (previousSource) {
      previousSource.onopen = null;
      previousSource.onmessage = null;
      previousSource.onerror = null;
      previousSource.close();
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const identity = identityRef.current;
    const streamUrl = withRunId(identity.url, identity.runId);
    let eventSource: EventSource;
    try {
      eventSource = new EventSource(streamUrl);
    } catch {
      const detail = "Claude Code event stream could not be created";
      reportError(REQUEST_ERROR.create({ detail }), detail);
      return;
    }
    eventSourceRef.current = eventSource;
    setState((prev) => ({ ...prev, isConnected: false }));

    eventSource.onopen = () => {
      if (!ownsSource(generation, eventSource)) return;
      setState((prev) => ({ ...prev, isConnected: true }));
      try {
        optionsRef.current.onConnect?.();
      } catch (error) {
        const detail = "Claude Code onConnect callback failed";
        reportError(error instanceof Error ? error : new Error(String(error)), detail);
      }
    };

    eventSource.onmessage = (e) => {
      if (!ownsSource(generation, eventSource)) return;
      const admission = admitClaudeCodeEventMessage(e.data);
      if (!admission.ok || !isClaudeCodeCoreEvent(admission.event)) {
        const reason = admission.ok
          ? "event type is not allowed on this transport"
          : admission.reason;
        const detail = `Invalid Claude Code event: ${reason}`;
        reportError(REQUEST_ERROR.create({ detail }), detail);
        return;
      }
      if (admission.event.runId !== undefined && admission.event.runId !== identity.runId) {
        const detail = "Invalid Claude Code event: runId does not match the active stream";
        reportError(REQUEST_ERROR.create({ detail }), detail);
        return;
      }
      processEvent(admission.event, generation, eventSource);
    };

    eventSource.onerror = () => {
      if (!ownsSource(generation, eventSource)) return;
      eventSource.onopen = null;
      eventSource.onmessage = null;
      eventSource.onerror = null;
      eventSourceRef.current = null;
      eventSource.close();
      setState((prev) => ({ ...prev, isConnected: false }));
      try {
        optionsRef.current.onDisconnect?.();
      } catch (error) {
        const detail = "Claude Code onDisconnect callback failed";
        reportError(error instanceof Error ? error : new Error(String(error)), detail);
      }

      // Attempt reconnect
      const currentOptions = optionsRef.current;
      if (
        !terminalRef.current &&
        currentOptions.autoReconnect &&
        reconnectAttemptsRef.current < currentOptions.maxReconnectAttempts &&
        reconnectTimeoutRef.current === null
      ) {
        reconnectAttemptsRef.current++;
        reconnectTimeoutRef.current = globalThis.setTimeout(
          () => {
            reconnectTimeoutRef.current = null;
            if (ownsGeneration(generation) && optionsRef.current.autoReconnect) {
              connectRef.current(true);
            }
          },
          boundedReconnectDelayMs(
            currentOptions.reconnectDelay,
            reconnectAttemptsRef.current,
          ),
        );
      } else {
        const detail = "Claude Code event stream connection failed";
        reportError(REQUEST_ERROR.create({ detail }), detail);
      }
    };
  };

  // Connect to SSE stream
  const connect = useCallback((): void => {
    if (
      !mountedRef.current || terminalRef.current || identityRef.current.url !== url ||
      identityRef.current.runId !== runId
    ) return;
    connectRef.current(false);
  }, [runId, url]);

  // Disconnect from stream
  const disconnect = useCallback(() => {
    if (identityRef.current.url !== url || identityRef.current.runId !== runId) return;
    stopTransport(true);
  }, [runId, stopTransport, url]);

  // Reset transport and state only when the stream identity changes.
  useEffect(() => {
    mountedRef.current = true;
    identityRef.current = { url, runId };
    terminalRef.current = false;
    reconnectAttemptsRef.current = 0;
    setState(createStreamState());

    return () => {
      mountedRef.current = false;
      stopTransport(false);
    };
  }, [runId, stopTransport, url]);

  useEffect(() => {
    if (identityRef.current.url !== url || identityRef.current.runId !== runId) return;
    if (autoConnect && !terminalRef.current) {
      if (!eventSourceRef.current && intentionalStopRef.current) connectRef.current(false);
    } else {
      stopTransport(true);
    }
  }, [autoConnect, runId, stopTransport, url]);

  const ownsRenderedIdentity = mountedRef.current && identityRef.current.url === url &&
    identityRef.current.runId === runId;
  return {
    ...(ownsRenderedIdentity ? state : createStreamState()),
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
