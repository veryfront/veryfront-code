import "#veryfront/schemas/_test-setup.ts";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import type { RedisClient, RedisRuntimeProvider } from "#veryfront/extensions/distributed";
import { RedisRuntimeProviderName } from "#veryfront/extensions/distributed";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RedisCacheStore } from "./redis-store.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import type { CachePayload } from "../types.ts";

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

function createPayload(html: string): CachePayload {
  return {
    result: { html, frontmatter: {}, stream: null },
    storedAt: 1_000,
  };
}

describe("RedisCacheStore", () => {
  describe("constructor", () => {
    it("should create store with default options", () => {
      assertEquals(createStore() instanceof RedisCacheStore, true);
    });

    it("namespaces Redis keys with the custom key prefix", async () => {
      let setKey: string | undefined;
      let getKey: string | undefined;
      let raw: string | null = null;
      const client: RedisClient = {
        ...createRedisClient(),
        get: (key) => {
          getKey = key;
          return Promise.resolve(raw);
        },
        set: (key, value) => {
          setKey = key;
          raw = value;
          return Promise.resolve("OK");
        },
      };
      register(
        RedisRuntimeProviderName,
        createRedisProvider(client, () => Promise.resolve()),
      );
      const store = createStore({ keyPrefix: "custom:" });

      try {
        await store.set("page-1", createPayload("<p>prefixed</p>"));
        await store.get("page-1");
        assertEquals(setKey, "custom:page-1", "SET must be namespaced by keyPrefix");
        assertEquals(getKey, "custom:page-1", "GET must use the same namespaced key");
      } finally {
        await store.destroy();
        unregister(RedisRuntimeProviderName);
      }
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

    it("applies the configured TTL seconds to the Redis SET options", async () => {
      let setOptions: { EX?: number; NX?: boolean } | undefined;
      const client: RedisClient = {
        ...createRedisClient(),
        set: (_key, _value, options) => {
          setOptions = options;
          return Promise.resolve("OK");
        },
      };
      register(
        RedisRuntimeProviderName,
        createRedisProvider(client, () => Promise.resolve()),
      );
      const store = createStore({ keyPrefix: "render:", ttlSeconds: 7200 });

      try {
        await store.set("ttl-key", createPayload("<p>ttl</p>"));
        assertEquals(
          setOptions,
          { EX: 7200 },
          "configured ttlSeconds must reach the Redis SET options",
        );
      } finally {
        await store.destroy();
        unregister(RedisRuntimeProviderName);
      }
    });

    it("keeps the fallback cache disabled by default", async () => {
      const store = createStore({ keyPrefix: "render:" });

      try {
        (store as any).redisUnavailable = true;
        await store.set("fallback-default", createPayload("<p>skipped</p>"));
        assertEquals(
          await store.get("fallback-default"),
          undefined,
          "fallback must stay off by default",
        );
      } finally {
        await store.destroy();
      }
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
    it("preserves Dates and compare-deletes only the observed value", async () => {
      let raw: string | null = null;
      let setOptions: { EX?: number; NX?: boolean } | undefined;
      const client: RedisClient = {
        ...createRedisClient(),
        get: () => Promise.resolve(raw),
        set: (_key, value, options) => {
          raw = value;
          setOptions = options;
          return Promise.resolve("OK");
        },
        eval: (_script, options) => {
          if (raw === options.arguments[0]) {
            raw = null;
            return Promise.resolve(1);
          }
          return Promise.resolve(0);
        },
      };
      register(
        RedisRuntimeProviderName,
        createRedisProvider(client, () => Promise.resolve()),
      );
      const store = createStore({ keyPrefix: "render:" });
      const observed: CachePayload = {
        result: {
          html: "<p>dated</p>",
          frontmatter: {
            publishedAt: new Date("2026-07-24T08:30:00.000Z"),
          } as unknown as CachePayload["result"]["frontmatter"],
          stream: null,
        },
        storedAt: Date.now(),
      };
      const replacement: CachePayload = {
        result: { html: "<p>replacement</p>", frontmatter: {}, stream: null },
        storedAt: Date.now() + 1,
      };

      try {
        await store.set("dated-key", observed);
        assertEquals(
          setOptions,
          { EX: 3_600 },
          "default Redis SET must carry the 1 hour expiry",
        );
        const roundTripped = await store.get("dated-key");
        assertEquals(roundTripped?.result.frontmatter as unknown, {
          publishedAt: new Date("2026-07-24T08:30:00.000Z"),
        });

        await store.set("dated-key", replacement);
        assertExists(roundTripped);
        assertEquals(
          await store.deleteIfUnchanged("dated-key", roundTripped),
          false,
        );
        const current = await store.get("dated-key");
        assertEquals(current?.result.html, "<p>replacement</p>");
        assertExists(current);
        assertEquals(await store.deleteIfUnchanged("dated-key", current), true);
        assertEquals(await store.get("dated-key"), undefined);
      } finally {
        await store.destroy();
        unregister(RedisRuntimeProviderName);
      }
    });

    it("compare-deletes the exact legacy bytes returned by get", async () => {
      const legacyPayload = {
        result: {
          html: "<p>legacy</p>",
          frontmatter: { source: "legacy" },
          stream: null,
        },
        storedAt: 1_000,
      };
      let raw: string | null = JSON.stringify(legacyPayload);
      let compared: string | undefined;
      const client: RedisClient = {
        ...createRedisClient(),
        get: () => Promise.resolve(raw),
        eval: (_script, options) => {
          compared = options.arguments[0];
          if (raw === compared) {
            raw = null;
            return Promise.resolve(1);
          }
          return Promise.resolve(0);
        },
      };
      register(
        RedisRuntimeProviderName,
        createRedisProvider(client, () => Promise.resolve()),
      );
      const store = createStore({ keyPrefix: "render:" });

      try {
        const observed = await store.get("legacy-key");
        assertExists(observed);
        assertEquals(observed.result.html, "<p>legacy</p>");

        raw = JSON.stringify({
          ...legacyPayload,
          result: { ...legacyPayload.result, html: "<p>replacement</p>" },
        });
        assertEquals(await store.deleteIfUnchanged("legacy-key", observed), false);
        assertEquals(compared, JSON.stringify(legacyPayload));

        raw = JSON.stringify(legacyPayload);
        assertEquals(await store.deleteIfUnchanged("legacy-key", observed), true);
        assertEquals(compared, JSON.stringify(legacyPayload));
        assertEquals(raw, null);
      } finally {
        await store.destroy();
        unregister(RedisRuntimeProviderName);
      }
    });

    it("uses canonical bytes for independently constructed expectations", async () => {
      const expected: CachePayload = {
        result: { html: "<p>canonical</p>", frontmatter: {}, stream: null },
        storedAt: 1_000,
      };
      let raw: string | null = null;
      const client: RedisClient = {
        ...createRedisClient(),
        set: (_key, value) => {
          raw = value;
          return Promise.resolve("OK");
        },
        eval: (_script, options) => {
          if (raw === options.arguments[0]) {
            raw = null;
            return Promise.resolve(1);
          }
          return Promise.resolve(0);
        },
      };
      register(
        RedisRuntimeProviderName,
        createRedisProvider(client, () => Promise.resolve()),
      );
      const store = createStore({ keyPrefix: "render:" });

      try {
        await store.set("canonical-key", expected);
        assertEquals(await store.deleteIfUnchanged("canonical-key", expected), true);
        assertEquals(raw, null);
      } finally {
        await store.destroy();
        unregister(RedisRuntimeProviderName);
      }
    });

    it("recognizes only exact successful Redis integer replies", async () => {
      const expected: CachePayload = {
        result: { html: "<p>expected</p>", frontmatter: {}, stream: null },
        storedAt: 1_000,
      };
      const cases: Array<[unknown, boolean]> = [
        [1, true],
        ["1", true],
        [1n, true],
        [0, false],
        ["0", false],
        [true, false],
      ];

      for (const [reply, expectedResult] of cases) {
        const client: RedisClient = {
          ...createRedisClient(),
          eval: () => Promise.resolve(reply),
        };
        register(
          RedisRuntimeProviderName,
          createRedisProvider(client, () => Promise.resolve()),
        );
        const store = createStore({ keyPrefix: "render:" });

        try {
          assertEquals(
            await store.deleteIfUnchanged("reply-key", expected),
            expectedResult,
          );
        } finally {
          await store.destroy();
          unregister(RedisRuntimeProviderName);
        }
      }
    });

    it("uses object-shaped SCAN results and closes its owned connection", async () => {
      const scanResults = [
        { cursor: 3, keys: ["render:a"] },
        { cursor: 0, keys: ["render:b"] },
      ];
      const deleted: string[] = [];
      const scanPatterns: Array<string | undefined> = [];
      let closeCalls = 0;
      const client = createRedisClient(
        (_cursor, options) => {
          scanPatterns.push(options?.MATCH);
          return Promise.resolve(scanResults.shift()!);
        },
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
        assertEquals(
          scanPatterns,
          ["render:*", "render:*"],
          "deleteByPrefix must scope SCAN to the store key prefix",
        );

        scanPatterns.length = 0;
        scanResults.push({ cursor: 0, keys: [] });
        await store.deleteByPrefix("page:");
        assertEquals(
          scanPatterns,
          ["render:page:*"],
          "deleteByPrefix must scope SCAN to the requested prefix",
        );

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
