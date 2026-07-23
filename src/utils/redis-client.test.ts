import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createRedisClientManager,
  type RedisClient,
  type RedisClientFactoryOptions,
} from "./redis-client.ts";

interface FakeRedisClient extends RedisClient {
  disconnectCalls: number;
}

function createFakeClient(connect: () => Promise<void> = () => Promise.resolve()): FakeRedisClient {
  return {
    connect,
    disconnectCalls: 0,
    disconnect() {
      this.disconnectCalls++;
      return Promise.resolve();
    },
    get: () => Promise.resolve(null),
    mGet: (keys) => Promise.resolve(keys.map(() => null)),
    set: () => Promise.resolve("OK"),
    del: () => Promise.resolve(0),
    scan: () => Promise.resolve({ cursor: 0, keys: [] }),
    expire: () => Promise.resolve(1),
    isOpen: true,
  };
}

describe("redis-client", () => {
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
  });

  it("shares one in-flight connection for equivalent options", async () => {
    let releaseConnect: (() => void) | undefined;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    let createCount = 0;
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      loadFactory: () =>
        Promise.resolve(() => {
          createCount++;
          return createFakeClient(() => connectGate);
        }),
    });

    const first = manager.getClient({ url: "redis://cache" });
    const second = manager.getClient({ url: "redis://cache" });
    assertEquals(first, second);

    releaseConnect?.();
    assertEquals(await first, await second);
    assertEquals(createCount, 1);
  });

  it("does not reuse a client created with different connection options", async () => {
    const clients = [createFakeClient(), createFakeClient()];
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      loadFactory: () => Promise.resolve(() => clients.shift()!),
    });

    const first = await manager.getClient({ url: "redis://first" });
    const second = await manager.getClient({ url: "redis://second" });

    assertEquals(first === second, false);
    assertEquals((first as FakeRedisClient).disconnectCalls, 0);
    assertEquals(await manager.getClient({ url: "redis://first" }), first);

    await manager.disconnect();
    assertEquals((first as FakeRedisClient).disconnectCalls, 1);
    assertEquals((second as FakeRedisClient).disconnectCalls, 1);
  });

  it("connects different configurations independently without head-of-line blocking", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstClient = createFakeClient(() => firstGate);
    const secondClient = createFakeClient();
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      loadFactory: () =>
        Promise.resolve((options) => options.url === "redis://first" ? firstClient : secondClient),
    });

    const first = manager.getClient({ url: "redis://first" });
    const second = manager.getClient({ url: "redis://second" });

    assertEquals(await second, secondClient);
    releaseFirst?.();
    assertEquals(await first, firstClient);
  });

  it("reuses an active client and reconnects only after explicit disconnect", async () => {
    const clients = [createFakeClient(), createFakeClient()];
    let createCount = 0;
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      loadFactory: () =>
        Promise.resolve(() => {
          createCount++;
          return clients.shift()!;
        }),
    });

    const first = await manager.getClient({ url: "redis://cache" });
    assertEquals(await manager.getClient({ url: "redis://cache" }), first);
    assertEquals(createCount, 1);

    await manager.disconnect();
    assertEquals((first as FakeRedisClient).disconnectCalls, 1);
    assertEquals(await manager.getClient({ url: "redis://cache" }) === first, false);
    assertEquals(createCount, 2);
  });

  it("resolves connection configuration from the environment", async () => {
    let received: RedisClientFactoryOptions | undefined;
    const env = new Map([
      ["REDIS_URL", "rediss://cache.example.test"],
      ["REDIS_PASSWORD", "secret"],
      ["REDIS_USERNAME", "service"],
    ]);
    const manager = createRedisClientManager({
      getEnv: (key) => env.get(key),
      loadFactory: () =>
        Promise.resolve((options) => {
          received = options;
          return createFakeClient();
        }),
    });

    assertEquals(manager.isConfigured(), true);
    await manager.getClient();
    assertEquals(received, {
      url: "rediss://cache.example.test",
      socket: { tls: true },
      password: "secret",
      username: "service",
    });

    env.delete("REDIS_URL");
    assertEquals(manager.isConfigured(), false);
  });

  it("cancels and disposes a connection that completes after disconnect", async () => {
    let notifyConnectStarted: (() => void) | undefined;
    const connectStarted = new Promise<void>((resolve) => {
      notifyConnectStarted = resolve;
    });
    let releaseConnect: (() => void) | undefined;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    const stale = createFakeClient(() => {
      notifyConnectStarted?.();
      return connectGate;
    });
    const fresh = createFakeClient();
    const clients = [stale, fresh];
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      loadFactory: () => Promise.resolve(() => clients.shift()!),
    });

    const pending = manager.getClient({ url: "redis://cache" });
    await connectStarted;
    const disconnected = manager.disconnect();
    const rejected = assertRejects(() => pending, Error, "cancelled");
    releaseConnect?.();
    await Promise.all([disconnected, rejected]);

    assertEquals(stale.disconnectCalls, 1);
    assertEquals(await manager.getClient({ url: "redis://cache" }), fresh);
  });

  it("cancels and disconnects a provisional client whose connect never settles", async () => {
    let notifyConnectStarted: (() => void) | undefined;
    const connectStarted = new Promise<void>((resolve) => {
      notifyConnectStarted = resolve;
    });
    const provisional = createFakeClient(() => {
      notifyConnectStarted?.();
      return new Promise<void>(() => {});
    });
    provisional.isOpen = false;
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      loadFactory: () => Promise.resolve(() => provisional),
    });

    const pending = manager.getClient({ url: "redis://cache" });
    const rejected = assertRejects(() => pending, Error, "cancelled");
    await connectStarted;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timed-out">((resolve) => {
      timeoutId = setTimeout(() => resolve("timed-out"), 100);
    });
    const disconnectResult = await Promise.race([
      manager.disconnect().then(() => "disconnected" as const),
      timeout,
    ]).finally(() => clearTimeout(timeoutId));

    assertEquals(disconnectResult, "disconnected");
    assertEquals(provisional.disconnectCalls, 1);
    await rejected;
  });

  it("cancels all differently configured requests active before disconnect", async () => {
    let startedConnections = 0;
    let notifyConnectionsStarted: (() => void) | undefined;
    const connectionsStarted = new Promise<void>((resolve) => {
      notifyConnectionsStarted = resolve;
    });
    let releaseConnect: (() => void) | undefined;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    let createCount = 0;
    const connect = () => {
      startedConnections++;
      if (startedConnections === 2) notifyConnectionsStarted?.();
      return connectGate;
    };
    const clients = [
      createFakeClient(connect),
      createFakeClient(connect),
    ];
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      loadFactory: () =>
        Promise.resolve(() => {
          createCount++;
          return clients.shift()!;
        }),
    });

    const first = manager.getClient({ url: "redis://first" });
    const queued = manager.getClient({ url: "redis://queued" });
    await connectionsStarted;
    const disconnected = manager.disconnect();
    releaseConnect?.();

    await Promise.all([
      disconnected,
      assertRejects(() => first, Error, "cancelled"),
      assertRejects(() => queued, Error, "cancelled"),
    ]);
    assertEquals(createCount, 2);
  });

  it("cancels before opening a client when disconnect occurs while loading the factory", async () => {
    let releaseFactory: (() => void) | undefined;
    const factoryGate = new Promise<void>((resolve) => {
      releaseFactory = resolve;
    });
    let connectCalls = 0;
    let factoryCalls = 0;
    const client = createFakeClient(() => {
      connectCalls++;
      return Promise.resolve();
    });
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      loadFactory: async () => {
        await factoryGate;
        return () => {
          factoryCalls++;
          return client;
        };
      },
    });

    const pending = manager.getClient({ url: "redis://cache" });
    await Promise.resolve();
    const disconnected = manager.disconnect();
    releaseFactory?.();

    await Promise.all([
      disconnected,
      assertRejects(() => pending, Error, "cancelled"),
    ]);
    assertEquals(connectCalls, 0);
    assertEquals(factoryCalls, 0);
    assertEquals(client.disconnectCalls, 0);
  });

  it("disposes a client whose connection attempt fails", async () => {
    const failedClient = createFakeClient(() => Promise.reject(new Error("connect failed")));
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      loadFactory: () => Promise.resolve(() => failedClient),
    });

    await assertRejects(
      () => manager.getClient({ url: "redis://cache" }),
      Error,
      "connect failed",
    );

    assertEquals(failedClient.disconnectCalls, 1);
  });

  it("applies a failure cooldown before retrying the same connection", async () => {
    let currentTime = 1_000;
    let createCount = 0;
    const clients = [
      createFakeClient(() => Promise.reject(new Error("connect failed"))),
      createFakeClient(),
    ];
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      now: () => currentTime,
      loadFactory: () =>
        Promise.resolve(() => {
          createCount++;
          return clients.shift()!;
        }),
    });

    await assertRejects(
      () => manager.getClient({ url: "redis://cache" }),
      Error,
      "connect failed",
    );
    await assertRejects(
      () => manager.getClient({ url: "redis://cache" }),
      Error,
      "recently failed",
    );
    assertEquals(createCount, 1);

    currentTime += 5_000;
    await manager.getClient({ url: "redis://cache" });
    assertEquals(createCount, 2);
  });

  it("rejects invalid connection timeouts", async () => {
    const manager = createRedisClientManager({
      getEnv: () => undefined,
      loadFactory: () => Promise.resolve(() => createFakeClient()),
    });

    for (const timeout of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assertRejects(
        () => manager.getClient({ connectTimeout: timeout }),
        RangeError,
      );
    }
  });
});
