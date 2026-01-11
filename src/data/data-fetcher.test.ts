import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { DataFetcher } from "./data-fetcher.ts";
import type { DataContext, PageWithData } from "./types.ts";

describe("DataFetcher", () => {
  const createContext = (overrides: Partial<DataContext> = {}): DataContext => ({
    params: {},
    query: new URLSearchParams(),
    request: new Request("http://localhost/test"),
    url: new URL("http://localhost/test"),
    ...overrides,
  });

  describe("constructor", () => {
    it("should create instance without adapter", () => {
      const fetcher = new DataFetcher();
      assertExists(fetcher);
    });

    it("should create instance with adapter", () => {
      const mockAdapter = {
        env: { get: () => undefined },
      } as any;
      const fetcher = new DataFetcher(mockAdapter);
      assertExists(fetcher);
    });
  });

  describe("fetchData", () => {
    it("should return empty props when no data functions defined", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
      };

      const result = await fetcher.fetchData(pageModule, createContext());

      assertEquals(result.props, {});
    });

    describe("development mode", () => {
      it("should prefer getServerData in development mode", async () => {
        const fetcher = new DataFetcher();
        const pageModule: PageWithData<{ source: string }> = {
          default: () => null,
          getServerData: () => ({ props: { source: "server" } }),
          getStaticData: () => ({ props: { source: "static" } }),
        };

        const result = await fetcher.fetchData(
          pageModule,
          createContext(),
          "development",
        );

        assertEquals((result.props as { source: string })?.source, "server");
      });

      it("should fallback to getStaticData if getServerData not defined", async () => {
        const fetcher = new DataFetcher();
        const pageModule: PageWithData<{ source: string }> = {
          default: () => null,
          getStaticData: () => ({ props: { source: "static" } }),
        };

        const result = await fetcher.fetchData(
          pageModule,
          createContext(),
          "development",
        );

        assertEquals((result.props as { source: string })?.source, "static");
      });
    });

    describe("production mode", () => {
      it("should prefer getStaticData in production mode", async () => {
        const fetcher = new DataFetcher();
        const pageModule: PageWithData<{ source: string }> = {
          default: () => null,
          getServerData: () => ({ props: { source: "server" } }),
          getStaticData: () => ({ props: { source: "static" } }),
        };

        const result = await fetcher.fetchData(
          pageModule,
          createContext(),
          "production",
        );

        assertEquals((result.props as { source: string })?.source, "static");
      });

      it("should use getServerData if getStaticData not defined in production", async () => {
        const fetcher = new DataFetcher();
        const pageModule: PageWithData<{ source: string }> = {
          default: () => null,
          getServerData: () => ({ props: { source: "server" } }),
        };

        const result = await fetcher.fetchData(
          pageModule,
          createContext(),
          "production",
        );

        assertEquals((result.props as { source: string })?.source, "server");
      });
    });

    it("should default to development mode", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData<{ source: string }> = {
        default: () => null,
        getServerData: () => ({ props: { source: "server" } }),
        getStaticData: () => ({ props: { source: "static" } }),
      };

      const result = await fetcher.fetchData(pageModule, createContext());

      assertEquals((result.props as { source: string })?.source, "server");
    });

    it("should handle redirect from data function", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({
          redirect: { destination: "/login", permanent: false },
        }),
      };

      const result = await fetcher.fetchData(pageModule, createContext());

      assertEquals(result.redirect?.destination, "/login");
    });

    it("should handle notFound from data function", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({
          notFound: true,
        }),
      };

      const result = await fetcher.fetchData(pageModule, createContext());

      assertEquals(result.notFound, true);
    });
  });

  describe("getStaticPaths", () => {
    it("should return null when getStaticPaths not defined", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertEquals(result, null);
    });

    it("should return paths from getStaticPaths", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [{ params: { id: "1" } }, { params: { id: "2" } }],
          fallback: false,
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.paths.length, 2);
      assertEquals(result!.fallback, false);
    });

    it("should support fallback: blocking", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [],
          fallback: "blocking",
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertEquals(result!.fallback, "blocking");
    });
  });

  describe("clearCache", () => {
    it("should clear all cache without pattern", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: () => ({
          props: { cached: true },
          revalidate: 3600,
        }),
      };

      // Populate cache
      await fetcher.fetchData(pageModule, createContext(), "production");

      // Clear cache - verify method doesn't throw
      fetcher.clearCache();
    });

    it("should clear cache matching pattern", () => {
      const fetcher = new DataFetcher();

      // Clear with pattern - verify method doesn't throw
      fetcher.clearCache("/blog");
    });

    it("should not throw with empty pattern", () => {
      const fetcher = new DataFetcher();

      // Should not throw
      fetcher.clearCache("");
    });
  });

  describe("integration scenarios", () => {
    it("should handle page with all data functions", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData<{ title: string }> = {
        default: () => null,
        getServerData: (ctx) => ({
          props: { title: `Server: ${ctx.params.id}` },
        }),
        getStaticData: (ctx) => ({
          props: { title: `Static: ${ctx.params.id}` },
          revalidate: 60,
        }),
        getStaticPaths: () => ({
          paths: [{ params: { id: "1" } }, { params: { id: "2" } }],
          fallback: false,
        }),
      };

      const context = createContext({
        params: { id: "1" },
        url: new URL("http://localhost/posts/1"),
      });

      // In development, uses getServerData
      const devResult = await fetcher.fetchData(pageModule, context, "development");
      assertEquals((devResult.props as { title: string })?.title, "Server: 1");

      // In production, uses getStaticData
      const prodResult = await fetcher.fetchData(pageModule, context, "production");
      assertEquals((prodResult.props as { title: string })?.title, "Static: 1");

      // getStaticPaths works independently
      const paths = await fetcher.getStaticPaths(pageModule);
      assertEquals(paths!.paths.length, 2);
    });

    it("should pass full context to getServerData", async () => {
      const fetcher = new DataFetcher();
      let receivedContext: DataContext | undefined;

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: (ctx) => {
          receivedContext = ctx;
          return { props: {} };
        },
      };

      const context = createContext({
        params: { slug: "test" },
        query: new URLSearchParams("?sort=date"),
        request: new Request("http://localhost/posts/test?sort=date", {
          headers: { "X-Custom": "header" },
        }),
        url: new URL("http://localhost/posts/test?sort=date"),
      });

      await fetcher.fetchData(pageModule, context);

      assertExists(receivedContext);
      assertEquals(receivedContext.params.slug, "test");
      assertEquals(receivedContext.query.get("sort"), "date");
      assertExists(receivedContext.request);
      assertEquals(receivedContext.url.pathname, "/posts/test");
    });
  });
});
