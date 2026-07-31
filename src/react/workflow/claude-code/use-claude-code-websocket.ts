/**
 * React Hook for Claude Code WebSocket (Bidirectional)
 *
 * Provides real-time bidirectional communication with Claude Code agents.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClaudeCodeEventExtended,
  ClaudeCodeResult,
  ClientCommandType,
} from "#veryfront/workflow/claude-code/types.ts";
import {
  type ClaudeCodeEventState,
  createClaudeCodeEventState,
  isClaudeCodeCoreEvent,
  reduceClaudeCodeEventState,
} from "./event-state-reducer.ts";
import { admitClaudeCodeEventMessage, MAX_CLAUDE_CODE_FIELD_LENGTH } from "./event-protocol.ts";
import { NETWORK_ERROR, REQUEST_ERROR } from "#veryfront/errors/error-registry.ts";
import {
  boundedReconnectDelayMs,
  normalizeActiveTimerDelayMs,
  normalizePingIntervalMs,
  normalizeReconnectAttempts,
} from "../option-normalization.ts";

/** Default delay before reconnecting after disconnect */
const DEFAULT_RECONNECT_DELAY_MS = 1_000;

/** Default interval for WebSocket ping messages */
const DEFAULT_PING_INTERVAL_MS = 30_000;

const MAX_CLAUDE_CODE_PENDING_INTERACTIONS = 1_000;
const MAX_CLAUDE_CODE_PENDING_COMMANDS = 1_000;

type KeyedCommandType = Exclude<ClientCommandType, "ping">;

interface PendingCommand {
  commandId: string;
  commandType: KeyedCommandType;
  serialized: string;
  toolCallId?: string;
  requestId?: string;
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
  requestId?: string;
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
  const normalizedMaxReconnectAttempts = normalizeReconnectAttempts(maxReconnectAttempts);
  const normalizedReconnectDelay = normalizeActiveTimerDelayMs(
    reconnectDelay,
    "reconnectDelay",
  );
  const normalizedPingInterval = normalizePingIntervalMs(pingInterval);

  const [state, setState] = useState<UseClaudeCodeWebSocketState>(createWebSocketState);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const intentionalStopRef = useRef(true);
  const terminalRef = useRef(false);
  const identityRef = useRef({ url, runId });
  const pendingCommandsRef = useRef<Map<string, PendingCommand>>(new Map());
  const commandSequenceRef = useRef(0);
  const deliveryErrorRef = useRef<string | null>(null);
  const optionsRef = useRef({
    autoReconnect,
    maxReconnectAttempts: normalizedMaxReconnectAttempts,
    reconnectDelay: normalizedReconnectDelay,
    pingInterval: normalizedPingInterval,
    onEvent,
    onConnect,
    onDisconnect,
    onError,
    onComplete,
    onApprovalRequest,
    onInputRequest,
  });
  const connectRef = useRef<(retry: boolean) => void>(() => {});

  useEffect(() => {
    optionsRef.current = {
      autoReconnect,
      maxReconnectAttempts: normalizedMaxReconnectAttempts,
      reconnectDelay: normalizedReconnectDelay,
      pingInterval: normalizedPingInterval,
      onEvent,
      onConnect,
      onDisconnect,
      onError,
      onComplete,
      onApprovalRequest,
      onInputRequest,
    };
  }, [
    autoReconnect,
    normalizedMaxReconnectAttempts,
    normalizedPingInterval,
    normalizedReconnectDelay,
    onApprovalRequest,
    onComplete,
    onConnect,
    onDisconnect,
    onError,
    onEvent,
    onInputRequest,
  ]);

  const clearReconnectTimer = useCallback((): void => {
    if (reconnectTimeoutRef.current === null) return;
    clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = null;
  }, []);

  const clearPingInterval = useCallback((): void => {
    if (pingIntervalRef.current === null) return;
    clearInterval(pingIntervalRef.current);
    pingIntervalRef.current = null;
  }, []);

  useEffect(() => {
    if (!autoReconnect) clearReconnectTimer();
  }, [autoReconnect, clearReconnectTimer]);

  const ownsGeneration = useCallback((generation: number): boolean => {
    return mountedRef.current && !intentionalStopRef.current &&
      generationRef.current === generation;
  }, []);

