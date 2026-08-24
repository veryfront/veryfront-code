import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import type { RedisClient, RedisRuntimeProvider } from "#veryfront/extensions/distributed";
import { RedisRuntimeProviderName } from "#veryfront/extensions/distributed";
import { disconnectRedisClient, getRedisClient } from "./redis-client.ts";

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

function createProvider(
  id: string,
  operations: {
    getClient?: () => Promise<RedisClient>;
    disconnectClient?: () => Promise<void>;
  } = {},
): RedisRuntimeProvider {
  return {
    id,
    loadModule: () => Promise.resolve({ createClient: () => ({}) } as never),
    getClient: operations.getClient ?? (() => Promise.resolve(createClient())),
    disconnectClient: operations.disconnectClient ?? (() => Promise.resolve()),
    openClient: () => Promise.resolve({ client: createClient(), close: () => Promise.resolve() }),
    createEventPublisher: () =>
      Promise.resolve({
        publish: () => Promise.resolve(),
        subscribe: () => Promise.resolve(() => undefined),
        close: () => Promise.resolve(),
      }),
    close: () => Promise.resolve(),
  };
}

describe("shared Redis client facade", () => {
  it("disconnects every provider that created a shared client", async () => {
    let firstDisconnects = 0;
    let secondDisconnects = 0;
    const first = createProvider("first", {
      disconnectClient: () => {
        firstDisconnects++;
        return Promise.resolve();
      },
    });
    const second = createProvider("second", {
      disconnectClient: () => {
        secondDisconnects++;
        return Promise.resolve();
      },
    });

    register(RedisRuntimeProviderName, first);
    try {
      await getRedisClient();
      register(RedisRuntimeProviderName, second);
      await getRedisClient();
      await disconnectRedisClient();

      assertEquals(firstDisconnects, 1);
      assertEquals(secondDisconnects, 1);
    } finally {
      unregister(RedisRuntimeProviderName);
      await disconnectRedisClient();
    }
  });

  it("waits for provider ownership before disconnecting an in-flight acquisition", async () => {
    let rejectAcquisition: ((error: Error) => void) | undefined;
    const acquisition = new Promise<RedisClient>((_resolve, reject) => {
      rejectAcquisition = reject;
    });
    let disconnects = 0;
    const provider = createProvider("pending", {
      getClient: () => acquisition,
      disconnectClient: () => {
        disconnects++;
        rejectAcquisition?.(new Error("acquisition cancelled"));
        return Promise.resolve();
      },
    });

    register(RedisRuntimeProviderName, provider);
    try {
      const pending = getRedisClient();
      await disconnectRedisClient();
      await assertRejects(() => pending, Error, "acquisition cancelled");
      assertEquals(disconnects, 1);
    } finally {
      unregister(RedisRuntimeProviderName);
      await disconnectRedisClient();
    }
  });

  it("defers an acquisition issued while a disconnect is in flight", async () => {
    const order: string[] = [];
    let disconnects = 0;
    let releaseDisconnect: (() => void) | undefined;
    const provider = createProvider("teardown-race", {
      getClient: () => {
        order.push("getClient");
        return Promise.resolve(createClient());
      },
      disconnectClient: () => {
        disconnects++;
        // Only the first teardown is gated; later cleanup calls resolve at once.
        if (disconnects > 1) return Promise.resolve();
        order.push("disconnectClient");
        return new Promise<void>((resolve) => {
          releaseDisconnect = () => {
            releaseDisconnect = undefined;
            order.push("disconnected");
            resolve();
          };
        });
      },
    });

    register(RedisRuntimeProviderName, provider);
    try {
      const teardown = disconnectRedisClient();
      const reacquired = getRedisClient();

      await waitFor(() => releaseDisconnect !== undefined, {
        message: "disconnectClient was never called",
      });
      assertEquals(
        order,
        ["disconnectClient"],
        "no acquisition may reach the provider while teardown is in flight",
      );

      releaseDisconnect?.();
      await teardown;
      await reacquired;

      assertEquals(
        order,
        ["disconnectClient", "disconnected", "getClient"],
        "an acquisition issued during teardown must wait for the disconnect to finish",
      );
    } finally {
      // Ungate the teardown even when an assertion failed, so cleanup can run.
      releaseDisconnect?.();
      unregister(RedisRuntimeProviderName);
      await disconnectRedisClient();
    }
  });

  it("aggregates failures from every owner that could not disconnect", async () => {
    let firstDisconnects = 0;
    let secondDisconnects = 0;
    const first = createProvider("aggregate-first", {
      disconnectClient: () => {
        firstDisconnects++;
        return firstDisconnects === 1
          ? Promise.reject(new Error("first disconnect failed"))
          : Promise.resolve();
      },
    });
    const second = createProvider("aggregate-second", {
      disconnectClient: () => {
        secondDisconnects++;
        return secondDisconnects === 1
          ? Promise.reject(new Error("second disconnect failed"))
          : Promise.resolve();
      },
    });

    register(RedisRuntimeProviderName, first);
    try {
      await getRedisClient();
      register(RedisRuntimeProviderName, second);
      await getRedisClient();

      const error = await assertRejects(
        () => disconnectRedisClient(),
        AggregateError,
        "Redis shared client disconnect failed",
      );
      assertEquals(
        (error as AggregateError).errors.length,
        2,
        "every failed owner is reported",
      );

      await disconnectRedisClient();
      assertEquals(
        firstDisconnects,
        2,
        "failed owners are retained and retried",
      );
      assertEquals(
        secondDisconnects,
        2,
        "failed owners are retained and retried",
      );
    } finally {
      unregister(RedisRuntimeProviderName);
      await disconnectRedisClient();
    }
  });

  it("retains failed owners so disconnect can be retried", async () => {
    let disconnects = 0;
    const provider = createProvider("retry", {
      disconnectClient: () => {
        disconnects++;
        return disconnects === 1
          ? Promise.reject(new Error("disconnect failed"))
          : Promise.resolve();
      },
    });

    register(RedisRuntimeProviderName, provider);
    try {
      await getRedisClient();
      await assertRejects(
        () => disconnectRedisClient(),
        Error,
        "disconnect failed",
      );
      await disconnectRedisClient();
      assertEquals(disconnects, 2);
    } finally {
      unregister(RedisRuntimeProviderName);
      await disconnectRedisClient();
    }
  });
});
