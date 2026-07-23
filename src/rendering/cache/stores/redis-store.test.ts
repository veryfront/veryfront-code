import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RedisCacheStore } from "./redis-store.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { getOwnedRedisCacheNamespaceDescriptors } from "#veryfront/cache/backends/redis-keyspace.ts";
import { MAX_CACHE_TTL_SECONDS } from "#veryfront/cache/backends/ttl.ts";
import type { RedisClient, RedisClientManager } from "#veryfront/utils/redis-client.ts";

function createRedisClient(
  overrides: Partial<RedisClient> = {},
): RedisClient {
  return {
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    get: () => Promise.resolve(null),
    mGet: (keys) => Promise.resolve(keys.map(() => null)),
    set: () => Promise.resolve("OK"),
    del: () => Promise.resolve(0),
    scan: () => Promise.resolve({ cursor: 0, keys: [] }),
    expire: () => Promise.resolve(1),
    isOpen: true,
    ...overrides,
  };
}

function createClientManager(
  client: RedisClient,
  onDisconnect?: () => void,
): RedisClientManager {
  return {
    getClient: () => Promise.resolve(client),
    disconnect: () => {
      onDisconnect?.();
      return Promise.resolve();
    },
    isConfigured: () => true,
  };
}

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

describe("RedisCacheStore", () => {
  describe("constructor", () => {
    it("should create store with default options", () => {
      assertEquals(createStore() instanceof RedisCacheStore, true);
    });

    it("should create store with custom key prefix", () => {
      assertEquals(createStore({ keyPrefix: "custom:" }) instanceof RedisCacheStore, true);
    });

    it("normalizes a legacy custom prefix to a delimited namespace", () => {
      const prefix = "legacy-custom-prefix";
      assertEquals(createStore({ keyPrefix: prefix }) instanceof RedisCacheStore, true);

      const descriptor = getOwnedRedisCacheNamespaceDescriptors()
        .find((candidate) => candidate.prefix === `${prefix}:`);
      assertEquals(
        descriptor?.matchProjectOwnership?.("project-x:preview-main:digest"),
        { projectId: "project-x", environment: "preview" },
      );
    });

    it("does not upgrade an existing opaque cache namespace to render ownership", () => {
      const prefix = "vf:transform:";
      const candidateKey = "project-x:preview-main:digest";
      const ownershipBefore = getOwnedRedisCacheNamespaceDescriptors()
        .find((descriptor) => descriptor.prefix === prefix)
        ?.matchProjectOwnership?.(candidateKey) ?? null;

      assertEquals(ownershipBefore, null);
      assertThrows(
        () => createStore({ keyPrefix: prefix }),
        TypeError,
        "collides with an existing cache namespace",
      );

      const ownershipAfter = getOwnedRedisCacheNamespaceDescriptors()
        .find((descriptor) => descriptor.prefix === prefix)
        ?.matchProjectOwnership?.(candidateKey) ?? null;
      assertEquals(ownershipAfter, null);
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

    it("rejects TTLs that Redis EX cannot represent safely", () => {
      for (
        const ttlSeconds of [
          0,
          -1,
          0.5,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          MAX_CACHE_TTL_SECONDS + 1,
        ]
      ) {
        assertThrows(() => createStore({ ttlSeconds }), RangeError);
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

    it("rejects blank and unsafe custom prefixes", () => {
      for (
        const keyPrefix of [
          "",
          "   ",
          "unsafe\nprefix",
          "x".repeat(512),
          "vf:workflow",
          "vf:token",
        ]
      ) {
        assertThrows(() => createStore({ keyPrefix }), TypeError);
      }
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

  describe("fallback cache", () => {
    it("expires fallback entries without payload expiresAt using store TTL", async () => {
      await withStoreTtlEnabled(async () => {
        const unavailable = createRedisClient({
          get: () => Promise.reject(new Error("unavailable")),
          set: () => Promise.reject(new Error("unavailable")),
        });
        const store = createStore({
          enableFallback: true,
          ttlSeconds: 1,
          clientManager: createClientManager(unavailable),
        });
        try {
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

    it("retains fallback entries through a payload stale window longer than store TTL", async () => {
      const unavailable = createRedisClient({
        get: () => Promise.reject(new Error("unavailable")),
        set: () => Promise.reject(new Error("unavailable")),
      });
      const store = createStore({
        enableFallback: true,
        ttlSeconds: 1,
        clientManager: createClientManager(unavailable),
      });
      try {
        await store.set("stale-window", {
          result: {
            html: "<p>fallback</p>",
            frontmatter: {},
            headings: [],
            stream: null,
          },
          storedAt: Date.now(),
          expiresAt: Date.now() + 500,
          staleUntil: Date.now() + 10_000,
        });

        await new Promise((resolve) => setTimeout(resolve, 1_100));
        assertEquals((await store.get("stale-window"))?.result.html, "<p>fallback</p>");
      } finally {
        await store.destroy();
      }
    });
  });

  describe("connection recovery", () => {
    it("recovers reads after a transient Redis failure", async () => {
      let attempts = 0;
      let disconnects = 0;
      const payload = JSON.stringify({
        result: { html: "<p>recovered</p>", frontmatter: {}, stream: null },
        storedAt: 1,
      });
      const client = createRedisClient({
        get: () => {
          attempts++;
          return attempts === 1
            ? Promise.reject(new Error("read failed"))
            : Promise.resolve(payload);
        },
      });
      const store = createStore({
        clientManager: createClientManager(client, () => disconnects++),
      });

      assertEquals(await store.get("page"), undefined);
      assertEquals((await store.get("page"))?.result.html, "<p>recovered</p>");
      assertEquals(attempts, 2);
      assertEquals(disconnects, 1);
    });

    it("rejects a failed write and succeeds on retry", async () => {
      let attempts = 0;
      const client = createRedisClient({
        set: () => {
          attempts++;
          return attempts === 1 ? Promise.reject(new Error("write failed")) : Promise.resolve("OK");
        },
      });
      const store = createStore({ clientManager: createClientManager(client) });
      const payload = {
        result: { html: "<p>value</p>", frontmatter: {}, stream: null },
        storedAt: 1,
      };

      await assertRejects(() => store.set("page", payload), Error, "write failed");
      await store.set("page", payload);
      assertEquals(attempts, 2);
    });

    it("uses a Redis TTL long enough to retain the payload stale window", async () => {
      let ttlSeconds: number | undefined;
      const client = createRedisClient({
        set: (_key, _value, options) => {
          ttlSeconds = options?.EX;
          return Promise.resolve("OK");
        },
      });
      const store = createStore({
        ttlSeconds: 1,
        clientManager: createClientManager(client),
      });
      await store.set("page", {
        result: { html: "<p>value</p>", frontmatter: {}, stream: null },
        storedAt: Date.now(),
        expiresAt: Date.now() + 500,
        staleUntil: Date.now() + 10_000,
      });

      assertEquals((ttlSeconds ?? 0) >= 9, true);
    });

    it("turns an already-retention-expired write into a delete", async () => {
      let setCalls = 0;
      let deleteCalls = 0;
      const client = createRedisClient({
        set: () => {
          setCalls++;
          return Promise.resolve("OK");
        },
        del: () => {
          deleteCalls++;
          return Promise.resolve(1);
        },
      });
      const store = createStore({ clientManager: createClientManager(client) });
      const now = Date.now();

      await store.set("page", {
        result: { html: "<p>expired</p>", frontmatter: {}, stream: null },
        storedAt: now - 2,
        expiresAt: now - 1,
      });

      assertEquals(setCalls, 0);
      assertEquals(deleteCalls, 1);
    });

    it("propagates failed deletes and succeeds on retry", async () => {
      let attempts = 0;
      const client = createRedisClient({
        del: () => {
          attempts++;
          return attempts === 1 ? Promise.reject(new Error("delete failed")) : Promise.resolve(1);
        },
      });
      const store = createStore({
        enableFallback: true,
        clientManager: createClientManager(client),
      });

      await assertRejects(() => store.delete("page"), Error, "delete failed");
      await store.delete("page");
      assertEquals(attempts, 2);
    });

    it("evicts malformed Redis payloads", async () => {
      const deleted: Array<string | string[]> = [];
      const client = createRedisClient({
        get: () => Promise.resolve("{}"),
        del: (key) => {
          deleted.push(key);
          return Promise.resolve(1);
        },
      });
      const store = createStore({ clientManager: createClientManager(client) });

      assertEquals(await store.get("malformed"), undefined);
      assertEquals(deleted, ["veryfront:render:malformed"]);
    });
  });

  describe("Redis deletion scope", () => {
    it("escapes glob metacharacters in scan prefixes", async () => {
      const scanPatterns: string[] = [];
      const client = createRedisClient({
        scan: (
          _cursor: number,
          options?: { MATCH?: string; COUNT?: number },
        ) => {
          if (options?.MATCH) scanPatterns.push(options.MATCH);
          return Promise.resolve({ cursor: 0, keys: [] });
        },
      });
      const store = createStore({
        keyPrefix: "tenant*",
        clientManager: createClientManager(client),
      });

      await store.deleteByPrefix("project?[");
      await store.clear();

      assertEquals(scanPatterns, [
        "tenant\\*:project\\?\\[*",
        "tenant\\*:*",
      ]);
    });

    it("propagates prefix invalidation failures and retries Redis", async () => {
      let scanAttempts = 0;
      const client = createRedisClient({
        scan: () => {
          scanAttempts++;
          return scanAttempts === 1
            ? Promise.reject(new Error("scan failed"))
            : Promise.resolve({ cursor: 0, keys: [] });
        },
      });
      const store = createStore({
        enableFallback: true,
        clientManager: createClientManager(client),
      });

      await assertRejects(() => store.deleteByPrefix("project:"), Error, "scan failed");
      assertEquals(await store.deleteByPrefix("project:"), 0);
      assertEquals(scanAttempts, 2);
    });

    it("propagates clear failures and retries Redis", async () => {
      let scanAttempts = 0;
      const client = createRedisClient({
        scan: () => {
          scanAttempts++;
          return scanAttempts === 1
            ? Promise.reject(new Error("clear scan failed"))
            : Promise.resolve({ cursor: 0, keys: [] });
        },
      });
      const store = createStore({
        enableFallback: true,
        clientManager: createClientManager(client),
      });

      await assertRejects(() => store.clear(), Error, "clear scan failed");
      await store.clear();
      assertEquals(scanAttempts, 2);
    });

    it("finishes and deduplicates a multi-page scan before deleting", async () => {
      const events: string[] = [];
      const deletedBatches: string[][] = [];
      const pages = new Map<number, { cursor: number; keys: string[] }>([
        [0, { cursor: 11, keys: ["cache:a", "cache:b"] }],
        [11, { cursor: 22, keys: ["cache:b", "cache:c"] }],
        [22, { cursor: 0, keys: ["cache:d"] }],
      ]);
      const client = createRedisClient({
        scan: (cursor) => {
          events.push(`scan:${cursor}:deleted=${deletedBatches.length}`);
          return Promise.resolve(pages.get(cursor)!);
        },
        del: (keys) => {
          const batch = typeof keys === "string" ? [keys] : keys;
          deletedBatches.push([...batch]);
          events.push(`delete:${batch.join(",")}`);
          return Promise.resolve(batch.length);
        },
      });
      const store = createStore({
        keyPrefix: "cache:",
        clientManager: createClientManager(client),
      });

      assertEquals(await store.clear(), undefined);
      assertEquals(events.slice(0, 3), [
        "scan:0:deleted=0",
        "scan:11:deleted=0",
        "scan:22:deleted=0",
      ]);
      assertEquals(deletedBatches, [["cache:a", "cache:b", "cache:c", "cache:d"]]);
    });

    it("rejects SCAN keys outside the requested literal namespace before deleting", async () => {
      let deletes = 0;
      const client = createRedisClient({
        scan: () => Promise.resolve({ cursor: 0, keys: ["other:tenant:page"] }),
        del: () => {
          deletes++;
          return Promise.resolve(1);
        },
      });
      const store = createStore({
        keyPrefix: "cache:",
        clientManager: createClientManager(client),
      });

      await assertRejects(
        () => store.deleteByPrefix("tenant:"),
        Error,
        "outside the requested cache namespace",
      );
      assertEquals(deletes, 0);
    });
  });
});
