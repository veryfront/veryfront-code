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

const logger = baseLogger.component("websocket-publisher");

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
  private pingTimer: number | null = null;

  constructor(config: WebSocketPublisherConfig) {
    this.config = {
      debug: false,
      pingInterval: 30000,
      ...config,
    };

    this.setupSocketListeners();
    this.startPingInterval();
  }

  private setupSocketListeners(): void {
    const { socket } = this.config;

    socket.onmessage = (event) => {
      try {
        const command = JSON.parse(event.data) as ClientCommand;
        this.handleCommand(command);
      } catch (error) {
        if (this.config.debug) {
          logger.error("Failed to parse command", error);
        }
      }
    };

    socket.onclose = () => {
      this.closed = true;
      this.stopPingInterval();
    };

    socket.onerror = (error) => {
      if (this.config.debug) {
        logger.error("Socket error", error);
      }
      // Stop ping interval on error to prevent resource leak
      // The socket may or may not close after an error, but we should
      // proactively clean up in case the close event doesn't fire
      this.stopPingInterval();
    };
  }

  private handleCommand(command: ClientCommand): void {
    if (this.config.debug) {
      logger.debug("Received command", { commandType: command.type });
    }

    // Handle ping internally
    if (command.type === "ping") {
      this.sendPong();
      return;
    }

    // Dispatch to handlers
    for (const handler of this.commandHandlers) {
      try {
        handler(command);
      } catch (error) {
        if (this.config.debug) {
          logger.error("Handler error", error);
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
        if (this.closed || socket.readyState !== WebSocket.OPEN) {
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
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Subscribe to client commands
   */
  onCommand(handler: ClientCommandHandler): () => void {
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
    if (socket.readyState !== WebSocket.OPEN) {
      if (this.config.debug) {
        logger.warn("Socket not open, dropping event");
      }
      return;
    }

    socket.send(JSON.stringify(event));

    if (this.config.debug) {
      logger.debug("Sent event", { eventType: event.type });
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

    const { socket } = this.config;
    if (socket.readyState === WebSocket.OPEN) {
      socket.close();
    }

    this.commandHandlers.clear();
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
    return !this.closed && this.config.socket.readyState === WebSocket.OPEN;
  }
}

/**
 * Redis-backed WebSocket publisher for distributed deployments
 *
 * Uses Redis pub/sub to bridge WebSocket connections across multiple servers:
 * - Events are published to Redis, then broadcast to connected WebSockets
 * - Commands from WebSocket are published to Redis for the worker to receive
 */
export interface RedisWebSocketBridgeConfig {
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
export function createWebSocketHandler(config: {
  /** Get run ID from request */
  getRunId: (req: Request) => string | null;

  /** Called when a new connection is established */
  onConnection: (
    publisher: WebSocketPublisher,
    runId: string,
  ) => void | Promise<void>;

  /** Called when connection closes */
  onClose?: (runId: string) => void | Promise<void>;

  /** Enable debug logging */
  debug?: boolean;
}): (req: Request) => Response {
  return (req: Request): Response => {
    const runId = config.getRunId(req);
    if (!runId) {
      return new Response("Missing runId", { status: 400 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req);

    socket.onopen = () => {
      const publisher = new WebSocketPublisher({
        socket,
        runId,
        debug: config.debug,
      });

      config.onConnection(publisher, runId);

      socket.onclose = () => {
        config.onClose?.(runId);
      };
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
  private pendingApprovals = new Map<
    string,
    {
      resolve: (approved: boolean) => void;
      reject: (error: Error) => void;
      timeout: number | null;
    }
  >();
  private inputResolvers: Array<{
    resolve: (input: string) => void;
    reject: (error: Error) => void;
    timeout: number | null;
  }> = [];

  constructor(
    private publisher: BidirectionalPublisher,
    private config: {
      approvalTimeout?: number;
      inputTimeout?: number;
      onCancel?: (reason?: string) => void;
    } = {},
  ) {
    // Subscribe to commands
    publisher.onCommand((command) => this.handleCommand(command));
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
    this.cancelled = true;
    this.config.onCancel?.(reason);

    // Reject all pending approvals
    for (const [, pending] of this.pendingApprovals) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(new Error("Cancelled"));
    }
    this.pendingApprovals.clear();

    // Reject all pending inputs
    for (const pending of this.inputResolvers) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(new Error("Cancelled"));
    }
    this.inputResolvers = [];
  }

  private handleApproval(
    toolCallId: string,
    approved: boolean,
    _reason?: string,
  ): void {
    const pending = this.pendingApprovals.get(toolCallId);
    if (pending) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.resolve(approved);
      this.pendingApprovals.delete(toolCallId);
    }
  }

  private handleInput(content: string): void {
    const pending = this.inputResolvers.shift();
    if (pending) {
      if (pending.timeout) clearTimeout(pending.timeout);
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
    if (this.cancelled) {
      return Promise.reject(new Error("Agent cancelled"));
    }

    const timeout = this.config.approvalTimeout || 60000;

    // Send approval request to client
    this.publisher.send({
      type: "approval_request",
      timestamp: Date.now(),
      toolCallId,
      toolName,
      input,
      reason,
      timeout,
    });

    return new Promise((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        this.pendingApprovals.delete(toolCallId);
        // Default to reject on timeout
        resolve(false);
      }, timeout);

      this.pendingApprovals.set(toolCallId, {
        resolve,
        reject,
        timeout: timeoutId,
      });
    });
  }

  /**
   * Request input from the user
   */
  requestInput(prompt: string, defaultValue?: string): Promise<string> {
    if (this.cancelled) {
      return Promise.reject(new Error("Agent cancelled"));
    }

    const timeout = this.config.inputTimeout || 300000; // 5 minutes

    // Send input request to client
    this.publisher.send({
      type: "input_request",
      timestamp: Date.now(),
      prompt,
      defaultValue,
      timeout,
    });

    return new Promise((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        const index = this.inputResolvers.findIndex((r) => r.resolve === resolve);
        if (index !== -1) {
          this.inputResolvers.splice(index, 1);
        }
        if (defaultValue !== undefined) {
          resolve(defaultValue);
        } else {
          reject(new Error("Input timeout"));
        }
      }, timeout);

      this.inputResolvers.push({
        resolve,
        reject,
        timeout: timeoutId,
      });
    });
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    // Clear all pending operations
    for (const [, pending] of this.pendingApprovals) {
      if (pending.timeout) clearTimeout(pending.timeout);
    }
    this.pendingApprovals.clear();

    for (const pending of this.inputResolvers) {
      if (pending.timeout) clearTimeout(pending.timeout);
    }
    this.inputResolvers = [];
  }
}
