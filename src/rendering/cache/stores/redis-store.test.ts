import "#veryfront/schemas/_test-setup.ts";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import type { RedisClient, RedisRuntimeProvider } from "#veryfront/extensions/distributed";
import { RedisRuntimeProviderName } from "#veryfront/extensions/distributed";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RedisCacheStore } from "./redis-store.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";

async function withStoreTtlEnabled(fn: () => Promise<void>): Promise<void> {
  const previousGlobal = (globalThis as Record<string, unknown>).__vfDisableLruInterval;
  const previousEnv = Deno.env.get("VF_DISABLE_LRU_INTERVAL");

  (globalThis as Record<string, unknown>).__vfDisableLruInterval = false;
  Deno.env.delete("VF_DISABLE_LRU_INTERVAL");

  try {
    await fn();
  } finally {
    if (previousGlobal === undefined) {
      delete (globalThis as Record<string, unknown>).__vfDisableLruInterval;
    } else {
      (globalThis as Record<string, unknown>).__vfDisableLruInterval = previousGlobal;
    }

    if (previousEnv === undefined) {
      Deno.env.delete("VF_DISABLE_LRU_INTERVAL");
    } else {
      Deno.env.set("VF_DISABLE_LRU_INTERVAL", previousEnv);
    }
  }
}

function createStore(options?: ConstructorParameters<typeof RedisCacheStore>[0]): RedisCacheStore {
  return new RedisCacheStore(options);
}

function createRedisProvider(
  client: RedisClient,
  close: () => Promise<void>,
): RedisRuntimeProvider {
  return {
    id: "render-cache-test",
    loadModule: () => Promise.resolve({ createClient: () => ({}) } as never),
    getClient: () => Promise.resolve(client),
    disconnectClient: () => Promise.resolve(),
    openClient: () => Promise.resolve({ client, close }),
    createEventPublisher: () =>
      Promise.resolve({
        publish: () => Promise.resolve(),
        subscribe: () => Promise.resolve(() => undefined),
        close: () => Promise.resolve(),
      }),
    close: () => Promise.resolve(),
  };
}

function createRedisClient(
  scan: RedisClient["scan"] = () => Promise.resolve({ cursor: 0, keys: [] }),
  del: RedisClient["del"] = () => Promise.resolve(0),
): RedisClient {
  return {
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    get: () => Promise.resolve(null),
    mGet: (keys) => Promise.resolve(keys.map(() => null)),
    set: () => Promise.resolve("OK"),
    del,
    scan,
    expire: () => Promise.resolve(1),
    eval: () => Promise.resolve([1, 1_000]),
    incr: () => Promise.resolve(1),
    pExpire: () => Promise.resolve(true),
    pTTL: () => Promise.resolve(1_000),
    on: () => undefined,
  };
}

describe("RedisCacheStore", () => {
  describe("constructor", () => {
    it("should create store with default options", () => {
      assertEquals(createStore() instanceof RedisCacheStore, true);
    });

    it("should create store with custom key prefix", () => {
      assertEquals(createStore({ keyPrefix: "custom:" }) instanceof RedisCacheStore, true);
    });

    it("should create store with fallback disabled", () => {
      assertEquals(createStore({ enableFallback: false }) instanceof RedisCacheStore, true);
    });

    it("should create store with custom URL", () => {
      assertEquals(createStore({ url: "redis://localhost:6379" }) instanceof RedisCacheStore, true);
    });

    it("should create store with all options", () => {
      assertEquals(
        createStore({
          url: "redis://localhost:6379",
          keyPrefix: "test:",
          enableFallback: true,
        }) instanceof RedisCacheStore,
        true,
      );
    });

    it("should accept custom TTL seconds", () => {
      assertEquals(createStore({ ttlSeconds: 7200 }) instanceof RedisCacheStore, true);
    });

    it("should accept combined options", () => {
      assertEquals(
        createStore({
          url: "redis://localhost:6379",
          keyPrefix: "custom:",
          enableFallback: true,
          ttlSeconds: 1800,
        }) instanceof RedisCacheStore,
        true,
      );
    });
  });

  describe("destroy", () => {
    it("should be safe to call destroy when not connected", async () => {
      await createStore().destroy();
    });

    it("should be safe to call destroy multiple times", async () => {
      const store = createStore();
      await store.destroy();
      await store.destroy();
    });
  });

  describe("extension-owned Redis connection", () => {
    it("uses object-shaped SCAN results and closes its owned connection", async () => {
      const scanResults = [
        { cursor: 3, keys: ["render:a"] },
        { cursor: 0, keys: ["render:b"] },
      ];
      const deleted: string[] = [];
      let closeCalls = 0;
      const client = createRedisClient(
        () => Promise.resolve(scanResults.shift()!),
        (key) => {
          if (typeof key === "string") deleted.push(key);
          return Promise.resolve(1);
        },
      );
      register(
        RedisRuntimeProviderName,
        createRedisProvider(client, () => {
          closeCalls++;
          return Promise.resolve();
        }),
      );
      const store = createStore({ keyPrefix: "render:" });

      try {
        assertEquals(await store.deleteByPrefix(""), 2);
        assertEquals(deleted, ["render:a", "render:b"]);
        await store.destroy();
        assertEquals(closeCalls, 1);
      } finally {
        unregister(RedisRuntimeProviderName);
      }
    });

    it("retries a failed owned-handle close", async () => {
      let closeCalls = 0;
      register(
        RedisRuntimeProviderName,
        createRedisProvider(createRedisClient(), () => {
          closeCalls++;
          return closeCalls === 1 ? Promise.reject(new Error("close failed")) : Promise.resolve();
        }),
      );
      const store = createStore();

      try {
        await store.get("initialize");
        await assertRejects(() => store.destroy(), Error, "close failed");
        await store.destroy();
        assertEquals(closeCalls, 2);
      } finally {
        unregister(RedisRuntimeProviderName);
      }
    });
  });

  describe("fallback cache", () => {
    it("expires fallback entries without payload expiresAt using store TTL", async () => {
      await withStoreTtlEnabled(async () => {
        const store = createStore({ enableFallback: true, ttlSeconds: 1 });
        try {
          (store as any).redisUnavailable = true;

          await store.set("fallback-ttl", {
            result: {
              html: "<p>fallback</p>",
              frontmatter: {},
              headings: [],
              stream: null,
            },
            storedAt: Date.now(),
          } as any);

          await new Promise((resolve) => setTimeout(resolve, 1_100));

          const result = await store.get("fallback-ttl");
          assertEquals(result, undefined);
        } finally {
          await store.destroy();
        }
      });
    });
  });
});
