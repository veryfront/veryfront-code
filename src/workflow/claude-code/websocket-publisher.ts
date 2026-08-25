/**
 * WebSocket Event Publisher
 *
 * Provides bidirectional communication between client and agent.
 */

import { logger as baseLogger } from "#veryfront/utils";
import type {
  ApprovalRequestEvent,
  BidirectionalPublisher,
  CancelledEvent,
  ClaudeCodeEvent,
  ClaudeCodeEventExtended,
  ClientCommand,
  ClientCommandDisposition,
  ClientCommandHandler,
  ClientCommandObserver,
  CommandAckEvent,
  InputRequestEvent,
  PongEvent,
} from "./types.ts";
import {
  admitClaudeCodeClientCommandDisposition as admitClientCommandDisposition,
  admitClaudeCodeClientCommandMessage,
  encodeClaudeCodeEventMessage,
  isClaudeCodeWireField as isBoundedString,
  isClaudeCodeWireIdentifier as isBoundedIdentifier,
  readRejectedClaudeCodeClientCommandContext as readRejectedCommandContext,
  snapshotClaudeCodeWireRecord,
} from "./wire-protocol.ts";
import { INVALID_ARGUMENT, ORCHESTRATION_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";
import {
  upgradeWebSocket,
  type WebSocketUpgradeResult,
} from "#veryfront/platform/compat/http/index.ts";
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

const MAX_TRACKED_CLIENT_COMMANDS = 256;

interface CommandLedgerEntry {
  readonly fingerprint: string;
  ack?: CommandAckEvent;
}

function snapshotApprovalInput(
  input: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  const snapshot = snapshotClaudeCodeWireRecord(input);
  if (!snapshot) {
    throw INVALID_ARGUMENT.create({ detail: "Approval input is not bounded wire JSON" });
  }
  return snapshot;
}

function serializeWireEvent(event: ClaudeCodeEventExtended): string {
  const encoding = encodeClaudeCodeEventMessage(event, true);
  if (!encoding.ok) {
    throw INVALID_ARGUMENT.create({ detail: encoding.reason });
  }
  return encoding.data;
}

function admitClientCommand(data: unknown, expectedRunId: string): ClientCommand | null {
  const admission = admitClaudeCodeClientCommandMessage(data, expectedRunId);
  return admission.ok ? admission.event : null;
}

function fingerprintClientCommand(command: ClientCommand): string {
  switch (command.type) {
    case "cancel":
      return JSON.stringify({ type: command.type, runId: command.runId, reason: command.reason });
    case "approve":
      return JSON.stringify({
        type: command.type,
        runId: command.runId,
        requestId: command.requestId,
        toolCallId: command.toolCallId,
      });
    case "reject":
      return JSON.stringify({
        type: command.type,
        runId: command.runId,
        requestId: command.requestId,
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

/** Run-scoped controller policy. */
export interface AgentControllerConfig {
  /** Maximum time to wait for an approval decision. */
  approvalTimeout?: number;
  /** Maximum time to wait for requested input. */
  inputTimeout?: number;
  /** Invoked after an admitted cancellation command. */
  onCancel?: (reason?: string) => void;
}

/** Run-scoped command surface without transport lifecycle authority. */
export interface AgentControllerHandle {
  /** Immutable workflow run identity. */
  readonly runId: string;
  /** Whether an admitted cancellation command ended the run. */
  readonly isCancelled: boolean;
  /** Request an exactly correlated tool approval. */
  requestApproval(
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
    reason: string,
  ): Promise<boolean>;
  /** Request user input for this run. */
  requestInput(prompt: string, defaultValue?: string): Promise<string>;
}

/** Opaque ownership token for one run controller generation. */
export interface AgentControllerRunRegistration {
  /** Immutable workflow run identity. */
  readonly runId: string;
  /** Unique identity for this controller generation. */
  readonly generation: symbol;
  /** Controller retained for the lifetime of this run generation. */
  readonly controller: AgentControllerHandle;
}

/** Opaque ownership token for one run publisher generation. */
export interface AgentControllerRegistration {
  /** Stable controller ownership token shared by reconnecting publishers. */
  readonly run: AgentControllerRunRegistration;
  /** Immutable workflow run identity. */
  readonly runId: string;
  /** Unique identity for this publisher generation. */
  readonly generation: symbol;
  /** Publisher owned by this exact registration. */
  readonly publisher: BidirectionalPublisher;
  /** Run controller shared by reconnecting publishers. */
  readonly controller: AgentControllerHandle;
}

/**
 * WebSocket-based bidirectional publisher
 *
 * Enables two-way communication:
 * - Server → Client: Events (text, tool calls, results)
 * - Client → Server: Commands (cancel, approve, reject, input)
 */
export class WebSocketPublisher implements BidirectionalPublisher {
  readonly #connectionRunId: string;
  private readonly config: Required<Omit<WebSocketPublisherConfig, "socket" | "runId">> & {
    readonly socket: WebSocket;
  };
  private commandHandler: ClientCommandHandler | null = null;
  private commandObservers = new Set<ClientCommandObserver>();
  private commandLedger = new Map<string, CommandLedgerEntry>();
  private commandHandlerTimers = new Set<number>();
  private closed = false;
  private pingTimer: number | null = null;

  constructor(config: WebSocketPublisherConfig) {
    const runId = config.runId;
    if (typeof runId !== "string" || !runId.trim()) {
      throw INVALID_ARGUMENT.create({ detail: "WebSocket publisher runId must not be empty" });
    }
    if (!isBoundedIdentifier(runId)) {
      throw INVALID_ARGUMENT.create({ detail: "WebSocket publisher runId is not canonical" });
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
    this.#connectionRunId = runId;
    Object.defineProperty(this, "runId", {
      configurable: false,
      enumerable: true,
      get: () => this.#connectionRunId,
    });
    this.config = {
      socket: config.socket,
      debug: config.debug ?? false,
      pingInterval: config.pingInterval ?? DEFAULT_PING_INTERVAL_MS,
      commandHandlerTimeout: config.commandHandlerTimeout ?? DEFAULT_COMMAND_HANDLER_TIMEOUT_MS,
    };

    this.setupSocketListeners();
    this.startPingInterval();
  }

  get runId(): string {
    return this.#connectionRunId;
  }

  private setupSocketListeners(): void {
    const { socket } = this.config;

    socket.addEventListener("message", (event) => {
      const command = admitClientCommand(event.data, this.#connectionRunId);
      if (command) {
        this.handleCommand(command);
        return;
      }
      const rejected = readRejectedCommandContext(event.data);
      if (rejected) {
        const acknowledgementBase = {
          type: "command_ack",
          timestamp: Date.now(),
          runId: this.#connectionRunId,
          commandId: rejected.commandId,
          status: "rejected",
          reason: "command failed protocol admission",
        } as const;
        if (rejected.commandType === "approve" || rejected.commandType === "reject") {
          if (rejected.requestId !== undefined) {
            this.trySend({
              ...acknowledgementBase,
              commandType: rejected.commandType,
              requestId: rejected.requestId,
            });
          }
        } else if (rejected.commandType === "input") {
          this.trySend({
            ...acknowledgementBase,
            commandType: rejected.commandType,
            ...(rejected.requestId === undefined ? {} : { requestId: rejected.requestId }),
          });
        } else {
          this.trySend({ ...acknowledgementBase, commandType: rejected.commandType });
        }
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
    const finishResult = (value: unknown): void => {
      if (value === undefined) {
        finish({ status: "rejected", reason: "no authoritative handler accepted" });
        return;
      }
      finish(
        admitClientCommandDisposition(value) ?? {
          status: "rejected",
          reason: "command handler returned an invalid disposition",
        },
      );
    };
    let nativePromise = false;
    try {
      nativePromise = result instanceof Promise;
    } catch {
      finishResult(result);
      return;
    }
    if (!nativePromise) {
      finishResult(result);
      return;
    }
    try {
      void Promise.prototype.then.call(
        result,
        finishResult,
        (error: unknown) => {
          this.reportHandlerError(error);
          finish({ status: "rejected", reason: "command handler rejected the command" });
        },
      );
    } catch {
      finish({
        status: "rejected",
        reason: "command handler returned an invalid disposition",
      });
    }
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
    const acknowledgementBase = {
      type: "command_ack",
      timestamp: Date.now(),
      runId: this.#connectionRunId,
      commandId: command.commandId!,
      status,
      ...(reason === undefined ? {} : { reason }),
    } as const;
    switch (command.type) {
      case "approve":
      case "reject":
        return {
          ...acknowledgementBase,
          commandType: command.type,
          requestId: command.requestId,
        };
      case "input":
        return {
          ...acknowledgementBase,
          commandType: command.type,
          ...(command.requestId === undefined ? {} : { requestId: command.requestId }),
        };
      case "cancel":
      case "ping":
        return { ...acknowledgementBase, commandType: command.type };
    }
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
      runId: this.#connectionRunId,
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
          runId: this.#connectionRunId,
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
    if (this.closed) {
      throw ORCHESTRATION_ERROR.create({ detail: "WebSocket publisher is closed" });
    }
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
    if (event.runId !== undefined && event.runId !== this.#connectionRunId) {
      throw INVALID_ARGUMENT.create({
        detail: "Claude Code event runId does not match the publisher",
      });
    }

    const { socket } = this.config;
    if (socket.readyState !== WebSocket.OPEN) {
      throw ORCHESTRATION_ERROR.create({ detail: "WebSocket is not open" });
    }

    socket.send(serializeWireEvent(event));

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
      runId: this.#connectionRunId,
      ...(reason === undefined ? {} : { reason }),
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
 * Configuration for a registry-owned WebSocket upgrade handler.
 */
export interface WebSocketHandlerConfig {
  /** Get run ID from request */
  getRunId: (req: Request) => string | null;

  /**
   * Run-keyed controller ownership.
   *
   * A socket close releases its run by default. When `retainRunOnClose` is
   * enabled, the caller must invoke `releaseRun()` with the exact run
   * registration when the run itself ends.
   */
  registry: AgentControllerRegistry;

  /** Called when a current connection generation is established. */
  onConnection: (registration: AgentControllerRegistration) => void | Promise<void>;

  /** Called only when the exact current connection generation closes. */
  onClose?: (registration: AgentControllerRegistration) => void | Promise<void>;

  /** WebSocket upgrade implementation. Defaults to the portable runtime adapter. */
  upgradeWebSocket?: (request: Request) => WebSocketUpgradeResult;

  /**
   * Retain run-scoped state after its socket closes.
   *
   * Use this only when the application terminally calls `releaseRun()` for
   * every admitted run. Defaults to false so arbitrary run IDs cannot leave
   * persistent registry entries.
   */
  retainRunOnClose?: boolean;

  /** Enable debug logging */
  debug?: boolean;
}

function releaseUnpublishedRun(
  registry: AgentControllerRegistry,
  registration: AgentControllerRegistration,
): void {
  if (registry.getPublisher(registration.runId) === undefined) {
    registry.releaseRun(registration.run);
  }
}

/** Create a WebSocket handler for HTTP upgrade requests. */
export function createWebSocketHandler(
  config: WebSocketHandlerConfig,
): (req: Request) => Response {
  const { registry } = config;
  return (req: Request): Response => {
    const runId = config.getRunId(req);
    if (!runId) {
      return new Response("Missing runId", { status: 400 });
    }
    if (!isBoundedIdentifier(runId)) {
      return new Response("Invalid runId", { status: 400 });
    }

    const { socket, response } = (config.upgradeWebSocket ?? upgradeWebSocket)(req);

    socket.addEventListener("open", () => {
      let publisher: WebSocketPublisher;
      try {
        publisher = new WebSocketPublisher({
          socket,
          runId,
          debug: config.debug,
        });
      } catch (error) {
        logger.error("WebSocket publisher setup failed", {
          runId,
          errorName: error instanceof Error ? error.name : typeof error,
        });
        try {
          socket.close();
        } catch (cleanupError) {
          logger.error("WebSocket setup failure cleanup failed", {
            runId,
            errorName: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
          });
        }
        return;
      }
      let registration: AgentControllerRegistration;
      try {
        registration = registry.register(publisher);
      } catch (error) {
        logger.error("WebSocket publisher registration failed", {
          runId,
          errorName: error instanceof Error ? error.name : typeof error,
        });
        try {
          publisher.close();
        } catch (cleanupError) {
          logger.error("WebSocket publisher registration cleanup failed", {
            runId,
            errorName: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
          });
        }
        return;
      }

      void Promise.resolve()
        .then(() => {
          if (registry.getPublisher(runId) !== registration) return;
          return config.onConnection(registration);
        })
        .catch((error) => {
          logger.error("WebSocket connection callback failed", {
            runId,
            errorName: error instanceof Error ? error.name : typeof error,
          });
          try {
            if (registry.detach(registration)) {
              releaseUnpublishedRun(registry, registration);
            } else {
              publisher.close();
            }
          } catch (cleanupError) {
            logger.error("WebSocket connection cleanup failed", {
              runId,
              errorName: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
            });
          }
        });

      socket.addEventListener("close", () => {
        let detached = false;
        try {
          detached = registry.detach(registration);
        } catch (error) {
          logger.error("WebSocket registry detach failed", {
            runId,
            errorName: error instanceof Error ? error.name : typeof error,
          });
        }
        if (!detached) return;
        if (!config.retainRunOnClose) {
          try {
            releaseUnpublishedRun(registry, registration);
          } catch (error) {
            logger.error("WebSocket run release failed", {
              runId,
              errorName: error instanceof Error ? error.name : typeof error,
            });
          }
        }
        void Promise.resolve()
          .then(() => config.onClose?.(registration))
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

interface AgentControllerAuthority {
  attach(publisher: BidirectionalPublisher, runId: string): void;
  detach(publisher: BidirectionalPublisher): boolean;
  dispose(): void;
}

interface AgentControllerTransport {
  readonly generation: symbol;
  readonly publisher: BidirectionalPublisher;
  readonly unsubscribe: () => void;
}

type PendingInputRequestEvent = Readonly<
  InputRequestEvent & {
    readonly runId: string;
    readonly requestId: string;
    readonly timeout: number;
  }
>;

interface PendingInputOperation {
  readonly event: PendingInputRequestEvent;
  readonly resolve: (input: string) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: number | null;
}

interface PendingApprovalOperation {
  readonly event: Readonly<ApprovalRequestEvent>;
  readonly resolve: (approved: boolean) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: number | null;
}

const CONTROLLER_AUTHORITIES = new WeakMap<AgentControllerHandle, AgentControllerAuthority>();

function getControllerAuthority(controller: AgentControllerHandle): AgentControllerAuthority {
  const authority = CONTROLLER_AUTHORITIES.get(controller);
  if (!authority) {
    throw ORCHESTRATION_ERROR.create({ detail: "Agent controller lifecycle authority is missing" });
  }
  return authority;
}

/** Registry-owned implementation; registrations expose no disposal authority. */
class RunAgentController implements AgentControllerHandle {
  readonly #runId: string;
  readonly #config: Readonly<AgentControllerConfig>;
  #transport: AgentControllerTransport | null = null;
  #cancelled = false;
  #disposed = false;
  readonly #handledCommands = new Map<
    string,
    { fingerprint: string; disposition: ClientCommandDisposition }
  >();
  readonly #pendingApprovals = new Map<string, PendingApprovalOperation>();
  readonly #pendingApprovalByToolCallId = new Map<string, string>();
  readonly #inputResolvers = new Map<string, PendingInputOperation>();
  #nextInputRequestId = 1;
  #nextApprovalRequestSequence = 1;
  readonly #requestNamespace: string;

  constructor(
    publisher: BidirectionalPublisher,
    runId: string,
    config: AgentControllerConfig = {},
  ) {
    if (config.approvalTimeout !== undefined) {
      parsePositiveDurationWithLabel(config.approvalTimeout, "Agent approvalTimeout");
    }
    if (config.inputTimeout !== undefined) {
      parsePositiveDurationWithLabel(config.inputTimeout, "Agent inputTimeout");
    }
    if (!isBoundedIdentifier(runId)) {
      throw INVALID_ARGUMENT.create({
        detail: "Agent publisher runId must be a bounded identifier",
      });
    }
    let requestNamespace: string;
    try {
      requestNamespace = globalThis.crypto.randomUUID();
    } catch (cause) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Agent request identity generation is unavailable",
        cause,
      });
    }
    if (!isBoundedIdentifier(requestNamespace)) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Agent request identity generation returned an invalid identifier",
      });
    }
    this.#runId = runId;
    this.#requestNamespace = requestNamespace;
    this.#config = Object.freeze({ ...config });
    Object.defineProperty(this, "runId", {
      configurable: false,
      enumerable: true,
      get: () => this.#runId,
    });
    CONTROLLER_AUTHORITIES.set(
      this,
      Object.freeze({
        attach: (replacement: BidirectionalPublisher, replacementRunId: string) =>
          this.#attachPublisher(replacement, replacementRunId),
        detach: (current: BidirectionalPublisher) => this.#detachPublisher(current),
        dispose: () => this.#dispose(),
      }),
    );
    this.#attachPublisher(publisher, runId);
  }

  get runId(): string {
    return this.#runId;
  }

  #attachPublisher(publisher: BidirectionalPublisher, knownRunId?: string): void {
    if (this.#disposed) {
      throw ORCHESTRATION_ERROR.create({ detail: "Agent controller disposed" });
    }
    const publisherRunId = knownRunId ?? publisher.runId;
    if (publisherRunId !== this.#runId) {
      throw INVALID_ARGUMENT.create({
        detail: "Replacement publisher runId does not match the agent controller",
      });
    }
    const generation = Symbol(this.#runId);
    const unsubscribeReplacement = publisher.onCommand((command) =>
      this.#handleCommand(command, generation)
    );
    const current = this.#transport;
    try {
      current?.unsubscribe();
    } catch (cause) {
      try {
        unsubscribeReplacement();
      } catch (cleanupCause) {
        throw new AggregateError(
          [cause, cleanupCause],
          "Agent controller publisher replacement failed and cleanup was incomplete",
        );
      }
      throw cause;
    }
    const replacement = {
      generation,
      publisher,
      unsubscribe: unsubscribeReplacement,
    };
    this.#transport = replacement;
    for (const pending of [...this.#pendingApprovals.values()]) {
      this.#deliverApproval(pending, replacement);
    }
    for (const pending of [...this.#inputResolvers.values()]) {
      this.#deliverInput(pending, replacement);
    }
  }

  #detachPublisher(publisher: BidirectionalPublisher): boolean {
    const current = this.#transport;
    if (!current || current.publisher !== publisher) return false;
    this.#transport = null;
    current.unsubscribe();
    return true;
  }

  #handleCommand(
    command: ClientCommand,
    transportGeneration: symbol,
  ): ClientCommandDisposition {
    if (this.#disposed) return { status: "rejected", reason: "Agent controller disposed" };
    if (this.#transport?.generation !== transportGeneration) {
      return { status: "rejected", reason: "publisher generation is retired" };
    }
    if (command.runId !== this.#runId) {
      return { status: "rejected", reason: "command runId does not match the agent controller" };
    }
    const commandId = command.commandId;
    const fingerprint = commandId ? fingerprintClientCommand(command) : undefined;
    if (commandId && fingerprint) {
      const existing = this.#handledCommands.get(commandId);
      if (existing) {
        return existing.fingerprint === fingerprint
          ? existing.disposition
          : { status: "rejected", reason: "commandId was reused for another command" };
      }
    }

    let disposition: ClientCommandDisposition;
    switch (command.type) {
      case "cancel":
        this.#handleCancel(command.reason);
        disposition = { status: "accepted" };
        break;

      case "approve":
        disposition = this.#handleApproval(command.toolCallId, command.requestId, true)
          ? { status: "accepted" }
          : {
            status: "rejected",
            reason: "approval correlation does not match a pending request",
          };
        break;

      case "reject":
        disposition = this.#handleApproval(
            command.toolCallId,
            command.requestId,
            false,
            command.reason,
          )
          ? { status: "accepted" }
          : {
            status: "rejected",
            reason: "approval correlation does not match a pending request",
          };
        break;

      case "input":
        disposition = this.#handleInput(command.content, command.requestId)
          ? { status: "accepted" }
          : { status: "rejected", reason: "input request is not pending or is ambiguous" };
        break;

      case "ping":
        disposition = { status: "accepted" };
        break;
    }

    if (commandId && fingerprint) {
      while (this.#handledCommands.size >= MAX_TRACKED_CLIENT_COMMANDS) {
        const oldest = this.#handledCommands.keys().next().value;
        if (oldest === undefined) break;
        this.#handledCommands.delete(oldest);
      }
      this.#handledCommands.set(commandId, { fingerprint, disposition });
    }
    return disposition;
  }

  #handleCancel(reason?: string): void {
    this.#cancelled = true;

    // Reject all pending approvals
    for (const [, pending] of this.#pendingApprovals) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(ORCHESTRATION_ERROR.create({ detail: "Cancelled" }));
    }
    this.#pendingApprovals.clear();
    this.#pendingApprovalByToolCallId.clear();

    // Reject all pending inputs
    for (const pending of this.#inputResolvers.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(ORCHESTRATION_ERROR.create({ detail: "Cancelled" }));
    }
    this.#inputResolvers.clear();

    this.#config.onCancel?.(reason);
  }

  #handleApproval(
    toolCallId: string,
    requestId: string,
    approved: boolean,
    _reason?: string,
  ): boolean {
    const pending = this.#pendingApprovals.get(requestId);
    if (!pending || pending.event.toolCallId !== toolCallId) return false;
    if (pending.timeout) clearTimeout(pending.timeout);
    pending.resolve(approved);
    this.#pendingApprovals.delete(requestId);
    if (this.#pendingApprovalByToolCallId.get(toolCallId) === requestId) {
      this.#pendingApprovalByToolCallId.delete(toolCallId);
    }
    return true;
  }

  #createApprovalRequestId(): string {
    if (!Number.isSafeInteger(this.#nextApprovalRequestSequence)) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Agent approval request identity space is exhausted",
      });
    }
    const requestId = `${this.#requestNamespace}-${this.#nextApprovalRequestSequence.toString(36)}`;
    this.#nextApprovalRequestSequence += 1;
    return requestId;
  }

  #createInputRequestId(): string {
    if (
      !Number.isSafeInteger(this.#nextInputRequestId) ||
      this.#nextInputRequestId < 1
    ) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Agent input request identity space is exhausted",
      });
    }
    const requestId = `input-${this.#requestNamespace}-${this.#nextInputRequestId.toString(36)}`;
    if (!isBoundedIdentifier(requestId)) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Agent input request identity is not a bounded identifier",
      });
    }
    if (this.#inputResolvers.has(requestId)) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Agent input request identity collided with pending work",
      });
    }
    this.#nextInputRequestId += 1;
    return requestId;
  }

  #handleInput(content: string, requestId?: string): boolean {
    let selectedId = requestId;
    if (selectedId === undefined) {
      if (this.#inputResolvers.size !== 1) return false;
      selectedId = this.#inputResolvers.keys().next().value;
    }
    if (selectedId === undefined) return false;
    const pending = this.#inputResolvers.get(selectedId);
    if (!pending) return false;
    if (pending.timeout) clearTimeout(pending.timeout);
    this.#inputResolvers.delete(selectedId);
    pending.resolve(content);
    return true;
  }

  /**
   * Check if the agent has been cancelled
   */
  get isCancelled(): boolean {
    return this.#cancelled;
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
    if (this.#cancelled) {
      return Promise.reject(ORCHESTRATION_ERROR.create({ detail: "Agent cancelled" }));
    }
    if (this.#disposed) {
      return Promise.reject(ORCHESTRATION_ERROR.create({ detail: "Agent controller disposed" }));
    }
    if (this.#pendingApprovalByToolCallId.has(toolCallId)) {
      return Promise.reject(
        INVALID_ARGUMENT.create({ detail: `Approval is already pending: ${toolCallId}` }),
      );
    }

    let event: Readonly<ApprovalRequestEvent>;
    try {
      if (!isBoundedIdentifier(toolCallId)) {
        throw INVALID_ARGUMENT.create({
          detail: "Approval toolCallId is not a bounded identifier",
        });
      }
      if (!isBoundedString(toolName) || !isBoundedString(reason)) {
        throw INVALID_ARGUMENT.create({ detail: "Approval text exceeds the wire field limit" });
      }
      const timeout = this.#config.approvalTimeout ?? DEFAULT_APPROVAL_TIMEOUT_MS;
      const requestId = this.#createApprovalRequestId();
      event = Object.freeze({
        type: "approval_request",
        timestamp: Date.now(),
        runId: this.#runId,
        requestId,
        toolCallId,
        toolName,
        input: snapshotApprovalInput(input),
        reason,
        timeout,
      });
      serializeWireEvent(event);
    } catch (error) {
      return Promise.reject(error);
    }
    const { requestId } = event;
    const timeout = event.timeout ?? DEFAULT_APPROVAL_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const clearPending = (): void => {
        this.#pendingApprovals.delete(requestId);
        if (this.#pendingApprovalByToolCallId.get(toolCallId) === requestId) {
          this.#pendingApprovalByToolCallId.delete(toolCallId);
        }
      };
      const timeoutId = globalThis.setTimeout(() => {
        clearPending();
        // Default to reject on timeout
        resolve(false);
      }, timeout);

      const pending = {
        event,
        resolve,
        reject,
        timeout: timeoutId,
      };
      this.#pendingApprovals.set(requestId, pending);
      this.#pendingApprovalByToolCallId.set(toolCallId, requestId);
      const transport = this.#transport;
      if (transport) this.#deliverApproval(pending, transport);
    });
  }

  #deliverApproval(
    pending: PendingApprovalOperation,
    transport: AgentControllerTransport,
  ): void {
    const rejectDelivery = (cause: unknown): void => {
      if (this.#transport?.generation !== transport.generation) return;
      const { requestId, toolCallId } = pending.event;
      if (this.#pendingApprovals.get(requestId) !== pending) return;
      if (pending.timeout !== null) clearTimeout(pending.timeout);
      this.#pendingApprovals.delete(requestId);
      if (this.#pendingApprovalByToolCallId.get(toolCallId) === requestId) {
        this.#pendingApprovalByToolCallId.delete(toolCallId);
      }
      pending.reject(ORCHESTRATION_ERROR.create({
        detail: "Approval request delivery failed",
        cause,
      }));
    };
    let delivery: void | Promise<void>;
    try {
      delivery = transport.publisher.send(pending.event);
    } catch (cause) {
      rejectDelivery(cause);
      return;
    }
    if (delivery !== undefined) void Promise.resolve(delivery).catch(rejectDelivery);
  }

  /**
   * Request input from the user
   */
  requestInput(prompt: string, defaultValue?: string): Promise<string> {
    if (this.#cancelled) {
      return Promise.reject(ORCHESTRATION_ERROR.create({ detail: "Agent cancelled" }));
    }
    if (this.#disposed) {
      return Promise.reject(ORCHESTRATION_ERROR.create({ detail: "Agent controller disposed" }));
    }

    let event: PendingInputRequestEvent;
    try {
      if (
        !isBoundedString(prompt) ||
        (defaultValue !== undefined && !isBoundedString(defaultValue))
      ) {
        throw INVALID_ARGUMENT.create({ detail: "Input text exceeds the wire field limit" });
      }
      const timeout = this.#config.inputTimeout ?? DEFAULT_INPUT_TIMEOUT_MS;
      event = Object.freeze({
        type: "input_request",
        timestamp: Date.now(),
        runId: this.#runId,
        requestId: this.#createInputRequestId(),
        prompt,
        ...(defaultValue === undefined ? {} : { defaultValue }),
        timeout,
      });
      serializeWireEvent(event);
    } catch (error) {
      return Promise.reject(error);
    }
    const transport = this.#transport;
    if (!transport) {
      return Promise.reject(ORCHESTRATION_ERROR.create({ detail: "Agent transport is detached" }));
    }
    const { requestId, timeout } = event;

    return new Promise((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        if (this.#inputResolvers.get(requestId) !== pending) return;
        this.#inputResolvers.delete(requestId);
        if (defaultValue !== undefined) {
          resolve(defaultValue);
        } else {
          reject(TIMEOUT_ERROR.create({ detail: "Input timeout" }));
        }
      }, timeout);

      const pending: PendingInputOperation = {
        event,
        resolve,
        reject,
        timeout: timeoutId,
      };
      this.#inputResolvers.set(requestId, pending);

      this.#deliverInput(pending, transport);
    });
  }

  #deliverInput(
    pending: PendingInputOperation,
    transport: AgentControllerTransport,
  ): void {
    const rejectDelivery = (cause: unknown): void => {
      if (this.#transport?.generation !== transport.generation) return;
      const { requestId } = pending.event;
      if (this.#inputResolvers.get(requestId) !== pending) return;
      if (pending.timeout !== null) clearTimeout(pending.timeout);
      this.#inputResolvers.delete(requestId);
      pending.reject(ORCHESTRATION_ERROR.create({
        detail: "Input request delivery failed",
        cause,
      }));
    };
    let delivery: void | Promise<void>;
    try {
      delivery = transport.publisher.send(pending.event);
    } catch (cause) {
      rejectDelivery(cause);
      return;
    }
    if (delivery !== undefined) void Promise.resolve(delivery).catch(rejectDelivery);
  }

  #dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const transport = this.#transport;
    this.#transport = null;
    let unsubscribeFailed = false;
    let unsubscribeError: unknown;
    try {
      transport?.unsubscribe();
    } catch (error) {
      unsubscribeFailed = true;
      unsubscribeError = error;
    }
    const disposalError = ORCHESTRATION_ERROR.create({ detail: "Agent controller disposed" });

    // Clear all pending operations
    for (const [, pending] of this.#pendingApprovals) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(disposalError);
    }
    this.#pendingApprovals.clear();
    this.#pendingApprovalByToolCallId.clear();

    for (const pending of this.#inputResolvers.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(disposalError);
    }
    this.#inputResolvers.clear();
    this.#handledCommands.clear();
    if (unsubscribeFailed) throw unsubscribeError;
  }
}

