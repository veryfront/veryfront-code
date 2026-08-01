import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RedisClient } from "veryfront/extensions/distributed";
import {
  createRedisClientManager,
  openRedisClient,
  type RedisClientFactoryOptions,
} from "./redis-client-manager.ts";

interface FakeRedisClient extends RedisClient {
  disconnectCalls: number;
  emit(event: string, value?: unknown): void;
}

function createFakeClient(
  connect: () => Promise<void> = () => Promise.resolve(),
  disconnect: () => Promise<void> = () => Promise.resolve(),
): FakeRedisClient {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    connect,
    disconnectCalls: 0,
    disconnect() {
      this.disconnectCalls++;
      return disconnect();
    },
    get: () => Promise.resolve(null),
    mGet: (keys) => Promise.resolve(keys.map(() => null)),
    set: () => Promise.resolve("OK"),
    del: () => Promise.resolve(0),
    scan: () => Promise.resolve({ cursor: 0, keys: [] }),
    expire: () => Promise.resolve(1),
    eval: () => Promise.resolve([1, 1_000]),
    incr: () => Promise.resolve(1),
    pExpire: () => Promise.resolve(true),
    pTTL: () => Promise.resolve(1_000),
    on(event, listener) {
      let eventListeners = listeners.get(event);
      if (!eventListeners) {
        eventListeners = new Set();
        listeners.set(event, eventListeners);
      }
      eventListeners.add(listener);
    },
    emit(event, value) {
      for (const listener of listeners.get(event) ?? []) listener(value);
    },
    isOpen: true,
  };
}

async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

