import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __injectCachesForTests,
  getCachedPaths,
  getLastDistributedRefresh,
  getProcessingStack,
  hasInjectedProcessingStack,
} from "./http-cache-state.ts";

describe("transforms/esm/http-cache-state", () => {
  afterEach(() => {
    __injectCachesForTests(null);
  });

  describe("getCachedPaths", () => {
    it("returns default cache when nothing injected", () => {
      const cache = getCachedPaths();
      assertEquals(typeof cache.get, "function");
      assertEquals(typeof cache.set, "function");
    });

    it("returns injected cache when provided", () => {
      const mockCache = new Map<string, string>();
      mockCache.set("test-key", "test-value");
      __injectCachesForTests({ cachedPaths: mockCache });
      assertEquals(getCachedPaths().get("test-key"), "test-value");
    });
  });

  describe("getProcessingStack", () => {
    it("returns default set when nothing injected", () => {
      const stack = getProcessingStack();
      assertEquals(typeof stack.has, "function");
      assertEquals(typeof stack.add, "function");
    });

    it("returns injected stack when provided", () => {
      const mockStack = new Set<string>(["url1"]);
      __injectCachesForTests({ processingStack: mockStack });
      assertEquals(getProcessingStack().has("url1"), true);
    });
  });

  describe("getLastDistributedRefresh", () => {
    it("returns default cache when nothing injected", () => {
      const cache = getLastDistributedRefresh();
      assertEquals(typeof cache.get, "function");
      assertEquals(typeof cache.set, "function");
    });

    it("returns injected cache when provided", () => {
      const mockCache = new Map<string, number>();
      mockCache.set("hash1", 12345);
      __injectCachesForTests({ lastDistributedRefresh: mockCache });
      assertEquals(getLastDistributedRefresh().get("hash1"), 12345);
    });
  });

  describe("hasInjectedProcessingStack", () => {
    it("returns false by default", () => {
      assertEquals(hasInjectedProcessingStack(), false);
    });

    it("returns true when processing stack is injected", () => {
      __injectCachesForTests({ processingStack: new Set() });
      assertEquals(hasInjectedProcessingStack(), true);
    });

    it("returns false after resetting", () => {
      __injectCachesForTests({ processingStack: new Set() });
      __injectCachesForTests(null);
      assertEquals(hasInjectedProcessingStack(), false);
    });
  });

  describe("__injectCachesForTests", () => {
    it("restores defaults when called with null", () => {
      const mockCache = new Map<string, string>();
      mockCache.set("key", "val");
      __injectCachesForTests({ cachedPaths: mockCache });
      assertEquals(getCachedPaths().get("key"), "val");

      __injectCachesForTests(null);
      assertEquals(getCachedPaths().get("key"), undefined);
    });

    it("can inject only cachedPaths without affecting others", () => {
      const mockCache = new Map<string, string>();
      __injectCachesForTests({ cachedPaths: mockCache });
      assertEquals(hasInjectedProcessingStack(), false);
    });

    it("can inject only processingStack without affecting others", () => {
      __injectCachesForTests({ processingStack: new Set(["url"]) });
      assertEquals(hasInjectedProcessingStack(), true);
    });
  });
});
