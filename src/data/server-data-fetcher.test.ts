import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ServerDataFetcher } from "./server-data-fetcher.ts";
import type { DataContext, PageWithData } from "./types.ts";
import { __resetPoolForTests } from "#veryfront/security/sandbox/worker-pool.ts";
import { CircuitBreakerOpen } from "#veryfront/utils/circuit-breaker.ts";

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

    it("rejects invalid loader results without exposing their contents", async () => {
      const fetcher = new ServerDataFetcher();
      const secretMarker = "private-result-marker";
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () =>
          ({ redirect: { destination: 42 }, secretMarker }) as unknown as ReturnType<
            NonNullable<PageWithData["getServerData"]>
          >,
      };

      const error = await assertRejects(
        () => fetcher.fetch(pageModule, createContext()),
        Error,
        "invalid data result",
      );
      assertEquals(error.message.includes(secretMarker), false);
    });

    it("rejects loader results that exceed the data-result byte limit", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({
          props: { payload: "x".repeat(8 * 1024 * 1024 + 1) },
        }),
      };

      await assertRejects(
        () => fetcher.fetch(pageModule, createContext()),
        Error,
        "exceeds the data result limit",
      );
    });

    it("rejects result accessors without invoking them", async () => {
      const fetcher = new ServerDataFetcher();
      let reads = 0;
      const result = Object.defineProperty({}, "props", {
        enumerable: true,
        get() {
          reads++;
          return { private: true };
        },
      });
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => result,
      } as PageWithData;

      await assertRejects(
        () => fetcher.fetch(pageModule, createContext()),
        Error,
        "exceeds the data result limit",
      );
      assertEquals(reads, 0);
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

    it("does not trust a caller-provided project header for circuit scope", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw new Error("upstream failed");
        },
      };

      for (let attempt = 0; attempt < 5; attempt++) {
        const request = new Request("http://data-scope-test.invalid/page", {
          headers: { "x-project-id": `spoofed-${attempt}` },
        });
        await assertRejects(
          () =>
            fetcher.fetch(
              pageModule,
              createContext({
                request,
                url: new URL("http://data-scope-test.invalid/page"),
              }),
            ),
          Error,
          "upstream failed",
        );
      }

      const request = new Request("http://data-scope-test.invalid/page", {
        headers: { "x-project-id": "spoofed-final" },
      });
      await assertRejects(
        () =>
          fetcher.fetch(
            pageModule,
            createContext({
              request,
              url: new URL("http://data-scope-test.invalid/page"),
            }),
          ),
        CircuitBreakerOpen,
      );
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

    it("should reject via Content-Length header before buffering", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      __resetPoolForTests();

      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: {} }),
      };

      // Small body but Content-Length claims 20 MB
      const request = new Request("http://localhost/test", {
        method: "POST",
        body: "small",
        headers: { "content-length": String(20 * 1024 * 1024) },
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

    it("should reject malformed Content-Length headers", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      __resetPoolForTests();

      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: {} }),
      };
      const request = new Request("http://localhost/test", {
        method: "POST",
        body: "small",
        headers: { "content-length": "5 trailing-data" },
      });

      await assertRejects(
        () =>
          fetcher.fetch(
            pageModule,
            createContext({ request }),
            { modulePath: "/tmp/test/page.ts", projectDir: "/tmp/test" },
          ),
        Error,
        "Invalid Content-Length header",
      );
    });

    it("rejects oversized request metadata before isolated dispatch", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      __resetPoolForTests();

      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: {} }),
      };
      const request = new Request("http://localhost/test", {
        headers: { "x-large": "x".repeat(9 * 1024) },
      });

      await assertRejects(
        () =>
          fetcher.fetch(
            pageModule,
            createContext({ request }),
            { modulePath: "/tmp/test/page.ts", projectDir: "/tmp/test" },
          ),
        Error,
        "Headers too large",
      );
    });

    it("should cancel a chunked body as soon as the byte limit is exceeded", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      __resetPoolForTests();

      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: {} }),
      };
      const chunk = new Uint8Array(1024 * 1024);
      const totalChunks = 20;
      let chunksProduced = 0;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          chunksProduced++;
          controller.enqueue(chunk);
          if (chunksProduced === totalChunks) controller.close();
        },
        cancel() {
          cancelled = true;
        },
      });
      const request = new Request("http://localhost/test", {
        method: "POST",
        body,
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

      assertEquals(cancelled, true);
      assertEquals(chunksProduced < totalChunks, true);
    });

    it("does not open the project circuit for invalid isolated requests", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      __resetPoolForTests();

      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: {} }),
      };

      for (let attempt = 0; attempt < 5; attempt++) {
        const request = new Request("http://invalid-body-test.invalid/page", {
          method: "POST",
          body: "small",
          headers: { "content-length": `invalid-${attempt}` },
        });
        await assertRejects(
          () =>
            fetcher.fetch(
              pageModule,
              createContext({
                request,
                url: new URL("http://invalid-body-test.invalid/page"),
              }),
              { modulePath: "/tmp/test/page.ts", projectDir: "/tmp/test" },
            ),
          Error,
          "Invalid Content-Length header",
        );
      }

      const request = new Request("http://invalid-body-test.invalid/page");
      await assertRejects(
        () =>
          fetcher.fetch(
            pageModule,
            createContext({
              request,
              url: new URL("http://invalid-body-test.invalid/page"),
            }),
            { modulePath: "/tmp/test/page.ts", projectDir: "/tmp/test" },
          ),
        Error,
        "requires an exact source integration policy",
      );
    });

    it("should skip body size guard when request has no body", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      __resetPoolForTests();

      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: { ok: true } }),
      };

      // GET request with no body
      const request = new Request("http://localhost/test", { method: "GET" });

      // The worker boundary is strict: isolated project code cannot run without
      // the exact source policy established by request middleware.
      await assertRejects(
        () =>
          fetcher.fetch(
            pageModule,
            createContext({ request }),
            { modulePath: "/tmp/test/page.ts", projectDir: "/tmp/test" },
          ),
        Error,
        "requires an exact source integration policy",
      );
    });
  });
});
