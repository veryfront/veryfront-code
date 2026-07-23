/**
 * React Hook for Claude Code WebSocket (Bidirectional)
 *
 * Provides real-time bidirectional communication with Claude Code agents.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CancelCommand, ClaudeCodeEventExtended, ClaudeCodeResult } from "../types.ts";
import {
  type ClaudeCodeEventState,
  createClaudeCodeEventState,
  isClaudeCodeCoreEvent,
  reduceClaudeCodeEventState,
} from "./event-state-reducer.ts";
import { NETWORK_ERROR, REQUEST_ERROR } from "#veryfront/errors/error-registry/server.ts";
import {
  type GenerationInterval,
  type GenerationTimeout,
  invokeLifecycleCallback,
} from "./connection-lifecycle.ts";

/** Default delay before reconnecting after disconnect */
const DEFAULT_RECONNECT_DELAY_MS = 1_000;

/** Default interval for WebSocket ping messages */
const DEFAULT_PING_INTERVAL_MS = 30_000;

const SOCKET_OPEN = 1;

/**
 * Pending approval state
 */
export interface PendingApproval {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
  timeout?: number;
  requestedAt: number;
}

/**
 * Pending input request state
 */
export interface PendingInput {
  prompt: string;
  defaultValue?: string;
  timeout?: number;
  requestedAt: number;
}

/**
 * State for Claude Code WebSocket
 */
export interface UseClaudeCodeWebSocketState extends ClaudeCodeEventState {
  /** Whether currently connected */
  isConnected: boolean;

  /** Whether agent was cancelled */
  isCancelled: boolean;

  /** Pending approval requests */
  pendingApprovals: PendingApproval[];

  /** Pending input request (if any) */
  pendingInput: PendingInput | null;
}

/**
 * Options for useClaudeCodeWebSocket hook
 */
export interface UseClaudeCodeWebSocketOptions {
  /** WebSocket endpoint URL */
  url: string;

  /** Run ID to connect to */
  runId: string;

  /** Auto-connect on mount */
  autoConnect?: boolean;

  /** Reconnect on disconnect */
  autoReconnect?: boolean;

  /** Max reconnect attempts */
  maxReconnectAttempts?: number;

  /** Reconnect delay (ms) */
  reconnectDelay?: number;

  /** Ping interval (ms) */
  pingInterval?: number;

  /** Callbacks */
  onEvent?: (event: ClaudeCodeEventExtended) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onComplete?: (result: ClaudeCodeResult) => void;
  onApprovalRequest?: (approval: PendingApproval) => void;
  onInputRequest?: (input: PendingInput) => void;
}

/**
 * Actions returned by the hook
 */
export interface UseClaudeCodeWebSocketActions {
  /** Connect to WebSocket */
  connect: () => void;

  /** Disconnect from WebSocket */
  disconnect: () => void;

  /** Cancel the agent execution */
  cancel: (reason?: string) => void;

  /** Approve a pending tool call */
  approve: (toolCallId: string) => void;

  /** Reject a pending tool call */
  reject: (toolCallId: string, reason?: string) => void;

  /** Send user input */
  sendInput: (content: string) => void;
}

function createWebSocketState(): UseClaudeCodeWebSocketState {
  return {
    ...createClaudeCodeEventState(),
    isConnected: false,
    isCancelled: false,
    pendingApprovals: [],
    pendingInput: null,
  };
}

