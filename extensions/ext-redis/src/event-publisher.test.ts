import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createRedisEventPublisherImplementation,
  type RedisEventListener,
  type RedisEventPublisherClient,
  type RedisEventPublisherClientFactory,
  type RedisEventPublisherConfig,
  type RedisEventPublisherImplementation,
  type RedisEventPublisherLogger,
} from "./event-publisher-internal.ts";
import type { ClaudeCodeEvent } from "veryfront/workflow/claude-code";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

interface UnsubscribeCall {
  readonly channel: string;
  readonly listener: RedisEventListener;
}

interface FakeRedisClient extends RedisEventPublisherClient {
  readonly calls: {
    close: number;
    connect: number;
    on: number;
    publish: number;
    subscribe: number;
    unsubscribe: number;
  };
  readonly order: string[];
  readonly subscribeCalls: UnsubscribeCall[];
  readonly unsubscribeCalls: UnsubscribeCall[];
  emit(channel: string, message: string): void;
  emitError(error: unknown): void;
}

interface FakeRedisClientOperations {
  readonly close?: () => Promise<void>;
  readonly connect?: () => Promise<void>;
  readonly on?: (event: "error", listener: (error: unknown) => void) => unknown;
  readonly publish?: (channel: string, message: string) => Promise<number>;
  readonly subscribe?: (channel: string, listener: RedisEventListener) => Promise<void>;
  readonly unsubscribe?: (channel: string, listener: RedisEventListener) => Promise<void>;
}

interface RecordingLogger extends RedisEventPublisherLogger {
  readonly errors: Array<{ message: string; args: unknown[] }>;
  readonly infos: Array<{ message: string; args: unknown[] }>;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

function createRecordingLogger(options: {
  readonly throwOnError?: boolean;
  readonly throwOnInfo?: boolean;
} = {}): RecordingLogger {
  const errors: Array<{ message: string; args: unknown[] }> = [];
  const infos: Array<{ message: string; args: unknown[] }> = [];
  return {
    errors,
    infos,
    error(message, ...args) {
      errors.push({ message, args });
      if (options.throwOnError) throw new Error("error logger failed");
    },
    info(message, ...args) {
      infos.push({ message, args });
      if (options.throwOnInfo) throw new Error("info logger failed");
    },
  };
}

function createFakeRedisClient(
  operations: FakeRedisClientOperations = {},
): FakeRedisClient {
  const calls = {
    close: 0,
    connect: 0,
    on: 0,
    publish: 0,
    subscribe: 0,
    unsubscribe: 0,
  };
  const order: string[] = [];
  const errorListeners = new Set<(error: unknown) => void>();
  const subscriptions = new Map<string, Set<RedisEventListener>>();
  const subscribeCalls: UnsubscribeCall[] = [];
  const unsubscribeCalls: UnsubscribeCall[] = [];
  return {
    calls,
    order,
    subscribeCalls,
    unsubscribeCalls,
    close: () => {
      calls.close++;
      order.push("close");
      return operations.close?.() ?? Promise.resolve();
    },
    connect: () => {
      calls.connect++;
      order.push("connect");
      return operations.connect?.() ?? Promise.resolve();
    },
    on: (event, listener) => {
      calls.on++;
      order.push(`on:${event}`);
      const result = operations.on?.(event, listener);
      errorListeners.add(listener);
      return result;
    },
    publish: (channel, message) => {
      calls.publish++;
      order.push("publish");
      return operations.publish?.(channel, message) ?? Promise.resolve(1);
    },
    subscribe: async (channel, listener) => {
      calls.subscribe++;
      order.push("subscribe");
      subscribeCalls.push({ channel, listener });
      await operations.subscribe?.(channel, listener);
      let listeners = subscriptions.get(channel);
      if (!listeners) {
        listeners = new Set();
        subscriptions.set(channel, listeners);
      }
      listeners.add(listener);
    },
    unsubscribe: async (channel, listener) => {
      calls.unsubscribe++;
      order.push("unsubscribe");
      unsubscribeCalls.push({ channel, listener });
      await operations.unsubscribe?.(channel, listener);
      const listeners = subscriptions.get(channel);
      listeners?.delete(listener);
      if (listeners?.size === 0) subscriptions.delete(channel);
    },
    emit(channel, message) {
      for (const listener of subscriptions.get(channel) ?? []) listener(message);
    },
    emitError(error) {
      for (const listener of errorListeners) listener(error);
    },
  };
}

function createClientFactory(
  publishClient: RedisEventPublisherClient,
  subscribeClient: RedisEventPublisherClient,
): RedisEventPublisherClientFactory {
  const clients = [publishClient, subscribeClient];
  return () => {
    const client = clients.shift();
    if (!client) throw new Error("Unexpected Redis client creation");
    return client;
  };
}

function createPublisher(
  publishClient: RedisEventPublisherClient,
  subscribeClient: RedisEventPublisherClient,
  options: {
    readonly config?: RedisEventPublisherConfig;
    readonly logger?: RedisEventPublisherLogger;
  } = {},
): RedisEventPublisherImplementation {
  return createRedisEventPublisherImplementation(
    options.config ?? { url: "rediss://cache.example.test" },
    {
      createClient: createClientFactory(publishClient, subscribeClient),
      logger: options.logger ?? createRecordingLogger(),
    },
  );
}

function createEvent(): ClaudeCodeEvent {
  return {
    type: "error",
    timestamp: 1,
    message: "test failure",
    recoverable: false,
    runId: "run-1",
  };
}

async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}

