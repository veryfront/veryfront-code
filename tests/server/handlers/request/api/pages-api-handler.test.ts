import { assertEquals } from "#std/assert";
import { afterEach, beforeEach, describe, it } from "#std/testing/bdd";
import type { APIRouteHandler } from "../../../../../src/routing/api/handler.ts";
import {
  type HandlerCache,
  __injectCacheForTests,
  resetApiHandler,
  resetApiHandlerForProject,
} from "../../../../../src/server/handlers/request/api/pages-api-handler.ts";

function createMockHandler(destroyed = { value: false }): APIRouteHandler {
  return { destroy: () => { destroyed.value = true; } } as unknown as APIRouteHandler;
}

function createTestCache(): HandlerCache<Promise<APIRouteHandler>> & { size: number } {
  const map = new Map<string, Promise<APIRouteHandler>>();
  return {
    get: (k) => map.get(k),
    set: (k, v) => { map.set(k, v); },
    delete: (k) => map.delete(k),
    clear: () => map.clear(),
    entries: () => map.entries(),
    values: () => map.values(),
    get size() { return map.size; },
  };
}

describe("pages-api-handler", () => {
  let cache: ReturnType<typeof createTestCache>;

  beforeEach(() => {
    cache = createTestCache();
    __injectCacheForTests(cache);
  });

  afterEach(() => {
    __injectCacheForTests(null);
  });

  describe("resetApiHandlerForProject", () => {
    it("removes entries matching the project slug suffix", async () => {
      const d1 = { value: false };
      const d2 = { value: false };
      cache.set("/tmp/projects/abc:my-project", Promise.resolve(createMockHandler(d1)));
      cache.set("/tmp/projects/xyz:other-project", Promise.resolve(createMockHandler(d2)));

      await resetApiHandlerForProject("my-project");

      assertEquals(cache.size, 1);
      assertEquals(d1.value, true);
      assertEquals(d2.value, false);
    });

    it("removes entries where key equals the slug exactly", async () => {
      const d1 = { value: false };
      cache.set("my-project", Promise.resolve(createMockHandler(d1)));

      await resetApiHandlerForProject("my-project");

      assertEquals(cache.size, 0);
      assertEquals(d1.value, true);
    });

    it("removes multiple entries for the same slug", async () => {
      const d1 = { value: false };
      const d2 = { value: false };
      cache.set("/dir-a:my-project", Promise.resolve(createMockHandler(d1)));
      cache.set("/dir-b:my-project", Promise.resolve(createMockHandler(d2)));

      await resetApiHandlerForProject("my-project");

      assertEquals(cache.size, 0);
      assertEquals(d1.value, true);
      assertEquals(d2.value, true);
    });

    it("does nothing when no entries match", async () => {
      const d1 = { value: false };
      cache.set("/tmp:other-project", Promise.resolve(createMockHandler(d1)));

      await resetApiHandlerForProject("my-project");

      assertEquals(cache.size, 1);
      assertEquals(d1.value, false);
    });

    it("does not match partial slug suffixes", async () => {
      const d1 = { value: false };
      cache.set("/tmp:not-my-project", Promise.resolve(createMockHandler(d1)));

      await resetApiHandlerForProject("my-project");

      assertEquals(cache.size, 1);
      assertEquals(d1.value, false);
    });
  });

  describe("resetApiHandler", () => {
    it("removes a specific entry by projectDir key", async () => {
      const d1 = { value: false };
      const d2 = { value: false };
      cache.set("/dir-a", Promise.resolve(createMockHandler(d1)));
      cache.set("/dir-b", Promise.resolve(createMockHandler(d2)));

      await resetApiHandler("/dir-a");

      assertEquals(cache.size, 1);
      assertEquals(d1.value, true);
      assertEquals(d2.value, false);
    });

    it("clears all entries when no projectDir given", async () => {
      const d1 = { value: false };
      const d2 = { value: false };
      cache.set("/dir-a", Promise.resolve(createMockHandler(d1)));
      cache.set("/dir-b", Promise.resolve(createMockHandler(d2)));

      await resetApiHandler();

      assertEquals(cache.size, 0);
      assertEquals(d1.value, true);
      assertEquals(d2.value, true);
    });
  });
});
