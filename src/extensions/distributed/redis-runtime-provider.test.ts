import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
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

/** Data-property stubs for every method `captureNodeRedisClient` must snapshot. */
const NODE_REDIS_CLIENT_METHODS = [
  "connect",
  "hSet",
  "hGetAll",
  "hDel",
  "del",
  "sAdd",
  "sRem",
  "sMembers",
  "rPush",
  "lRange",
  "lIndex",
  "lSet",
  "lLen",
  "xAdd",
  "xGroupCreate",
  "xReadGroup",
  "xAck",
  "keys",
  "scan",
  "exists",
  "expire",
  "set",
  "get",
  "publish",
  "subscribe",
  "unsubscribe",
  "eval",
  "close",
  "destroy",
  "on",
] as const;

function createModuleClient(
  omitted?: typeof NODE_REDIS_CLIENT_METHODS[number],
): Record<string, unknown> {
  const client: Record<string, unknown> = {};
  for (const name of NODE_REDIS_CLIENT_METHODS) {
    if (name === omitted) continue;
    client[name] = () => Promise.resolve(null);
  }
  return client;
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
  it("forwards module-client error listeners with their own receiver", async () => {
    const calls: Array<{ receiver: unknown; args: unknown[] }> = [];
    const client = createModuleClient();
    client.on = function (this: unknown, ...args: unknown[]) {
      calls.push({ receiver: this, args });
      return "registered";
    };
    const provider = createProvider();
    provider.loadModule = () => Promise.resolve({ createClient: () => client } as never);

    const module = await captureRedisRuntimeProvider(provider).loadModule();
    const captured: NodeRedisClient = module.createClient({});
    const listener = () => {};
    const result = captured.on("error", listener);

    assertEquals(calls.length, 1, "on must be forwarded exactly once");
    assertEquals(
      calls[0]?.receiver === client,
      true,
      "the underlying client must stay the receiver of on",
    );
    assertEquals(
      calls[0]?.args,
      ["error", listener],
      "on must forward the event name and listener unchanged",
    );
    assertEquals(result, "registered", "on must return the underlying return value");
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

  it("rejects hostile provider ids", () => {
    for (
      const id of [
        "",
        " padded ",
        // One code unit past the 256-code-unit bound.
        "x".repeat(257),
        "id\0",
        "id\n",
        // Decomposed "e" + combining acute: not NFC.
        "e\u0301xt",
      ]
    ) {
      assertThrows(
        () => captureRedisRuntimeProvider({ ...createProvider(), id }),
        TypeError,
        "bounded canonical string",
        `provider id ${JSON.stringify(id)} must be rejected at capture`,
      );
    }
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

  it("rejects module-client accessors and missing methods without invoking them", async () => {
    let getterCalls = 0;
    const client = createModuleClient();
    Object.defineProperty(client, "get", {
      enumerable: true,
      get() {
        getterCalls++;
        return () => Promise.resolve(null);
      },
    });
    const provider = createProvider();
    provider.loadModule = () => Promise.resolve({ createClient: () => client } as never);

    const module = await captureRedisRuntimeProvider(provider).loadModule();
    assertThrows(
      () => module.createClient({}),
      TypeError,
      "must be a data property",
      "an accessor-backed module client method must be rejected",
    );
    assertEquals(getterCalls, 0, "module client getters must never run");

    const incomplete = createProvider();
    incomplete.loadModule = () =>
      Promise.resolve({ createClient: () => createModuleClient("destroy") } as never);
    const incompleteModule = await captureRedisRuntimeProvider(incomplete).loadModule();
    assertThrows(
      () => incompleteModule.createClient({}),
      TypeError,
      "must be exposed",
      "a module client missing destroy must be rejected",
    );
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

  it("forwards captured publisher calls with their own receiver and requires a disposer", async () => {
    const receivers: unknown[] = [];
    const dispose = () => undefined;
    const implementation = {
      publish(this: unknown) {
        receivers.push(this);
        return Promise.resolve();
      },
      subscribe(this: unknown) {
        receivers.push(this);
        return Promise.resolve(dispose);
      },
      close(this: unknown) {
        receivers.push(this);
        return Promise.resolve();
      },
    };
    const provider = createProvider();
    provider.createEventPublisher = () => Promise.resolve(implementation as never);

    const publisher = await captureRedisRuntimeProvider(provider).createEventPublisher({
      url: "redis://cache.example.test",
    });
    await publisher.publish({ type: "ping" } as never);
    const disposer = await publisher.subscribe("run-1", () => {});
    await publisher.close();

    assertEquals(receivers.length, 3, "publish, subscribe, and close must each be forwarded once");
    for (const receiver of receivers) {
      assertEquals(
        receiver === implementation,
        true,
        "the publisher implementation must stay the receiver of its own methods",
      );
    }
    assertEquals(disposer === dispose, true, "subscribe must resolve the disposer it returned");

    const invalid = createProvider();
    invalid.createEventPublisher = () =>
      Promise.resolve({
        publish: () => Promise.resolve(),
        subscribe: () => Promise.resolve("not-a-disposer"),
        close: () => Promise.resolve(),
      } as never);
    const invalidPublisher = await captureRedisRuntimeProvider(invalid).createEventPublisher({
      url: "redis://cache.example.test",
    });
    await assertRejects(
      () => invalidPublisher.subscribe("run-1", () => {}),
      TypeError,
      "must return a disposer",
    );
  });

  it("preserves the validation error when handle cleanup also fails", async () => {
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
          return Promise.reject(new Error("close failed"));
        },
      });
    const captured = captureRedisRuntimeProvider(provider);

    const error = await assertRejects(
      () => captured.openClient(),
      AggregateError,
      "Redis client handle validation and cleanup failed",
    ) as AggregateError;

    assertInstanceOf(
      error.errors[0],
      TypeError,
      "the validation failure must be the first aggregated error",
    );
    assertStringIncludes(
      error.errors[0].message,
      "must be a data property",
      "the validation failure must survive a failing cleanup",
    );
    assertStringIncludes(
      String(error.errors[1]),
      "close failed",
      "the cleanup failure must be aggregated alongside it",
    );
    assertEquals(getterCalls, 0, "cleanup must not invoke the rejected accessor");
    assertEquals(closeCalls, 1, "the rejected handle must still be closed once");
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
