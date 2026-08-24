import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/index.ts";
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
        const first = connection.close();
        const second = connection.close();
        assertStrictEquals(
          first,
          second,
          "concurrent close() calls must share one in-flight close promise",
        );
        await Promise.all([first, second]);
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

  it("closes a handle that arrives after close superseded the generation", async () => {
    // `signal` is optional in RedisRuntimeProvider, so a provider that ignores
    // it is contract-legal and still delivers a live socket after close won.
    const client = createClient();
    let closeCalls = 0;
    let openStartedResolve: (() => void) | undefined;
    const openStarted = new Promise<void>((resolve) => {
      openStartedResolve = resolve;
    });
    let releaseOpen: (() => void) | undefined;
    const opened = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    await withProvider(
      createProvider(() => {
        openStartedResolve?.();
        return opened.then(() => ({
          client,
          close() {
            closeCalls++;
            return Promise.resolve();
          },
        }));
      }),
      async () => {
        const connection = new OwnedRedisClientConnection();
        const opening = connection.getClient();
        await openStarted;
        const closing = connection.close();
        releaseOpen?.();
        await closing;

        assertEquals(
          closeCalls,
          1,
          "a handle delivered after the generation changed must be closed exactly once",
        );
        await assertRejects(() => opening, Error, "superseded");
        await connection.close();
        assertEquals(closeCalls, 1, "a drained handle must not be closed a second time");
      },
    );
  });

  it("makes a later getClient wait for the in-flight close", async () => {
    const clients = [createClient(), createClient()];
    let opens = 0;
    let releaseClose: (() => void) | undefined;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    await withProvider(
      createProvider(() => {
        const index = opens++;
        return Promise.resolve({
          client: clients[index]!,
          close: () => (index === 0 ? closeGate : Promise.resolve()),
        });
      }),
      async () => {
        const connection = new OwnedRedisClientConnection();
        await connection.getClient();
        const closing = connection.close();
        const reopened = connection.getClient();
        for (let turn = 0; turn < 50; turn++) await Promise.resolve();
        assertEquals(
          opens,
          1,
          "getClient must not open a replacement while close is still draining",
        );

        releaseClose?.();
        await closing;
        await reopened;
        assertEquals(opens, 2, "exactly one replacement handle must be opened");
        assertEquals(
          clients[1]!.listenerCount("error"),
          1,
          "getClient must resume on the second client once close settles",
        );
        await connection.close();
      },
    );
  });

  it("notifies the owner's lifecycle callbacks when the active client fails or ends", async () => {
    const clients = [createClient(), createClient()];
    let opens = 0;
    const errors: unknown[] = [];
    let ends = 0;
    await withProvider(
      createProvider(() =>
        Promise.resolve({ client: clients[opens++]!, close: () => Promise.resolve() })
      ),
      async () => {
        const connection = new OwnedRedisClientConnection({}, {
          onError: (error) => errors.push(error),
          onEnd: () => {
            ends++;
          },
        });
        await connection.getClient();
        const socketError = new Error("socket lost");
        clients[0]!.emit("error", socketError);

        assertEquals(errors.length, 1, "onError must fire once for the active client's error");
        assertStrictEquals(errors[0], socketError, "onError must receive the client's error");
        assertEquals(ends, 0, "a socket error must not be reported as a clean end");

        await connection.getClient();
        clients[1]!.emit("end");
        assertEquals(ends, 1, "onEnd must fire when the active client ends");
        assertEquals(errors.length, 1, "a clean end must not be reported as an error");
        await connection.close();
      },
    );
  });

  it("retains a handle whose close failed and reports the failure to the owner", async () => {
    const client = createClient();
    const closeFailure = new Error("close failed");
    let closeCalls = 0;
    const closeErrors: unknown[] = [];
    await withProvider(
      createProvider(() =>
        Promise.resolve({
          client,
          close() {
            closeCalls++;
            return Promise.reject(closeFailure);
          },
        })
      ),
      async () => {
        const connection = new OwnedRedisClientConnection({}, {
          onCloseError: (error) => closeErrors.push(error),
        });
        await connection.getClient();
        client.emit("error", new Error("socket lost"));
        await waitFor(() => closeErrors.length === 1, {
          interval: 1,
          message: "onCloseError must receive a failed retirement close",
        });
        assertStrictEquals(
          closeErrors[0],
          closeFailure,
          "onCloseError must receive the close rejection reason",
        );
        assertEquals(closeCalls, 1, "retirement must attempt the close once");

        await assertRejects(
          () => connection.close(),
          Error,
          "close failed",
          "a handle whose close failed must be retried and its failure surfaced",
        );
        assertEquals(closeCalls, 2, "a failed close must be retried, not dropped");
      },
    );
  });

  it("retires the active client even when the owner's callback throws", async () => {
    const clients = [createClient(), createClient()];
    let opens = 0;
    await withProvider(
      createProvider(() =>
        Promise.resolve({ client: clients[opens++]!, close: () => Promise.resolve() })
      ),
      async () => {
        const connection = new OwnedRedisClientConnection({}, {
          onError: () => {
            throw new Error("diagnostics failed");
          },
        });
        await connection.getClient();
        clients[0]!.emit("error", new Error("socket lost"));

        await connection.getClient();
        assertEquals(
          opens,
          2,
          "a throwing lifecycle callback must not block retirement of the failed client",
        );
        assertEquals(
          clients[1]!.listenerCount("error"),
          1,
          "the replacement client must be wired for lifecycle events",
        );
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
