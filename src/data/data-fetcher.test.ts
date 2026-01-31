import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DataFetcher } from "./data-fetcher.ts";
import type { DataContext, DataResult, PageWithData } from "./types.ts";

function createContext(overrides: Partial<DataContext> = {}): DataContext {
  return {
    params: {},
    query: new URLSearchParams(),
    request: new Request("http://localhost/test"),
    url: new URL("http://localhost/test"),
    ...overrides,
  };
}

function getProps<T>(result: DataResult): T {
  assertExists(result.props);
  return result.props as T;
}

describe("DataFetcher", () => {
  describe("constructor", () => {
    it("should create instance without adapter", () => {
      assertExists(new DataFetcher());
    });

    it("should create instance with adapter", () => {
      const mockAdapter = { env: { get: () => undefined } } as any;
      assertExists(new DataFetcher(mockAdapter));
    });
  });

  describe("fetchData", () => {
    it("should return empty props when no data functions defined", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = { default: () => null };

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

        assertEquals(getProps<{ source: string }>(result).source, "server");
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

        assertEquals(getProps<{ source: string }>(result).source, "static");
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

        assertEquals(getProps<{ source: string }>(result).source, "static");
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

        assertEquals(getProps<{ source: string }>(result).source, "server");
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

      assertEquals(getProps<{ source: string }>(result).source, "server");
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
        getServerData: () => ({ notFound: true }),
      };

      const result = await fetcher.fetchData(pageModule, createContext());

      assertEquals(result.notFound, true);
    });
  });

  describe("getStaticPaths", () => {
    it("should return null when getStaticPaths not defined", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = { default: () => null };

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
      assertEquals(result.paths.length, 2);
      assertEquals(result.fallback, false);
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

      assertEquals(result?.fallback, "blocking");
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

      await fetcher.fetchData(pageModule, createContext(), "production");
      fetcher.clearCache();
    });

    it("should clear cache matching pattern", () => {
      const fetcher = new DataFetcher();
      fetcher.clearCache("/blog");
    });

    it("should not throw with empty pattern", () => {
      const fetcher = new DataFetcher();
      fetcher.clearCache("");
    });
  });

  describe("integration scenarios", () => {
    it("should handle page with all data functions", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData<{ title: string }> = {
        default: () => null,
        getServerData: (ctx) => ({ props: { title: `Server: ${ctx.params.id}` } }),
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

      const devResult = await fetcher.fetchData(pageModule, context, "development");
      assertEquals(getProps<{ title: string }>(devResult).title, "Server: 1");

      const prodResult = await fetcher.fetchData(pageModule, context, "production");
      assertEquals(getProps<{ title: string }>(prodResult).title, "Static: 1");

      const paths = await fetcher.getStaticPaths(pageModule);
      assertEquals(paths?.paths.length, 2);
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
