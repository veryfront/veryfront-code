import type {
  RedisEventPublisherConfig,
  RedisEventPublisherImplementation,
} from "veryfront/extensions/distributed";
import { logger as baseLogger } from "veryfront/utils/logger";
import type { ClaudeCodeEvent, ClaudeCodeEventHandler } from "veryfront/workflow/claude-code/types";
import { requireRedisUrl } from "./connection-config.ts";

const logger = baseLogger.component("redis-event-publisher");
const CONFIG_KEYS = new Set(["url", "channelPrefix", "debug"]);
const MAX_CHANNEL_PREFIX_CODE_UNITS = 1_024;

interface CapturedRedisEventPublisherConfig {
  readonly url: string;
  readonly channelPrefix: string;
  readonly debug: boolean;
}

export type RedisEventListener = (message: string) => void;

export interface RedisEventPublisherClient {
  on(event: "error", listener: (error: unknown) => void): unknown;
  connect(): Promise<void>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, listener: RedisEventListener): Promise<void>;
  unsubscribe(channel: string, listener: RedisEventListener): Promise<void>;
  close(): Promise<void>;
}

export type RedisEventPublisherClientFactory = (url: string) => RedisEventPublisherClient;

export interface RedisEventPublisherLogger {
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface RedisEventPublisherDependencies {
  readonly createClient: RedisEventPublisherClientFactory;
  readonly logger?: RedisEventPublisherLogger;
}

interface RedisClientPair {
  readonly publish: RedisEventPublisherClient;
  readonly subscribe: RedisEventPublisherClient;
}

interface RedisConnectAttempt {
  readonly client: RedisEventPublisherClient;
  readonly promise: Promise<void>;
  settled: boolean;
}

type RedisEventPublisherState = "open" | "closing" | "closed";

function readOwnDataProperty(value: object, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch (cause) {
    throw new TypeError(`Redis event publisher config ${key} could not be inspected`, { cause });
  }
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Redis event publisher config ${key} must be a data property`);
  }
  return descriptor.value;
}

function captureConfig(value: RedisEventPublisherConfig): CapturedRedisEventPublisherConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Redis event publisher config must be an object");
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw new TypeError("Redis event publisher config could not be inspected", { cause });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Redis event publisher config must be a plain object");
  }
  if (keys.some((key) => typeof key !== "string" || !CONFIG_KEYS.has(key))) {
    throw new TypeError("Redis event publisher config contains an unknown option");
  }

  const url = requireRedisUrl(readOwnDataProperty(value, "url"));
  const channelPrefixValue = readOwnDataProperty(value, "channelPrefix");
  const channelPrefix = channelPrefixValue ?? "claude-code";
  if (
    typeof channelPrefix !== "string" || channelPrefix.length === 0 ||
    channelPrefix.length > MAX_CHANNEL_PREFIX_CODE_UNITS ||
    channelPrefix.trim() !== channelPrefix || /\p{Cc}/u.test(channelPrefix)
  ) {
    throw new TypeError("Redis event publisher channelPrefix must be a bounded canonical string");
  }
  const debugValue = readOwnDataProperty(value, "debug");
  if (debugValue !== undefined && typeof debugValue !== "boolean") {
    throw new TypeError("Redis event publisher debug must be a boolean");
  }
  return Object.freeze({ url, channelPrefix, debug: debugValue ?? false });
}

function safeLogInfo(target: RedisEventPublisherLogger, message: string, ...args: unknown[]): void {
  try {
    target.info(message, ...args);
  } catch {
    // Diagnostics must not own transport lifecycle.
  }
}

function safeLogError(
  target: RedisEventPublisherLogger,
  message: string,
  ...args: unknown[]
): void {
  try {
    target.error(message, ...args);
  } catch {
    // Diagnostics must not own transport lifecycle.
  }
}

function publisherClosedError(state: Exclude<RedisEventPublisherState, "open">): Error {
  return new Error(`Redis event publisher is ${state}`);
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

class InternalRedisEventPublisher implements RedisEventPublisherImplementation {
  private readonly resources = new Set<RedisEventPublisherClient>();
  private readonly closeAttempts = new Map<RedisEventPublisherClient, Promise<void>>();
  private readonly retirements = new Set<Promise<void>>();
  private clients: RedisClientPair | null = null;
  private initialization: Promise<RedisClientPair> | null = null;
  private initializationAbortController: AbortController | null = null;
  private closePromise: Promise<void> | null = null;
  private state: RedisEventPublisherState = "open";

  constructor(
    private readonly config: CapturedRedisEventPublisherConfig,
    private readonly createClient: RedisEventPublisherClientFactory,
    private readonly diagnosticLogger: RedisEventPublisherLogger,
  ) {}

  private registerErrorListener(client: RedisEventPublisherClient, role: string): void {
    client.on("error", (error) => {
      safeLogError(this.diagnosticLogger, "Redis event publisher client error", error, { role });
    });
  }

  private createClientPair(): RedisClientPair {
    const publishClient = this.createClient(this.config.url);
    this.resources.add(publishClient);
    this.registerErrorListener(publishClient, "publish");

    const subscribeClient = this.createClient(this.config.url);
    if (subscribeClient === publishClient) {
      throw new TypeError(
        "Redis event publisher requires distinct publish and subscribe clients",
      );
    }
    this.resources.add(subscribeClient);
    this.registerErrorListener(subscribeClient, "subscribe");
    return Object.freeze({ publish: publishClient, subscribe: subscribeClient });
  }

  private ensureInitialized(): Promise<RedisClientPair> {
    if (this.state !== "open") return Promise.reject(publisherClosedError(this.state));
    if (this.clients) return Promise.resolve(this.clients);
    if (this.initialization) return this.initialization;

    const abortController = new AbortController();
    this.initializationAbortController = abortController;
    const initialization = (async () => {
      let clients: RedisClientPair | undefined;
      let connectAttempts: readonly RedisConnectAttempt[] = [];
      try {
        // A failed prior setup must be fully retired before replacement.
        await raceWithAbort(this.waitForRetirements(), abortController.signal);
        await raceWithAbort(this.closeClients([...this.resources]), abortController.signal);
        if (this.state !== "open") throw publisherClosedError(this.state);
        const nextClients = this.createClientPair();
        clients = nextClients;
        connectAttempts = [
          this.startConnect(nextClients.publish),
          this.startConnect(nextClients.subscribe),
        ];
        await raceWithAbort(
          Promise.all(connectAttempts.map(({ promise }) => promise)).then(() => undefined),
          abortController.signal,
        );
        if (this.state !== "open") throw publisherClosedError(this.state);
      } catch (error) {
        const cleanupTargets = clients ? [clients.publish, clients.subscribe] : [...this.resources];
        const immediateCleanup = this.closeClients(cleanupTargets);
        for (const attempt of connectAttempts) {
          if (!attempt.settled) this.scheduleFinalClose(attempt, immediateCleanup);
        }
        try {
          await immediateCleanup;
        } catch (closeError) {
          throw new AggregateError(
            [error, closeError],
            "Redis event publisher setup and cleanup failed",
          );
        }
        throw error;
      }
      if (!clients) throw new Error("Redis event publisher clients were not initialized");
      this.clients = clients;
      return clients;
    })().finally(() => {
      if (this.initialization === initialization) this.initialization = null;
      if (this.initializationAbortController === abortController) {
        this.initializationAbortController = null;
      }
    });
    this.initialization = initialization;
    return initialization;
  }

  private startConnect(client: RedisEventPublisherClient): RedisConnectAttempt {
    const attempt: RedisConnectAttempt = {
      client,
      promise: Promise.resolve().then(() => client.connect()),
      settled: false,
    };
    void attempt.promise.then(
      () => {
        attempt.settled = true;
      },
      () => {
        attempt.settled = true;
      },
    );
    return attempt;
  }

  private waitForRetirements(): Promise<void> {
    return Promise.all([...this.retirements]).then(() => undefined);
  }

  private scheduleFinalClose(
    attempt: RedisConnectAttempt,
    immediateCleanup: Promise<void>,
  ): void {
    const connectionSettled = attempt.promise.then(
      () => undefined,
      () => undefined,
    );
    const retirement = connectionSettled
      .then(() => immediateCleanup.catch(() => undefined))
      .then(() => this.closeClient(attempt.client, true));
    const tracked = retirement.finally(() => {
      this.retirements.delete(tracked);
    });
    this.retirements.add(tracked);
    void tracked.catch((error) => {
      safeLogError(
        this.diagnosticLogger,
        "Redis event publisher late-connect cleanup failed",
        error,
      );
    });
  }

  private closeClient(client: RedisEventPublisherClient, force = false): Promise<void> {
    if (force) this.resources.add(client);
    else if (!this.resources.has(client)) return Promise.resolve();
    const existing = this.closeAttempts.get(client);
    if (existing) {
      if (!force) return existing;
      return existing.catch(() => undefined).then(() => this.closeClient(client, true));
    }

    const attempt = Promise.resolve()
      .then(() => client.close())
      .then(
        () => {
          this.resources.delete(client);
          if (this.clients?.publish === client || this.clients?.subscribe === client) {
            this.clients = null;
          }
          this.closeAttempts.delete(client);
        },
        (error) => {
          this.closeAttempts.delete(client);
          throw error;
        },
      );
    this.closeAttempts.set(client, attempt);
    return attempt;
  }

  private closeClients(clients: readonly RedisEventPublisherClient[]): Promise<void> {
    return Promise.all([...new Set(clients)].map((client) => this.closeClient(client))).then(
      () => undefined,
    );
  }

  private getChannel(runId: string): string {
    return `${this.config.channelPrefix}:events:${runId}`;
  }

  async publish(event: ClaudeCodeEvent): Promise<void> {
    const clients = await this.ensureInitialized();
    if (this.state !== "open") throw publisherClosedError(this.state);
    const channel = event.runId
      ? this.getChannel(event.runId)
      : `${this.config.channelPrefix}:events:global`;
    await clients.publish.publish(channel, JSON.stringify(event));
    if (this.config.debug) {
      safeLogInfo(this.diagnosticLogger, "Published event", {
        channel,
        eventType: event.type,
      });
    }
  }

  async subscribe(runId: string, handler: ClaudeCodeEventHandler): Promise<() => void> {
    const clients = await this.ensureInitialized();
    if (this.state !== "open") throw publisherClosedError(this.state);
    const channel = this.getChannel(runId);
    let deliveryActive = true;
    const listener: RedisEventListener = (message) => {
      if (!deliveryActive || this.state !== "open") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(message);
      } catch (error) {
        safeLogError(this.diagnosticLogger, "Failed to parse Redis event", error);
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      try {
        const handled = handler(parsed as ClaudeCodeEvent);
        void Promise.resolve(handled).catch((error) => {
          safeLogError(this.diagnosticLogger, "Redis event handler failed", error);
        });
      } catch (error) {
        safeLogError(this.diagnosticLogger, "Redis event handler failed", error);
      }
    };
    await clients.subscribe.subscribe(channel, listener);
    if (this.state !== "open") {
      this.startBackgroundUnsubscribe(clients.subscribe, channel, listener);
      throw publisherClosedError(this.state);
    }
    if (this.config.debug) {
      safeLogInfo(this.diagnosticLogger, "Subscribed to channel", { channel });
    }

    let disposed = false;
    let disposal: Promise<void> | null = null;
    return () => {
      deliveryActive = false;
      if (disposed || disposal || this.state === "closed") return;
      const attempt = Promise.resolve()
        .then(async () => {
          if (this.state === "closing" && this.closePromise) return false;
          await clients.subscribe.unsubscribe(channel, listener);
          return true;
        })
        .then(
          (unsubscribed) => {
            if (unsubscribed) disposed = true;
            else if (disposal === attempt) disposal = null;
          },
          (error) => {
            if (disposal === attempt) disposal = null;
            safeLogError(
              this.diagnosticLogger,
              "Failed to unsubscribe Redis event listener",
              error,
              { channel },
            );
          },
        );
      disposal = attempt;
    };
  }

  private startBackgroundUnsubscribe(
    client: RedisEventPublisherClient,
    channel: string,
    listener: RedisEventListener,
  ): void {
    void Promise.resolve()
      .then(() => client.unsubscribe(channel, listener))
      .catch((error) => {
        safeLogError(
          this.diagnosticLogger,
          "Failed to unsubscribe Redis event listener",
          error,
          { channel },
        );
      });
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.state === "closed" && this.resources.size === 0) return Promise.resolve();
    this.state = "closing";
    this.initializationAbortController?.abort(publisherClosedError("closing"));

    const closePromise = this.closeClients([...this.resources]).then(
      () => {
        this.state = "closed";
      },
      (error) => {
        throw error;
      },
    ).finally(() => {
      if (this.closePromise === closePromise) this.closePromise = null;
    });
    this.closePromise = closePromise;
    return closePromise;
  }
}

/** Construct a validated Redis Pub/Sub implementation. */
export function createRedisEventPublisher(
  config: RedisEventPublisherConfig,
  dependencies: RedisEventPublisherDependencies,
): RedisEventPublisherImplementation {
  if (typeof dependencies.createClient !== "function") {
    throw new TypeError("Redis event publisher client factory must be a function");
  }
  const diagnosticLogger = dependencies.logger ?? logger;
  if (
    !diagnosticLogger || typeof diagnosticLogger !== "object" ||
    typeof diagnosticLogger.info !== "function" ||
    typeof diagnosticLogger.error !== "function"
  ) {
    throw new TypeError("Redis event publisher logger is invalid");
  }
  return new InternalRedisEventPublisher(
    captureConfig(config),
    dependencies.createClient,
    diagnosticLogger,
  );
}