/**
 * Backwards-compatible single-connection controller.
 *
 * Prefer {@link AgentControllerRegistry} when a run may outlive one publisher
 * connection. Registry registrations deliberately expose no disposal method.
 */
export class AgentController implements AgentControllerHandle {
  readonly #controller: RunAgentController;

  constructor(
    publisher: BidirectionalPublisher,
    config: AgentControllerConfig = {},
  ) {
    this.#controller = new RunAgentController(publisher, publisher.runId, config);
  }

  get runId(): string {
    return this.#controller.runId;
  }

  get isCancelled(): boolean {
    return this.#controller.isCancelled;
  }

  requestApproval(
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
    reason: string,
  ): Promise<boolean> {
    return this.#controller.requestApproval(toolCallId, toolName, input, reason);
  }

  requestInput(prompt: string, defaultValue?: string): Promise<string> {
    return this.#controller.requestInput(prompt, defaultValue);
  }

  /** Release the direct controller's subscription and pending work. */
  dispose(): void {
    getControllerAuthority(this.#controller).dispose();
  }
}

/**
 * Retains one controller generation per run independently of transient
 * publisher connections. Replacements synchronously retire the old publisher;
 * only an exact publisher token can detach, and only an exact run token can
 * terminally release the controller.
 */
export class AgentControllerRegistry {
  private readonly runs = new Map<
    string,
    {
      readonly run: AgentControllerRunRegistration;
      publisher?: AgentControllerRegistration;
    }
  >();
  private readonly registeredPublishers = new WeakSet<BidirectionalPublisher>();
  private readonly controllerConfig: Readonly<AgentControllerConfig>;
  private closed = false;

