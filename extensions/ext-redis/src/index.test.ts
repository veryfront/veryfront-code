/**
 * ext-redis extension tests.
 *
 * Exercises `RedisTokenCacheStore` round-trip via the in-memory stub, plus
 * the extension factory's `setup` / `teardown` lifecycle.
 *
 * @module extensions/ext-redis/test
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  ExtensionContext,
  ExtensionLogger,
  TokenCacheEntry,
  TokenCacheStore,
} from "veryfront/extensions";
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

describe("ext-redis extension", () => {
  describe("factory metadata", () => {
    it("declares the expected name and version", () => {
      const ext = factory();
      assertEquals(ext.name, "ext-redis");
      assertEquals(typeof ext.version, "string");
      assertEquals(ext.version.length > 0, true);
    });

    it("declares a TokenCacheStore contract capability", () => {
      const ext = factory();
      const hasContract = ext.capabilities.some(
        (c) => c.type === "contract" && c.name === "TokenCacheStore",
      );
      assertEquals(hasContract, true);
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
        logger: silentLogger(),
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
