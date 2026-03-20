import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ServerDataFetcher } from "./server-data-fetcher.ts";
import type { DataContext, PageWithData } from "./types.ts";
import { __resetPoolForTests } from "#veryfront/security/sandbox/worker-pool.ts";

describe("ServerDataFetcher", () => {
  function createContext(overrides: Partial<DataContext> = {}): DataContext {
    return {
      params: {},
      query: new URLSearchParams(),
      request: new Request("http://localhost/test"),
      url: new URL("http://localhost/test"),
      ...overrides,
    };
  }

  describe("constructor", () => {
    it("should create instance without adapter", () => {
      assertExists(new ServerDataFetcher());
    });

    it("should create instance without arguments", () => {
      assertExists(new ServerDataFetcher());
    });
  });

  describe("fetch", () => {
    it("should return empty props when getServerData is not defined", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = { default: () => null };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.props, {});
      assertEquals(result.redirect, undefined);
      assertEquals(result.notFound, undefined);
    });

    it("should call getServerData with context", async () => {
      const fetcher = new ServerDataFetcher();
      let receivedContext: DataContext | undefined;

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: (ctx) => {
          receivedContext = ctx;
          return { props: {} };
        },
      };

      const context = createContext({ params: { id: "123" } });
      await fetcher.fetch(pageModule, context);

      assertExists(receivedContext);
      assertEquals(receivedContext.params.id, "123");
    });

    it("should return props from getServerData", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData<{ title: string; count: number }> = {
        default: () => null,
        getServerData: () => ({ props: { title: "Hello", count: 42 } }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.props, { title: "Hello", count: 42 });
    });

    it("should handle redirect result", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({
          redirect: { destination: "/login", permanent: false },
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.redirect?.destination, "/login");
      assertEquals(result.redirect?.permanent, false);
      assertEquals(result.props, undefined);
    });

    it("should handle permanent redirect", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({
          redirect: { destination: "/new-url", permanent: true },
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.redirect?.permanent, true);
    });

    it("should handle notFound result", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ notFound: true }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.notFound, true);
      assertEquals(result.props, undefined);
      assertEquals(result.redirect, undefined);
    });

    it("should preserve revalidate option", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({
          props: { data: "test" },
          revalidate: 60,
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.revalidate, 60);
    });

    it("should handle revalidate: false", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({
          props: {},
          revalidate: false,
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.revalidate, false);
    });

    it("should default props to empty object if undefined", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({}),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.props, {});
    });

    it("should throw when getServerData throws", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw new Error("Database connection failed");
        },
      };

      await assertRejects(
        () => fetcher.fetch(pageModule, createContext()),
        Error,
        "Database connection failed",
      );
    });

    it("should support synchronous getServerData", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData<{ sync: boolean }> = {
        default: () => null,
        getServerData: () => ({ props: { sync: true } }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.props, { sync: true });
    });

    it("should pass request object in context", async () => {
      const fetcher = new ServerDataFetcher();
      let receivedRequest: Request | undefined;

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: (ctx) => {
          receivedRequest = ctx.request;
          return { props: {} };
        },
      };

      const request = new Request("http://localhost/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      await fetcher.fetch(pageModule, createContext({ request }));

      assertExists(receivedRequest);
      assertEquals(receivedRequest.method, "POST");
    });

    it("should pass query params in context", async () => {
      const fetcher = new ServerDataFetcher();
      let receivedQuery: URLSearchParams | undefined;

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: (ctx) => {
          receivedQuery = ctx.query;
          return { props: {} };
        },
      };

      const query = new URLSearchParams("?search=test&page=2");
      await fetcher.fetch(pageModule, createContext({ query }));

      assertExists(receivedQuery);
      assertEquals(receivedQuery.get("search"), "test");
      assertEquals(receivedQuery.get("page"), "2");
    });
  });

  describe("fetchIsolated body size guard", () => {
    afterEach(() => {
      try {
        Deno.env.delete("WORKER_ISOLATION_ENABLED");
      } catch { /* ok */ }
      try {
        Deno.env.delete("WORKER_ISOLATION_DATA");
      } catch { /* ok */ }
      __resetPoolForTests();
    });

    it("should reject oversized request bodies in isolated data fetch", async () => {
      // Enable data isolation
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      __resetPoolForTests();

      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: { data: "test" } }),
      };

      // Create a body larger than 10 MB
      const largeBody = new Uint8Array(11 * 1024 * 1024);
      const request = new Request("http://localhost/test", {
        method: "POST",
        body: largeBody,
      });

      await assertRejects(
        () =>
          fetcher.fetch(
            pageModule,
            createContext({ request }),
            { modulePath: "/tmp/test/page.ts", projectDir: "/tmp/test" },
          ),
        Error,
        "too large",
      );
    });
  });
});