async function raceWithTimeout<T>(promise: Promise<T>, timeoutMs = 100): Promise<T | "timeout"> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"timeout">((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

describe("RedisEventPublisher", () => {
  it("captures canonical config without invoking accessors or accepting unknown values", () => {
    const client = createFakeRedisClient();
    const dependencies = {
      createClient: () => client,
      logger: createRecordingLogger(),
    };
    let getterCalls = 0;
    const accessor = {} as RedisEventPublisherConfig;
    Object.defineProperty(accessor, "url", {
      enumerable: true,
      get() {
        getterCalls++;
        return "rediss://cache.example.test";
      },
    });

    assertThrows(
      () => createRedisEventPublisherImplementation(accessor, dependencies),
      TypeError,
      "data property",
    );
    assertEquals(getterCalls, 0);
    assertThrows(
      () =>
        createRedisEventPublisherImplementation(
          { url: "rediss://cache.example.test", extra: true } as never,
          dependencies,
        ),
      TypeError,
      "unknown option",
    );
    assertThrows(
      () =>
        createRedisEventPublisherImplementation(
          { url: "redis://cache.example.test" },
          dependencies,
        ),
      TypeError,
      "must use rediss://",
    );
    assertThrows(
      () =>
        createRedisEventPublisherImplementation(
          { url: "rediss://cache.example.test", channelPrefix: " " },
          dependencies,
        ),
      TypeError,
      "bounded canonical string",
    );
    assertThrows(
      () =>
        createRedisEventPublisherImplementation(
          { url: "rediss://cache.example.test", debug: "yes" } as never,
          dependencies,
        ),
      TypeError,
      "debug must be a boolean",
    );
  });

  it("keeps defaults when optional config values are explicitly undefined", async () => {
    let publishedChannel: string | undefined;
    const publishClient = createFakeRedisClient({
      publish: (channel) => {
        publishedChannel = channel;
        return Promise.resolve(1);
      },
    });
    const subscribeClient = createFakeRedisClient();
    const publisher = createPublisher(publishClient, subscribeClient, {
      config: {
        url: "rediss://cache.example.test",
        channelPrefix: undefined,
        debug: undefined,
      },
    });

    await publisher.publish(createEvent());

    assertEquals(publishedChannel, "claude-code:events:run-1");
    await publisher.close();
  });

  it("registers contained error listeners before either client connects", async () => {
    const diagnosticLogger = createRecordingLogger({ throwOnError: true });
    const lifecycleOrder: string[] = [];
    const publishClient = createFakeRedisClient({
      on: () => lifecycleOrder.push("publish:on:error"),
      connect: () => {
        lifecycleOrder.push("publish:connect");
        return Promise.resolve();
      },
    });
    const subscribeClient = createFakeRedisClient({
      on: () => lifecycleOrder.push("subscribe:on:error"),
      connect: () => {
        lifecycleOrder.push("subscribe:connect");
        return Promise.resolve();
      },
    });
    const publisher = createPublisher(publishClient, subscribeClient, {
      logger: diagnosticLogger,
    });

    await publisher.publish(createEvent());
    publishClient.emitError(new Error("publish socket failed"));
    subscribeClient.emitError(new Error("subscribe socket failed"));

    assertEquals(publishClient.order.slice(0, 2), ["on:error", "connect"]);
    assertEquals(subscribeClient.order.slice(0, 2), ["on:error", "connect"]);
    assertEquals(lifecycleOrder, [
      "publish:on:error",
      "subscribe:on:error",
      "publish:connect",
      "subscribe:connect",
    ]);
    assertEquals(diagnosticLogger.errors.map((entry) => entry.message), [
      "Redis event publisher client error",
      "Redis event publisher client error",
    ]);
    await publisher.close();
  });

  it("disposes only the exact listener while another listener remains active", async () => {
    const publishClient = createFakeRedisClient();
    const subscribeClient = createFakeRedisClient();
    const publisher = createPublisher(publishClient, subscribeClient);
    let firstEvents = 0;
    let secondEvents = 0;
    const disposeFirst = await publisher.subscribe("run-1", () => {
      firstEvents++;
    });
    const disposeSecond = await publisher.subscribe("run-1", () => {
      secondEvents++;
    });
    const channel = "claude-code:events:run-1";
    subscribeClient.emit(channel, JSON.stringify(createEvent()));

    assertEquals(firstEvents, 1);
    assertEquals(secondEvents, 1);
    assertEquals(disposeFirst(), undefined);
    subscribeClient.emit(channel, JSON.stringify(createEvent()));
    assertEquals(firstEvents, 1);
    assertEquals(secondEvents, 2);
    await drainMicrotasks();
    subscribeClient.emit(channel, JSON.stringify(createEvent()));

    assertEquals(subscribeClient.unsubscribeCalls.length, 1);
    assertEquals(subscribeClient.unsubscribeCalls[0]?.channel, channel);
    assertStrictEquals(
      subscribeClient.unsubscribeCalls[0]?.listener,
      subscribeClient.subscribeCalls[0]?.listener,
    );
    assertEquals(
      subscribeClient.unsubscribeCalls[0]?.listener ===
        subscribeClient.subscribeCalls[1]?.listener,
      false,
    );
    assertEquals(firstEvents, 1);
    assertEquals(secondEvents, 3);
    disposeSecond();
    await drainMicrotasks();
    await publisher.close();
  });

  it("single-flights synchronous disposer calls and keeps successful disposal idempotent", async () => {
    const unsubscribeGate = deferred<void>();
    const publishClient = createFakeRedisClient();
    const subscribeClient = createFakeRedisClient({
      unsubscribe: () => unsubscribeGate.promise,
    });
    const publisher = createPublisher(publishClient, subscribeClient);
    const dispose = await publisher.subscribe("run-1", () => undefined);

    assertEquals(dispose(), undefined);
    assertEquals(dispose(), undefined);
    await drainMicrotasks();
    assertEquals(subscribeClient.calls.unsubscribe, 1);
    unsubscribeGate.resolve();
    await drainMicrotasks();
    dispose();

    assertEquals(subscribeClient.calls.unsubscribe, 1);
    await publisher.close();
  });

  it("observes disposer rejection and permits a later retry", async () => {
    const diagnosticLogger = createRecordingLogger({ throwOnError: true });
    let unsubscribeAttempts = 0;
    const publishClient = createFakeRedisClient();
    const subscribeClient = createFakeRedisClient({
      unsubscribe: () => {
        unsubscribeAttempts++;
        return unsubscribeAttempts === 1
          ? Promise.reject(new Error("unsubscribe failed"))
          : Promise.resolve();
      },
    });
    const publisher = createPublisher(publishClient, subscribeClient, {
      logger: diagnosticLogger,
    });
    let delivered = 0;
    const dispose = await publisher.subscribe("run-1", () => {
      delivered++;
    });

    dispose();
    await drainMicrotasks();
    subscribeClient.emit("claude-code:events:run-1", JSON.stringify(createEvent()));
    dispose();
    await drainMicrotasks();

    assertEquals(delivered, 0);
    assertEquals(subscribeClient.calls.unsubscribe, 2);
    assertStrictEquals(
      subscribeClient.unsubscribeCalls[0]?.listener,
      subscribeClient.unsubscribeCalls[1]?.listener,
    );
    assertEquals(diagnosticLogger.errors[0]?.message, "Failed to unsubscribe Redis event listener");
    await publisher.close();
  });

  it("does not let info diagnostics fail publish or strand a subscription", async () => {
    const diagnosticLogger = createRecordingLogger({ throwOnInfo: true });
    const publishClient = createFakeRedisClient();
    const subscribeClient = createFakeRedisClient();
    const publisher = createPublisher(publishClient, subscribeClient, {
      config: { url: "rediss://cache.example.test", debug: true },
      logger: diagnosticLogger,
    });

    await publisher.publish(createEvent());
    const dispose = await publisher.subscribe("run-1", () => undefined);
    dispose();
    await drainMicrotasks();

    assertEquals(diagnosticLogger.infos.map((entry) => entry.message), [
      "Published event",
      "Subscribed to channel",
    ]);
    assertEquals(subscribeClient.calls.unsubscribe, 1);
    await publisher.close();
  });

  it("labels synchronous and asynchronous handler failures separately from JSON failures", async () => {
    const diagnosticLogger = createRecordingLogger();
    const publishClient = createFakeRedisClient();
    const subscribeClient = createFakeRedisClient();
    const publisher = createPublisher(publishClient, subscribeClient, {
      logger: diagnosticLogger,
    });
    await publisher.subscribe("sync", () => {
      throw new Error("sync handler failed");
    });
    await publisher.subscribe("async", () => Promise.reject(new Error("async handler failed")));

    subscribeClient.emit("claude-code:events:sync", JSON.stringify(createEvent()));
    subscribeClient.emit("claude-code:events:async", JSON.stringify(createEvent()));
    subscribeClient.emit("claude-code:events:sync", "not json");
    await drainMicrotasks();

    assertEquals(diagnosticLogger.errors.map((entry) => entry.message), [
      "Redis event handler failed",
      "Failed to parse Redis event",
      "Redis event handler failed",
    ]);
    await publisher.close();
  });

  it("cleans up a first client when creating the second client throws", async () => {
    const firstClient = createFakeRedisClient();
    let factoryCalls = 0;
    const publisher = createRedisEventPublisherImplementation(
      { url: "rediss://cache.example.test" },
      {
        createClient: () => {
          factoryCalls++;
          if (factoryCalls === 1) return firstClient;
          throw new Error("second client factory failed");
        },
        logger: createRecordingLogger(),
      },
    );

    await assertRejects(() => publisher.publish(createEvent()), Error, "factory failed");
    await drainMicrotasks();

    assertEquals(firstClient.calls.on, 1);
    assertEquals(firstClient.calls.connect, 0);
    assertEquals(firstClient.calls.close, 1);
    await publisher.close();
  });

  it("cleans up both clients when error-listener registration fails", async () => {
    const publishClient = createFakeRedisClient();
    const subscribeClient = createFakeRedisClient({
      on: () => {
        throw new Error("listener registration failed");
      },
    });
    const publisher = createPublisher(publishClient, subscribeClient);

    await assertRejects(
      () => publisher.publish(createEvent()),
      Error,
      "listener registration failed",
    );
    await drainMicrotasks();

    assertEquals(publishClient.calls.close, 1);
    assertEquals(subscribeClient.calls.close, 1);
    assertEquals(publishClient.calls.connect, 0);
    assertEquals(subscribeClient.calls.connect, 0);
    await publisher.close();
  });

  it("fails close immediately when one client hangs and the other rejects", async () => {
    const publishClient = createFakeRedisClient({
      close: () => new Promise<void>(() => {}),
    });
    const subscribeClient = createFakeRedisClient({
      close: () => Promise.reject(new Error("subscribe close failed")),
    });
    const publisher = createPublisher(publishClient, subscribeClient);
    await publisher.publish(createEvent());

    const result = await raceWithTimeout(
      publisher.close().then(
        () => "resolved" as const,
        (error) => error instanceof Error ? error.message : String(error),
      ),
    );

    assertEquals(result, "subscribe close failed");
    assertEquals(publishClient.calls.close, 1);
    assertEquals(subscribeClient.calls.close, 1);
  });

  it("stops delivery at close start and allows exact detach after fail-fast close", async () => {
    const publishClient = createFakeRedisClient({
      close: () => Promise.reject(new Error("publish close failed")),
    });
    const subscribeClient = createFakeRedisClient({
      close: () => new Promise<void>(() => {}),
    });
    const publisher = createPublisher(publishClient, subscribeClient);
    let delivered = 0;
    const dispose = await publisher.subscribe("run-1", () => {
      delivered++;
    });
    const capturedListener = subscribeClient.subscribeCalls[0]!.listener;
    const payload = JSON.stringify(createEvent());
    capturedListener(payload);
    assertEquals(delivered, 1);

    const closing = publisher.close();
    capturedListener(payload);
    assertEquals(delivered, 1);
    await assertRejects(() => closing, Error, "publish close failed");
    capturedListener(payload);
    assertEquals(delivered, 1);

    assertEquals(dispose(), undefined);
    await drainMicrotasks();
    assertEquals(subscribeClient.calls.unsubscribe, 1);
    assertStrictEquals(subscribeClient.unsubscribeCalls[0]?.listener, capturedListener);
    capturedListener(payload);
    assertEquals(delivered, 1);
  });

  it("starts every close safely when a client throws synchronously", async () => {
    const publishClient = createFakeRedisClient({
      close: () => {
        throw new Error("synchronous close failure");
      },
    });
    const subscribeClient = createFakeRedisClient();
    const publisher = createPublisher(publishClient, subscribeClient);
    await publisher.publish(createEvent());

    await assertRejects(() => publisher.close(), Error, "synchronous close failure");

    assertEquals(publishClient.calls.close, 1);
    assertEquals(subscribeClient.calls.close, 1);
  });

  it("observes a peer rejection that arrives after close has already failed", async () => {
    const laterClose = deferred<void>();
    const publishClient = createFakeRedisClient({
      close: () => Promise.reject(new Error("first close failure")),
    });
    const subscribeClient = createFakeRedisClient({ close: () => laterClose.promise });
    const publisher = createPublisher(publishClient, subscribeClient);
    await publisher.publish(createEvent());

    await assertRejects(() => publisher.close(), Error, "first close failure");
    laterClose.reject(new Error("later close failure"));
    await drainMicrotasks();

    assertEquals(publishClient.calls.close, 1);
    assertEquals(subscribeClient.calls.close, 1);
  });

  it("returns one close promise to concurrent callers and retains it after success", async () => {
    const closeGate = deferred<void>();
    const publishClient = createFakeRedisClient({ close: () => closeGate.promise });
    const subscribeClient = createFakeRedisClient({ close: () => closeGate.promise });
    const publisher = createPublisher(publishClient, subscribeClient);
    await publisher.publish(createEvent());

    const first = publisher.close();
    const concurrent = publisher.close();
    assertStrictEquals(concurrent, first);
    closeGate.resolve();
    await first;

    assertStrictEquals(publisher.close(), first);
    assertEquals(publishClient.calls.close, 1);
    assertEquals(subscribeClient.calls.close, 1);
  });

  it("retains failed cleanup for retry without closing successful clients twice", async () => {
    let publishCloseAttempts = 0;
    const publishClient = createFakeRedisClient({
      close: () => {
        publishCloseAttempts++;
        return publishCloseAttempts === 1
          ? Promise.reject(new Error("publish close failed"))
          : Promise.resolve();
      },
    });
    const subscribeClient = createFakeRedisClient();
    const publisher = createPublisher(publishClient, subscribeClient);
    await publisher.publish(createEvent());

    await assertRejects(() => publisher.close(), Error, "publish close failed");
    const retry = publisher.close();
    await retry;

    assertEquals(publishClient.calls.close, 2);
    assertEquals(subscribeClient.calls.close, 1);
    assertStrictEquals(publisher.close(), retry);
  });

  it("is terminal and cannot lazily open clients after close", async () => {
    let clientCreations = 0;
    const publisher = createRedisEventPublisherImplementation(
      { url: "rediss://cache.example.test" },
      {
        createClient: () => {
          clientCreations++;
          return createFakeRedisClient();
        },
        logger: createRecordingLogger(),
      },
    );

    await publisher.close();
    await assertRejects(() => publisher.publish(createEvent()), Error, "closed");
    await assertRejects(
      () => publisher.subscribe("run-1", () => undefined),
      Error,
      "closed",
    );
    assertEquals(clientCreations, 0);
  });

  it("does not attach clients when initialization completes after close", async () => {
    const publishConnect = deferred<void>();
    const subscribeConnect = deferred<void>();
    const publishClient = createFakeRedisClient({ connect: () => publishConnect.promise });
    const subscribeClient = createFakeRedisClient({ connect: () => subscribeConnect.promise });
    const publisher = createPublisher(publishClient, subscribeClient);
    const publishing = publisher.publish(createEvent()).then(
      () => "resolved" as const,
      (error) => error instanceof Error ? error.message : String(error),
    );
    await Promise.resolve();

    await publisher.close();
    publishConnect.resolve();
    subscribeConnect.resolve();

    assertEquals(await publishing, "Redis event publisher is closed");
    assertEquals(publishClient.calls.close, 1);
    assertEquals(subscribeClient.calls.close, 1);
    assertEquals(publishClient.calls.publish, 0);
  });
});
