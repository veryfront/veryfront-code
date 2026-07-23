/**
 * WebSocket Event Publisher
 *
 * Provides bidirectional communication between client and agent.
 */

import { logger as baseLogger } from "#veryfront/utils";
import type {
  BidirectionalPublisher,
  CancelledEvent,
  ClaudeCodeEvent,
  ClaudeCodeEventExtended,
  ClientCommand,
  ClientCommandHandler,
  PongEvent,
} from "./types.ts";
import { ORCHESTRATION_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";
import { upgradeWebSocket } from "#veryfront/compat/http";

const logger = baseLogger.component("websocket-publisher");

/** Default interval for WebSocket ping/keepalive messages */
const DEFAULT_PING_INTERVAL_MS = 30_000;

/** Default timeout for tool call approval requests */
const DEFAULT_APPROVAL_TIMEOUT_MS = 60_000;

/** Default timeout for user input requests (5 minutes) */
const DEFAULT_INPUT_TIMEOUT_MS = 300_000;

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

/**
 * WebSocket publisher configuration
 */
export interface WebSocketPublisherConfig {
  /** WebSocket instance */
  socket: WebSocket;

  /** Run ID for this connection */
  runId: string;

  /** Enable debug logging */
  debug?: boolean;

  /** Ping interval (ms) - 0 to disable */
  pingInterval?: number;
}

/**
 * WebSocket-based bidirectional publisher
 *
 * Enables two-way communication:
 * - Server → Client: Events (text, tool calls, results)
 * - Client → Server: Commands (cancel, approve, reject, input)
 */
export class WebSocketPublisher implements BidirectionalPublisher {
  private config: Required<Omit<WebSocketPublisherConfig, "socket">> & {
    socket: WebSocket;
  };
  private commandHandlers = new Set<ClientCommandHandler>();
  private closed = false;
  private pingTimer: ReturnType<typeof globalThis.setInterval> | null = null;

  private readonly handleSocketMessage = (event: MessageEvent): void => {
    try {
      const parsed: unknown = JSON.parse(event.data);
      if (!parsed || typeof parsed !== "object") return;
      const command = parsed as ClientCommand;
      this.handleCommand(command);
    } catch {
      if (this.config.debug) {
        logger.error("Failed to parse command");
      }
    }
  };

  private readonly handleSocketClose = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.stopPingInterval();
    this.commandHandlers.clear();
    this.removeSocketListeners();
  };

  private readonly handleSocketError = (): void => {
    if (this.config.debug) {
      logger.error("Socket error");
    }
    // WebSocket errors are terminal. Close explicitly so runtimes that omit the
    // usual follow-up close event cannot retain listeners or command handlers.
    this.close();
  };

  constructor(config: WebSocketPublisherConfig) {
    this.config = {
      debug: false,
      pingInterval: DEFAULT_PING_INTERVAL_MS,
      ...config,
    };

    this.setupSocketListeners();
    this.startPingInterval();
  }

  private setupSocketListeners(): void {
    const { socket } = this.config;
    socket.addEventListener("message", this.handleSocketMessage);
    socket.addEventListener("close", this.handleSocketClose);
    socket.addEventListener("error", this.handleSocketError);
  }

  private removeSocketListeners(): void {
    const { socket } = this.config;
    socket.removeEventListener("message", this.handleSocketMessage);
    socket.removeEventListener("close", this.handleSocketClose);
    socket.removeEventListener("error", this.handleSocketError);
  }

  private handleCommand(command: ClientCommand): void {
    if (this.config.debug) {
      logger.info("Received command", { commandType: command.type });
    }

    // Handle ping internally
    if (command.type === "ping") {
      this.sendPong();
      return;
    }

    // Dispatch to handlers
    for (const handler of this.commandHandlers) {
      try {
        void Promise.resolve(handler(command)).catch(() => {
          if (this.config.debug) {
            logger.error("Command handler failed", { commandType: command.type });
          }
        });
      } catch {
        if (this.config.debug) {
          logger.error("Command handler failed", { commandType: command.type });
        }
      }
    }
  }

  private sendPong(): void {
    const pong: PongEvent = {
      type: "pong",
      timestamp: Date.now(),
      runId: this.config.runId,
    };
    this.send(pong);
  }

  private startPingInterval(): void {
    if (this.config.pingInterval > 0) {
      this.pingTimer = globalThis.setInterval(() => {
        // Stop interval if socket is no longer usable (prevents resource leak)
        const { socket } = this.config;
        if (this.closed || socket.readyState !== SOCKET_OPEN) {
          this.stopPingInterval();
          return;
        }

        // Server-side ping to keep connection alive
        this.send({
          type: "pong",
          timestamp: Date.now(),
          runId: this.config.runId,
        } as PongEvent);
      }, this.config.pingInterval);
    }
  }

  private stopPingInterval(): void {
    if (this.pingTimer !== null) {
      globalThis.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Subscribe to client commands
   */
  onCommand(handler: ClientCommandHandler): () => void {
    if (this.closed) return () => {};
    this.commandHandlers.add(handler);
    return () => {
      this.commandHandlers.delete(handler);
    };
  }

  /**
   * Send an event to the client
   */
  send(event: ClaudeCodeEventExtended): void {
    if (this.closed) return;

    const { socket } = this.config;
    if (socket.readyState !== SOCKET_OPEN) {
      if (this.config.debug) {
        logger.warn("Socket not open, dropping event");
      }
      return;
    }

    socket.send(JSON.stringify(event));

    if (this.config.debug) {
      logger.info("Sent event", { eventType: event.type });
    }
  }

  /**
   * Publish an event (implements ClaudeCodeEventPublisher)
   */
  publish(event: ClaudeCodeEvent): void {
    this.send(event);
  }

  /**
   * Close the publisher
   */
  close(): void {
    if (this.closed) return;

    this.closed = true;
    this.stopPingInterval();
    this.commandHandlers.clear();
    this.removeSocketListeners();

    const { socket } = this.config;
    if (
      socket.readyState === SOCKET_CONNECTING ||
      socket.readyState === SOCKET_OPEN
    ) {
      socket.close();
    }
  }

  /**
   * Send a cancellation event
   */
  sendCancelled(reason?: string): void {
    const event: CancelledEvent = {
      type: "cancelled",
      timestamp: Date.now(),
      runId: this.config.runId,
      reason,
    };
    this.send(event);
  }

  /**
   * Check if the connection is open
   */
  get isOpen(): boolean {
    return !this.closed && this.config.socket.readyState === SOCKET_OPEN;
  }
}

/**
 * Redis-backed WebSocket publisher for distributed deployments
 *
 * Uses Redis pub/sub to bridge WebSocket connections across multiple servers:
 * - Events are published to Redis, then broadcast to connected WebSockets
 * - Commands from WebSocket are published to Redis for the worker to receive
 */
interface RedisWebSocketBridgeConfig {
  /** Redis URL */
  redisUrl: string;

  /** Channel prefix */
  channelPrefix?: string;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Create a WebSocket handler for HTTP upgrade requests
 */
export type WebSocketConnectionDisposer = () => void | Promise<void>;

export interface WebSocketConnectionContext {
  /** Aborted when the connection closes or setup fails. */
  signal: AbortSignal;
}

export interface WebSocketHandlerConfig {
  /** Get run ID from request */
  getRunId: (req: Request) => string | null;

  /** Called when a new connection is established */
  onConnection: (
    publisher: WebSocketPublisher,
    runId: string,
    context: WebSocketConnectionContext,
  ) =>
    | void
    | WebSocketConnectionDisposer
    | Promise<void | WebSocketConnectionDisposer>;

  /** Called when connection closes */
  onClose?: (runId: string) => void | Promise<void>;

  /** Enable debug logging */
  debug?: boolean;
}

export function createWebSocketHandler(
  config: WebSocketHandlerConfig,
): (req: Request) => Response {
  return (req: Request): Response => {
    const runId = config.getRunId(req);
    if (!runId) {
      return new Response("Missing runId", { status: 400 });
    }

    const { socket, response } = upgradeWebSocket(req);

    socket.onopen = () => {
      const publisher = new WebSocketPublisher({
        socket,
        runId,
        debug: config.debug,
      });

      const abortController = new AbortController();
      let cleanupRequested = false;
      let closeNotified = false;
      let disposer: WebSocketConnectionDisposer | null = null;
      let disposerStarted = false;

      const runDisposer = (candidate: WebSocketConnectionDisposer | null): void => {
        if (!candidate || disposerStarted) return;
        disposerStarted = true;
        disposer = null;
        try {
          void Promise.resolve(candidate()).catch(() => {
            if (config.debug) logger.error("WebSocket connection cleanup failed");
          });
        } catch {
          if (config.debug) logger.error("WebSocket connection cleanup failed");
        }
      };

      const notifyClose = (): void => {
        if (closeNotified) return;
        closeNotified = true;
        try {
          void Promise.resolve(config.onClose?.(runId)).catch(() => {
            if (config.debug) logger.error("WebSocket close cleanup failed");
          });
        } catch {
          if (config.debug) logger.error("WebSocket close cleanup failed");
        }
      };

      const cleanupConnection = (): void => {
        if (cleanupRequested) return;
        cleanupRequested = true;
        abortController.abort();
        runDisposer(disposer);
        notifyClose();
      };

      const handleConnectionFailure = (): void => {
        if (config.debug) logger.error("WebSocket connection setup failed");
        cleanupConnection();
        try {
          publisher.close();
        } catch {
          if (config.debug) logger.error("WebSocket connection close failed");
        }
      };

      socket.addEventListener("close", cleanupConnection, { once: true });

      try {
        void Promise.resolve(
          config.onConnection(publisher, runId, { signal: abortController.signal }),
        ).then((candidate) => {
          if (typeof candidate !== "function") return;
          if (cleanupRequested) runDisposer(candidate);
          else disposer = candidate;
        }, handleConnectionFailure);
      } catch {
        handleConnectionFailure();
      }
    };

    return response;
  };
}

/**
 * Agent controller for handling client commands
 *
 * Wraps an agent execution and provides methods to control it from client commands.
 */
export class AgentController {
  private cancelled = false;
  private disposed = false;
  private unsubscribeFromCommands: (() => void) | null = null;
  private pendingApprovals = new Map<
    string,
    {
      resolve: (approved: boolean) => void;
      reject: (error: Error) => void;
      timeout: TimeoutHandle | null;
    }
  >();
  private inputResolvers: Array<{
    resolve: (input: string) => void;
    reject: (error: Error) => void;
    timeout: TimeoutHandle | null;
  }> = [];

  constructor(
    private publisher: BidirectionalPublisher,
    private config: {
      approvalTimeout?: number;
      inputTimeout?: number;
      onCancel?: (reason?: string) => void | Promise<void>;
    } = {},
  ) {
    // Subscribe to commands
    this.unsubscribeFromCommands = publisher.onCommand((command) => this.handleCommand(command));
  }

  private handleCommand(command: ClientCommand): void {
    switch (command.type) {
      case "cancel":
        this.handleCancel(command.reason);
        break;

      case "approve":
        this.handleApproval(command.toolCallId, true);
        break;

      case "reject":
        this.handleApproval(command.toolCallId, false, command.reason);
        break;

      case "input":
        this.handleInput(command.content);
        break;
    }
  }

  private handleCancel(reason?: string): void {
    if (this.disposed || this.cancelled) return;
    this.cancelled = true;

    // Reject all pending approvals
    for (const [, pending] of this.pendingApprovals) {
      if (pending.timeout !== null) globalThis.clearTimeout(pending.timeout);
      pending.reject(ORCHESTRATION_ERROR.create({ detail: "Cancelled" }));
    }
    this.pendingApprovals.clear();

    // Reject all pending inputs
    for (const pending of this.inputResolvers) {
      if (pending.timeout !== null) globalThis.clearTimeout(pending.timeout);
      pending.reject(ORCHESTRATION_ERROR.create({ detail: "Cancelled" }));
    }
    this.inputResolvers = [];

    try {
      void Promise.resolve(this.config.onCancel?.(reason)).catch(() => {
        logger.error("Agent cancellation callback failed");
      });
    } catch {
      logger.error("Agent cancellation callback failed");
    }
  }

  private handleApproval(
    toolCallId: string,
    approved: boolean,
    _reason?: string,
  ): void {
    const pending = this.pendingApprovals.get(toolCallId);
    if (pending) {
      this.pendingApprovals.delete(toolCallId);
      if (pending.timeout !== null) globalThis.clearTimeout(pending.timeout);
      pending.timeout = null;
      pending.resolve(approved);
    }
  }

  private handleInput(content: string): void {
    const pending = this.inputResolvers.shift();
    if (pending) {
      if (pending.timeout !== null) globalThis.clearTimeout(pending.timeout);
      pending.timeout = null;
      pending.resolve(content);
    }
  }

  /**
   * Check if the agent has been cancelled
   */
  get isCancelled(): boolean {
    return this.cancelled;
  }

  /**
   * Request approval for a tool call
   */
  requestApproval(
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
    reason: string,
  ): Promise<boolean> {
    if (this.disposed) {
      return Promise.reject(
        ORCHESTRATION_ERROR.create({ detail: "Agent controller disposed" }),
      );
    }
    if (this.cancelled) {
      return Promise.reject(ORCHESTRATION_ERROR.create({ detail: "Agent cancelled" }));
    }

    if (this.pendingApprovals.has(toolCallId)) {
      return Promise.reject(
        ORCHESTRATION_ERROR.create({ detail: "Duplicate active tool call ID" }),
      );
    }

    const timeout = this.config.approvalTimeout ?? DEFAULT_APPROVAL_TIMEOUT_MS;

    const event: ClaudeCodeEventExtended = {
      type: "approval_request",
      timestamp: Date.now(),
      toolCallId,
      toolName,
      input,
      reason,
      timeout,
    };

    let pending!: {
      resolve: (approved: boolean) => void;
      reject: (error: Error) => void;
      timeout: TimeoutHandle | null;
    };
    const promise = new Promise<boolean>((resolve, reject) => {
      pending = { resolve, reject, timeout: null };
    });
    this.pendingApprovals.set(toolCallId, pending);
    pending.timeout = globalThis.setTimeout(() => {
      if (this.pendingApprovals.get(toolCallId) !== pending) return;
      this.pendingApprovals.delete(toolCallId);
      pending.timeout = null;
      // Default to reject on timeout.
      pending.resolve(false);
    }, timeout);

    this.sendPendingEvent(event, () => {
      if (this.pendingApprovals.get(toolCallId) !== pending) return;
      this.pendingApprovals.delete(toolCallId);
      if (pending.timeout !== null) globalThis.clearTimeout(pending.timeout);
      pending.timeout = null;
      pending.reject(
        ORCHESTRATION_ERROR.create({ detail: "Failed to send approval request" }),
      );
    });
    return promise;
  }

  /**
   * Request input from the user
   */
  requestInput(prompt: string, defaultValue?: string): Promise<string> {
    if (this.disposed) {
      return Promise.reject(
        ORCHESTRATION_ERROR.create({ detail: "Agent controller disposed" }),
      );
    }
    if (this.cancelled) {
      return Promise.reject(ORCHESTRATION_ERROR.create({ detail: "Agent cancelled" }));
    }

    const timeout = this.config.inputTimeout ?? DEFAULT_INPUT_TIMEOUT_MS;

    const event: ClaudeCodeEventExtended = {
      type: "input_request",
      timestamp: Date.now(),
      prompt,
      defaultValue,
      timeout,
    };

    let pending!: {
      resolve: (input: string) => void;
      reject: (error: Error) => void;
      timeout: TimeoutHandle | null;
    };
    const promise = new Promise<string>((resolve, reject) => {
      pending = { resolve, reject, timeout: null };
    });
    this.inputResolvers.push(pending);
    pending.timeout = globalThis.setTimeout(() => {
      const index = this.inputResolvers.indexOf(pending);
      if (index !== -1) {
        this.inputResolvers.splice(index, 1);
        if (defaultValue !== undefined) {
          pending.resolve(defaultValue);
        } else {
          pending.reject(TIMEOUT_ERROR.create({ detail: "Input timeout" }));
        }
      }
      pending.timeout = null;
    }, timeout);

    this.sendPendingEvent(event, () => {
      const index = this.inputResolvers.indexOf(pending);
      if (index === -1) return;
      this.inputResolvers.splice(index, 1);
      if (pending.timeout !== null) globalThis.clearTimeout(pending.timeout);
      pending.timeout = null;
      pending.reject(
        ORCHESTRATION_ERROR.create({ detail: "Failed to send input request" }),
      );
    });
    return promise;
  }

  private sendPendingEvent(
    event: ClaudeCodeEventExtended,
    onFailure: () => void,
  ): void {
    try {
      void Promise.resolve(this.publisher.send(event)).catch(onFailure);
    } catch {
      onFailure();
    }
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const unsubscribe = this.unsubscribeFromCommands;
    this.unsubscribeFromCommands = null;

    // Settle every pending operation so callers are not left waiting forever.
    for (const [, pending] of this.pendingApprovals) {
      if (pending.timeout !== null) globalThis.clearTimeout(pending.timeout);
      pending.reject(
        ORCHESTRATION_ERROR.create({ detail: "Agent controller disposed" }),
      );
    }
    this.pendingApprovals.clear();

    for (const pending of this.inputResolvers) {
      if (pending.timeout !== null) globalThis.clearTimeout(pending.timeout);
      pending.reject(
        ORCHESTRATION_ERROR.create({ detail: "Agent controller disposed" }),
      );
    }
    this.inputResolvers = [];

    try {
      unsubscribe?.();
    } catch {
      logger.error("Failed to unsubscribe agent controller commands");
    }
  }
}
