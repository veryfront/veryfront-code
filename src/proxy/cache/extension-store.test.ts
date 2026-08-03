import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type {
  TokenCacheEntry,
  TokenCacheStats,
  TokenCacheStore,
} from "../../extensions/cache/index.ts";
import {
  acquireExtensionTokenCacheStoreFromEnv,
  ensureExtensionTokenCacheStoreFromEnv,
} from "./extension-store.ts";

class FakeTokenCacheStore implements TokenCacheStore {
  get(_key: string): Promise<TokenCacheEntry | null> {
    return Promise.resolve(null);
  }

  set(_key: string, _entry: TokenCacheEntry): Promise<void> {
    return Promise.resolve();
  }

  delete(_key: string): Promise<void> {
    return Promise.resolve();
  }

  clear(): Promise<void> {
    return Promise.resolve();
  }

  has(_key: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  stats(): Promise<TokenCacheStats> {
    return Promise.resolve({ hits: 0, misses: 0, size: 0, type: "extension" });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

function environment(
  values: Readonly<Record<string, string | undefined>>,
): (name: string) => string | undefined {
  return (name) => values[name];
}

describe("distributed token-cache acquisition", () => {
  it("does not resolve an extension unless Extension is explicitly selected", async () => {
    let resolutions = 0;
    const acquisition = await acquireExtensionTokenCacheStoreFromEnv({
      readEnv: environment({
        CACHE_TYPE: "memory",
        REDIS_URL: "redis://must-not-activate.example",
      }),
      resolveStore: () => {
        resolutions++;
        return new FakeTokenCacheStore();
      },
    });

    assertEquals(acquisition, { kind: "disabled", store: null });
    assertEquals(resolutions, 0);
  });

  it("does not infer Extension selection from REDIS_URL", async () => {
    let resolutions = 0;
    const store = await ensureExtensionTokenCacheStoreFromEnv({
      readEnv: environment({ REDIS_URL: "redis://must-not-activate.example" }),
      resolveStore: () => {
        resolutions++;
        return new FakeTokenCacheStore();
      },
    });

    assertEquals(store, null);
    assertEquals(resolutions, 0);
  });

  it("borrows an already-registered store without constructing or owning it", async () => {
    const store = new FakeTokenCacheStore();
    const acquisition = await acquireExtensionTokenCacheStoreFromEnv({
      readEnv: environment({ CACHE_TYPE: "extension" }),
      resolveStore: () => store,
    });

    assertEquals(acquisition.kind, "borrowed");
    assertStrictEquals(acquisition.store, store);
    assertStrictEquals(
      await ensureExtensionTokenCacheStoreFromEnv({
        readEnv: environment({ CACHE_TYPE: "extension" }),
        resolveStore: () => store,
      }),
      store,
    );
  });

  it("fails closed when Extension is selected without an activated extension", async () => {
    await assertRejects(
      () =>
        acquireExtensionTokenCacheStoreFromEnv({
          readEnv: environment({ CACHE_TYPE: "extension" }),
          resolveStore: () => undefined,
        }),
      Error,
      "explicitly activated extension",
    );
  });

  it("rejects invalid cache selection and environment values", async () => {
    await assertRejects(
      () =>
        acquireExtensionTokenCacheStoreFromEnv({
          readEnv: environment({ CACHE_TYPE: "automatic" }),
        }),
      TypeError,
      "CACHE_TYPE must be memory or extension",
    );
    await assertRejects(
      () =>
        acquireExtensionTokenCacheStoreFromEnv({
          readEnv: (() => 42) as unknown as (name: string) => string | undefined,
        }),
      TypeError,
      "must be a string",
    );
  });

  it("rejects dependency accessors and unexpected bootstrap properties", () => {
    const accessor = Object.defineProperty({}, "readEnv", {
      enumerable: true,
      get: () => environment({ CACHE_TYPE: "memory" }),
    });
    assertThrows(
      () => acquireExtensionTokenCacheStoreFromEnv(accessor),
      TypeError,
      "data property",
    );
    assertThrows(
      () =>
        acquireExtensionTokenCacheStoreFromEnv({
          readEnv: environment({ CACHE_TYPE: "memory" }),
          importModule: () => Promise.resolve({}),
        } as never),
      TypeError,
      "unknown option",
    );
  });

  it("rejects malformed registered stores at the core boundary", async () => {
    await assertRejects(
      () =>
        acquireExtensionTokenCacheStoreFromEnv({
          readEnv: environment({ CACHE_TYPE: "extension" }),
          resolveStore: () => ({}) as TokenCacheStore,
        }),
      TypeError,
      "get",
    );
  });
});
