/**
 * ext-cache-redis extension tests.
 *
 * Exercises `RedisTokenCacheStore` round-trip via the in-memory stub, plus
 * the extension factory's `setup` / `teardown` lifecycle.
 *
 * @module extensions/ext-cache-redis/test
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ExtensionContext, ExtensionLogger } from "veryfront/extensions";
import type { TokenCacheEntry, TokenCacheStore } from "veryfront/extensions/cache";
import factory, { RedisTokenCacheStore } from "./index.ts";
import { createStubClientFactory } from "./test-utils.ts";

function makeEntry(token: string, ttlMs = 60_000): TokenCacheEntry {
  return {
    token,
    expiresAt: Date.now() + ttlMs,
    scope: "preview",
    projectSlug: "acme",
  };
}

function silentLogger(): ExtensionLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

interface CapturedLog {
  message: string;
  args: unknown[];
}

function capturingLogger(): {
  logger: ExtensionLogger;
  debug: CapturedLog[];
  info: CapturedLog[];
  warn: CapturedLog[];
  error: CapturedLog[];
} {
  const debug: CapturedLog[] = [];
  const info: CapturedLog[] = [];
  const warn: CapturedLog[] = [];
  const error: CapturedLog[] = [];
  return {
    debug,
    info,
    warn,
    error,
    logger: {
      debug: (message: string, ...args: unknown[]) => {
        debug.push({ message, args });
      },
      info: (message: string, ...args: unknown[]) => {
        info.push({ message, args });
      },
      warn: (message: string, ...args: unknown[]) => {
        warn.push({ message, args });
      },
      error: (message: string, ...args: unknown[]) => {
        error.push({ message, args });
      },
    },
  };
}

describe("ext-cache-redis extension", () => {
  describe("factory metadata", () => {
    it("declares the expected name and version", () => {
      const ext = factory();
      assertEquals(ext.name, "ext-cache-redis");
      assertEquals(typeof ext.version, "string");
      assertEquals(ext.version.length > 0, true);
    });

    it("declares a TokenCacheStore contract", () => {
      const ext = factory();
      assertEquals(ext.contracts?.provides, ["TokenCacheStore"]);
    });

    it("declares network and env capabilities", () => {
      const ext = factory();
      assertEquals(ext.capabilities, [
        { type: "net:outbound", hosts: ["*"] },
        {
          type: "env:read",
          keys: ["REDIS_URL", "REDIS_PREFIX", "REDIS_PASSWORD"],
        },
      ]);
    });

    it("matches its explicit package manifest exactly", async () => {
      const ext = factory();
      const manifest = JSON.parse(
        await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
      );
      assertEquals(manifest.veryfront.activation, "explicit");
      assertEquals(manifest.veryfront.contracts, ext.contracts);
      assertEquals(manifest.veryfront.capabilities, ext.capabilities);
    });
  });

  describe("RedisTokenCacheStore round-trip", () => {
    it("performs set → get → stats → delete → close via the stub client", async () => {
      const { factory: clientFactory } = createStubClientFactory();
      const store: TokenCacheStore = new RedisTokenCacheStore(
        { url: "redis://localhost:6379" },
        { clientFactory, logger: silentLogger() },
      );

      // set
      const entry = makeEntry("tok-abc");
      await store.set("project:acme", entry);

      // get
      const fetched = await store.get("project:acme");
      assertExists(fetched);
      assertEquals(fetched!.token, "tok-abc");
      assertEquals(fetched!.projectSlug, "acme");

      // stats — one hit recorded
      const stats = await store.stats();
      assertEquals(stats.type, "extension");
      assertEquals(stats.hits, 1);
      assertEquals(stats.misses, 0);

      // delete
      await store.delete("project:acme");
      const afterDelete = await store.get("project:acme");
      assertEquals(afterDelete, null);

      // close — should not throw even if called repeatedly
      await store.close();
      await store.close();
    });

    it("misses on expired entries and increments miss counter", async () => {
      const { factory: clientFactory } = createStubClientFactory();
      const store = new RedisTokenCacheStore(
        { url: "redis://localhost:6379" },
        { clientFactory, logger: silentLogger() },
      );

      // Expired at construction time — exercises the "get returns null" path.
      const expired: TokenCacheEntry = {
        token: "stale",
        expiresAt: Date.now() - 1_000,
        scope: "production",
      };
      await store.set("x", expired);

      // Stub preserves the entry (setEx with ttl >= 1s) but store.get()
      // re-checks expiry against the embedded timestamp.
      const result = await store.get("x");
      assertEquals(result, null);

      const stats = await store.stats();
      assertEquals(stats.misses, 1);
      await store.close();
    });

    it("clear() removes entries matching the prefix", async () => {
      const { factory: clientFactory, client } = createStubClientFactory();
      const store = new RedisTokenCacheStore(
        { url: "redis://localhost:6379", prefix: "vf:token:" },
        { clientFactory, logger: silentLogger() },
      );

      await store.set("a", makeEntry("t1"));
      await store.set("b", makeEntry("t2"));
      assertEquals(client._dump().size, 2);

      await store.clear();
      assertEquals(client._dump().size, 0);
      await store.close();
    });

    it("rejects prefixes that could widen the Redis clear pattern", async () => {
      for (
        const prefix of [
          "",
          " ",
          "vf:\u001f",
          "vf:\u007f",
          "vf:é",
          "a".repeat(257),
          "vf:*",
          "vf:?",
          "vf:[",
          "vf:]",
          "vf:\\",
        ]
      ) {
        assertThrows(
          () => new RedisTokenCacheStore({ url: "redis://localhost:6379", prefix }),
          TypeError,
          "1 to 256 visible ASCII characters without glob metacharacters",
        );
      }

      assertThrows(
        () =>
          new RedisTokenCacheStore({
            url: "redis://localhost:6379",
            prefix: 42 as unknown as string,
          }),
        TypeError,
        "1 to 256 visible ASCII characters without glob metacharacters",
      );

      const store = new RedisTokenCacheStore({
        url: "redis://localhost:6379",
        prefix: "a".repeat(256),
      });
      await store.close();
    });

    it("logs expected redis socket disconnects below error level", async () => {
      const { factory: clientFactory, client } = createStubClientFactory();
      const { logger, info, error } = capturingLogger();
      const store = new RedisTokenCacheStore(
        { url: "redis://localhost:6379" },
        { clientFactory, logger },
      );

      await store.stats();

      client._emitError(new Error("Socket closed unexpectedly"));

      assertEquals(error.length, 0);
      assertEquals(
        info.some((entry) => entry.message === "[RedisCache] Client disconnected"),
        true,
      );
      await store.close();
    });

    it("keeps unexpected redis client errors at error level", async () => {
      const { factory: clientFactory, client } = createStubClientFactory();
      const { logger, error } = capturingLogger();
      const store = new RedisTokenCacheStore(
        { url: "redis://localhost:6379" },
        { clientFactory, logger },
      );

      await store.stats();

      client._emitError(new Error("ERR invalid password"));

      assertEquals(error.length, 1);
      assertEquals(error[0]?.message, "[RedisCache] Client error");
      await store.close();
    });
  });

  describe("extension setup/teardown", () => {
    function buildCtx(
      config: Record<string, unknown>,
      provides: Map<string, unknown>,
      logger: ExtensionLogger = silentLogger(),
    ): ExtensionContext {
      return {
        get: <T>(name: string) => provides.get(name) as T | undefined,
        require: <T>(name: string) => {
          const impl = provides.get(name);
          if (impl === undefined) throw new Error(`missing ${name}`);
          return impl as T;
        },
        provide: <T>(name: string, impl: T) => {
          provides.set(name, impl);
        },
        config,
        logger,
      };
    }

    it("registers TokenCacheStore when config provides a url", async () => {
      const ext = factory();
      const provides = new Map<string, unknown>();
      const ctx = buildCtx(
        { proxy: { cache: { redis: { url: "redis://localhost:6379" } } } },
        provides,
      );

      await ext.setup!(ctx);
      const store = provides.get("TokenCacheStore");
      assertExists(store);

      // teardown should not throw even if the client never connected
      await ext.teardown!();
    });

    it("fails closed when explicit activation has no Redis configuration", async () => {
      const previousRedisUrl = Deno.env.get("REDIS_URL");
      Deno.env.delete("REDIS_URL");

      try {
        const ext = factory();
        const provides = new Map<string, unknown>();
        const { logger, info } = capturingLogger();

        await assertRejects(
          async () => await ext.setup!(buildCtx({}, provides, logger)),
          TypeError,
          "requires proxy.cache.redis.url or REDIS_URL",
        );

        assertEquals(provides.has("TokenCacheStore"), false);
        assertEquals(info, []);
      } finally {
        if (previousRedisUrl === undefined) Deno.env.delete("REDIS_URL");
        else Deno.env.set("REDIS_URL", previousRedisUrl);
      }
    });

    it("rejects an unsafe prefix before registering the cache contract", async () => {
      const ext = factory();
      const provides = new Map<string, unknown>();
      const ctx = buildCtx(
        {
          proxy: {
            cache: {
              redis: { url: "redis://localhost:6379", prefix: "vf:*" },
            },
          },
        },
        provides,
      );

      await assertRejects(
        async () => await ext.setup!(ctx),
        TypeError,
        "1 to 256 visible ASCII characters without glob metacharacters",
      );
      assertEquals(provides.has("TokenCacheStore"), false);
    });

    it("redacts credentials from the url before logging", async () => {
      const ext = factory();
      const provides = new Map<string, unknown>();
      const { logger, info } = capturingLogger();
      const ctx = buildCtx(
        {
          proxy: {
            cache: {
              redis: { url: "rediss://alice:s3cret@redis.example.com:6380" },
            },
          },
        },
        provides,
        logger,
      );

      await ext.setup!(ctx);

      const line = info.find((entry) => entry.message.includes("TokenCacheStore registered"));
      assertExists(line);
      assertEquals(line!.message.includes("s3cret"), false);
      assertEquals(line!.message.includes("alice"), false);
      const loggedUrl = line!.message.match(/\(url=(.*)\)$/)?.[1];
      assertExists(loggedUrl);
      assertEquals(new URL(loggedUrl).hostname, "redis.example.com");

      await ext.teardown!();
    });

    it("logs <redacted> when the configured url is unparseable", async () => {
      const ext = factory();
      const provides = new Map<string, unknown>();
      const { logger, info } = capturingLogger();
      const ctx = buildCtx(
        { proxy: { cache: { redis: { url: "not a url" } } } },
        provides,
        logger,
      );

      await ext.setup!(ctx);

      const line = info.find((entry) => entry.message.includes("TokenCacheStore registered"));
      assertExists(line);
      assertEquals(line!.message.includes("<redacted>"), true);

      await ext.teardown!();
    });
  });
});
