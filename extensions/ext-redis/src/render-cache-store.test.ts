import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RedisCacheStore } from "./render-cache-store.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { getOwnedDistributedCacheNamespaceDescriptors } from "#veryfront/cache/backends/distributed-keyspace.ts";
import { MAX_CACHE_TTL_SECONDS } from "#veryfront/cache/backends/ttl.ts";
import type { RedisClient, RedisClientManager } from "./redis-client-manager.ts";

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
    eval: () => Promise.resolve(null),
    incr: () => Promise.resolve(1),
    pExpire: () => Promise.resolve(true),
    pTTL: () => Promise.resolve(1_000),
    info: () => Promise.resolve(""),
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

function createStore(options?: ConstructorParameters<typeof RedisCacheStore>[0]): RedisCacheStore {
  return new RedisCacheStore(options);
}

describe("RedisCacheStore", () => {
  describe("constructor", () => {
    it("should create store with default options", () => {
      assertEquals(createStore() instanceof RedisCacheStore, true);
    });

    it("should create store with custom key prefix", () => {
      const prefix = "vf:cache:tenant-render:";
      assertEquals(createStore({ keyPrefix: prefix }) instanceof RedisCacheStore, true);

      const descriptor = getOwnedDistributedCacheNamespaceDescriptors()
        .find((candidate) => candidate.prefix === prefix);
      assertEquals(
        descriptor?.matchProjectOwnership?.("project-x:preview:route:digest"),
        { projectId: "project-x", environment: "preview" },
      );
    });

    it("rejects legacy non-canonical prefixes instead of silently rewriting them", () => {
      assertThrows(
        () => createStore({ keyPrefix: "legacy-custom-prefix" }),
        TypeError,
        "must end with ':'",
      );
    });

    it("does not upgrade an existing opaque cache namespace to render ownership", () => {
      const prefix = "vf:cache:transform:";
      const candidateKey = "project-x:preview-main:digest";
      const ownershipBefore = getOwnedDistributedCacheNamespaceDescriptors()
        .find((descriptor) => descriptor.prefix === prefix)
        ?.matchProjectOwnership?.(candidateKey) ?? null;

      assertEquals(ownershipBefore, null);
      assertThrows(
        () => createStore({ keyPrefix: prefix }),
        TypeError,
        "collides with an existing cache namespace",
      );

      const ownershipAfter = getOwnedDistributedCacheNamespaceDescriptors()
        .find((descriptor) => descriptor.prefix === prefix)
        ?.matchProjectOwnership?.(candidateKey) ?? null;
      assertEquals(ownershipAfter, null);
    });

    it("should create store with custom URL", () => {
      assertEquals(createStore({ url: "redis://localhost:6379" }) instanceof RedisCacheStore, true);
    });

    it("should create store with all options", () => {
      assertEquals(
        createStore({
          url: "redis://localhost:6379",
          keyPrefix: "vf:cache:test-render:",
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
          keyPrefix: "vf:cache:combined-render:",
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

      await assertRejects(() => store.get("page"), Error, "read failed");
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
      assertEquals(deleted, ["vf:cache:render:malformed"]);
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
        keyPrefix: "vf:cache:tenant*:",
        clientManager: createClientManager(client),
      });

      await store.deleteByPrefix("project?[");
      await store.clear();

      assertEquals(scanPatterns, [
        "vf:cache:tenant\\*:project\\?\\[*",
        "vf:cache:tenant\\*:*",
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
        [0, { cursor: 11, keys: ["vf:cache:scan-test:a", "vf:cache:scan-test:b"] }],
        [11, { cursor: 22, keys: ["vf:cache:scan-test:b", "vf:cache:scan-test:c"] }],
        [22, { cursor: 0, keys: ["vf:cache:scan-test:d"] }],
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
        keyPrefix: "vf:cache:scan-test:",
        clientManager: createClientManager(client),
      });

      assertEquals(await store.clear(), undefined);
      assertEquals(events.slice(0, 3), [
        "scan:0:deleted=0",
        "scan:11:deleted=0",
        "scan:22:deleted=0",
      ]);
      assertEquals(deletedBatches, [[
        "vf:cache:scan-test:a",
        "vf:cache:scan-test:b",
        "vf:cache:scan-test:c",
        "vf:cache:scan-test:d",
      ]]);
    });

    it("rejects a repeated nonzero string cursor before deleting", async () => {
      let deletes = 0;
      const client = createRedisClient({
        scan: () => Promise.resolve({ cursor: 17, keys: ["vf:cache:scan-test:a"] }),
        del: () => {
          deletes++;
          return Promise.resolve(1);
        },
      });
      const store = createStore({
        keyPrefix: "vf:cache:scan-test:",
        clientManager: createClientManager(client),
      });

      await assertRejects(() => store.clear(), Error, "repeated a cursor");
      assertEquals(deletes, 0);
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
        keyPrefix: "vf:cache:scope-test:",
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
