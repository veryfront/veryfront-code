import { assertEquals } from "std/assert/mod.ts";
import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { DataFetcher } from "./data-fetcher.ts";
import type { PageWithData, DataContext } from "./types.ts";

describe("DataFetcher", () => {
  let fetcher: DataFetcher;

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
    fetcher = new DataFetcher();
  });

  describe("fetchData", () => {
    it("should return empty props when no data methods defined", async () => {
      const pageModule: PageWithData = {
        default: () => null,
      };

      const result = await fetcher.fetchData(pageModule, createContext());

      assertEquals(result, { props: {} });
    });

    it("should use getServerData in development mode", async () => {
      const expectedProps = { title: "Server Data" };

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => ({
          props: expectedProps,
        }),
      };

      const result = await fetcher.fetchData(pageModule, createContext(), "development");

      assertEquals(result, { props: expectedProps, revalidate: undefined });
    });

    it("should prefer getServerData over getStaticData in development", async () => {
      const serverProps = { source: "server" };
      const staticProps = { source: "static" };

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => ({
          props: serverProps,
        }),
        getStaticData: async () => ({
          props: staticProps,
        }),
      };

      const result = await fetcher.fetchData(pageModule, createContext(), "development");

      assertEquals(result, { props: serverProps, revalidate: undefined });
    });

    it("should use getStaticData when getServerData is not defined", async () => {
      const expectedProps = { title: "Static Data" };

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => ({
          props: expectedProps,
        }),
      };

      const result = await fetcher.fetchData(pageModule, createContext(), "development");

      assertEquals(result, { props: expectedProps });
    });

    it("should use getStaticData in production mode", async () => {
      const expectedProps = { title: "Static Data" };

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => ({
          props: expectedProps,
        }),
      };

      const result = await fetcher.fetchData(pageModule, createContext(), "production");

      assertEquals(result, { props: expectedProps });
    });

    it("should prefer getStaticData over getServerData in production", async () => {
      const serverProps = { source: "server" };
      const staticProps = { source: "static" };

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => ({
          props: serverProps,
        }),
        getStaticData: async () => ({
          props: staticProps,
        }),
      };

      const result = await fetcher.fetchData(pageModule, createContext(), "production");

      assertEquals(result, { props: staticProps });
    });

    it("should fallback to getServerData in production if no getStaticData", async () => {
      const expectedProps = { title: "Server Data" };

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => ({
          props: expectedProps,
        }),
      };

      const result = await fetcher.fetchData(pageModule, createContext(), "production");

      assertEquals(result, { props: expectedProps, revalidate: undefined });
    });

    it("should handle redirect result", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => ({
          redirect: {
            destination: "/new-page",
            permanent: false,
          },
        }),
      };

      const result = await fetcher.fetchData(pageModule, createContext(), "development");

      assertEquals(result, {
        redirect: {
          destination: "/new-page",
          permanent: false,
        },
      });
    });

    it("should handle notFound result", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => ({
          notFound: true,
        }),
      };

      const result = await fetcher.fetchData(pageModule, createContext(), "development");

      assertEquals(result, { notFound: true });
    });

    it("should handle revalidate option", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => ({
          props: { data: "test" },
          revalidate: 60,
        }),
      };

      const result = await fetcher.fetchData(pageModule, createContext());

      assertEquals(result, {
        props: { data: "test" },
        revalidate: 60,
      });
    });

    it("should cache static data across multiple calls", async () => {
      let callCount = 0;

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => {
          callCount++;
          return { props: { count: callCount } };
        },
      };

      const context = createContext();
      await fetcher.fetchData(pageModule, context);
      await fetcher.fetchData(pageModule, context);

      // Should only call once due to caching
      assertEquals(callCount, 1);
    });

    it("should handle different contexts separately", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async (ctx) => ({
          props: { id: ctx.params.id },
        }),
      };

      const context1 = createContext({ params: { id: "1" } });
      const context2 = createContext({ params: { id: "2" } });

      const result1 = await fetcher.fetchData(pageModule, context1, "development");
      const result2 = await fetcher.fetchData(pageModule, context2, "development");

      assertEquals(result1.props, { id: "1" });
      assertEquals(result2.props, { id: "2" });
    });

    it("should default to development mode when mode not specified", async () => {
      let methodCalled = "";

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => {
          methodCalled = "server";
          return { props: {} };
        },
        getStaticData: async () => {
          methodCalled = "static";
          return { props: {} };
        },
      };

      await fetcher.fetchData(pageModule, createContext());

      assertEquals(methodCalled, "server");
    });
  });

  describe("getStaticPaths", () => {
    it("should return null when getStaticPaths is not defined", async () => {
      const pageModule: PageWithData = {
        default: () => null,
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertEquals(result, null);
    });

    it("should return paths when getStaticPaths is defined", async () => {
      const expectedPaths = {
        paths: [
          { params: { id: "1" } },
          { params: { id: "2" } },
        ],
        fallback: false,
      };

      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: async () => expectedPaths,
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertEquals(result, expectedPaths);
    });

    it("should handle getStaticPaths with blocking fallback", async () => {
      const expectedPaths = {
        paths: [
          { params: { slug: "hello" } },
        ],
        fallback: "blocking" as const,
      };

      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: async () => expectedPaths,
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertEquals(result, expectedPaths);
    });
  });

  describe("clearCache", () => {
    it("should clear all cache when no pattern provided", async () => {
      let callCount = 0;

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async () => {
          callCount++;
          return { props: { count: callCount } };
        },
      };

      const context = createContext();

      // Populate cache
      await fetcher.fetchData(pageModule, context);
      assertEquals(callCount, 1);

      // Second call should use cache
      await fetcher.fetchData(pageModule, context);
      assertEquals(callCount, 1);

      // Clear cache
      fetcher.clearCache();

      // After clearing, should fetch again
      await fetcher.fetchData(pageModule, context);
      assertEquals(callCount, 2);
    });

    it("should clear cache by pattern", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async (ctx) => ({
          props: { path: ctx.url.pathname },
        }),
      };

      const context1 = createContext({ url: new URL("https://example.com/blog/post-1") });
      const context2 = createContext({ url: new URL("https://example.com/blog/post-2") });
      const context3 = createContext({ url: new URL("https://example.com/about") });

      // Populate cache
      await fetcher.fetchData(pageModule, context1);
      await fetcher.fetchData(pageModule, context2);
      await fetcher.fetchData(pageModule, context3);

      // Clear only blog posts
      fetcher.clearCache("/blog");

      // Verify by using a counting module
      let callCount = 0;
      const countingModule: PageWithData = {
        default: () => null,
        getStaticData: async () => {
          callCount++;
          return { props: { count: callCount } };
        },
      };

      // Blog posts should be refetched
      await fetcher.fetchData(countingModule, context1);
      await fetcher.fetchData(countingModule, context2);
      // About should not be refetched
      await fetcher.fetchData(countingModule, context3);

      assertEquals(callCount, 2);
    });

    it("should handle clearCache on empty cache", () => {
      fetcher.clearCache();
      fetcher.clearCache("/pattern");
      // Should not throw
    });
  });

  describe("integration tests", () => {
    it("should handle full data fetching flow with all methods", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: async () => ({
          paths: [
            { params: { id: "1" } },
            { params: { id: "2" } },
          ],
          fallback: false,
        }),
        getServerData: async (ctx) => ({
          props: { id: ctx.params.id, source: "server" },
        }),
        getStaticData: async (ctx) => ({
          props: { id: ctx.params.id, source: "static" },
          revalidate: 60,
        }),
      };

      const paths = await fetcher.getStaticPaths(pageModule);
      assertEquals(paths?.paths.length, 2);

      const context = createContext({ params: { id: "1" } });
      const devResult = await fetcher.fetchData(pageModule, context, "development");
      assertEquals(devResult.props, { id: "1", source: "server" });

      const prodResult = await fetcher.fetchData(pageModule, context, "production");
      assertEquals(prodResult.props, { id: "1", source: "static" });
    });

    it("should maintain separate caches for server and static data", async () => {
      let serverCalls = 0;
      let staticCalls = 0;

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => {
          serverCalls++;
          return { props: { source: "server", calls: serverCalls } };
        },
        getStaticData: async () => {
          staticCalls++;
          return { props: { source: "static", calls: staticCalls } };
        },
      };

      const context = createContext();

      // Development mode uses server data (no caching for server data in current implementation)
      await fetcher.fetchData(pageModule, context, "development");
      await fetcher.fetchData(pageModule, context, "development");

      // Production mode uses static data (with caching)
      await fetcher.fetchData(pageModule, context, "production");
      await fetcher.fetchData(pageModule, context, "production");

      // Server calls are not cached
      assertEquals(serverCalls, 2);
      // Static calls are cached
      assertEquals(staticCalls, 1);
    });
  });
});