/**
 * React hook for bidirectional Claude Code streaming
 *
 * @example
 * ```tsx
 * function AgentController({ runId }: { runId: string }) {
 *   const {
 *     isRunning,
 *     text,
 *     pendingApprovals,
 *     cancel,
 *     approve,
 *     reject,
 *   } = useClaudeCodeWebSocket({
 *     url: '/api/workflows/ws',
 *     runId,
 *   });
 *
 *   return (
 *     <div>
 *       <pre>{text}</pre>
 *
 *       {pendingApprovals.map(pa => (
 *         <div key={pa.toolCallId}>
 *           <p>Approve {pa.toolName}?</p>
 *           <pre>{JSON.stringify(pa.input, null, 2)}</pre>
 *           <button onClick={() => approve(pa.toolCallId)}>Approve</button>
 *           <button onClick={() => reject(pa.toolCallId)}>Reject</button>
 *         </div>
 *       ))}
 *
 *       {isRunning && (
 *         <button onClick={() => cancel()}>Cancel</button>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useClaudeCodeWebSocket(
  options: UseClaudeCodeWebSocketOptions,
): UseClaudeCodeWebSocketState & UseClaudeCodeWebSocketActions {
  const {
    url,
    runId,
    autoConnect = true,
    autoReconnect = true,
    maxReconnectAttempts = 5,
    reconnectDelay = DEFAULT_RECONNECT_DELAY_MS,
    pingInterval = DEFAULT_PING_INTERVAL_MS,
    onEvent,
    onConnect,
    onDisconnect,
    onError,
    onComplete,
    onApprovalRequest,
    onInputRequest,
  } = options;

  const [state, setState] = useState<UseClaudeCodeWebSocketState>(createWebSocketState);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<GenerationTimeout | null>(null);
  const pingIntervalRef = useRef<GenerationInterval | null>(null);
  const connectionGenerationRef = useRef(0);
  const shouldConnectRef = useRef(false);
  const connectionIdentity = JSON.stringify([url, runId]);
  const connectionIdentityRef = useRef(connectionIdentity);
  const startConnectionRef = useRef<(fresh: boolean) => void>(() => {});
  const callbacksRef = useRef({
    onEvent,
    onConnect,
    onDisconnect,
    onError,
    onComplete,
    onApprovalRequest,
    onInputRequest,
  });
  callbacksRef.current = {
    onEvent,
    onConnect,
    onDisconnect,
    onError,
    onComplete,
    onApprovalRequest,
    onInputRequest,
  };

  const clearReconnectTimeout = useCallback(() => {
    const timeout = reconnectTimeoutRef.current;
    reconnectTimeoutRef.current = null;
    if (timeout) globalThis.clearTimeout(timeout.handle);
  }, []);

  const clearPingInterval = useCallback(() => {
    const interval = pingIntervalRef.current;
    pingIntervalRef.current = null;
    if (interval) globalThis.clearInterval(interval.handle);
  }, []);

  // Process incoming event
  const processEvent = useCallback((event: ClaudeCodeEventExtended, generation: number) => {
    let approval: PendingApproval | undefined;
    let inputRequest: PendingInput | undefined;
    if (event.type === "approval_request") {
      approval = {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input,
        reason: event.reason,
        timeout: event.timeout,
        requestedAt: Date.now(),
      };
    } else if (event.type === "input_request") {
      inputRequest = {
        prompt: event.prompt,
        defaultValue: event.defaultValue,
        timeout: event.timeout,
        requestedAt: Date.now(),
      };
    }

    setState((prev) => {
      if (connectionGenerationRef.current !== generation) return prev;
      const newState = isClaudeCodeCoreEvent(event)
        ? reduceClaudeCodeEventState(prev, event)
        : { ...prev };

      switch (event.type) {
        case "complete":
          newState.pendingApprovals = [];
          newState.pendingInput = null;
          break;

        case "cancelled":
          newState.isRunning = false;
          newState.isCancelled = true;
          newState.pendingApprovals = [];
          newState.pendingInput = null;
          break;

        case "approval_request":
          if (approval) {
            newState.pendingApprovals = [...prev.pendingApprovals, approval];
          }
          break;

        case "input_request":
          if (inputRequest) {
            newState.pendingInput = inputRequest;
          }
          break;

        case "pong":
          // Keepalive response, no state change needed
          break;
      }

      return newState;
    });

    const callbacks = callbacksRef.current;
    invokeLifecycleCallback("useClaudeCodeWebSocket.onEvent", callbacks.onEvent, event);
    if (event.type === "complete") {
      invokeLifecycleCallback(
        "useClaudeCodeWebSocket.onComplete",
        callbacks.onComplete,
        event.result,
      );
    }
    if (approval) {
      invokeLifecycleCallback(
        "useClaudeCodeWebSocket.onApprovalRequest",
        callbacks.onApprovalRequest,
        approval,
      );
    }
    if (inputRequest) {
      invokeLifecycleCallback(
        "useClaudeCodeWebSocket.onInputRequest",
        callbacks.onInputRequest,
        inputRequest,
      );
    }
  }, []);

  // Send command to server
  const sendCommand = useCallback(
    (command: Record<string, unknown>): boolean => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== SOCKET_OPEN) {
        console.warn("[useClaudeCodeWebSocket] Socket not open");
        return false;
      }

      try {
        socket.send(
          JSON.stringify({
            ...command,
            timestamp: Date.now(),
            runId,
          }),
        );
        return true;
      } catch {
        invokeLifecycleCallback(
          "useClaudeCodeWebSocket.onError",
          callbacksRef.current.onError,
          NETWORK_ERROR.create({ detail: "WebSocket send failed" }),
        );
        return false;
      }
    },
    [runId],
  );

  // Connect to WebSocket
  const startConnection = useCallback((fresh: boolean) => {
    shouldConnectRef.current = true;
    if (fresh) reconnectAttemptsRef.current = 0;
    const generation = ++connectionGenerationRef.current;

    clearReconnectTimeout();
    clearPingInterval();

    const previousSocket = socketRef.current;
    if (previousSocket) {
      previousSocket.onopen = null;
      previousSocket.onmessage = null;
      previousSocket.onclose = null;
      previousSocket.onerror = null;
      previousSocket.close();
    }
    setState((prev) => ({ ...prev, isConnected: false }));

    const wsUrl = `${url}?runId=${encodeURIComponent(runId)}`;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      if (
        connectionGenerationRef.current !== generation ||
        socketRef.current !== socket ||
        !shouldConnectRef.current
      ) {
        socket.close();
        return;
      }
      setState((prev) => ({ ...prev, isConnected: true }));
      reconnectAttemptsRef.current = 0;

      // Start ping interval
      if (pingInterval > 0) {
        const interval: GenerationInterval = {
          generation,
          handle: globalThis.setInterval(() => {
            if (
              pingIntervalRef.current !== interval ||
              connectionGenerationRef.current !== generation ||
              socketRef.current !== socket ||
              socket.readyState !== SOCKET_OPEN
            ) return;
            try {
              socket.send(JSON.stringify({
                type: "ping",
                timestamp: Date.now(),
                runId,
              }));
            } catch {
              clearPingInterval();
            }
          }, pingInterval),
        };
        pingIntervalRef.current = interval;
      }

      invokeLifecycleCallback(
        "useClaudeCodeWebSocket.onConnect",
        callbacksRef.current.onConnect,
      );
    };

    socket.onmessage = (e) => {
      if (
        connectionGenerationRef.current !== generation ||
        socketRef.current !== socket
      ) return;
      try {
        const parsed: unknown = JSON.parse(e.data);
        if (!parsed || typeof parsed !== "object") return;
        const event = parsed as ClaudeCodeEventExtended;
        processEvent(event, generation);
      } catch (error) {
        console.error("[useClaudeCodeWebSocket] Failed to parse event:", error);
      }
    };

    socket.onclose = () => {
      if (
        connectionGenerationRef.current !== generation ||
        socketRef.current !== socket
      ) return;
      socketRef.current = null;
      setState((prev) => ({ ...prev, isConnected: false }));

      // Clear ping interval
      clearPingInterval();

      // Attempt reconnect
      let terminalError = false;
      if (
        shouldConnectRef.current &&
        autoReconnect &&
        reconnectAttemptsRef.current < maxReconnectAttempts
      ) {
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
      } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
        terminalError = true;
      }

      invokeLifecycleCallback(
        "useClaudeCodeWebSocket.onDisconnect",
        callbacksRef.current.onDisconnect,
      );
      if (terminalError) {
        invokeLifecycleCallback(
          "useClaudeCodeWebSocket.onError",
          callbacksRef.current.onError,
          REQUEST_ERROR.create({ detail: "Connection failed after max retries" }),
        );
      }
    };

    socket.onerror = () => {
      if (
        connectionGenerationRef.current !== generation ||
        socketRef.current !== socket
      ) return;
      invokeLifecycleCallback(
        "useClaudeCodeWebSocket.onError",
        callbacksRef.current.onError,
        NETWORK_ERROR.create({ detail: "WebSocket error" }),
      );
    };
  }, [
    url,
    runId,
    processEvent,
    autoReconnect,
    maxReconnectAttempts,
    reconnectDelay,
    pingInterval,
    clearPingInterval,
    clearReconnectTimeout,
  ]);
  startConnectionRef.current = startConnection;

  const connect = useCallback(() => {
    startConnectionRef.current(true);
  }, []);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    shouldConnectRef.current = false;
    connectionGenerationRef.current++;
    clearReconnectTimeout();
    clearPingInterval();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
      invokeLifecycleCallback(
        "useClaudeCodeWebSocket.onDisconnect",
        callbacksRef.current.onDisconnect,
      );
    }
    setState((prev) => ({ ...prev, isConnected: false }));
  }, [clearPingInterval, clearReconnectTimeout]);

  // Cancel agent execution
  const cancel = useCallback(
    (reason?: string) => {
      const command: Omit<CancelCommand, "timestamp" | "runId"> = {
        type: "cancel",
        reason,
      };
      sendCommand(command);
    },
    [sendCommand],
  );

  // Approve a tool call
  const approve = useCallback(
    (toolCallId: string) => {
      if (!sendCommand({ type: "approve", toolCallId })) return;
      setState((prev) => ({
        ...prev,
        pendingApprovals: prev.pendingApprovals.filter(
          (pa) => pa.toolCallId !== toolCallId,
        ),
      }));
    },
    [sendCommand],
  );

  // Reject a tool call
  const reject = useCallback(
    (toolCallId: string, reason?: string) => {
      if (!sendCommand({ type: "reject", toolCallId, reason })) return;
      setState((prev) => ({
        ...prev,
        pendingApprovals: prev.pendingApprovals.filter(
          (pa) => pa.toolCallId !== toolCallId,
        ),
      }));
    },
    [sendCommand],
  );

  // Send user input
  const sendInput = useCallback(
    (content: string) => {
      if (!sendCommand({ type: "input", content })) return;
      setState((prev) => ({ ...prev, pendingInput: null }));
    },
    [sendCommand],
  );

  // Auto-connect on mount
  useEffect(() => {
    if (connectionIdentityRef.current !== connectionIdentity) {
      connectionIdentityRef.current = connectionIdentity;
      reconnectAttemptsRef.current = 0;
      setState(createWebSocketState());
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
    cancel,
    approve,
    reject,
    sendInput,
  };
}
