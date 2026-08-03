import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { type ExtensionLoader, tryResolve } from "veryfront/extensions";
import type { TokenCacheStore } from "#veryfront/extensions/cache/index.ts";
import { RedisRuntimeProviderName } from "#veryfront/extensions/distributed/index.ts";
import { createCacheFromEnv, TracingTokenCache } from "#veryfront/proxy/cache/index.ts";
import { acquireExtensionTokenCacheStoreFromEnv } from "#veryfront/proxy/cache/extension-store.ts";
import { createProxyShutdownHooks } from "#veryfront/proxy/shutdown-hooks.ts";
import {
  activateStandaloneProxyExtensions,
  registerStandaloneProxyExtensionTeardown,
} from "./proxy-extension-composition.ts";

describe("standalone proxy extension composition", () => {
  const originalCacheType = Deno.env.get("CACHE_TYPE");
  const originalRedisUrl = Deno.env.get("REDIS_URL");
  let loader: ExtensionLoader | null = null;

  afterEach(async () => {
    await loader?.teardownAll();
    loader = null;
    if (originalCacheType === undefined) Deno.env.delete("CACHE_TYPE");
    else Deno.env.set("CACHE_TYPE", originalCacheType);
    if (originalRedisUrl === undefined) Deno.env.delete("REDIS_URL");
    else Deno.env.set("REDIS_URL", originalRedisUrl);
  });

  it("does not import or activate a cache provider for the memory backend", async () => {
    Deno.env.set("CACHE_TYPE", "memory");
    Deno.env.delete("REDIS_URL");

    loader = await activateStandaloneProxyExtensions();

    assertEquals(loader, null);
  });

  for (const cacheType of ["extension", "redis"] as const) {
    it(`activates ext-cache-redis before ${cacheType} cache acquisition`, async () => {
      Deno.env.set("CACHE_TYPE", cacheType);
      Deno.env.set("REDIS_URL", "redis://127.0.0.1:6379");

      loader = await activateStandaloneProxyExtensions();
      const shutdownHooks = createProxyShutdownHooks();
      await registerStandaloneProxyExtensionTeardown(loader, shutdownHooks.register);
      const acquisition = await acquireExtensionTokenCacheStoreFromEnv();

      assertEquals(Deno.env.get("CACHE_TYPE"), "extension");
      assertEquals(loader !== null, true);
      assertEquals(tryResolve(RedisRuntimeProviderName) !== undefined, true);
      assertEquals(acquisition.kind, "borrowed");
      assertStrictEquals(
        acquisition.store,
        tryResolve<TokenCacheStore>("TokenCacheStore"),
      );

      const cache = await createCacheFromEnv({ extensionStore: acquisition });
      assertEquals(cache instanceof TracingTokenCache, true);
      await cache.close();
      assertStrictEquals(
        tryResolve<TokenCacheStore>("TokenCacheStore"),
        acquisition.store,
      );

      assertEquals(await shutdownHooks.settle(), []);
      assertEquals(tryResolve<TokenCacheStore>("TokenCacheStore"), undefined);
      assertEquals(tryResolve(RedisRuntimeProviderName), undefined);
      loader = null;
    });
  }

  it("activates the Redis runtime for routing invalidation in memory-cache mode", async () => {
    Deno.env.set("CACHE_TYPE", "memory");
    Deno.env.set("REDIS_URL", "redis://127.0.0.1:6379");

    loader = await activateStandaloneProxyExtensions();

    assertEquals(loader !== null, true);
    assertEquals(tryResolve<TokenCacheStore>("TokenCacheStore"), undefined);
    assertEquals(tryResolve(RedisRuntimeProviderName) !== undefined, true);

    await loader?.teardownAll();
    loader = null;
    assertEquals(tryResolve(RedisRuntimeProviderName), undefined);
  });

  it("tears down the provider when shutdown registration fails", async () => {
    Deno.env.set("CACHE_TYPE", "extension");
    Deno.env.set("REDIS_URL", "redis://127.0.0.1:6379");
    loader = await activateStandaloneProxyExtensions();

    await assertRejects(
      () =>
        registerStandaloneProxyExtensionTeardown(loader, () => {
          throw new Error("shutdown registration failed");
        }),
      Error,
      "shutdown registration failed",
    );
    assertEquals(tryResolve<TokenCacheStore>("TokenCacheStore"), undefined);
    assertEquals(tryResolve(RedisRuntimeProviderName), undefined);
    loader = null;
  });

  it("tears down the provider when shutdown-hook disposal fails", async () => {
    Deno.env.set("CACHE_TYPE", "extension");
    Deno.env.set("REDIS_URL", "redis://127.0.0.1:6379");
    loader = await activateStandaloneProxyExtensions();
    const teardown = await registerStandaloneProxyExtensionTeardown(
      loader,
      () => () => {
        throw new Error("shutdown-hook disposal failed");
      },
    );

    await assertRejects(
      teardown,
      Error,
      "shutdown-hook disposal failed",
    );
    assertEquals(tryResolve<TokenCacheStore>("TokenCacheStore"), undefined);
    assertEquals(tryResolve(RedisRuntimeProviderName), undefined);
    loader = null;
  });

  it("uses Promise intrinsics captured before extension-owned mutation", async () => {
    Deno.env.set("CACHE_TYPE", "extension");
    Deno.env.set("REDIS_URL", "redis://127.0.0.1:6379");
    loader = await activateStandaloneProxyExtensions();
    const resolveDescriptor = Object.getOwnPropertyDescriptor(Promise, "resolve")!;
    let registration: Promise<() => Promise<void>> | undefined;

    try {
      Object.defineProperty(Promise, "resolve", {
        ...resolveDescriptor,
        value: () => {
          throw new Error("poisoned Promise.resolve");
        },
      });
      registration = registerStandaloneProxyExtensionTeardown(
        loader,
        () => () => undefined,
      );
    } finally {
      Object.defineProperty(Promise, "resolve", resolveDescriptor);
    }

    const teardown = await registration;
    let cleanup: Promise<void> | undefined;
    try {
      Object.defineProperty(Promise, "resolve", {
        ...resolveDescriptor,
        value: () => {
          throw new Error("poisoned Promise.resolve");
        },
      });
      cleanup = teardown();
    } finally {
      Object.defineProperty(Promise, "resolve", resolveDescriptor);
    }
    await cleanup;
    assertEquals(tryResolve<TokenCacheStore>("TokenCacheStore"), undefined);
    assertEquals(tryResolve(RedisRuntimeProviderName), undefined);
    loader = null;
  });
});
