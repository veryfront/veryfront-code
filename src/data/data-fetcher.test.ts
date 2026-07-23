import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
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
      const mockAdapter = { env: { get: () => undefined } };
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

    it("preserves the page props type in its return value", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData<{ title: string }> = {
        default: () => null,
        getServerData: () => ({ props: { title: "Typed" } }),
      };

      const result = await fetcher.fetchData(pageModule, createContext());

      assertEquals(result.props?.title, "Typed");
    });

    it("rejects unsupported runtime modes", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: {} }),
      };

      await assertRejects(
        () =>
          fetcher.fetchData(
            pageModule,
            createContext(),
            "staging" as "development",
          ),
        Error,
        "mode",
      );
    });

    it("snapshots loader getters once per operation", async () => {
      const fetcher = new DataFetcher();
      let reads = 0;
      const pageModule = {
        default: () => null,
        get getServerData() {
          reads++;
          return () => ({ props: { reads } });
        },
      } satisfies PageWithData;

      const result = await fetcher.fetchData(pageModule, createContext());

      assertEquals(reads, 1);
      assertEquals(getProps<{ reads: number }>(result).reads, 1);
    });

    it("rejects invalid data contexts before invoking loaders", async () => {
      const fetcher = new DataFetcher();
      let called = false;
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          called = true;
          return { props: {} };
        },
      };
      const context = createContext({
        params: { id: "x".repeat(4_097) },
      });

      await assertRejects(
        () => fetcher.fetchData(pageModule, context),
        Error,
        "invalid data context",
      );
      assertEquals(called, false);
    });

    it("rejects data-context accessors without invoking them", async () => {
      const fetcher = new DataFetcher();
      let reads = 0;
      const context = Object.defineProperty(
        {
          query: new URLSearchParams(),
          request: new Request("http://localhost/test"),
          url: new URL("http://localhost/test"),
        },
        "params",
        {
          enumerable: true,
          get() {
            reads++;
            return {};
          },
        },
      ) as DataContext;

      await assertRejects(
        () =>
          fetcher.fetchData(
            { default: () => null, getServerData: () => ({ props: {} }) },
            context,
          ),
        Error,
        "invalid data context",
      );
      assertEquals(reads, 0);
    });

    it("snapshots mutable server context before invoking a loader", async () => {
      const fetcher = new DataFetcher();
      const context = createContext({
        query: new URLSearchParams("sort=original"),
        request: new Request("http://localhost/original", {
          headers: { "x-state": "original" },
        }),
        url: new URL("http://localhost/original?sort=original"),
      });
      let markStarted!: () => void;
      let releaseLoader!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const canFinish = new Promise<void>((resolve) => {
        releaseLoader = resolve;
      });
      const page: PageWithData = {
        default: () => null,
        getServerData: async (loaderContext) => {
          markStarted();
          await canFinish;
          return {
            props: {
              sort: loaderContext.query.get("sort"),
              pathname: loaderContext.url.pathname,
              header: loaderContext.request.headers.get("x-state"),
            },
          };
        },
      };

      const pending = fetcher.fetchData(page, context);
      await started;
      context.query.set("sort", "mutated");
      context.url.pathname = "/mutated";
      context.request.headers.set("x-state", "mutated");
      releaseLoader();

      assertEquals(getProps(await pending), {
        sort: "original",
        pathname: "/original",
        header: "original",
      });
    });

    it("gives concurrent server loaders independent request bodies", async () => {
      const fetcher = new DataFetcher();
      const context = createContext({
        request: new Request("http://localhost/submit", {
          method: "POST",
          body: "shared payload",
        }),
        url: new URL("http://localhost/submit"),
      });
      const page: PageWithData = {
        default: () => null,
        getServerData: async (loaderContext) => ({
          props: { body: await loaderContext.request.text() },
        }),
      };

      const [first, second] = await Promise.all([
        fetcher.fetchData(page, context),
        fetcher.fetchData(page, context),
      ]);

      assertEquals(getProps(first), { body: "shared payload" });
      assertEquals(getProps(second), { body: "shared payload" });
    });

    it("rejects incomplete isolation options instead of running in process", async () => {
      const fetcher = new DataFetcher();
      let called = false;
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          called = true;
          return { props: {} };
        },
      };

      await assertRejects(
        () =>
          fetcher.fetchData(pageModule, createContext(), "development", {
            modulePath: "/project/page.ts",
          }),
        Error,
        "modulePath and projectDir",
      );
      assertEquals(called, false);
    });

    it("rejects relative isolation paths instead of resolving against process state", async () => {
      const fetcher = new DataFetcher();
      let called = false;
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          called = true;
          return { props: {} };
        },
      };

      await assertRejects(
        () =>
          fetcher.fetchData(pageModule, createContext(), "development", {
            modulePath: "pages/index.ts",
            projectDir: ".",
          }),
        Error,
        "absolute",
      );
      assertEquals(called, false);
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

    it("isolates cached static data by page module", async () => {
      await runWithCacheKeyContext(
        { projectId: "project-a", mode: "production", versionId: "release-a" },
        async () => {
          const fetcher = new DataFetcher();
          const context = createContext({ url: new URL("http://localhost/shared") });
          let firstCalls = 0;
          let secondCalls = 0;
          const first: PageWithData = {
            default: () => null,
            getStaticData: () => ({ props: { source: "first", calls: ++firstCalls } }),
          };
          const second: PageWithData = {
            default: () => null,
            getStaticData: () => ({ props: { source: "second", calls: ++secondCalls } }),
          };

          assertEquals(
            getProps<{ source: string }>(
              await fetcher.fetchData(first, context, "production"),
            ).source,
            "first",
          );
          assertEquals(
            getProps<{ source: string }>(
              await fetcher.fetchData(second, context, "production"),
            ).source,
            "second",
          );
          await fetcher.fetchData(first, context, "production");
          await fetcher.fetchData(second, context, "production");

          assertEquals(firstCalls, 1);
          assertEquals(secondCalls, 1);
        },
      );
    });

    it("coalesces concurrent static cache misses", async () => {
      await runWithCacheKeyContext(
        { projectId: "project-a", mode: "production", versionId: "release-a" },
        async () => {
          const fetcher = new DataFetcher();
          const context = createContext({ url: new URL("http://localhost/concurrent") });
          let calls = 0;
          let resolveResult!: (result: DataResult) => void;
          const resultPromise = new Promise<DataResult>((resolve) => {
            resolveResult = resolve;
          });
          const page: PageWithData = {
            default: () => null,
            getStaticData: () => {
              calls++;
              return resultPromise;
            },
          };

          const first = fetcher.fetchData(page, context, "production");
          const second = fetcher.fetchData(page, context, "production");
          await new Promise((resolve) => setTimeout(resolve, 0));

          assertEquals(calls, 1);
          resolveResult({ props: { value: { state: "shared" } } });
          const firstResult = await first;
          const secondResult = await second;
          assertEquals(firstResult, { props: { value: { state: "shared" } } });
          assertEquals(secondResult, { props: { value: { state: "shared" } } });

          const firstValue = getProps<{ value: { state: string } }>(firstResult);
          const secondValue = getProps<{ value: { state: string } }>(secondResult);
          firstValue.value.state = "mutated";
          assertEquals(secondValue.value.state, "shared");
        },
      );
    });

    it("does not expose mutable references owned by the static cache", async () => {
      await runWithCacheKeyContext(
        { projectId: "project-a", mode: "production", versionId: "release-a" },
        async () => {
          const fetcher = new DataFetcher();
          const context = createContext({ url: new URL("http://localhost/immutable") });
          let calls = 0;
          const page: PageWithData = {
            default: () => null,
            getStaticData: () => ({
              props: { nested: { value: "original" }, calls: ++calls },
            }),
          };

          const first = getProps<{ nested: { value: string } }>(
            await fetcher.fetchData(page, context, "production"),
          );
          first.nested.value = "mutated";

          const second = getProps<{ nested: { value: string }; calls: number }>(
            await fetcher.fetchData(page, context, "production"),
          );
          assertEquals(second.nested.value, "original");
          assertEquals(second.calls, 1);
        },
      );
    });

    it("uses one cache entry for equivalent route params", async () => {
      await runWithCacheKeyContext(
        { projectId: "project-a", mode: "production", versionId: "release-a" },
        async () => {
          const fetcher = new DataFetcher();
          let calls = 0;
          const page: PageWithData = {
            default: () => null,
            getStaticData: () => ({ props: { calls: ++calls } }),
          };
          const firstContext = createContext({
            params: { category: "news", id: "42" },
            url: new URL("http://localhost/posts/42"),
          });
          const secondContext = createContext({
            params: { id: "42", category: "news" },
            url: new URL("http://localhost/posts/42"),
          });

          await fetcher.fetchData(page, firstContext, "production");
          await fetcher.fetchData(page, secondContext, "production");

          assertEquals(calls, 1);
        },
      );
    });

    it("isolates static data when the request origin changes", async () => {
      await runWithCacheKeyContext(
        { projectId: "project-a", mode: "production", versionId: "release-a" },
        async () => {
          const fetcher = new DataFetcher();
          let calls = 0;
          const page: PageWithData = {
            default: () => null,
            getStaticData: (context) => ({
              props: { origin: context.url.origin, calls: ++calls },
            }),
          };

          const first = await fetcher.fetchData(
            page,
            createContext({ url: new URL("https://first.example/page") }),
            "production",
          );
          const second = await fetcher.fetchData(
            page,
            createContext({ url: new URL("https://second.example/page") }),
            "production",
          );

          assertEquals(getProps(first), {
            origin: "https://first.example",
            calls: 1,
          });
          assertEquals(getProps(second), {
            origin: "https://second.example",
            calls: 2,
          });
        },
      );
    });

    it("does not expose request query or caller-owned context state to static loaders", async () => {
      const fetcher = new DataFetcher();
      const context = createContext({
        params: { id: "original" },
        url: new URL("http://localhost/posts/original?token=private#fragment"),
      });
      let releaseLoader!: () => void;
      const loaderCanFinish = new Promise<void>((resolve) => {
        releaseLoader = resolve;
      });
      const page: PageWithData = {
        default: () => null,
        getStaticData: async (staticContext) => {
          await loaderCanFinish;
          return {
            props: {
              id: staticContext.params.id,
              pathname: staticContext.url.pathname,
              search: staticContext.url.search,
              hash: staticContext.url.hash,
            },
          };
        },
      };

      const pending = fetcher.fetchData(page, context, "production");
      context.params.id = "mutated";
      context.url.pathname = "/mutated";
      context.url.search = "?token=changed";
      releaseLoader();

      assertEquals(getProps(await pending), {
        id: "original",
        pathname: "/posts/original",
        search: "",
        hash: "",
      });
    });

    it("does not let an in-flight static fetch undo a full cache clear", async () => {
      await runWithCacheKeyContext(
        { projectId: "project-a", mode: "production", versionId: "release-a" },
        async () => {
          const fetcher = new DataFetcher();
          const context = createContext({ url: new URL("http://localhost/in-flight") });
          let calls = 0;
          let resolveFirst!: (result: DataResult) => void;
          let markFirstStarted!: () => void;
          const firstResult = new Promise<DataResult>((resolve) => {
            resolveFirst = resolve;
          });
          const firstStarted = new Promise<void>((resolve) => {
            markFirstStarted = resolve;
          });
          const page: PageWithData = {
            default: () => null,
            getStaticData: () => {
              calls++;
              if (calls === 1) markFirstStarted();
              return calls === 1 ? firstResult : { props: { version: calls } };
            },
          };

          const pending = fetcher.fetchData(page, context, "production");
          await firstStarted;
          assertEquals(calls, 1);
          fetcher.clearCache();
          resolveFirst({ props: { version: 1 } });
          assertEquals(getProps(await pending), { version: 1 });

          assertEquals(
            getProps(await fetcher.fetchData(page, context, "production")),
            { version: 2 },
          );
          assertEquals(calls, 2);
        },
      );
    });

    it("does not let an in-flight static fetch undo a patterned cache clear", async () => {
      await runWithCacheKeyContext(
        { projectId: "project-a", mode: "production", versionId: "release-a" },
        async () => {
          const fetcher = new DataFetcher();
          const context = createContext({ url: new URL("http://localhost/target-page") });
          let calls = 0;
          let resolveFirst!: (result: DataResult) => void;
          let markFirstStarted!: () => void;
          const firstResult = new Promise<DataResult>((resolve) => {
            resolveFirst = resolve;
          });
          const firstStarted = new Promise<void>((resolve) => {
            markFirstStarted = resolve;
          });
          const page: PageWithData = {
            default: () => null,
            getStaticData: () => {
              calls++;
              if (calls === 1) markFirstStarted();
              return calls === 1 ? firstResult : { props: { version: calls } };
            },
          };

          const pending = fetcher.fetchData(page, context, "production");
          await firstStarted;
          assertEquals(calls, 1);
          fetcher.clearCache("target-page");
          resolveFirst({ props: { version: 1 } });
          await pending;

          assertEquals(
            getProps(await fetcher.fetchData(page, context, "production")),
            { version: 2 },
          );
          assertEquals(calls, 2);
        },
      );
    });

    it("does not let background revalidation restore a cleared entry", async () => {
      await runWithCacheKeyContext(
        { projectId: "project-a", mode: "production", versionId: "release-a" },
        async () => {
          const fetcher = new DataFetcher();
          const context = createContext({
            url: new URL("http://localhost/revalidate-page"),
          });
          let calls = 0;
          let resolveRevalidation!: (result: DataResult) => void;
          let markRevalidationStarted!: () => void;
          const revalidationResult = new Promise<DataResult>((resolve) => {
            resolveRevalidation = resolve;
          });
          const revalidationStarted = new Promise<void>((resolve) => {
            markRevalidationStarted = resolve;
          });
          const page: PageWithData = {
            default: () => null,
            getStaticData: () => {
              calls++;
              if (calls === 1) {
                return { props: { version: 1 }, revalidate: -1 };
              }
              if (calls === 2) {
                markRevalidationStarted();
                return revalidationResult;
              }
              return { props: { version: calls }, revalidate: false };
            },
          };

          assertEquals(
            getProps(await fetcher.fetchData(page, context, "production")),
            { version: 1 },
          );
          assertEquals(
            getProps(await fetcher.fetchData(page, context, "production")),
            { version: 1 },
          );
          await revalidationStarted;

          fetcher.clearCache("revalidate-page");
          assertEquals(
            getProps(await fetcher.fetchData(page, context, "production")),
            { version: 3 },
          );

          resolveRevalidation({ props: { version: 2 }, revalidate: false });
          await Promise.resolve();
          await Promise.resolve();
          assertEquals(
            getProps(await fetcher.fetchData(page, context, "production")),
            { version: 3 },
          );
          assertEquals(calls, 3);
        },
      );
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

    it("rejects invalid cache clear patterns", () => {
      const fetcher = new DataFetcher();
      assertThrows(
        () => fetcher.clearCache(42 as unknown as string),
        Error,
        "pattern",
      );
      assertThrows(
        () => fetcher.clearCache("x".repeat(4_097)),
        Error,
        "pattern",
      );
    });
  });

  describe("destroy", () => {
    it("releases resources and prevents reuse", async () => {
      const fetcher = new DataFetcher();
      fetcher.destroy();
      fetcher.destroy();

      await assertRejects(
        () =>
          fetcher.fetchData(
            { default: () => null },
            createContext(),
          ),
        Error,
        "destroyed",
      );
      await assertRejects(
        () => fetcher.getStaticPaths({ default: () => null }),
        Error,
        "destroyed",
      );
      assertThrows(() => fetcher.clearCache(), Error, "destroyed");
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
