import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __destroyRSCHandlerForTests,
  __injectCacheForTests,
  __resetRSCHandlerForTests,
  getRSCHandler,
  type HandlerCache,
} from "./handler-registry.ts";
import type { RSCDevServerHandler } from "../orchestrators/index.ts";

function createStubCache(): HandlerCache<RSCDevServerHandler> & {
  entries: Map<string, RSCDevServerHandler>;
} {
  const entries = new Map<string, RSCDevServerHandler>();
  return {
    entries,
    get(key: string) {
      return entries.get(key);
    },
    set(key: string, value: RSCDevServerHandler) {
      entries.set(key, value);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

describe("server/services/rsc/endpoints/handler-registry", () => {
  afterEach(() => {
    __destroyRSCHandlerForTests();
  });

  describe("getRSCHandler", () => {
    it("should create a new handler for a project", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      const handler = getRSCHandler("/project/dir");
      assertEquals(cache.size, 1);
      assertEquals(!!handler, true);
    });

    it("should return cached handler for same projectDir", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      const handler1 = getRSCHandler("/project/dir");
      const handler2 = getRSCHandler("/project/dir");
      assertEquals(handler1, handler2);
      assertEquals(cache.size, 1);
    });

    it("should use projectId as cache key when provided", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      getRSCHandler("/dir", "proj-123");
      assertEquals(cache.entries.has("proj-123"), true);
      assertEquals(cache.entries.has("/dir"), false);
    });

    it("should use projectDir as cache key when projectId is undefined", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      getRSCHandler("/project/dir");
      assertEquals(cache.entries.has("/project/dir"), true);
    });

    it("should create separate handlers for different projects", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      const handler1 = getRSCHandler("/dir1");
      const handler2 = getRSCHandler("/dir2");
      assertEquals(handler1 !== handler2, true);
      assertEquals(cache.size, 2);
    });
  });

  describe("__resetRSCHandlerForTests", () => {
    it("should clear all cached handlers", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);

      getRSCHandler("/dir1");
      getRSCHandler("/dir2");
      assertEquals(cache.size, 2);

      __resetRSCHandlerForTests();
      assertEquals(cache.size, 0);
    });
  });

  describe("__destroyRSCHandlerForTests", () => {
    it("should remove injected cache", () => {
      const cache = createStubCache();
      __injectCacheForTests(cache);
      getRSCHandler("/dir");
      assertEquals(cache.size, 1);

      __destroyRSCHandlerForTests();

      // After destroy, a new call should create a new handler (using default cache)
      // We just verify no errors
      const cache2 = createStubCache();
      __injectCacheForTests(cache2);
      getRSCHandler("/dir");
      assertEquals(cache2.size, 1);
    });
  });
});
