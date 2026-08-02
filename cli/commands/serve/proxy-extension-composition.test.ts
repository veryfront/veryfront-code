import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { type ExtensionLoader, tryResolve } from "veryfront/extensions";
import type { TokenCacheStore } from "#veryfront/extensions/cache/index.ts";
import { createCacheFromEnv, TracingTokenCache } from "#veryfront/proxy/cache/index.ts";
import { acquireExtensionTokenCacheStoreFromEnv } from "#veryfront/proxy/cache/extension-store.ts";
import { activateStandaloneProxyCacheExtension } from "./proxy-extension-composition.ts";

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

    loader = await activateStandaloneProxyCacheExtension();

    assertEquals(loader, null);
  });

  it("activates ext-cache-redis before standalone cache acquisition", async () => {
    Deno.env.set("CACHE_TYPE", "extension");
    Deno.env.set("REDIS_URL", "redis://127.0.0.1:6379");

    loader = await activateStandaloneProxyCacheExtension();
    const acquisition = await acquireExtensionTokenCacheStoreFromEnv();

    assertEquals(loader !== null, true);
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
  });
});
