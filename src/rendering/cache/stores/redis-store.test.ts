import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RedisCacheStore } from "./redis-store.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";

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