  const ownsSocket = useCallback((generation: number, socket: WebSocket): boolean => {
    return ownsGeneration(generation) && socketRef.current === socket;
  }, [ownsGeneration]);

  const reportError = useCallback((error: Error, stateMessage: string): void => {
    if (!mountedRef.current) return;
    deliveryErrorRef.current = null;
    setState((prev) => ({ ...prev, error: stateMessage }));
    try {
      optionsRef.current.onError?.(error);
    } catch {
      // Consumer callbacks cannot interrupt transport ownership or cleanup.
    }
  }, []);

  const reportDeliveryError = useCallback((detail: string): void => {
    if (!mountedRef.current) return;
    deliveryErrorRef.current = detail;
    setState((prev) => ({ ...prev, error: detail }));
    try {
      optionsRef.current.onError?.(REQUEST_ERROR.create({ detail }));
    } catch {
      // Consumer callbacks cannot interrupt transport ownership or cleanup.
    }
  }, []);

  const recoverDeliveryError = useCallback((): void => {
    const deliveryError = deliveryErrorRef.current;
    if (deliveryError === null) return;
    deliveryErrorRef.current = null;
    setState((prev) => prev.error === deliveryError ? { ...prev, error: null } : prev);
  }, []);

  // Process incoming event
  const processEvent = useCallback(
    (event: ClaudeCodeEventExtended, generation: number, socket: WebSocket) => {
      if (!ownsSocket(generation, socket)) return;

      const callbacks = optionsRef.current;
      const terminal = event.type === "complete" || event.type === "cancelled" ||
        (event.type === "error" && !event.recoverable);
      if (terminal) {
        terminalRef.current = true;
        intentionalStopRef.current = true;
        generationRef.current += 1;
        pendingCommandsRef.current.clear();
        clearReconnectTimer();
        clearPingInterval();
        if (socketRef.current === socket) socketRef.current = null;
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
      let approval: PendingApproval | undefined;
      let inputRequest: PendingInput | undefined;
      let acknowledgedCommand: PendingCommand | undefined;

      if (event.type === "command_ack") {
        acknowledgedCommand = pendingCommandsRef.current.get(event.commandId);
        if (!acknowledgedCommand) return;
        if (
          acknowledgedCommand.commandType !== event.commandType ||
          (event.commandType === "input" && event.requestId !== undefined &&
            event.requestId !== acknowledgedCommand.requestId)
        ) {
          const detail = "Invalid Claude Code command acknowledgement correlation";
          reportError(REQUEST_ERROR.create({ detail }), detail);
          return;
        }
        pendingCommandsRef.current.delete(event.commandId);
        if (event.status === "rejected") {
          const detail = event.reason || `Claude Code ${event.commandType} command was rejected`;
          reportError(REQUEST_ERROR.create({ detail }), detail);
        }
      }

      try {
        callbacks.onEvent?.(structuredClone(event));
      } catch (error) {
        const detail = "Claude Code onEvent callback failed";
        reportError(error instanceof Error ? error : new Error(String(error)), detail);
      }

      if (event.type === "complete") {
        try {
          callbacks.onComplete?.(structuredClone(event.result));
        } catch (error) {
          const detail = "Claude Code onComplete callback failed";
          reportError(error instanceof Error ? error : new Error(String(error)), detail);
        }
      }
      if (event.type === "approval_request") {
        approval = {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
          reason: event.reason,
          timeout: event.timeout,
          requestedAt: Date.now(),
        };
        try {
          callbacks.onApprovalRequest?.(structuredClone(approval));
        } catch (error) {
          const detail = "Claude Code onApprovalRequest callback failed";
          reportError(error instanceof Error ? error : new Error(String(error)), detail);
        }
      }
      if (event.type === "input_request") {
        inputRequest = {
          requestId: event.requestId,
          prompt: event.prompt,
          defaultValue: event.defaultValue,
          timeout: event.timeout,
          requestedAt: Date.now(),
        };
        try {
          callbacks.onInputRequest?.(structuredClone(inputRequest));
        } catch (error) {
          const detail = "Claude Code onInputRequest callback failed";
          reportError(error instanceof Error ? error : new Error(String(error)), detail);
        }
      }

      setState((prev) => {
        const newState = isClaudeCodeCoreEvent(event)
          ? reduceClaudeCodeEventState(prev, event)
          : { ...prev };

        switch (event.type) {
          case "complete":
            newState.pendingApprovals = [];
            newState.pendingInput = null;
            break;

          case "error":
            if (!event.recoverable) {
              newState.pendingApprovals = [];
              newState.pendingInput = null;
            }
            break;

          case "cancelled":
            newState.isRunning = false;
            newState.isCancelled = true;
            newState.pendingApprovals = [];
            newState.pendingInput = null;
            break;

          case "approval_request": {
            if (approval) {
              const withoutDuplicate = prev.pendingApprovals.filter((candidate) =>
                candidate.toolCallId !== approval!.toolCallId
              );
              newState.pendingApprovals = [...withoutDuplicate, approval].slice(
                -MAX_CLAUDE_CODE_PENDING_INTERACTIONS,
              );
              if (
                withoutDuplicate.length >= MAX_CLAUDE_CODE_PENDING_INTERACTIONS &&
                newState.error === null
              ) newState.error = "Claude Code approvals exceeded the retained collection limit";
            }
            break;
          }

          case "input_request": {
            if (inputRequest) newState.pendingInput = inputRequest;
            break;
          }

          case "command_ack":
            if (event.status === "accepted" && acknowledgedCommand) {
              if (
                acknowledgedCommand.commandType === "approve" ||
                acknowledgedCommand.commandType === "reject"
              ) {
                newState.pendingApprovals = prev.pendingApprovals.filter((candidate) =>
                  candidate.toolCallId !== acknowledgedCommand!.toolCallId
                );
              } else if (
                acknowledgedCommand.commandType === "input" &&
                prev.pendingInput?.requestId === acknowledgedCommand.requestId
              ) {
                newState.pendingInput = null;
              }
            }
            break;

          case "pong":
            // Keepalive response, no state change needed
            break;
        }

        if (terminal) newState.isConnected = false;

        return newState;
      });
    },
    [clearPingInterval, clearReconnectTimer, ownsSocket, reportError],
  );

  const sendSerializedCommand = useCallback((serialized: string): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || intentionalStopRef.current) {
      const detail = "WebSocket command not delivered because the transport is not connected";
      reportDeliveryError(detail);
      return false;
    }

    try {
      socket.send(serialized);
    } catch {
      const detail = "WebSocket command send failed";
      reportDeliveryError(detail);
      return false;
    }

    recoverDeliveryError();
    return true;
  }, [recoverDeliveryError, reportDeliveryError]);

  const nextCommandId = useCallback((): string => {
    try {
      const generated = globalThis.crypto?.randomUUID?.();
      if (generated && generated.length <= MAX_CLAUDE_CODE_FIELD_LENGTH) return generated;
    } catch {
      // Fall through to a process-local bounded identifier.
    }
    commandSequenceRef.current += 1;
    return `cc-${Date.now().toString(36)}-${commandSequenceRef.current.toString(36)}`;
  }, []);

  const enqueueCommand = useCallback((
    commandType: KeyedCommandType,
    fields: Record<string, unknown>,
    correlation: Pick<PendingCommand, "toolCallId" | "requestId"> = {},
  ): PendingCommand | null => {
    if (pendingCommandsRef.current.size >= MAX_CLAUDE_CODE_PENDING_COMMANDS) {
      const detail = "WebSocket pending commands exceeded the retained collection limit";
      reportError(REQUEST_ERROR.create({ detail }), detail);
      return null;
    }
    const commandId = nextCommandId();
    const serialized = JSON.stringify({
      type: commandType,
      ...fields,
      timestamp: Date.now(),
      runId: identityRef.current.runId,
      commandId,
    });
    const pending: PendingCommand = {
      commandId,
      commandType,
      serialized,
      ...correlation,
    };
    pendingCommandsRef.current.set(commandId, pending);
    sendSerializedCommand(serialized);
    return pending;
  }, [nextCommandId, reportError, sendSerializedCommand]);

  const sendLegacyCommand = useCallback((command: Record<string, unknown>): boolean => {
    return sendSerializedCommand(JSON.stringify({
      ...command,
      timestamp: Date.now(),
      runId: identityRef.current.runId,
    }));
  }, [sendSerializedCommand]);

  const stopTransport = useCallback((updateState: boolean): void => {
    intentionalStopRef.current = true;
    generationRef.current += 1;
    reconnectAttemptsRef.current = 0;
    clearReconnectTimer();
    clearPingInterval();

    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }

    if (updateState && mountedRef.current) {
      setState((prev) => ({ ...prev, isConnected: false }));
    }
  }, [clearPingInterval, clearReconnectTimer]);

  connectRef.current = (retry: boolean): void => {
    if (!mountedRef.current) return;
    if (!retry) {
      reconnectAttemptsRef.current = 0;
      terminalRef.current = false;
    }
    intentionalStopRef.current = false;
    clearReconnectTimer();
    clearPingInterval();

    const previousSocket = socketRef.current;
    socketRef.current = null;
    if (previousSocket) {
      previousSocket.onopen = null;
      previousSocket.onmessage = null;
      previousSocket.onclose = null;
      previousSocket.onerror = null;
      previousSocket.close();
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const identity = identityRef.current;
    const wsUrl = withRunId(identity.url, identity.runId);
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      const detail = "WebSocket connection could not be created";
      reportError(NETWORK_ERROR.create({ detail }), detail);
      return;
    }
    socketRef.current = socket;
    setState((prev) => ({ ...prev, isConnected: false }));

    socket.onopen = () => {
      if (!ownsSocket(generation, socket)) return;
      setState((prev) => ({ ...prev, isConnected: true }));
      try {
        optionsRef.current.onConnect?.();
      } catch (error) {
        const detail = "Claude Code onConnect callback failed";
        reportError(error instanceof Error ? error : new Error(String(error)), detail);
      }

      for (const pending of pendingCommandsRef.current.values()) {
        if (!sendSerializedCommand(pending.serialized)) break;
      }

      // Start ping interval
      const currentPingInterval = optionsRef.current.pingInterval;
      if (currentPingInterval > 0) {
        clearPingInterval();
        pingIntervalRef.current = globalThis.setInterval(() => {
          if (ownsSocket(generation, socket)) sendLegacyCommand({ type: "ping" });
        }, currentPingInterval);
      }
    };

    socket.onmessage = (e) => {
      if (!ownsSocket(generation, socket)) return;
      const admission = admitClaudeCodeEventMessage(e.data, true);
      if (!admission.ok) {
        const detail = `Invalid Claude Code event: ${admission.reason}`;
        reportError(REQUEST_ERROR.create({ detail }), detail);
        return;
      }
      if (admission.event.runId !== undefined && admission.event.runId !== identity.runId) {
        const detail = "Invalid Claude Code event: runId does not match the active socket";
        reportError(REQUEST_ERROR.create({ detail }), detail);
        return;
      }
      processEvent(admission.event, generation, socket);
    };

    socket.onclose = () => {
      if (!ownsSocket(generation, socket)) return;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socketRef.current = null;
      setState((prev) => ({ ...prev, isConnected: false }));
      try {
        optionsRef.current.onDisconnect?.();
      } catch (error) {
        const detail = "Claude Code onDisconnect callback failed";
        reportError(error instanceof Error ? error : new Error(String(error)), detail);
      }
      clearPingInterval();

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
      } else if (reconnectAttemptsRef.current >= currentOptions.maxReconnectAttempts) {
        const detail = "WebSocket connection failed after the maximum retry count";
        reportError(REQUEST_ERROR.create({ detail }), detail);
      }
    };

    socket.onerror = () => {
      if (!ownsSocket(generation, socket)) return;
      const detail = "WebSocket transport error";
      reportError(NETWORK_ERROR.create({ detail }), detail);
    };
  };

  // Connect to WebSocket
  const connect = useCallback((): void => {
    if (
      !mountedRef.current || terminalRef.current || identityRef.current.url !== url ||
      identityRef.current.runId !== runId
    ) return;
    connectRef.current(false);
  }, [runId, url]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (identityRef.current.url !== url || identityRef.current.runId !== runId) return;
    stopTransport(true);
  }, [runId, stopTransport, url]);

  // Cancel agent execution
  const cancel = useCallback(
    (reason?: string) => {
      if (identityRef.current.url !== url || identityRef.current.runId !== runId) return;
      if (reason !== undefined && reason.length > MAX_CLAUDE_CODE_FIELD_LENGTH) {
        const detail = "WebSocket cancel reason exceeds the protocol limit";
        reportError(REQUEST_ERROR.create({ detail }), detail);
        return;
      }
      const existing = [...pendingCommandsRef.current.values()].find((command) =>
        command.commandType === "cancel"
      );
      if (existing) {
        sendSerializedCommand(existing.serialized);
        return;
      }
      enqueueCommand("cancel", { reason });
    },
    [enqueueCommand, reportError, runId, sendSerializedCommand, url],
  );

  // Approve a tool call
  const approve = useCallback(
    (toolCallId: string) => {
      if (identityRef.current.url !== url || identityRef.current.runId !== runId) return;
      if (!state.pendingApprovals.some((approval) => approval.toolCallId === toolCallId)) return;
      const existing = [...pendingCommandsRef.current.values()].find((command) =>
        (command.commandType === "approve" || command.commandType === "reject") &&
        command.toolCallId === toolCallId
      );
      if (existing) {
        sendSerializedCommand(existing.serialized);
        return;
      }
      enqueueCommand("approve", { toolCallId }, { toolCallId });
    },
    [enqueueCommand, runId, sendSerializedCommand, state.pendingApprovals, url],
  );

  // Reject a tool call
  const reject = useCallback(
    (toolCallId: string, reason?: string) => {
      if (identityRef.current.url !== url || identityRef.current.runId !== runId) return;
      if (!state.pendingApprovals.some((approval) => approval.toolCallId === toolCallId)) return;
      if (reason !== undefined && reason.length > MAX_CLAUDE_CODE_FIELD_LENGTH) {
        const detail = "WebSocket rejection reason exceeds the protocol limit";
        reportError(REQUEST_ERROR.create({ detail }), detail);
        return;
      }
      const existing = [...pendingCommandsRef.current.values()].find((command) =>
        (command.commandType === "approve" || command.commandType === "reject") &&
        command.toolCallId === toolCallId
      );
      if (existing) {
        sendSerializedCommand(existing.serialized);
        return;
      }
      enqueueCommand("reject", { toolCallId, reason }, { toolCallId });
    },
    [
      enqueueCommand,
      reportError,
      runId,
      sendSerializedCommand,
      state.pendingApprovals,
      url,
    ],
  );

  // Send user input
  const sendInput = useCallback(
    (content: string) => {
      if (identityRef.current.url !== url || identityRef.current.runId !== runId) return;
      const pendingInput = state.pendingInput;
      if (!pendingInput) return;
      if (content.length > MAX_CLAUDE_CODE_FIELD_LENGTH) {
        const detail = "WebSocket input exceeds the protocol limit";
        reportError(REQUEST_ERROR.create({ detail }), detail);
        return;
      }
      const existing = [...pendingCommandsRef.current.values()].find((command) =>
        command.commandType === "input" && command.requestId === pendingInput.requestId
      );
      if (existing) {
        sendSerializedCommand(existing.serialized);
        return;
      }
      enqueueCommand(
        "input",
        {
          content,
          ...(pendingInput.requestId === undefined ? {} : { requestId: pendingInput.requestId }),
        },
        { requestId: pendingInput.requestId },
      );
    },
    [
      enqueueCommand,
      reportError,
      runId,
      sendSerializedCommand,
      state.pendingInput,
      url,
    ],
  );

  // Reset transport and state only when the socket identity changes.
  useEffect(() => {
    mountedRef.current = true;
    identityRef.current = { url, runId };
    terminalRef.current = false;
    reconnectAttemptsRef.current = 0;
    pendingCommandsRef.current.clear();
    deliveryErrorRef.current = null;
    setState(createWebSocketState());

    return () => {
      mountedRef.current = false;
      stopTransport(false);
      pendingCommandsRef.current.clear();
    };
  }, [runId, stopTransport, url]);

  useEffect(() => {
    if (identityRef.current.url !== url || identityRef.current.runId !== runId) return;
    if (autoConnect && !terminalRef.current) {
      if (!socketRef.current && intentionalStopRef.current) connectRef.current(false);
    } else {
      stopTransport(true);
    }
  }, [autoConnect, runId, stopTransport, url]);

  const ownsRenderedIdentity = mountedRef.current && identityRef.current.url === url &&
    identityRef.current.runId === runId;
  return {
    ...(ownsRenderedIdentity ? state : createWebSocketState()),
    connect,
    disconnect,
    cancel,
    approve,
    reject,
    sendInput,
  };
}
