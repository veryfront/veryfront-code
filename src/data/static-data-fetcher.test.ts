import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { CacheManager } from "./data-fetching-cache.ts";
import { StaticDataFetcher } from "./static-data-fetcher.ts";
import type { DataContext, PageWithData } from "./types.ts";
import { REVALIDATION_PER_PROJECT_LIMIT } from "#veryfront/utils/constants/cache.ts";

function withProductionContext<T>(fn: () => T): T {
  return runWithCacheKeyContext(
    { projectId: "test-project", mode: "production", versionId: "rel_123" },
    fn,
  );
}

function createContext(overrides: Partial<DataContext> = {}): DataContext {
  return {
    params: {},
    query: new URLSearchParams(),
    request: new Request("http://localhost/test"),
    url: new URL("http://localhost/test"),
    ...overrides,
  };
}

function createFetcher(): { cache: CacheManager; fetcher: StaticDataFetcher } {
  const cache = new CacheManager();
  const fetcher = new StaticDataFetcher(cache);
  return { cache, fetcher };
}

describe("StaticDataFetcher", () => {
  describe("constructor", () => {
    it("should create instance with cache manager", () => {
      const { fetcher } = createFetcher();
      assertExists(fetcher);
    });

    it("should create instance with cache manager only", () => {
      const cache = new CacheManager();
      const fetcher = new StaticDataFetcher(cache);
      assertExists(fetcher);
    });
  });

  describe("fetch", () => {
    it("should return empty props when getStaticData is not defined", async () => {
      const { fetcher } = createFetcher();
      const pageModule: PageWithData = { default: () => null };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.props, {});
    });

    it("should call getStaticData with params and url", async () => {
      const { fetcher } = createFetcher();
      let receivedParams: Record<string, string | string[]> | undefined;
      let receivedUrl: URL | undefined;

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: (ctx) => {
          receivedParams = ctx.params;
          receivedUrl = ctx.url;
          return { props: {} };
        },
      };

      const context = createContext({
        params: { id: "123" },
        url: new URL("http://localhost/posts/123"),
      });

      await fetcher.fetch(pageModule, context);

      assertExists(receivedParams);
      assertEquals(receivedParams.id, "123");
      assertExists(receivedUrl);
      assertEquals(receivedUrl.pathname, "/posts/123");
    });

    it("should NOT pass request or query to getStaticData", async () => {
      const { fetcher } = createFetcher();
      let receivedContext:
        | { params?: unknown; url?: unknown; request?: unknown; query?: unknown }
        | undefined;

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: (ctx) => {
          receivedContext = ctx;
          return { props: {} };
        },
      };

      await fetcher.fetch(pageModule, createContext());

      assertExists(receivedContext);
      assertEquals(receivedContext.request, undefined);
      assertEquals(receivedContext.query, undefined);
    });

    it("should return props from getStaticData", async () => {
      const { fetcher } = createFetcher();
      const pageModule: PageWithData<{ title: string }> = {
        default: () => null,
        getStaticData: () => ({ props: { title: "Static Title" } }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals((result.props as { title: string }).title, "Static Title");
    });

    it("should cache result after fetch in production mode", async () => {
      await withProductionContext(async () => {
        const { fetcher } = createFetcher();
        let callCount = 0;

        const pageModule: PageWithData<{ count: number }> = {
          default: () => null,
          getStaticData: () => {
            callCount++;
            return { props: { count: callCount } };
          },
        };

        const context = createContext({ url: new URL("http://localhost/cached-page") });

        const result1 = await fetcher.fetch(pageModule, context);
        assertEquals((result1.props as { count: number }).count, 1);

        const result2 = await fetcher.fetch(pageModule, context);
        assertEquals((result2.props as { count: number }).count, 1);
        assertEquals(callCount, 1);
      });
    });

    it("should create unique cache keys per path in production mode", async () => {
      await withProductionContext(async () => {
        const { fetcher } = createFetcher();
        let callCount = 0;

        const pageModule: PageWithData = {
          default: () => null,
          getStaticData: (ctx) => {
            callCount++;
            return { props: { path: ctx.url.pathname } };
          },
        };

        const context1 = createContext({
          params: { id: "1" },
          url: new URL("http://localhost/posts/1"),
        });
        const context2 = createContext({
          params: { id: "2" },
          url: new URL("http://localhost/posts/2"),
        });

        await fetcher.fetch(pageModule, context1);
        await fetcher.fetch(pageModule, context2);

        assertEquals(callCount, 2);
      });
    });

    it("should handle redirect result", async () => {
      const { fetcher } = createFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: () => ({ redirect: { destination: "/moved", permanent: true } }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.redirect?.destination, "/moved");
      assertEquals(result.redirect?.permanent, true);
    });

    it("normalizes static result precedence and nullish props", async () => {
      const cache = new CacheManager();
      const fetcher = new StaticDataFetcher(cache);
      const context = createContext();

      const redirectResult = await fetcher.fetch(
        {
          default: () => null,
          getStaticData: () => ({
            props: { ignored: true },
            redirect: { destination: "/moved" },
            notFound: true,
          }),
        },
        context,
      );
      assertEquals(redirectResult, { redirect: { destination: "/moved" } });

      const propsResult = await fetcher.fetch(
        {
          default: () => null,
          getStaticData: () => ({
            props: null as unknown as Record<string, unknown>,
          }),
        },
        context,
      );
      assertEquals(propsResult, { props: {} });
    });

    it("should handle notFound result", async () => {
      const { fetcher } = createFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: () => ({ notFound: true }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.notFound, true);
    });

    it("should throw when getStaticData throws", async () => {
      const { fetcher } = createFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: () => {
          throw new Error("CMS API failed");
        },
      };

      await assertRejects(
        () => fetcher.fetch(pageModule, createContext()),
        Error,
        "CMS API failed",
      );
    });

    it("should support synchronous getStaticData", async () => {
      const { fetcher } = createFetcher();
      const pageModule: PageWithData<{ sync: boolean }> = {
        default: () => null,
        getStaticData: () => ({ props: { sync: true } }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals((result.props as { sync: boolean }).sync, true);
    });

    it("rejects invalid static data without caching it", async () => {
      await withProductionContext(async () => {
        const { fetcher } = createFetcher();
        let calls = 0;
        const pageModule: PageWithData = {
          default: () => null,
          getStaticData: () => {
            calls++;
            return { props: {}, revalidate: Number.NaN };
          },
        };
        const context = createContext({ url: new URL("http://localhost/invalid-static") });

        await assertRejects(
          () => fetcher.fetch(pageModule, context),
          Error,
          "invalid data result",
        );
        await assertRejects(
          () => fetcher.fetch(pageModule, context),
          Error,
          "invalid data result",
        );
        assertEquals(calls, 2);
      });
    });

    it("should cache with revalidate time in production mode", async () => {
      await withProductionContext(async () => {
        const { cache, fetcher } = createFetcher();
        const pageModule: PageWithData = {
          default: () => null,
          getStaticData: () => ({ props: { data: "cached" }, revalidate: 60 }),
        };

        const context = createContext({ url: new URL("http://localhost/isr-page") });

        await fetcher.fetch(pageModule, context);

        const cacheKey = cache.createCacheKey(context);
        assertExists(cacheKey);

        const entry = cache.get(cacheKey);
        assertExists(entry);
        assertEquals(entry.revalidate, 60);
      });
    });

    it("should not cache in preview mode", async () => {
      await runWithCacheKeyContext(
        { projectId: "test", mode: "preview", versionId: "main" },
        async () => {
          const { fetcher } = createFetcher();
          let callCount = 0;

          const pageModule: PageWithData<{ count: number }> = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return { props: { count: callCount } };
            },
          };

          const context = createContext({ url: new URL("http://localhost/preview-page") });

          const result1 = await fetcher.fetch(pageModule, context);
          assertEquals((result1.props as { count: number }).count, 1);

          const result2 = await fetcher.fetch(pageModule, context);
          assertEquals((result2.props as { count: number }).count, 2);
          assertEquals(callCount, 2);
        },
      );
    });

    it("should return cached data when fresh in production mode", async () => {
      await withProductionContext(async () => {
        const { fetcher } = createFetcher();
        let callCount = 0;

        const pageModule: PageWithData<{ version: number }> = {
          default: () => null,
          getStaticData: () => {
            callCount++;
            return { props: { version: callCount }, revalidate: 3600 };
          },
        };

        const context = createContext({ url: new URL("http://localhost/fresh-page") });

        const result1 = await fetcher.fetch(pageModule, context);
        assertEquals((result1.props as { version: number }).version, 1);

        const result2 = await fetcher.fetch(pageModule, context);
        assertEquals((result2.props as { version: number }).version, 1);
        assertEquals(callCount, 1);
      });
    });

    it("should trigger only one background revalidation for the same stale cache entry", async () => {
      await withProductionContext(async () => {
        const { cache, fetcher } = createFetcher();
        let callCount = 0;
        let resolveRevalidation!: (
          result: { props: { version: number }; revalidate: number },
        ) => void;

        const revalidationResult = new Promise<{ props: { version: number }; revalidate: number }>(
          (resolve) => {
            resolveRevalidation = resolve;
          },
        );

        const pageModule: PageWithData<{ version: number }> = {
          default: () => null,
          getStaticData: () => {
            callCount++;
            return revalidationResult;
          },
        };

        const context = createContext({ url: new URL("http://localhost/stale-page") });
        const cacheKey = cache.createCacheKey(context);
        assertExists(cacheKey);

        cache.set(cacheKey, {
          data: { props: { version: 1 }, revalidate: 0 },
          timestamp: Date.now() - 10_000,
          revalidate: 0,
        });

        const firstResult = await fetcher.fetch(pageModule, context);
        const secondResult = await fetcher.fetch(pageModule, context);

        assertEquals((firstResult.props as { version: number }).version, 1);
        assertEquals((secondResult.props as { version: number }).version, 1);
        assertEquals(callCount, 1);

        resolveRevalidation({ props: { version: 2 }, revalidate: 60 });
        await new Promise((resolve) => setTimeout(resolve, 0));

        const refreshedEntry = cache.get(cacheKey);
        assertExists(refreshedEntry);
        assertEquals((refreshedEntry.data.props as { version: number }).version, 2);
      });
    });

    it("retries a stale entry after per-project revalidation contention", async () => {
      if (REVALIDATION_PER_PROJECT_LIMIT <= 0) return;

      await runWithCacheKeyContext(
        { projectId: "contention-project", mode: "production", versionId: "release-a" },
        async () => {
          const { cache, fetcher } = createFetcher();
          const releaseBlockers: Array<() => void> = [];
          const blockerPages: PageWithData[] = [];
          const blockerContexts: DataContext[] = [];

          for (let index = 0; index < REVALIDATION_PER_PROJECT_LIMIT; index++) {
            let release!: () => void;
            const blocker = new Promise<void>((resolve) => {
              release = resolve;
            });
            releaseBlockers.push(release);
            blockerPages.push({
              default: () => null,
              getStaticData: async () => {
                await blocker;
                return { props: { refreshed: true }, revalidate: 60 };
              },
            });
            blockerContexts.push(
              createContext({ url: new URL(`http://localhost/busy-${index}`) }),
            );
          }

          const targetContext = createContext({ url: new URL("http://localhost/target") });
          let targetCalls = 0;
          const targetPage: PageWithData = {
            default: () => null,
            getStaticData: () => {
              targetCalls++;
              return { props: { refreshed: true }, revalidate: 60 };
            },
          };

          for (const context of [...blockerContexts, targetContext]) {
            const cacheKey = cache.createCacheKey(context);
            assertExists(cacheKey);
            cache.set(cacheKey, {
              data: { props: { stale: true }, revalidate: 0 },
              timestamp: Date.now() - 10_000,
              revalidate: 0,
            });
          }

          try {
            await Promise.all(
              blockerPages.map((page, index) => fetcher.fetch(page, blockerContexts[index]!)),
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
            await fetcher.fetch(targetPage, targetContext);
            await new Promise((resolve) => setTimeout(resolve, 0));
            assertEquals(targetCalls, 0);
          } finally {
            for (const release of releaseBlockers) release();
          }

          await new Promise((resolve) => setTimeout(resolve, 0));
          await fetcher.fetch(targetPage, targetContext);
          await new Promise((resolve) => setTimeout(resolve, 0));
          assertEquals(targetCalls, 1);
        },
      );
    });
  });
});
