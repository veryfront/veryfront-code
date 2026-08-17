import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, unregister } from "../contracts.ts";
import { ensureRedisRuntimeProvider } from "./defaults.ts";
import {
  captureRedisRuntimeProvider,
  type NodeRedisClient,
  type RedisClient,
  type RedisRuntimeProvider,
  RedisRuntimeProviderName,
} from "./redis-runtime-provider.ts";

function createClient(): RedisClient {
  return {
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
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
  };
}

function createProvider(): RedisRuntimeProvider {
  return {
    id: "test-redis",
    loadModule: () => Promise.resolve({ createClient: () => ({}) } as never),
    getClient: () => Promise.resolve(createClient()),
    disconnectClient: () => Promise.resolve(),
    openClient: () =>
      Promise.resolve({
        client: createClient(),
        close: () => Promise.resolve(),
      }),
    createEventPublisher: () =>
      Promise.resolve({
        publish: () => Promise.resolve(),
        subscribe: () => Promise.resolve(() => undefined),
        close: () => Promise.resolve(),
      }),
    close: () => Promise.resolve(),
  };
}

describe("RedisRuntimeProvider", () => {
  it("keeps error-only Redis event listeners source compatible", () => {
    const on: NodeRedisClient["on"] = (
      event: "error",
      listener: (error: unknown) => void,
    ): unknown => {
      void listener;
      return event;
    };

    assertEquals(on("error", () => {}), "error");
  });

  it("captures provider methods without losing their receiver", async () => {
    let receivedThis: unknown;
    const provider = {
      ...createProvider(),
      async loadModule() {
        receivedThis = this;
        return { createClient: () => ({}) } as never;
      },
    };
    const captured = captureRedisRuntimeProvider(provider);

    await captured.loadModule();

    assertEquals(receivedThis === provider, true);
    assertEquals(captured.id, "test-redis");
    assertEquals(Object.isFrozen(captured), true);
  });

  it("rejects accessors without invoking them", () => {
    let getterCalls = 0;
    const provider = createProvider() as RedisRuntimeProvider & { id: string };
    Object.defineProperty(provider, "id", {
      enumerable: true,
      get() {
        getterCalls++;
        return "unsafe";
      },
    });

    assertThrows(
      () => captureRedisRuntimeProvider(provider),
      TypeError,
      "own data property",
    );
    assertEquals(getterCalls, 0);
  });

  it("rejects unexpected provider properties", () => {
    assertThrows(
      () => captureRedisRuntimeProvider({ ...createProvider(), fallback: true }),
      TypeError,
      "unexpected property",
    );
  });

  it("fails closed when a provider returns a malformed client", async () => {
    const provider = createProvider();
    provider.getClient = () => Promise.resolve({} as RedisClient);
    const captured = captureRedisRuntimeProvider(provider);

    await assertRejects(
      () => captured.getClient(),
      TypeError,
      "connect must be exposed",
    );
  });

  it("captures an optional info method with its original receiver", async () => {
    const client = createClient();
    let receivedThis: unknown;
    client.info = function () {
      receivedThis = this;
      return Promise.resolve("redis_version:7.4.1");
    };
    const provider = createProvider();
    provider.getClient = () => Promise.resolve(client);

    const captured = await captureRedisRuntimeProvider(provider).getClient();

    assertEquals(await captured.info?.("server"), "redis_version:7.4.1");
    assertEquals(receivedThis === client, true);
  });

  it("rejects returned module accessors without invoking them", async () => {
    let getterCalls = 0;
    const module = {};
    Object.defineProperty(module, "createClient", {
      enumerable: true,
      get() {
        getterCalls++;
        return () => ({});
      },
    });
    const provider = createProvider();
    provider.loadModule = () => Promise.resolve(module as never);
    const captured = captureRedisRuntimeProvider(provider);

    await assertRejects(
      () => captured.loadModule(),
      TypeError,
      "must be a data property",
    );
    assertEquals(getterCalls, 0);
  });

  it("snapshots proxy-backed clients without reading Redis methods through get", async () => {
    const accessedProperties: PropertyKey[] = [];
    const target = createClient();
    target.isOpen = true;
    const client = new Proxy(target, {
      get(target, property, receiver) {
        accessedProperties.push(property);
        return Reflect.get(target, property, receiver);
      },
    });
    const provider = createProvider();
    provider.getClient = () => Promise.resolve(client);
    const captured = captureRedisRuntimeProvider(provider);

    const result = await captured.getClient();

    assertEquals(
      accessedProperties.every((property) => property === "then"),
      true,
    );
    assertEquals(result.isOpen, true);
    assertEquals(accessedProperties.at(-1), "isOpen");
    assertEquals(await result.get("key"), null);
    assertEquals(
      accessedProperties.every((property) => property === "then" || property === "isOpen"),
      true,
    );
  });

  it("rejects returned client accessors without invoking them", async () => {
    let getterCalls = 0;
    const client = createClient();
    Object.defineProperty(client, "connect", {
      enumerable: true,
      get() {
        getterCalls++;
        return () => Promise.resolve();
      },
    });
    const provider = createProvider();
    provider.getClient = () => Promise.resolve(client);
    const captured = captureRedisRuntimeProvider(provider);

    await assertRejects(
      () => captured.getClient(),
      TypeError,
      "must be a data property",
    );
    assertEquals(getterCalls, 0);
  });

  it("closes a returned handle when client capture fails", async () => {
    let getterCalls = 0;
    let closeCalls = 0;
    const client = createClient();
    Object.defineProperty(client, "connect", {
      enumerable: true,
      get() {
        getterCalls++;
        return () => Promise.resolve();
      },
    });
    const provider = createProvider();
    provider.openClient = () =>
      Promise.resolve({
        client,
        close() {
          closeCalls++;
          return Promise.resolve();
        },
      });
    const captured = captureRedisRuntimeProvider(provider);

    await assertRejects(
      () => captured.openClient(),
      TypeError,
      "must be a data property",
    );
    assertEquals(getterCalls, 0);
    assertEquals(closeCalls, 1);
  });

  it("closes a returned event publisher when capture fails", async () => {
    let getterCalls = 0;
    let closeCalls = 0;
    const implementation = {
      subscribe: () => Promise.resolve(() => undefined),
      close() {
        closeCalls++;
        return Promise.resolve();
      },
    } as Record<string, unknown>;
    Object.defineProperty(implementation, "publish", {
      enumerable: true,
      get() {
        getterCalls++;
        return () => Promise.resolve();
      },
    });
    const provider = createProvider();
    provider.createEventPublisher = () => Promise.resolve(implementation as never);
    const captured = captureRedisRuntimeProvider(provider);

    await assertRejects(
      () => captured.createEventPublisher({ url: "redis://cache.example.test" }),
      TypeError,
      "own data property",
    );
    assertEquals(getterCalls, 0);
    assertEquals(closeCalls, 1);
  });

  it("resolves a provider registered through explicit orchestration", async () => {
    const provider = createProvider();
    register(RedisRuntimeProviderName, provider);
    try {
      const resolved = await ensureRedisRuntimeProvider();
      assertEquals(resolved.id, "test-redis");
    } finally {
      unregister(RedisRuntimeProviderName);
    }
  });

  it("fails closed with an install recommendation when no provider is registered", async () => {
    unregister(RedisRuntimeProviderName);
    await assertRejects(
      () => ensureRedisRuntimeProvider(),
      Error,
      "Install it with: deno add npm:@veryfront/ext-redis",
    );
  });
});