describe("Redis client manager", () => {
  it("captures options without invoking accessors or accepting unknown values", async () => {
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      loadFactory: () => Promise.resolve(() => createFakeClient()),
    });
    let getterCalls = 0;
    const accessor = {} as { url?: string };
    Object.defineProperty(accessor, "url", {
      enumerable: true,
      get() {
        getterCalls++;
        return "redis://cache.example.test";
      },
    });

    await assertRejects(
      () => manager.getClient(accessor),
      TypeError,
      "data property",
    );
    assertEquals(getterCalls, 0);
    await assertRejects(
      () => manager.getClient({ unexpected: true } as never),
      TypeError,
      "unknown option",
    );
  });

  it("rejects client method accessors without invoking them", async () => {
    let getterCalls = 0;
    const client = createFakeClient();
    Object.defineProperty(client, "connect", {
      enumerable: true,
      get() {
        getterCalls++;
        return () => Promise.resolve();
      },
    });

    await assertRejects(
      () =>
        openRedisClient(
          { url: "redis://cache.example.test" },
          {
            getEnv: () => undefined,
            loadFactory: () => Promise.resolve(() => client),
          },
        ),
      TypeError,
      "data method",
    );
    assertEquals(getterCalls, 0);
  });

  it("forwards timeout, reconnect, TLS, and credential options", async () => {
    let received: RedisClientFactoryOptions | undefined;
    const client = createFakeClient();
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      loadFactory: () =>
        Promise.resolve((options) => {
          received = options;
          return client;
        }),
    });

    await manager.getClient({
      url: "rediss://cache.example.test",
      connectTimeout: 1_250,
      autoReconnect: false,
      password: "password",
      username: "user",
    });

    assertEquals(received, {
      url: "rediss://cache.example.test",
      socket: {
        tls: true,
        connectTimeout: 1_250,
        reconnectStrategy: false,
      },
      password: "password",
      username: "user",
    });
    await manager.disconnect();
  });

  it("single-flights equivalent connections but isolates different options", async () => {
    let releaseConnect: (() => void) | undefined;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    const firstClient = createFakeClient(() => connectGate);
    const secondClient = createFakeClient();
    const clients = [firstClient, secondClient];
    let created = 0;
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      loadFactory: () =>
        Promise.resolve(() => {
          created++;
          return clients.shift()!;
        }),
    });

    const first = manager.getClient({ url: "redis://first.example.test" });
    const duplicate = manager.getClient({ url: "redis://first.example.test" });
    const independent = manager.getClient({ url: "redis://second.example.test" });

    assertEquals(first, duplicate);
    assertEquals(await independent, secondClient);
    releaseConnect?.();
    assertEquals(await first, await duplicate);
    assertEquals(created, 2);
    await manager.disconnect();
  });

  it("cancels and disposes a connection whose connect never settles", async () => {
    let connectStartedResolve: (() => void) | undefined;
    const connectStarted = new Promise<void>((resolve) => {
      connectStartedResolve = resolve;
    });
    const provisional = createFakeClient(() => {
      connectStartedResolve?.();
      return new Promise<void>(() => {});
    });
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      loadFactory: () => Promise.resolve(() => provisional),
    });

    const pending = manager.getClient({ url: "redis://cache.example.test" });
    await connectStarted;
    await Promise.all([
      manager.disconnect(),
      assertRejects(() => pending, Error, "cancelled"),
    ]);

    assertEquals(provisional.disconnectCalls, 1);
  });

  it("disconnects again when a cancelled connection settles late", async () => {
    let connectStartedResolve: (() => void) | undefined;
    const connectStarted = new Promise<void>((resolve) => {
      connectStartedResolve = resolve;
    });
    let releaseConnect: (() => void) | undefined;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    const provisional = createFakeClient(() => {
      connectStartedResolve?.();
      return connectGate;
    });
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      loadFactory: () => Promise.resolve(() => provisional),
    });

    const pending = manager.getClient({ url: "redis://cache.example.test" });
    await connectStarted;
    await Promise.all([
      manager.disconnect(),
      assertRejects(() => pending, Error, "cancelled"),
    ]);
    assertEquals(provisional.disconnectCalls, 1);

    releaseConnect?.();
    await drainMicrotasks();
    assertEquals(provisional.disconnectCalls, 2);
  });

  it("disconnects failed clients and applies a per-configuration retry cooldown", async () => {
    let currentTime = 1_000;
    const failed = createFakeClient(() => Promise.reject(new Error("connect failed")));
    const healthy = createFakeClient();
    const clients = [failed, healthy];
    let created = 0;
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      now: () => currentTime,
      loadFactory: () =>
        Promise.resolve(() => {
          created++;
          return clients.shift()!;
        }),
    });

    await assertRejects(
      () => manager.getClient({ url: "redis://cache.example.test" }),
      Error,
      "connect failed",
    );
    await assertRejects(
      () => manager.getClient({ url: "redis://cache.example.test" }),
      Error,
      "recently failed",
    );
    assertEquals(failed.disconnectCalls, 1);
    assertEquals(created, 1);

    currentTime += 5_000;
    assertEquals(
      await manager.getClient({ url: "redis://cache.example.test" }),
      healthy,
    );
    assertEquals(created, 2);
    await manager.disconnect();
  });

  it("does not reuse a client after its error event", async () => {
    let currentTime = 1_000;
    const stale = createFakeClient();
    const fresh = createFakeClient();
    const clients = [stale, fresh];
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      now: () => currentTime,
      loadFactory: () => Promise.resolve(() => clients.shift()!),
    });

    await manager.getClient({ url: "redis://cache.example.test" });
    stale.emit("error", new Error("socket failed"));
    await assertRejects(
      () => manager.getClient({ url: "redis://cache.example.test" }),
      Error,
      "recently failed",
    );
    currentTime += 5_000;
    assertEquals(
      await manager.getClient({ url: "redis://cache.example.test" }),
      fresh,
    );
    assertEquals(stale.disconnectCalls, 1);
    await manager.disconnect();
  });

  it("cleans up a provisional client when standalone setup fails", async () => {
    const client = createFakeClient(() => Promise.reject(new Error("connect failed")));

    await assertRejects(
      () =>
        openRedisClient(
          { url: "redis://cache.example.test" },
          {
            getEnv: () => undefined,
            loadFactory: () => Promise.resolve(() => client),
          },
        ),
      Error,
      "connect failed",
    );

    assertEquals(client.disconnectCalls, 1);
  });

  it("retains failed disconnects for a later manager cleanup retry", async () => {
    let disconnectAttempts = 0;
    const client = createFakeClient(
      () => Promise.resolve(),
      () => {
        disconnectAttempts++;
        return disconnectAttempts === 1
          ? Promise.reject(new Error("disconnect failed"))
          : Promise.resolve();
      },
    );
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      loadFactory: () => Promise.resolve(() => client),
    });
    await manager.getClient({ url: "redis://cache.example.test" });

    await assertRejects(() => manager.disconnect(), Error, "disconnect failed");
    await manager.disconnect();

    assertEquals(client.disconnectCalls, 2);
  });
});
