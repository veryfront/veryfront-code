import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RedisClient } from "veryfront/extensions/distributed";
import { openRedisClient } from "./redis-client-manager.ts";
import { createRedisRuntimeProvider } from "./redis-runtime-provider.ts";

interface FakeRedisClient extends RedisClient {
  disconnectCalls: number;
}

async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve();
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

function createClient(
  operations: {
    connect?: () => Promise<void>;
    disconnect?: () => Promise<void>;
  } = {},
): FakeRedisClient {
  return {
    disconnectCalls: 0,
    connect: operations.connect ?? (() => Promise.resolve()),
    disconnect() {
      this.disconnectCalls++;
      return operations.disconnect?.() ?? Promise.resolve();
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
    on: () => undefined,
  };
}

describe("Redis runtime provider owned clients", () => {
  it("keeps shared-client disconnect idempotent after provider close", async () => {
    const provider = createRedisRuntimeProvider();

    await provider.close();
    await provider.disconnectClient();
    await provider.disconnectClient();
  });

  it("disposes a connection that finishes opening during provider close", async () => {
    const client = createClient();
    let openStartedResolve: (() => void) | undefined;
    const openStarted = new Promise<void>((resolve) => {
      openStartedResolve = resolve;
    });
    let releaseOpen: ((client: RedisClient) => void) | undefined;
    const openingGate = new Promise<RedisClient>((resolve) => {
      releaseOpen = resolve;
    });
    const provider = createRedisRuntimeProvider({
      openClient: () => {
        openStartedResolve?.();
        return openingGate;
      },
    });

    const opening = provider.openClient();
    await openStarted;
    const closing = provider.close();
    releaseOpen?.(client);

    await assertRejects(() => opening, Error, "closing");
    await closing;
    assertEquals(client.disconnectCalls, 1);
  });

  it("aborts and disconnects a client whose connect never settles", async () => {
    let connectStartedResolve: (() => void) | undefined;
    const connectStarted = new Promise<void>((resolve) => {
      connectStartedResolve = resolve;
    });
    const client = createClient({
      connect: () => {
        connectStartedResolve?.();
        return new Promise<void>(() => {});
      },
    });
    const provider = createRedisRuntimeProvider({
      openClient: (options, lifecycle) =>
        openRedisClient(
          options,
          {
            getEnv: () => undefined,
            loadFactory: () => Promise.resolve(() => client),
          },
          lifecycle,
        ),
    });
    const opening = provider.openClient({ url: "redis://cache.example.test" });
    await connectStarted;

    const closeResult = await raceWithTimeout(provider.close());

    assertEquals(closeResult, undefined);
    await assertRejects(() => opening, Error, "closing");
    assertEquals(client.disconnectCalls, 1);
  });

  it("disconnects again when an aborted connection settles late", async () => {
    let connectStartedResolve: (() => void) | undefined;
    const connectStarted = new Promise<void>((resolve) => {
      connectStartedResolve = resolve;
    });
    let releaseConnect: (() => void) | undefined;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    const client = createClient({
      connect: () => {
        connectStartedResolve?.();
        return connectGate;
      },
    });
    const provider = createRedisRuntimeProvider({
      openClient: (options, lifecycle) =>
        openRedisClient(
          options,
          {
            getEnv: () => undefined,
            loadFactory: () => Promise.resolve(() => client),
          },
          lifecycle,
        ),
    });
    const opening = provider.openClient({ url: "redis://cache.example.test" });
    await connectStarted;

    await provider.close();
    await assertRejects(() => opening, Error, "closing");
    assertEquals(client.disconnectCalls, 1);

    releaseConnect?.();
    await drainMicrotasks();
    assertEquals(client.disconnectCalls, 2);
  });

  it("retries failed teardown and remains idempotent after success", async () => {
    let disconnectAttempts = 0;
    const client = createClient({
      disconnect: () => {
        disconnectAttempts++;
        return disconnectAttempts === 1
          ? Promise.reject(new Error("disconnect failed"))
          : Promise.resolve();
      },
    });
    const provider = createRedisRuntimeProvider({
      openClient: () => Promise.resolve(client),
    });
    await provider.openClient();

    await assertRejects(() => provider.close(), Error, "disconnect failed");
    await provider.close();
    await provider.close();

    assertEquals(client.disconnectCalls, 2);
  });

  it("retains a provisional client when setup cleanup fails", async () => {
    let disconnectAttempts = 0;
    const client = createClient({
      connect: () => Promise.reject(new Error("connect failed")),
      disconnect: () => {
        disconnectAttempts++;
        return disconnectAttempts === 1
          ? Promise.reject(new Error("cleanup failed"))
          : Promise.resolve();
      },
    });
    const provider = createRedisRuntimeProvider({
      openClient: (options) =>
        openRedisClient(options, {
          getEnv: () => undefined,
          loadFactory: () => Promise.resolve(() => client),
        }),
    });

    let setupError: unknown;
    try {
      await provider.openClient({ url: "redis://cache.example.test" });
    } catch (error) {
      setupError = error;
    }
    assertEquals(setupError instanceof AggregateError, true);
    assertEquals(
      setupError !== null && typeof setupError === "object" && "client" in setupError,
      false,
    );

    await provider.close();
    assertEquals(client.disconnectCalls, 2);
  });
});
