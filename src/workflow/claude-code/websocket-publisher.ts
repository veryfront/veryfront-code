/**
 * WebSocket Event Publisher
 *
 * Provides bidirectional communication between client and agent.
 */

import { logger as baseLogger } from "#veryfront/utils";
import { createSubscriberSet } from "#veryfront/utils/subscriber-set.ts";
import type {
  BidirectionalPublisher,
  CancelledEvent,
  ClaudeCodeEvent,
  ClaudeCodeEventExtended,
  ClientCommand,
  ClientCommandHandler,
  PongEvent,
} from "./types.ts";
import { INVALID_ARGUMENT, ORCHESTRATION_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";
import { parsePositiveDurationWithLabel } from "../types.ts";

const logger = baseLogger.component("websocket-publisher");

/** Default interval for WebSocket ping/keepalive messages */
const DEFAULT_PING_INTERVAL_MS = 30_000;

/** Default timeout for tool call approval requests */
const DEFAULT_APPROVAL_TIMEOUT_MS = 60_000;

/** Default timeout for user input requests (5 minutes) */
const DEFAULT_INPUT_TIMEOUT_MS = 300_000;

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
  private commandHandlers = createSubscriberSet<[ClientCommand]>((error) => {
    if (this.config.debug) {
      logger.error("Handler error", error);
    }
  });
  private closed = false;
  private pingTimer: number | null = null;

  constructor(config: WebSocketPublisherConfig) {
    if (typeof config.runId !== "string" || !config.runId.trim()) {
      throw INVALID_ARGUMENT.create({ detail: "WebSocket publisher runId must not be empty" });
    }
    if (config.pingInterval !== undefined && config.pingInterval !== 0) {
      parsePositiveDurationWithLabel(
        config.pingInterval,
        "WebSocket publisher pingInterval",
      );
    }
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

    socket.addEventListener("message", (event) => {
      try {
        const parsed: unknown = JSON.parse(event.data);
        if (!parsed || typeof parsed !== "object") return;
        const command = parsed as ClientCommand;
        this.handleCommand(command);
      } catch (error) {
        if (this.config.debug) {
          logger.error("Failed to parse command", error);
        }
      }
    });

    socket.addEventListener("close", () => {
      this.closed = true;
      this.stopPingInterval();
      this.commandHandlers.clear();
    });

    socket.addEventListener("error", (event) => {
      if (this.config.debug) {
        logger.error("Socket error", { event: String(event) });
      }
      // Stop ping interval on error to prevent resource leak
      // The socket may or may not close after an error, but we should
      // proactively clean up in case the close event doesn't fire
      this.stopPingInterval();
    });
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
    this.commandHandlers.notify(command);
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
    return this.commandHandlers.subscribe(handler);
  }

  /**
   * Send an event to the client
   */
  send(event: ClaudeCodeEventExtended): void {
    if (this.closed) {
      throw ORCHESTRATION_ERROR.create({ detail: "WebSocket publisher is closed" });
    }

    const { socket } = this.config;
    if (socket.readyState !== WebSocket.OPEN) {
      throw ORCHESTRATION_ERROR.create({ detail: "WebSocket is not open" });
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

    socket.addEventListener("open", () => {
      const publisher = new WebSocketPublisher({
        socket,
        runId,
        debug: config.debug,
      });

      void Promise.resolve()
        .then(() => config.onConnection(publisher, runId))
        .catch((error) => {
          logger.error("WebSocket connection callback failed", {
            runId,
            errorName: error instanceof Error ? error.name : typeof error,
          });
          publisher.close();
        });

      socket.addEventListener("close", () => {
        void Promise.resolve()
          .then(() => config.onClose?.(runId))
          .catch((error) => {
            logger.error("WebSocket close callback failed", {
              runId,
              errorName: error instanceof Error ? error.name : typeof error,
            });
          });
      }, { once: true });
    }, { once: true });

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
  private unsubscribeCommand: () => void;
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
    if (config.approvalTimeout !== undefined) {
      parsePositiveDurationWithLabel(config.approvalTimeout, "Agent approvalTimeout");
    }
    if (config.inputTimeout !== undefined) {
      parsePositiveDurationWithLabel(config.inputTimeout, "Agent inputTimeout");
    }
    // Subscribe to commands
    this.unsubscribeCommand = publisher.onCommand((command) => this.handleCommand(command));
  }

  private handleCommand(command: ClientCommand): void {
    if (this.disposed) return;
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

    // Reject all pending approvals
    for (const [, pending] of this.pendingApprovals) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(ORCHESTRATION_ERROR.create({ detail: "Cancelled" }));
    }
    this.pendingApprovals.clear();

    // Reject all pending inputs
    for (const pending of this.inputResolvers) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(ORCHESTRATION_ERROR.create({ detail: "Cancelled" }));
    }
    this.inputResolvers = [];

    this.config.onCancel?.(reason);
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
      return Promise.reject(ORCHESTRATION_ERROR.create({ detail: "Agent cancelled" }));
    }
    if (this.disposed) {
      return Promise.reject(ORCHESTRATION_ERROR.create({ detail: "Agent controller disposed" }));
    }
    if (this.pendingApprovals.has(toolCallId)) {
      return Promise.reject(
        INVALID_ARGUMENT.create({ detail: `Approval is already pending: ${toolCallId}` }),
      );
    }

    const timeout = this.config.approvalTimeout ?? DEFAULT_APPROVAL_TIMEOUT_MS;

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
      return Promise.reject(ORCHESTRATION_ERROR.create({ detail: "Agent cancelled" }));
    }
    if (this.disposed) {
      return Promise.reject(ORCHESTRATION_ERROR.create({ detail: "Agent controller disposed" }));
    }

    const timeout = this.config.inputTimeout ?? DEFAULT_INPUT_TIMEOUT_MS;

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
          reject(TIMEOUT_ERROR.create({ detail: "Input timeout" }));
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
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeCommand();
    const disposalError = ORCHESTRATION_ERROR.create({ detail: "Agent controller disposed" });

    // Clear all pending operations
    for (const [, pending] of this.pendingApprovals) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(disposalError);
    }
    this.pendingApprovals.clear();

    for (const pending of this.inputResolvers) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(disposalError);
    }
    this.inputResolvers = [];
  }
}
