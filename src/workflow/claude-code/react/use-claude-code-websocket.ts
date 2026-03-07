/**
 * React Hook for Claude Code WebSocket (Bidirectional)
 *
 * Provides real-time bidirectional communication with Claude Code agents.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApprovalRequestEvent,
  CancelCommand,
  ClaudeCodeEventExtended,
  ClaudeCodeResult,
  InputRequestEvent,
} from "../types.ts";

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
export interface UseClaudeCodeWebSocketState {
  /** Whether currently connected */
  isConnected: boolean;

  /** Whether agent is currently executing */
  isRunning: boolean;

  /** Whether agent was cancelled */
  isCancelled: boolean;

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

  /** Pending approval requests */
  pendingApprovals: PendingApproval[];

  /** Pending input request (if any) */
  pendingInput: PendingInput | null;

  /** Final result (when complete) */
  result: ClaudeCodeResult | null;

  /** Error message (if any) */
  error: string | null;
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
    reconnectDelay = 1000,
    pingInterval = 30000,
    onEvent,
    onConnect,
    onDisconnect,
    onError,
    onComplete,
    onApprovalRequest,
    onInputRequest,
  } = options;

  const [state, setState] = useState<UseClaudeCodeWebSocketState>({
    isConnected: false,
    isRunning: false,
    isCancelled: false,
    currentIteration: 0,
    maxIterations: 20,
    text: "",
    currentTool: null,
    toolCalls: [],
    pendingApprovals: [],
    pendingInput: null,
    result: null,
    error: null,
  });

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);

  // Process incoming event
  const processEvent = useCallback(
    (event: ClaudeCodeEventExtended) => {
      onEvent?.(event);

      setState((prev) => {
        const newState = { ...prev };

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
            newState.toolCalls = prev.toolCalls.map((tc) =>
              tc.id === event.toolCallId
                ? { ...tc, output: event.output, isError: event.isError }
                : tc
            );
            break;

          case "iteration_complete":
            newState.currentTool = null;
            break;

          case "complete":
            newState.isRunning = false;
            newState.result = event.result;
            newState.currentTool = null;
            newState.pendingApprovals = [];
            newState.pendingInput = null;
            onComplete?.(event.result);
            break;

          case "error":
            newState.error = event.message;
            if (!event.recoverable) {
              newState.isRunning = false;
            }
            break;

          case "cancelled":
            newState.isRunning = false;
            newState.isCancelled = true;
            newState.pendingApprovals = [];
            newState.pendingInput = null;
            break;

          case "approval_request": {
            const approval: PendingApproval = {
              toolCallId: (event as ApprovalRequestEvent).toolCallId,
              toolName: (event as ApprovalRequestEvent).toolName,
              input: (event as ApprovalRequestEvent).input,
              reason: (event as ApprovalRequestEvent).reason,
              timeout: (event as ApprovalRequestEvent).timeout,
              requestedAt: Date.now(),
            };
            newState.pendingApprovals = [...prev.pendingApprovals, approval];
            onApprovalRequest?.(approval);
            break;
          }

          case "input_request": {
            const inputReq: PendingInput = {
              prompt: (event as InputRequestEvent).prompt,
              defaultValue: (event as InputRequestEvent).defaultValue,
              timeout: (event as InputRequestEvent).timeout,
              requestedAt: Date.now(),
            };
            newState.pendingInput = inputReq;
            onInputRequest?.(inputReq);
            break;
          }

          case "pong":
            // Keepalive response, no state change needed
            break;
        }

        return newState;
      });
    },
    [onEvent, onComplete, onApprovalRequest, onInputRequest],
  );

  // Send command to server
  const sendCommand = useCallback(
    (command: Record<string, unknown>) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.warn("[useClaudeCodeWebSocket] Socket not open");
        return;
      }

      socket.send(
        JSON.stringify({
          ...command,
          timestamp: Date.now(),
          runId,
        }),
      );
    },
    [runId],
  );

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
    }

    const wsUrl = `${url}?runId=${encodeURIComponent(runId)}`;
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      setState((prev) => ({ ...prev, isConnected: true }));
      reconnectAttemptsRef.current = 0;
      onConnect?.();

      // Start ping interval
      if (pingInterval > 0) {
        pingIntervalRef.current = globalThis.setInterval(() => {
          sendCommand({ type: "ping" });
        }, pingInterval);
      }
    };

    socket.onmessage = (e) => {
      try {
        const parsed: unknown = JSON.parse(e.data);
        if (!parsed || typeof parsed !== "object") return;
        const event = parsed as ClaudeCodeEventExtended;
        processEvent(event);
      } catch (error) {
        console.error("[useClaudeCodeWebSocket] Failed to parse event:", error);
      }
    };

    socket.onclose = () => {
      setState((prev) => ({ ...prev, isConnected: false }));
      onDisconnect?.();

      // Clear ping interval
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      // Attempt reconnect
      if (
        autoReconnect &&
        reconnectAttemptsRef.current < maxReconnectAttempts
      ) {
        reconnectAttemptsRef.current++;
        reconnectTimeoutRef.current = globalThis.setTimeout(() => {
          connect();
        }, reconnectDelay * reconnectAttemptsRef.current);
      } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
        onError?.(new Error("Connection failed after max retries"));
      }
    };

    socket.onerror = () => {
      onError?.(new Error("WebSocket error"));
    };

    socketRef.current = socket;
  }, [
    url,
    runId,
    processEvent,
    sendCommand,
    autoReconnect,
    maxReconnectAttempts,
    reconnectDelay,
    pingInterval,
    onConnect,
    onDisconnect,
    onError,
  ]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setState((prev) => ({ ...prev, isConnected: false }));
  }, []);

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
      sendCommand({ type: "approve", toolCallId });
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
      sendCommand({ type: "reject", toolCallId, reason });
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
      sendCommand({ type: "input", content });
      setState((prev) => ({ ...prev, pendingInput: null }));
    },
    [sendCommand],
  );

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
    cancel,
    approve,
    reject,
    sendInput,
  };
}
