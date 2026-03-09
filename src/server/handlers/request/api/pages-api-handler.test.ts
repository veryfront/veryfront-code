import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it, afterEach } from "#veryfront/testing/bdd.ts";
import {
  resetApiHandler,
  resetApiHandlerForProject,
  __injectCacheForTests,
  type HandlerCache,
} from "./pages-api-handler.ts";

type MockHandler = { destroyed: boolean; destroy(): void };

function createMockCache(): HandlerCache<Promise<MockHandler>> & { store: Map<string, Promise<MockHandler>> } {
  const store = new Map<string, Promise<MockHandler>>();
  return {
    store,
    get(key: string) {
      return store.get(key);
    },
    set(key: string, value: Promise<MockHandler>) {
      store.set(key, value);
    },
    delete(key: string) {
      return store.delete(key);
    },
    clear() {
      store.clear();
    },
    entries() {
      return store.entries();
    },
    values() {
      return store.values();
    },
  };
}

function createMockHandler(): MockHandler {
  return {
    destroyed: false,
    destroy() {
      this.destroyed = true;
    },
  };
}

afterEach(() => {
  __injectCacheForTests(null);
});

describe("server/handlers/request/api/pages-api-handler", () => {
  describe("resetApiHandler", () => {
    it("should clear a specific project entry by key", async () => {
      const cache = createMockCache();
      const handler = createMockHandler();
      cache.set("/project-dir", Promise.resolve(handler));
      __injectCacheForTests(cache as any);

      await resetApiHandler("/project-dir");
      assertEquals(cache.store.size, 0);
      assertEquals(handler.destroyed, true);
    });

    it("should clear all entries when no projectDir specified", async () => {
      const cache = createMockCache();
      const h1 = createMockHandler();
      const h2 = createMockHandler();
      cache.set("/dir1", Promise.resolve(h1));
      cache.set("/dir2", Promise.resolve(h2));
      __injectCacheForTests(cache as any);

      await resetApiHandler();
      assertEquals(cache.store.size, 0);
      assertEquals(h1.destroyed, true);
      assertEquals(h2.destroyed, true);
    });

    it("should handle missing entry gracefully", async () => {
      const cache = createMockCache();
      __injectCacheForTests(cache as any);

      // Should not throw
      await resetApiHandler("/nonexistent");
      assertEquals(cache.store.size, 0);
    });
  });

  describe("resetApiHandlerForProject", () => {
    it("should clear entries matching project slug suffix", async () => {
      const cache = createMockCache();
      const h1 = createMockHandler();
      const h2 = createMockHandler();
      const h3 = createMockHandler();
      cache.set("/dir:my-project", Promise.resolve(h1));
      cache.set("/other:my-project", Promise.resolve(h2));
      cache.set("/dir:other-project", Promise.resolve(h3));
      __injectCacheForTests(cache as any);

      await resetApiHandlerForProject("my-project");
      assertEquals(cache.store.size, 1);
      assertEquals(cache.store.has("/dir:other-project"), true);
      assertEquals(h1.destroyed, true);
      assertEquals(h2.destroyed, true);
      assertEquals(h3.destroyed, false);
    });

    it("should match exact slug key", async () => {
      const cache = createMockCache();
      const handler = createMockHandler();
      cache.set("my-project", Promise.resolve(handler));
      __injectCacheForTests(cache as any);

      await resetApiHandlerForProject("my-project");
      assertEquals(cache.store.size, 0);
      assertEquals(handler.destroyed, true);
    });

    it("should handle no matching entries gracefully", async () => {
      const cache = createMockCache();
      cache.set("/dir:other", Promise.resolve(createMockHandler()));
      __injectCacheForTests(cache as any);

      await resetApiHandlerForProject("nonexistent");
      assertEquals(cache.store.size, 1);
    });
  });
});