  constructor(controllerConfig: AgentControllerConfig = {}) {
    this.controllerConfig = Object.freeze({ ...controllerConfig });
  }

  /** Attach a new authoritative publisher generation to its run controller. */
  register(publisher: BidirectionalPublisher): AgentControllerRegistration {
    if (this.closed) {
      throw ORCHESTRATION_ERROR.create({ detail: "Agent controller registry is closed" });
    }
    const runId = publisher.runId;
    if (!isBoundedIdentifier(runId)) {
      throw INVALID_ARGUMENT.create({
        detail: "Agent publisher runId must be a bounded identifier",
      });
    }
    if (this.registeredPublishers.has(publisher)) {
      throw INVALID_ARGUMENT.create({ detail: "Agent publisher is already registered" });
    }

    const current = this.runs.get(runId);
    const retired = current?.publisher;
    let run: AgentControllerRunRegistration;
    if (current) {
      try {
        getControllerAuthority(current.run.controller).attach(publisher, runId);
      } catch (cause) {
        const cleanupErrors: unknown[] = [cause];
        try {
          this.releaseRun(current.run);
        } catch (cleanupCause) {
          cleanupErrors.push(cleanupCause);
        }
        try {
          publisher.close();
        } catch (cleanupCause) {
          cleanupErrors.push(cleanupCause);
        }
        throw new AggregateError(
          cleanupErrors,
          "Agent controller publisher replacement failed closed",
        );
      }
      run = current.run;
    } else {
      const controller = new RunAgentController(publisher, runId, this.controllerConfig);
      run = Object.freeze({
        runId,
        generation: Symbol(runId),
        controller,
      });
    }
    const registration = Object.freeze({
      run,
      runId,
      generation: Symbol(runId),
      publisher,
      controller: run.controller,
    });
    this.registeredPublishers.add(publisher);
    if (current) {
      current.publisher = registration;
    } else {
      this.runs.set(runId, { run, publisher: registration });
    }

    if (retired) {
      try {
        retired.publisher.close();
      } catch (cause) {
        const cleanupErrors: unknown[] = [cause];
        try {
          this.releaseRun(run);
        } catch (cleanupCause) {
          cleanupErrors.push(cleanupCause);
        }
        throw new AggregateError(
          cleanupErrors,
          "Retired agent publisher could not be closed safely",
        );
      }
    }
    return registration;
  }

