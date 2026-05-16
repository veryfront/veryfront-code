/**
 * ext-cache-redis extension tests.
 *
 * Exercises `RedisTokenCacheStore` round-trip via the in-memory stub, plus
 * the extension factory's `setup` / `teardown` lifecycle.
 *
 * @module extensions/ext-cache-redis/test
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
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

function capturingLogger(): { logger: ExtensionLogger; info: string[] } {
  const info: string[] = [];
  return {
    info,
    logger: {
      debug: () => {},
      info: (msg: string) => {
        info.push(msg);
      },
      warn: () => {},
      error: () => {},
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
      assertEquals(stats.type, "redis");
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

      const line = info.find((m) => m.includes("TokenCacheStore registered"));
      assertExists(line);
      assertEquals(line!.includes("s3cret"), false);
      assertEquals(line!.includes("alice"), false);
      const loggedUrl = line!.match(/\(url=(.*)\)$/)?.[1];
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

      const line = info.find((m) => m.includes("TokenCacheStore registered"));
      assertExists(line);
      assertEquals(line!.includes("<redacted>"), true);

      await ext.teardown!();
    });

    it("skips registration when no url is configured", async () => {
      const ext = factory();
      const provides = new Map<string, unknown>();
      // Ensure no REDIS_URL env leaks into this test.
      const prev = Deno.env.get("REDIS_URL");
      if (prev !== undefined) Deno.env.delete("REDIS_URL");
      try {
        const ctx = buildCtx({}, provides);
        await ext.setup!(ctx);
        assertEquals(provides.has("TokenCacheStore"), false);
        await ext.teardown!();
      } finally {
        if (prev !== undefined) Deno.env.set("REDIS_URL", prev);
      }
    });
  });
});
