import { assertEquals, assertRejects } from "std/assert/mod.ts";
import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { StaticDataFetcher } from "./static-data-fetcher.ts";
import { CacheManager } from "./data-fetching-cache.ts";
import type { PageWithData, DataContext } from "./types.ts";

describe("StaticDataFetcher", () => {
  let cacheManager: CacheManager;
  let fetcher: StaticDataFetcher;

  const createContext = (overrides?: Partial<DataContext>): DataContext => ({
    params: {},
    query: new URLSearchParams(),
    request: new Request("https://example.com/page"),
    url: new URL("https://example.com/page"),
    ...overrides,
  });

  beforeEach(() => {
    // Disable LRU interval for tests
    (globalThis as Record<string, unknown>).__vfDisableLruInterval = true;
    cacheManager = new CacheManager();
    fetcher = new StaticDataFetcher(cacheManager);
  });

  describe("fetch", () => {
    it("should return empty props when getStaticData is not defined", async () => {
      const pageModule: PageWithData = {
        default: () => null,
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result, { props: {} });
    });

    it("should fetch and cache data on first call", async () => {
      const expectedProps = { title: "Test Page", count: 42 };

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => ({
          props: expectedProps,
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result, { props: expectedProps });
    });

    it("should return cached data on subsequent calls", async () => {
      let callCount = 0;
      const expectedProps = { title: "Test Page" };

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => {
          callCount++;
          return { props: expectedProps };
        },
      };

      const context = createContext();
      await fetcher.fetch(pageModule, context);
      await fetcher.fetch(pageModule, context);

      assertEquals(callCount, 1);
    });

    it("should handle revalidation with stale data", async () => {
      let callCount = 0;

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => {
          callCount++;
          return {
            props: { value: callCount },
            revalidate: 1, // 1 second
          };
        },
      };

      const context = createContext();

      // First fetch
      const result1 = await fetcher.fetch(pageModule, context);
      assertEquals(result1.props, { value: 1 });

      // Manually set timestamp to trigger revalidation
      const cacheKey = cacheManager.createCacheKey(context);
      const cached = cacheManager.get(cacheKey);
      if (cached) {
        cached.timestamp = Date.now() - 2000; // 2 seconds ago
        cacheManager.set(cacheKey, cached);
      }

      // Second fetch should return stale data and trigger background revalidation
      const result2 = await fetcher.fetch(pageModule, context);
      assertEquals(result2.props, { value: 1 }); // Still returns old data

      // Wait for background revalidation to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Third fetch should return updated data
      const result3 = await fetcher.fetch(pageModule, context);
      assertEquals(result3.props, { value: 2 });
    });

    it("should handle revalidate false", async () => {
      let callCount = 0;

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => {
          callCount++;
          return {
            props: { value: callCount },
            revalidate: false,
          };
        },
      };

      const context = createContext();

      await fetcher.fetch(pageModule, context);
      await fetcher.fetch(pageModule, context);
      await fetcher.fetch(pageModule, context);

      // Should only call once since revalidate is false
      assertEquals(callCount, 1);
    });

    it("should cache different contexts separately", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async (ctx) => ({
          props: { id: ctx.params.id },
        }),
      };

      const context1 = createContext({ params: { id: "1" } });
      const context2 = createContext({ params: { id: "2" } });

      const result1 = await fetcher.fetch(pageModule, context1);
      const result2 = await fetcher.fetch(pageModule, context2);

      assertEquals(result1.props, { id: "1" });
      assertEquals(result2.props, { id: "2" });
    });

    it("should handle synchronous getStaticData", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: () => ({
          props: { message: "Hello" },
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result, { props: { message: "Hello" } });
    });

    it("should throw error when getStaticData throws", async () => {
      const error = new Error("Data fetch failed");

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => {
          throw error;
        },
      };

      await assertRejects(
        async () => await fetcher.fetch(pageModule, createContext()),
        Error,
        "Data fetch failed",
      );
    });

    it("should handle redirect result", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => ({
          redirect: {
            destination: "/new-page",
            permanent: false,
          },
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.redirect, {
        destination: "/new-page",
        permanent: false,
      });
    });

    it("should handle notFound result", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => ({
          notFound: true,
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.notFound, true);
    });

    it("should cache redirect results", async () => {
      let callCount = 0;

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => {
          callCount++;
          return {
            redirect: {
              destination: "/redirect",
              permanent: true,
            },
          };
        },
      };

      const context = createContext();
      await fetcher.fetch(pageModule, context);
      await fetcher.fetch(pageModule, context);

      assertEquals(callCount, 1);
    });

    it("should not trigger revalidation for non-stale data", async () => {
      let callCount = 0;

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => {
          callCount++;
          return {
            props: { value: callCount },
            revalidate: 3600, // 1 hour
          };
        },
      };

      const context = createContext();

      await fetcher.fetch(pageModule, context);
      await fetcher.fetch(pageModule, context);
      await fetcher.fetch(pageModule, context);

      // Should only call once since data is not stale
      assertEquals(callCount, 1);
    });

    it("should handle complex props structure", async () => {
      const complexProps = {
        user: {
          id: 1,
          name: "John",
          roles: ["admin", "user"],
        },
        posts: [
          { id: 1, title: "Post 1" },
          { id: 2, title: "Post 2" },
        ],
      };

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => ({
          props: complexProps,
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result, { props: complexProps });
    });
  });

  describe("background revalidation", () => {
    it("should handle revalidation errors gracefully", async () => {
      let callCount = 0;

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              props: { value: 1 },
              revalidate: 1,
            };
          }
          throw new Error("Revalidation failed");
        },
      };

      const context = createContext();

      // First fetch succeeds
      const result1 = await fetcher.fetch(pageModule, context);
      assertEquals(result1.props, { value: 1 });

      // Make data stale
      const cacheKey = cacheManager.createCacheKey(context);
      const cached = cacheManager.get(cacheKey);
      if (cached) {
        cached.timestamp = Date.now() - 2000;
        cacheManager.set(cacheKey, cached);
      }

      // Second fetch should return stale data even though revalidation fails
      const result2 = await fetcher.fetch(pageModule, context);
      assertEquals(result2.props, { value: 1 });

      // Wait for background revalidation
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should still have old data since revalidation failed
      const result3 = await fetcher.fetch(pageModule, context);
      assertEquals(result3.props, { value: 1 });
    });

    it("should not trigger multiple concurrent revalidations", async () => {
      let callCount = 0;

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => {
          callCount++;
          await new Promise(resolve => setTimeout(resolve, 100));
          return {
            props: { value: callCount },
            revalidate: 1,
          };
        },
      };

      const context = createContext();

      // First fetch
      await fetcher.fetch(pageModule, context);

      // Make data stale
      const cacheKey = cacheManager.createCacheKey(context);
      const cached = cacheManager.get(cacheKey);
      if (cached) {
        cached.timestamp = Date.now() - 2000;
        cacheManager.set(cacheKey, cached);
      }

      // Multiple concurrent fetches
      await Promise.all([
        fetcher.fetch(pageModule, context),
        fetcher.fetch(pageModule, context),
        fetcher.fetch(pageModule, context),
      ]);

      // Wait for background revalidation
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should only have called getStaticData twice (initial + one revalidation)
      assertEquals(callCount, 2);
    });
  });

  describe("error handling", () => {
    it("should propagate and log errors from getStaticData", async () => {
      // StaticDataFetcher only takes cacheManager - always logs errors
      const localFetcher = new StaticDataFetcher(cacheManager);

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => {
          throw new Error("Test error");
        },
      };

      await assertRejects(
        async () => await localFetcher.fetch(pageModule, createContext()),
        Error,
        "Test error",
      );
    });

    it("should return data successfully", async () => {
      const localFetcher = new StaticDataFetcher(cacheManager);

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => ({
          props: { test: true },
        }),
      };

      const result = await localFetcher.fetch(pageModule, createContext());

      assertEquals(result, { props: { test: true } });
    });
  });
});
