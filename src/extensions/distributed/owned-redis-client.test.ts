import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, unregister } from "../contracts.ts";
import { OwnedRedisClientConnection } from "./owned-redis-client.ts";
import type {
  RedisClient,
  RedisClientHandle,
  RedisRuntimeProvider,
} from "./redis-runtime-provider.ts";
import { RedisRuntimeProviderName } from "./redis-runtime-provider.ts";

interface FakeRedisClient extends RedisClient {
  emit(event: string, value?: unknown): void;
  listenerCount(event: string): number;
}

async function raceWithTimeout<T>(promise: Promise<T>): Promise<T | "timeout"> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"timeout">((resolve) => {
        timeout = setTimeout(() => resolve("timeout"), 100);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function createClient(): FakeRedisClient {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
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
    listenerCount(event) {
      return listeners.get(event)?.size ?? 0;
    },
  };
}

function createProvider(
  openClient: RedisRuntimeProvider["openClient"],
): RedisRuntimeProvider {
  return {
    id: "owned-client-test",
    loadModule: () => Promise.resolve({ createClient: () => ({}) } as never),
    getClient: () => Promise.resolve(createClient()),
    disconnectClient: () => Promise.resolve(),
    openClient,
    createEventPublisher: () =>
      Promise.resolve({
        publish: () => Promise.resolve(),
        subscribe: () => Promise.resolve(() => undefined),
        close: () => Promise.resolve(),
      }),
    close: () => Promise.resolve(),
  };
}

async function withProvider(
  provider: RedisRuntimeProvider,
  run: () => Promise<void>,
): Promise<void> {
  register(RedisRuntimeProviderName, provider);
  try {
    await run();
  } finally {
    unregister(RedisRuntimeProviderName);
  }
}

describe("OwnedRedisClientConnection", () => {
  it("aborts an in-flight provider acquisition during close", async () => {
    let openStartedResolve: (() => void) | undefined;
    const openStarted = new Promise<void>((resolve) => {
      openStartedResolve = resolve;
    });
    await withProvider(
      createProvider((_options, signal) => {
        openStartedResolve?.();
        return new Promise<RedisClientHandle>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        });
      }),
      async () => {
        const connection = new OwnedRedisClientConnection();
        const opening = connection.getClient();
        await openStarted;

        const closeResult = await raceWithTimeout(
          connection.close().then(() => "closed" as const),
        );

        assertEquals(closeResult, "closed");
        await assertRejects(() => opening, Error, "superseded");
      },
    );
  });

  it("clears failed setup so a later call can retry", async () => {
    const client = createClient();
    let attempts = 0;
    await withProvider(
      createProvider(() => {
        attempts++;
        if (attempts === 1) return Promise.reject(new Error("setup failed"));
        return Promise.resolve({ client, close: () => Promise.resolve() });
      }),
      async () => {
        const connection = new OwnedRedisClientConnection();
        await assertRejects(() => connection.getClient(), Error, "setup failed");
        await connection.getClient();
        assertEquals(attempts, 2);
        await connection.close();
      },
    );
  });

  it("single-flights teardown and remains idempotent", async () => {
    const client = createClient();
    let closeCalls = 0;
    await withProvider(
      createProvider(() =>
        Promise.resolve({
          client,
          close() {
            closeCalls++;
            return Promise.resolve();
          },
        })
      ),
      async () => {
        const connection = new OwnedRedisClientConnection();
        await connection.getClient();
        await Promise.all([connection.close(), connection.close()]);
        await connection.close();
        assertEquals(closeCalls, 1);
      },
    );
  });

  it("closes a retired client before single-flighting its replacement", async () => {
    const first = createClient();
    const second = createClient();
    let releaseClose: (() => void) | undefined;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    let opens = 0;
    let firstCloseCalls = 0;
    await withProvider(
      createProvider(() => {
        opens++;
        const client = opens === 1 ? first : second;
        return Promise.resolve({
          client,
          close() {
            if (client === first) {
              firstCloseCalls++;
              return closeGate;
            }
            return Promise.resolve();
          },
        });
      }),
      async () => {
        const connection = new OwnedRedisClientConnection();
        await connection.getClient();
        first.emit("error", new Error("socket lost"));

        const replacement = connection.getClient();
        const duplicate = connection.getClient();
        assertEquals(replacement, duplicate);
        assertEquals(opens, 1);
        releaseClose?.();
        const replacementClient = await replacement;

        assertEquals(opens, 2);
        assertEquals(firstCloseCalls, 1);
        assertEquals(await duplicate, replacementClient);
        await connection.close();
      },
    );
  });

  it("ignores stale client events after replacement without adding listeners", async () => {
    const firstClient = createClient();
    const secondClient = createClient();
    const clients = [firstClient, secondClient];
    let opens = 0;
    await withProvider(
      createProvider(() => {
        const client = clients[opens++]!;
        return Promise.resolve({ client, close: () => Promise.resolve() });
      }),
      async () => {
        const connection = new OwnedRedisClientConnection();
        await connection.getClient();
        firstClient.emit("end");
        const replacement = await connection.getClient();

        firstClient.emit("error", new Error("stale"));
        firstClient.emit("end");

        assertEquals(await connection.getClient(), replacement);
        assertEquals(opens, 2);
        assertEquals(firstClient.listenerCount("error"), 1);
        assertEquals(firstClient.listenerCount("end"), 1);
        assertEquals(secondClient.listenerCount("error"), 1);
        assertEquals(secondClient.listenerCount("end"), 1);
        await connection.close();
      },
    );
  });
});
