import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ClaudeCodeEvent } from "veryfront/workflow/claude-code";
import {
  createRedisEventPublisher,
  type RedisEventListener,
  type RedisEventPublisherClient,
} from "./event-publisher.ts";

interface FakeRedisClient extends RedisEventPublisherClient {
  closeCalls: number;
  connectCalls: number;
  publishCalls: Array<{ channel: string; message: string }>;
  unsubscribeCalls: Array<{ channel: string; listener: RedisEventListener }>;
  emit(channel: string, message: string): void;
}

function createFakeClient(
  operations: {
    close?: () => Promise<void>;
    connect?: () => Promise<void>;
  } = {},
): FakeRedisClient {
  const subscriptions = new Map<string, Set<RedisEventListener>>();
  return {
    closeCalls: 0,
    connectCalls: 0,
    publishCalls: [],
    unsubscribeCalls: [],
    on: () => undefined,
    connect() {
      this.connectCalls++;
      return operations.connect?.() ?? Promise.resolve();
    },
    publish(channel, message) {
      this.publishCalls.push({ channel, message });
      return Promise.resolve(1);
    },
    subscribe(channel, listener) {
      let listeners = subscriptions.get(channel);
      if (!listeners) {
        listeners = new Set();
        subscriptions.set(channel, listeners);
      }
      listeners.add(listener);
      return Promise.resolve();
    },
    unsubscribe(channel, listener) {
      this.unsubscribeCalls.push({ channel, listener });
      subscriptions.get(channel)?.delete(listener);
      return Promise.resolve();
    },
    close() {
      this.closeCalls++;
      return operations.close?.() ?? Promise.resolve();
    },
    emit(channel, message) {
      for (const listener of subscriptions.get(channel) ?? []) listener(message);
    },
  };
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

function createPublisher(
  publishClient: RedisEventPublisherClient,
  subscribeClient: RedisEventPublisherClient,
) {
  const clients = [publishClient, subscribeClient];
  return createRedisEventPublisher(
    { url: "redis://cache.example.test", channelPrefix: "vf" },
    {
      createClient: () => {
        const client = clients.shift();
        if (!client) throw new Error("Unexpected Redis client creation");
        return client;
      },
      logger: { info: () => undefined, error: () => undefined },
    },
  );
}

async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}

async function raceWithTimeout<T>(promise: Promise<T>): Promise<T | "timeout"> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"timeout">((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), 100);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

