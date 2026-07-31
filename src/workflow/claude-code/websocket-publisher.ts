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
  ClientCommandDisposition,
  ClientCommandHandler,
  ClientCommandObserver,
  ClientCommandType,
  CommandAckEvent,
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

/** Default maximum lifetime for an authoritative command handler. */
const DEFAULT_COMMAND_HANDLER_TIMEOUT_MS = 30_000;

const MAX_CLIENT_COMMAND_BYTES = 64 * 1024;
const MAX_CLIENT_COMMAND_TEXT_LENGTH = 32 * 1024;
const MAX_CLIENT_COMMAND_ID_LENGTH = 256;
const MAX_TRACKED_CLIENT_COMMANDS = 256;

interface CommandLedgerEntry {
  readonly fingerprint: string;
  ack?: CommandAckEvent;
}

interface RejectedCommandContext {
  readonly commandId: string;
  readonly commandType: ClientCommandType;
  readonly requestId?: string;
}

const CLIENT_COMMAND_TYPES = new Set<ClientCommandType>([
  "cancel",
  "approve",
  "reject",
  "input",
  "ping",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDataProperty(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function hasExactDataProperties(record: object, allowed: ReadonlySet<string>): boolean {
  const keys = Reflect.ownKeys(record);
  return keys.every((key) =>
    typeof key === "string" && allowed.has(key) &&
    (() => {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      return descriptor?.enumerable === true && "value" in descriptor;
    })()
  );
}

function isBoundedString(
  value: unknown,
  maxLength = MAX_CLIENT_COMMAND_TEXT_LENGTH,
): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function isBoundedIdentifier(value: unknown): value is string {
  return isBoundedString(value, MAX_CLIENT_COMMAND_ID_LENGTH) && value.length > 0;
}

function admitClientCommand(data: unknown, expectedRunId: string): ClientCommand | null {
  if (typeof data !== "string") return null;
  if (data.length > MAX_CLIENT_COMMAND_BYTES) return null;
  if (new TextEncoder().encode(data).byteLength > MAX_CLIENT_COMMAND_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const type = readDataProperty(parsed, "type");
  const timestamp = readDataProperty(parsed, "timestamp");
  const runId = readDataProperty(parsed, "runId");
  const commandId = readDataProperty(parsed, "commandId");
  if (
    typeof type !== "string" ||
    typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < 0 ||
    runId !== expectedRunId ||
    (commandId !== undefined && !isBoundedIdentifier(commandId))
  ) return null;

  const baseKeys = ["type", "timestamp", "runId", "commandId"];
  const commandBase = {
    timestamp,
    runId,
    ...(commandId === undefined ? {} : { commandId }),
  };
  switch (type) {
    case "cancel": {
      if (!hasExactDataProperties(parsed, new Set([...baseKeys, "reason"]))) return null;
      const reason = readDataProperty(parsed, "reason");
      if (reason !== undefined && !isBoundedString(reason)) return null;
      return { type, ...commandBase, ...(reason === undefined ? {} : { reason }) };
    }
    case "approve": {
      if (!hasExactDataProperties(parsed, new Set([...baseKeys, "toolCallId"]))) {
        return null;
      }
      const toolCallId = readDataProperty(parsed, "toolCallId");
      if (!isBoundedIdentifier(toolCallId)) return null;
      return {
        type,
        ...commandBase,
        toolCallId,
      } as ClientCommand;
    }
    case "reject": {
      if (
        !hasExactDataProperties(
          parsed,
          new Set([...baseKeys, "toolCallId", "reason"]),
        )
      ) {
        return null;
      }
      const toolCallId = readDataProperty(parsed, "toolCallId");
      const reason = readDataProperty(parsed, "reason");
      if (!isBoundedIdentifier(toolCallId)) return null;
      if (reason !== undefined && !isBoundedString(reason)) return null;
      return {
        type,
        ...commandBase,
        toolCallId,
        ...(reason === undefined ? {} : { reason }),
      } as ClientCommand;
    }
    case "input": {
      if (!hasExactDataProperties(parsed, new Set([...baseKeys, "content", "requestId"]))) {
        return null;
      }
      const content = readDataProperty(parsed, "content");
      const requestId = readDataProperty(parsed, "requestId");
      if (!isBoundedString(content)) return null;
      if (requestId !== undefined && !isBoundedIdentifier(requestId)) return null;
      return {
        type,
        ...commandBase,
        content,
        ...(requestId === undefined ? {} : { requestId }),
      };
    }
    case "ping":
      return hasExactDataProperties(parsed, new Set(baseKeys)) ? { type, ...commandBase } : null;
    default:
      return null;
  }
}

function readRejectedCommandContext(data: unknown): RejectedCommandContext | null {
  if (typeof data !== "string") return null;
  if (data.length > MAX_CLIENT_COMMAND_BYTES) return null;
  if (new TextEncoder().encode(data).byteLength > MAX_CLIENT_COMMAND_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const commandId = readDataProperty(parsed, "commandId");
  const commandType = readDataProperty(parsed, "type");
  if (
    !isBoundedIdentifier(commandId) || typeof commandType !== "string" ||
    !CLIENT_COMMAND_TYPES.has(commandType as ClientCommandType)
  ) return null;
  const requestId = commandType === "input" ? readDataProperty(parsed, "requestId") : undefined;
  if (requestId !== undefined && !isBoundedIdentifier(requestId)) return null;
  return {
    commandId,
    commandType: commandType as ClientCommandType,
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function fingerprintClientCommand(command: ClientCommand): string {
  switch (command.type) {
    case "cancel":
      return JSON.stringify({ type: command.type, runId: command.runId, reason: command.reason });
    case "approve":
      return JSON.stringify({
        type: command.type,
        runId: command.runId,
        toolCallId: command.toolCallId,
      });
    case "reject":
      return JSON.stringify({
        type: command.type,
        runId: command.runId,
        toolCallId: command.toolCallId,
        reason: command.reason,
      });
    case "input":
      return JSON.stringify({
        type: command.type,
        runId: command.runId,
        requestId: command.requestId,
        content: command.content,
      });
    case "ping":
      return JSON.stringify({ type: command.type, runId: command.runId });
  }
}

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

  /** Maximum time for the authoritative command handler to settle. */
  commandHandlerTimeout?: number;
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
  private commandHandler: ClientCommandHandler | null = null;
  private commandObservers = new Set<ClientCommandObserver>();
  private commandLedger = new Map<string, CommandLedgerEntry>();
  private commandHandlerTimers = new Set<number>();
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
    if (config.commandHandlerTimeout !== undefined) {
      parsePositiveDurationWithLabel(
        config.commandHandlerTimeout,
        "WebSocket publisher commandHandlerTimeout",
      );
    }
    this.config = {
      debug: false,
      pingInterval: DEFAULT_PING_INTERVAL_MS,
      commandHandlerTimeout: DEFAULT_COMMAND_HANDLER_TIMEOUT_MS,
      ...config,
    };

    this.setupSocketListeners();
    this.startPingInterval();
  }

  private setupSocketListeners(): void {
    const { socket } = this.config;

    socket.addEventListener("message", (event) => {
      const command = admitClientCommand(event.data, this.config.runId);
      if (command) {
        this.handleCommand(command);
        return;
      }
      const rejected = readRejectedCommandContext(event.data);
      if (rejected) {
        this.trySend({
          type: "command_ack",
          timestamp: Date.now(),
          runId: this.config.runId,
          commandId: rejected.commandId,
          commandType: rejected.commandType,
          status: "rejected",
          ...(rejected.requestId === undefined ? {} : { requestId: rejected.requestId }),
          reason: "command failed protocol admission",
        });
      }
    });

    socket.addEventListener("close", () => {
      this.closed = true;
      this.stopPingInterval();
      this.stopCommandHandlerTimers();
      this.commandHandler = null;
      this.commandObservers.clear();
      this.commandLedger.clear();
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

    const commandId = command.commandId;
    if (!commandId) {
      if (command.type === "ping") this.sendPong();
      else this.dispatchLegacyCommand(command);
      return;
    }

    const fingerprint = fingerprintClientCommand(command);
    const existing = this.commandLedger.get(commandId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        this.sendCommandAck(command, "rejected", "commandId was reused for another command");
      } else if (existing.ack) {
        this.send(existing.ack);
      }
      return;
    }
    if (!this.reserveCommand(commandId, fingerprint)) {
      this.sendCommandAck(command, "rejected", "too many commands are awaiting acknowledgement");
      return;
    }

    if (command.type === "ping") {
      this.sendPong();
      this.finishKeyedCommand(command, { status: "accepted" });
      return;
    }
    this.notifyCommandObservers(command);
    this.dispatchKeyedCommand(command);
  }

  private dispatchLegacyCommand(command: ClientCommand): void {
    this.notifyCommandObservers(command);
    const handler = this.commandHandler;
    if (!handler) return;
    try {
      void Promise.resolve(handler(command)).catch((error) => this.reportHandlerError(error));
    } catch (error) {
      this.reportHandlerError(error);
    }
  }

  private notifyCommandObservers(command: ClientCommand): void {
    for (const observer of [...this.commandObservers]) {
      try {
        void Promise.resolve(observer(structuredClone(command))).catch((error) =>
          this.reportHandlerError(error)
        );
      } catch (error) {
        this.reportHandlerError(error);
      }
    }
  }

  private dispatchKeyedCommand(command: ClientCommand): void {
    const handler = this.commandHandler;
    if (!handler) {
      this.finishKeyedCommand(command, {
        status: "rejected",
        reason: "no authoritative handler accepted",
      });
      return;
    }

    let finished = false;
    const finish = (disposition: ClientCommandDisposition): void => {
      if (finished || this.closed) return;
      finished = true;
      clearTimeout(timeoutId);
      this.commandHandlerTimers.delete(timeoutId);
      this.finishKeyedCommand(command, disposition);
    };
    const timeoutId = globalThis.setTimeout(() => {
      finish({ status: "rejected", reason: "command handler timed out" });
    }, this.config.commandHandlerTimeout);
    this.commandHandlerTimers.add(timeoutId);

    let result: ReturnType<ClientCommandHandler>;
    try {
      result = handler(command);
    } catch (error) {
      this.reportHandlerError(error);
      finish({ status: "rejected", reason: "command handler rejected the command" });
      return;
    }
    void Promise.resolve(result)
      .then((disposition) => {
        finish(
          disposition ?? {
            status: "rejected",
            reason: "no authoritative handler accepted",
          },
        );
      })
      .catch((error) => {
        this.reportHandlerError(error);
        finish({ status: "rejected", reason: "command handler rejected the command" });
      });
  }

  private reserveCommand(commandId: string, fingerprint: string): boolean {
    while (this.commandLedger.size >= MAX_TRACKED_CLIENT_COMMANDS) {
      const settledId = [...this.commandLedger].find(([, entry]) => entry.ack)?.[0];
      if (!settledId) return false;
      this.commandLedger.delete(settledId);
    }
    this.commandLedger.set(commandId, { fingerprint });
    return true;
  }

  private finishKeyedCommand(
    command: ClientCommand,
    disposition: ClientCommandDisposition,
  ): void {
    const commandId = command.commandId;
    if (!commandId) return;
    const reason = disposition.status === "rejected" ? disposition.reason : undefined;
    const ack = this.createCommandAck(command, disposition.status, reason);
    const entry = this.commandLedger.get(commandId);
    if (entry) entry.ack = ack;
    this.trySend(ack);
  }

  private createCommandAck(
    command: ClientCommand,
    status: "accepted" | "rejected",
    reason?: string,
  ): CommandAckEvent {
    const requestId = "requestId" in command ? command.requestId : undefined;
    return {
      type: "command_ack",
      timestamp: Date.now(),
      runId: this.config.runId,
      commandId: command.commandId!,
      commandType: command.type,
      status,
      ...(requestId === undefined ? {} : { requestId }),
      ...(reason === undefined ? {} : { reason }),
    };
  }

  private sendCommandAck(
    command: ClientCommand,
    status: "accepted" | "rejected",
    reason?: string,
  ): void {
    this.trySend(this.createCommandAck(command, status, reason));
  }

  private trySend(event: ClaudeCodeEventExtended): boolean {
    try {
      this.send(event);
      return true;
    } catch (error) {
      if (this.config.debug) logger.error("Failed to send event", error);
      return false;
    }
  }

  private reportHandlerError(error: unknown): void {
    if (this.config.debug) logger.error("Handler error", error);
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

  private stopCommandHandlerTimers(): void {
    for (const timer of this.commandHandlerTimers) clearTimeout(timer);
    this.commandHandlerTimers.clear();
  }

  /**
   * Subscribe to client commands
   */
  onCommand(handler: ClientCommandHandler): () => void {
    if (this.commandHandler !== null) {
      throw ORCHESTRATION_ERROR.create({
        detail: "WebSocket publisher already has an authoritative handler",
      });
    }
    this.commandHandler = handler;
    return () => {
      if (this.commandHandler === handler) this.commandHandler = null;
    };
  }

  /** Subscribe to admitted commands without participating in acknowledgement. */
  observeCommands(observer: ClientCommandObserver): () => void {
    this.commandObservers.add(observer);
    return () => this.commandObservers.delete(observer);
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
    this.stopCommandHandlerTimers();

    const { socket } = this.config;
    if (socket.readyState === WebSocket.OPEN) {
      socket.close();
    }

    this.commandHandler = null;
    this.commandObservers.clear();
    this.commandLedger.clear();
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
  private publisher: BidirectionalPublisher;
  private cancelled = false;
  private disposed = false;
  private unsubscribeCommand: () => void = () => {};
  private handledCommands = new Map<
    string,
    { fingerprint: string; disposition: ClientCommandDisposition }
  >();
  private pendingApprovals = new Map<
    string,
    {
      resolve: (approved: boolean) => void;
      reject: (error: Error) => void;
      timeout: number | null;
    }
  >();
  private inputResolvers = new Map<string, {
    resolve: (input: string) => void;
    reject: (error: Error) => void;
    timeout: number | null;
  }>();
  private nextInputRequestId = 1;

  constructor(
    publisher: BidirectionalPublisher,
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
    this.publisher = publisher;
    this.attachPublisher(publisher);
  }

  /** Replace the transport while preserving run-scoped command idempotency. */
  attachPublisher(publisher: BidirectionalPublisher): void {
    if (this.disposed) {
      throw ORCHESTRATION_ERROR.create({ detail: "Agent controller disposed" });
    }
    this.unsubscribeCommand();
    this.publisher = publisher;
    this.unsubscribeCommand = publisher.onCommand((command) => this.handleCommand(command));
  }

  private handleCommand(command: ClientCommand): ClientCommandDisposition {
    if (this.disposed) return { status: "rejected", reason: "Agent controller disposed" };
    const commandId = command.commandId;
    const fingerprint = commandId ? fingerprintClientCommand(command) : undefined;
    if (commandId && fingerprint) {
      const existing = this.handledCommands.get(commandId);
      if (existing) {
        return existing.fingerprint === fingerprint
          ? existing.disposition
          : { status: "rejected", reason: "commandId was reused for another command" };
      }
    }

    let disposition: ClientCommandDisposition;
    switch (command.type) {
      case "cancel":
        this.handleCancel(command.reason);
        disposition = { status: "accepted" };
        break;

      case "approve":
        disposition = this.handleApproval(command.toolCallId, true)
          ? { status: "accepted" }
          : { status: "rejected", reason: "approval request is not pending" };
        break;

      case "reject":
        disposition = this.handleApproval(
            command.toolCallId,
            false,
            command.reason,
          )
          ? { status: "accepted" }
          : { status: "rejected", reason: "approval request is not pending" };
        break;

      case "input":
        disposition = this.handleInput(command.content, command.requestId)
          ? { status: "accepted" }
          : { status: "rejected", reason: "input request is not pending or is ambiguous" };
        break;

      case "ping":
        disposition = { status: "accepted" };
        break;
    }

    if (commandId && fingerprint) {
      while (this.handledCommands.size >= MAX_TRACKED_CLIENT_COMMANDS) {
        const oldest = this.handledCommands.keys().next().value;
        if (oldest === undefined) break;
        this.handledCommands.delete(oldest);
      }
      this.handledCommands.set(commandId, { fingerprint, disposition });
    }
    return disposition;
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
    for (const pending of this.inputResolvers.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(ORCHESTRATION_ERROR.create({ detail: "Cancelled" }));
    }
    this.inputResolvers.clear();

    this.config.onCancel?.(reason);
  }

  private handleApproval(
    toolCallId: string,
    approved: boolean,
    _reason?: string,
  ): boolean {
    const pending = this.pendingApprovals.get(toolCallId);
    if (!pending) return false;
    if (pending.timeout) clearTimeout(pending.timeout);
    pending.resolve(approved);
    this.pendingApprovals.delete(toolCallId);
    return true;
  }

  private handleInput(content: string, requestId?: string): boolean {
    let selectedId = requestId;
    if (selectedId === undefined) {
      if (this.inputResolvers.size !== 1) return false;
      selectedId = this.inputResolvers.keys().next().value;
    }
    if (selectedId === undefined) return false;
    const pending = this.inputResolvers.get(selectedId);
    if (!pending) return false;
    if (pending.timeout) clearTimeout(pending.timeout);
    this.inputResolvers.delete(selectedId);
    pending.resolve(content);
    return true;
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
    const requestId = `input-${this.nextInputRequestId++}`;

    // Send input request to client
    this.publisher.send({
      type: "input_request",
      timestamp: Date.now(),
      requestId,
      prompt,
      defaultValue,
      timeout,
    });

    return new Promise((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        this.inputResolvers.delete(requestId);
        if (defaultValue !== undefined) {
          resolve(defaultValue);
        } else {
          reject(TIMEOUT_ERROR.create({ detail: "Input timeout" }));
        }
      }, timeout);

      this.inputResolvers.set(requestId, {
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

    for (const pending of this.inputResolvers.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(disposalError);
    }
    this.inputResolvers.clear();
    this.handledCommands.clear();
  }
}
