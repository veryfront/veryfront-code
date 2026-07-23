import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  __setRedisClientFactoryForTests,
  disconnectRedisClient,
  getRedisClient,
  type RedisClient,
  type RedisClientOptions,
} from "./redis-client.ts";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => resolve = res);
  return { promise, resolve };
}

function fakeClient(overrides: Partial<RedisClient> = {}): RedisClient {
  return {
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    get: () => Promise.resolve(null),
    mGet: (keys) => Promise.resolve(keys.map(() => null)),
    set: () => Promise.resolve("OK"),
    del: () => Promise.resolve(0),
    scan: () => Promise.resolve({ cursor: 0, keys: [] }),
    expire: () => Promise.resolve(0),
    isOpen: true,
    ...overrides,
  };
}

describe("redis-client", () => {
  afterEach(async () => {
    await disconnectRedisClient();
    __setRedisClientFactoryForTests(null);
  });

  it("coalesces concurrent connections and wires supported socket options", async () => {
    const createCalls: unknown[] = [];
    let connectCalls = 0;
    const client = fakeClient({
      connect: () => {
        connectCalls++;
        return Promise.resolve();
      },
    });
    __setRedisClientFactoryForTests((options) => {
      createCalls.push(options);
      return client;
    });

    const first = getRedisClient({
      url: "rediss://cache.example.test:6380",
      connectTimeout: 2_500,
      autoReconnect: false,
    });
    const second = getRedisClient({
      url: "rediss://cache.example.test:6380",
      connectTimeout: 2_500,
      autoReconnect: false,
    });

    assertEquals(await first, client);
    assertEquals(await second, client);
    assertEquals(connectCalls, 1);
    assertEquals(createCalls, [{
      url: "rediss://cache.example.test:6380",
      socket: { connectTimeout: 2_500, reconnectStrategy: false, tls: true },
    }]);
  });

  it("does not resurrect a connection that settles after disconnect", async () => {
    const connecting = deferred();
    let disconnectCalls = 0;
    const client = fakeClient({
      connect: () => connecting.promise,
      disconnect: () => {
        disconnectCalls++;
        return Promise.resolve();
      },
    });
    __setRedisClientFactoryForTests(() => client);

    const pending = getRedisClient({ url: "redis://cache.example.test:6379" });
    await Promise.resolve();
    await disconnectRedisClient();
    connecting.resolve();

    const error = await assertRejects(() => pending, VeryfrontError);
    assertEquals(error.slug, "initialization-error");
    assertEquals(disconnectCalls, 2);

    const replacement = fakeClient();
    __setRedisClientFactoryForTests(() => replacement);
    assertEquals(
      await getRedisClient({ url: "redis://cache.example.test:6379" }),
      replacement,
    );
  });

  it("disconnects an in-flight client when different options supersede it", async () => {
    const firstConnecting = deferred();
    let firstDisconnects = 0;
    const firstClient = fakeClient({
      connect: () => firstConnecting.promise,
      disconnect: () => {
        firstDisconnects++;
        return Promise.resolve();
      },
    });
    const secondClient = fakeClient();
    let created = 0;
    __setRedisClientFactoryForTests(() => created++ === 0 ? firstClient : secondClient);

    const superseded = getRedisClient({ url: "redis://one.example.test" });
    await Promise.resolve();
    assertEquals(
      await getRedisClient({ url: "redis://two.example.test" }),
      secondClient,
    );
    assertEquals(firstDisconnects, 1);

    firstConnecting.resolve();
    const error = await assertRejects(() => superseded, VeryfrontError);
    assertEquals(error.slug, "initialization-error");
    assertEquals(firstDisconnects, 2);
  });

  it("replaces a shared client when connection identity changes", async () => {
    let firstDisconnects = 0;
    const firstClient = fakeClient({
      disconnect: () => {
        firstDisconnects++;
        return Promise.resolve();
      },
    });
    const secondClient = fakeClient();
    let created = 0;
    __setRedisClientFactoryForTests(() => created++ === 0 ? firstClient : secondClient);

    assertEquals(await getRedisClient({ url: "redis://one.example.test" }), firstClient);
    assertEquals(await getRedisClient({ url: "redis://two.example.test" }), secondClient);
    assertEquals(firstDisconnects, 1);
  });

  it("wraps connection failures without exposing credentials", async () => {
    __setRedisClientFactoryForTests(() =>
      fakeClient({
        connect: () =>
          Promise.reject(new Error("connect redis://user:super-secret@cache.example.test failed")),
      })
    );

    const error = await assertRejects(
      () => getRedisClient({ url: "redis://user:super-secret@cache.example.test" }),
      VeryfrontError,
    );

    assertEquals(error.slug, "initialization-error");
    assertEquals(error.message.includes("super-secret"), false);
    assertNotEquals(error.cause, undefined);
  });

  it("rejects malformed or unbounded runtime options before creating a client", async () => {
    let created = false;
    __setRedisClientFactoryForTests(() => {
      created = true;
      return fakeClient();
    });

    const invalidOptions: unknown[] = [
      null,
      [],
      { url: 42 },
      { url: "redis://cache.example.test", tls: "yes" },
      { url: "redis://cache.example.test", autoReconnect: 1 },
      { url: "redis://cache.example.test", username: "u".repeat(1_025) },
      { url: "redis://cache.example.test", password: "p".repeat(16_385) },
      Object.defineProperty({}, "url", {
        get() {
          throw new Error("unsafe getter detail");
        },
      }),
    ];
    for (const options of invalidOptions) {
      const error = await assertRejects(
        () => getRedisClient(options as RedisClientOptions),
        VeryfrontError,
      );
      assertEquals(error.slug, "invalid-argument");
    }
    assertEquals(created, false);
  });

  it("snapshots option access before validation and client creation", async () => {
    let connectTimeoutReads = 0;
    let receivedOptions: unknown;
    const client = fakeClient();
    __setRedisClientFactoryForTests((options) => {
      receivedOptions = options;
      return client;
    });

    const options = Object.defineProperty({}, "connectTimeout", {
      enumerable: true,
      get() {
        connectTimeoutReads++;
        return connectTimeoutReads === 1 ? 2_500 : 300_000;
      },
    }) as RedisClientOptions;

    assertEquals(await getRedisClient(options), client);
    assertEquals(connectTimeoutReads, 1);
    assertEquals(receivedOptions, { socket: { connectTimeout: 2_500 } });
  });
});