describe("Redis event publisher", () => {
  it("captures config without invoking accessors", () => {
    let getterCalls = 0;
    const config = {} as { url: string };
    Object.defineProperty(config, "url", {
      enumerable: true,
      get() {
        getterCalls++;
        return "redis://cache.example.test";
      },
    });

    assertThrows(
      () =>
        createRedisEventPublisher(config, {
          createClient: () => createFakeClient(),
        }),
      TypeError,
      "data property",
    );
    assertEquals(getterCalls, 0);
  });

  it("single-flights initialization across concurrent operations", async () => {
    const publishClient = createFakeClient();
    const subscribeClient = createFakeClient();
    const publisher = createPublisher(publishClient, subscribeClient);

    await Promise.all([
      publisher.publish(createEvent()),
      publisher.subscribe("run-1", () => undefined),
    ]);

    assertEquals(publishClient.connectCalls, 1);
    assertEquals(subscribeClient.connectCalls, 1);
    assertEquals(publishClient.publishCalls[0]?.channel, "vf:events:run-1");
    assertEquals(JSON.parse(publishClient.publishCalls[0]!.message), createEvent());
    await publisher.close();
  });

  it("disposes only the exact listener on a shared channel", async () => {
    const publishClient = createFakeClient();
    const subscribeClient = createFakeClient();
    const publisher = createPublisher(publishClient, subscribeClient);
    let firstEvents = 0;
    let secondEvents = 0;
    const disposeFirst = await publisher.subscribe("run-1", () => {
      firstEvents++;
    });
    await publisher.subscribe("run-1", () => {
      secondEvents++;
    });
    const channel = "vf:events:run-1";

    subscribeClient.emit(channel, JSON.stringify(createEvent()));
    disposeFirst();
    await drainMicrotasks();
    subscribeClient.emit(channel, JSON.stringify(createEvent()));

    assertEquals(firstEvents, 1);
    assertEquals(secondEvents, 2);
    assertEquals(subscribeClient.unsubscribeCalls.length, 1);
    await publisher.close();
  });

  it("close rejects promptly when one client hangs and the other fails", async () => {
    const publishClient = createFakeClient({
      close: () => new Promise<void>(() => {}),
    });
    const subscribeClient = createFakeClient({
      close: () => Promise.reject(new Error("close failed")),
    });
    const publisher = createPublisher(publishClient, subscribeClient);
    await publisher.publish(createEvent());

    const result = await raceWithTimeout(
      publisher.close().then(
        () => "resolved" as const,
        (error) => error instanceof Error ? error.message : String(error),
      ),
    );

    assertEquals(result, "close failed");
  });

  it("cleans up both clients when initialization fails", async () => {
    const publishClient = createFakeClient({
      connect: () => Promise.reject(new Error("connect failed")),
    });
    const subscribeClient = createFakeClient();
    const publisher = createPublisher(publishClient, subscribeClient);

    await assertRejects(() => publisher.publish(createEvent()), Error, "connect failed");

    assertEquals(publishClient.closeCalls, 1);
    assertEquals(subscribeClient.closeCalls, 1);
    await publisher.close();
  });

  it("closes a client again when parallel initialization settles late", async () => {
    let releaseConnect: (() => void) | undefined;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    const publishClient = createFakeClient({
      connect: () => Promise.reject(new Error("connect failed")),
    });
    const subscribeClient = createFakeClient({ connect: () => connectGate });
    const publisher = createPublisher(publishClient, subscribeClient);

    await assertRejects(() => publisher.publish(createEvent()), Error, "connect failed");
    assertEquals(publishClient.closeCalls, 1);
    assertEquals(subscribeClient.closeCalls, 1);

    releaseConnect?.();
    await drainMicrotasks();
    assertEquals(publishClient.closeCalls, 1);
    assertEquals(subscribeClient.closeCalls, 2);
    await publisher.close();
  });

  it("closes late connections after shutdown cancels initialization", async () => {
    let started = 0;
    let bothStartedResolve: (() => void) | undefined;
    const bothStarted = new Promise<void>((resolve) => {
      bothStartedResolve = resolve;
    });
    let releaseConnect: (() => void) | undefined;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    const connect = () => {
      started++;
      if (started === 2) bothStartedResolve?.();
      return connectGate;
    };
    const publishClient = createFakeClient({ connect });
    const subscribeClient = createFakeClient({ connect });
    const publisher = createPublisher(publishClient, subscribeClient);
    const publishing = publisher.publish(createEvent());
    await bothStarted;

    assertEquals(await raceWithTimeout(publisher.close()), undefined);
    await assertRejects(() => publishing, Error, "closing");
    assertEquals(publishClient.closeCalls, 1);
    assertEquals(subscribeClient.closeCalls, 1);

    releaseConnect?.();
    await drainMicrotasks();
    assertEquals(publishClient.closeCalls, 2);
    assertEquals(subscribeClient.closeCalls, 2);
  });

  it("finishes retryable failed-init cleanup before creating replacement clients", async () => {
    let failedCloseAttempts = 0;
    const failedPublish = createFakeClient({
      connect: () => Promise.reject(new Error("connect failed")),
      close: () => {
        failedCloseAttempts++;
        return failedCloseAttempts === 1
          ? Promise.reject(new Error("cleanup failed"))
          : Promise.resolve();
      },
    });
    const failedSubscribe = createFakeClient();
    const replacementPublish = createFakeClient();
    const replacementSubscribe = createFakeClient();
    const clients = [
      failedPublish,
      failedSubscribe,
      replacementPublish,
      replacementSubscribe,
    ];
    let created = 0;
    const publisher = createRedisEventPublisher(
      { url: "redis://cache.example.test" },
      {
        createClient: () => {
          created++;
          const client = clients.shift();
          if (!client) throw new Error("Unexpected Redis client creation");
          return client;
        },
        logger: { info: () => undefined, error: () => undefined },
      },
    );

    await assertRejects(
      () => publisher.publish(createEvent()),
      AggregateError,
      "setup and cleanup failed",
    );
    assertEquals(created, 2);

    await publisher.publish(createEvent());

    assertEquals(failedCloseAttempts, 2);
    assertEquals(created, 4);
    assertEquals(replacementPublish.publishCalls.length, 1);
    await publisher.close();
  });
});
