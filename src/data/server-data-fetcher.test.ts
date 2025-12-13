import { assertEquals, assertRejects } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { ServerDataFetcher } from "./server-data-fetcher.ts";
import type { PageWithData, DataContext, DataResult } from "./types.ts";

describe("ServerDataFetcher", () => {
  const createContext = (overrides?: Partial<DataContext>): DataContext => ({
    params: {},
    query: new URLSearchParams(),
    request: new Request("https://example.com/page"),
    url: new URL("https://example.com/page"),
    ...overrides,
  });

  describe("fetch", () => {
    it("should return empty props when getServerData is not defined", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result, { props: {} });
    });

    it("should return props from getServerData", async () => {
      const fetcher = new ServerDataFetcher();
      const expectedProps = { title: "Test Page", count: 42 };

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => ({
          props: expectedProps,
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result, { props: expectedProps, revalidate: undefined });
    });

    it("should handle synchronous getServerData", async () => {
      const fetcher = new ServerDataFetcher();
      const expectedProps = { message: "Hello" };

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({
          props: expectedProps,
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result, { props: expectedProps, revalidate: undefined });
    });

    it("should return redirect result", async () => {
      const fetcher = new ServerDataFetcher();
      const redirectResult: DataResult = {
        redirect: {
          destination: "/new-page",
          permanent: false,
        },
      };

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => redirectResult,
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result, { redirect: redirectResult.redirect });
    });

    it("should return permanent redirect", async () => {
      const fetcher = new ServerDataFetcher();

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => ({
          redirect: {
            destination: "/moved-permanently",
            permanent: true,
          },
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result, {
        redirect: {
          destination: "/moved-permanently",
          permanent: true,
        },
      });
    });

    it("should return notFound result", async () => {
      const fetcher = new ServerDataFetcher();

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => ({
          notFound: true,
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result, { notFound: true });
    });

    it("should return props with revalidate", async () => {
      const fetcher = new ServerDataFetcher();

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => ({
          props: { data: "test" },
          revalidate: 60,
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result, {
        props: { data: "test" },
        revalidate: 60,
      });
    });

    it("should return props with revalidate false", async () => {
      const fetcher = new ServerDataFetcher();

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => ({
          props: { data: "test" },
          revalidate: false,
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result, {
        props: { data: "test" },
        revalidate: false,
      });
    });

    it("should handle empty props object", async () => {
      const fetcher = new ServerDataFetcher();

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => ({
          props: {},
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result, { props: {}, revalidate: undefined });
    });

    it("should handle undefined props", async () => {
      const fetcher = new ServerDataFetcher();

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => ({
          props: undefined as unknown as Record<string, unknown>,
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result, { props: {}, revalidate: undefined });
    });

    it("should throw error when getServerData throws", async () => {
      const fetcher = new ServerDataFetcher();
      const error = new Error("Database error");

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => {
          throw error;
        },
      };

      await assertRejects(
        async () => await fetcher.fetch(pageModule, createContext()),
        Error,
        "Database error",
      );
    });

    it("should pass context to getServerData", async () => {
      const fetcher = new ServerDataFetcher();
      let receivedContext: DataContext | undefined;

      const context = createContext({
        params: { id: "123" },
        query: new URLSearchParams("foo=bar"),
      });

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async (ctx: DataContext) => {
          receivedContext = ctx;
          return { props: {} };
        },
      };

      await fetcher.fetch(pageModule, context);

      assertEquals(receivedContext?.params, { id: "123" });
      assertEquals(receivedContext?.query.get("foo"), "bar");
    });

    it("should handle complex props structure", async () => {
      const fetcher = new ServerDataFetcher();
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
        metadata: {
          total: 2,
          page: 1,
        },
      };

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => ({
          props: complexProps,
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result, { props: complexProps, revalidate: undefined });
    });
  });

  describe("error handling", () => {
    it("should propagate and log errors from getServerData", async () => {
      // ServerDataFetcher no longer takes adapter - always logs errors
      const fetcher = new ServerDataFetcher();

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => {
          throw new Error("Test error");
        },
      };

      await assertRejects(
        async () => await fetcher.fetch(pageModule, createContext()),
        Error,
        "Test error",
      );
    });

    it("should return data successfully", async () => {
      const fetcher = new ServerDataFetcher();

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async () => ({
          props: { test: true },
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result, { props: { test: true }, revalidate: undefined });
    });
  });
});