  /** Return the stable controller ownership token for a live run. */
  get(runId: string): AgentControllerRunRegistration | undefined {
    return this.runs.get(runId)?.run;
  }

  /** Return the currently attached publisher generation, if one exists. */
  getPublisher(runId: string): AgentControllerRegistration | undefined {
    return this.runs.get(runId)?.publisher;
  }

  /**
   * Detach one exact publisher generation while retaining run-scoped state.
   * Stale registrations cannot detach a replacement.
   */
  detach(registration: AgentControllerRegistration): boolean {
    const current = this.runs.get(registration.runId);
    if (current?.publisher !== registration) return false;
    current.publisher = undefined;
    const errors: unknown[] = [];
    try {
      if (!getControllerAuthority(current.run.controller).detach(registration.publisher)) {
        errors.push(ORCHESTRATION_ERROR.create({
          detail: "Agent controller publisher generation did not match its registration",
        }));
      }
    } catch (error) {
      errors.push(error);
    }
    try {
      registration.publisher.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      throw errors.length === 1
        ? errors[0]
        : new AggregateError(errors, "Agent publisher detach cleanup failed");
    }
    return true;
  }

  /**
   * Terminally release one exact run controller generation.
   * Stale run registrations cannot release a replacement run with the same ID.
   */
  releaseRun(registration: AgentControllerRunRegistration): boolean {
    const current = this.runs.get(registration.runId);
    if (current?.run !== registration) return false;
    this.runs.delete(registration.runId);
    const errors: unknown[] = [];
    try {
      getControllerAuthority(registration.controller).dispose();
    } catch (error) {
      errors.push(error);
    }
    if (current.publisher) {
      try {
        current.publisher.publisher.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw errors.length === 1
        ? errors[0]
        : new AggregateError(errors, "Agent controller registration cleanup failed");
    }
    return true;
  }

  /** Terminally release every run and reject future registrations. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const { run } of [...this.runs.values()]) {
      try {
        this.releaseRun(run);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw errors.length === 1
        ? errors[0]
        : new AggregateError(errors, "Agent controller registry cleanup failed");
    }
  }
}
