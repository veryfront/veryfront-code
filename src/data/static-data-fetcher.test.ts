import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { CacheManager } from "./data-fetching-cache.ts";
import { StaticDataFetcher } from "./static-data-fetcher.ts";
import type { DataContext, PageWithData } from "./types.ts";
import { notFound, redirect } from "./helpers.ts";

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
  });

  describe("background revalidation", () => {
    async function settleRevalidation(): Promise<void> {
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }

    // A background revalidation must never replace a live page with a control
    // result. The entry would be stored with `revalidate: undefined`, which
    // never qualifies for revalidation again, so every request served a 404
    // until the entry aged out of the cache.
    it("keeps the cached page when a revalidation throws notFound()", async () => {
      await withProductionContext(async () => {
        const { cache, fetcher } = createFetcher();

        const pageModule: PageWithData<{ version: number }> = {
          default: () => null,
          getStaticData: () => {
            throw notFound();
          },
        };

        const context = createContext({ url: new URL("http://localhost/isr-not-found") });
        const cacheKey = cache.createCacheKey(context);
        assertExists(cacheKey);

        cache.set(cacheKey, {
          data: { props: { version: 1 }, revalidate: 0 },
          timestamp: Date.now() - 10_000,
          revalidate: 0,
        });

        const served = await fetcher.fetch(pageModule, context);
        assertEquals((served.props as { version: number }).version, 1);

        await settleRevalidation();

        const entry = cache.get(cacheKey);
        assertExists(entry);
        assertEquals((entry.data.props as { version: number }).version, 1);
        assertEquals(entry.data.notFound, undefined);
        // Still a number, so the entry stays eligible for the next revalidation.
        assertEquals(entry.revalidate, 0);

        const next = await fetcher.fetch(pageModule, context);
        assertEquals((next.props as { version: number }).version, 1);
        assertEquals(next.notFound, undefined);
      });
    });

    it("keeps the cached page when a revalidation throws redirect()", async () => {
      await withProductionContext(async () => {
        const { cache, fetcher } = createFetcher();

        const pageModule: PageWithData<{ version: number }> = {
          default: () => null,
          getStaticData: () => {
            throw redirect("/login");
          },
        };

        const context = createContext({ url: new URL("http://localhost/isr-redirect") });
        const cacheKey = cache.createCacheKey(context);
        assertExists(cacheKey);

        cache.set(cacheKey, {
          data: { props: { version: 1 }, revalidate: 0 },
          timestamp: Date.now() - 10_000,
          revalidate: 0,
        });

        await fetcher.fetch(pageModule, context);
        await settleRevalidation();

        const entry = cache.get(cacheKey);
        assertExists(entry);
        assertEquals((entry.data.props as { version: number }).version, 1);
        assertEquals(entry.data.redirect, undefined);
        assertEquals(entry.revalidate, 0);
      });
    });

    it("still replaces the cached page on a successful revalidation", async () => {
      await withProductionContext(async () => {
        const { cache, fetcher } = createFetcher();

        const pageModule: PageWithData<{ version: number }> = {
          default: () => null,
          getStaticData: () => ({ props: { version: 2 }, revalidate: 60 }),
        };

        const context = createContext({ url: new URL("http://localhost/isr-success") });
        const cacheKey = cache.createCacheKey(context);
        assertExists(cacheKey);

        cache.set(cacheKey, {
          data: { props: { version: 1 }, revalidate: 0 },
          timestamp: Date.now() - 10_000,
          revalidate: 0,
        });

        await fetcher.fetch(pageModule, context);
        await settleRevalidation();

        const entry = cache.get(cacheKey);
        assertExists(entry);
        assertEquals((entry.data.props as { version: number }).version, 2);
        assertEquals(entry.revalidate, 60);
      });
    });
  });

  describe("thrown control results", () => {
    function throwing(error: unknown): PageWithData {
      return {
        default: () => null,
        getStaticData: () => {
          throw error;
        },
      };
    }

    it("treats a thrown notFound() as a 404 result without a cache context", async () => {
      const { fetcher } = createFetcher();
      const result = await fetcher.fetch(throwing(notFound()), createContext());

      assertEquals(result.notFound, true);
    });

    // Regression: only the no-cache path handled this, so `throw notFound()`
    // still returned a 500 in production, where a cache key always exists.
    it("treats a thrown notFound() as a 404 result with a production cache context", async () => {
      const { fetcher } = createFetcher();

      const result = await withProductionContext(() =>
        fetcher.fetch(throwing(notFound()), createContext())
      );

      assertEquals(result.notFound, true);
    });

    it("treats a thrown redirect() as a redirect without a cache context", async () => {
      const { fetcher } = createFetcher();

      const result = await fetcher.fetch(throwing(redirect("/login")), createContext());

      assertEquals(result.redirect?.destination, "/login");
      assertEquals(result.redirect?.permanent, false);
    });

    it("treats a thrown redirect() as a redirect with a production cache context", async () => {
      const { fetcher } = createFetcher();

      const result = await withProductionContext(() =>
        fetcher.fetch(throwing(redirect("/login", true)), createContext())
      );

      assertEquals(result.redirect?.destination, "/login");
      assertEquals(result.redirect?.permanent, true);
    });

    it("still propagates a genuine Error", async () => {
      const { fetcher } = createFetcher();

      await assertRejects(
        () =>
          withProductionContext(() =>
            fetcher.fetch(
              throwing(new Error("intentional test error from getStaticData")),
              createContext(),
            )
          ),
        Error,
        "intentional test error from getStaticData",
      );
    });

    // The cached path runs inside a circuit breaker, so a 404 that counted as a
    // failure would take the whole project's static data down after five.
    it("does not open the circuit breaker on repeated 404s", async () => {
      const { fetcher } = createFetcher();

      for (let i = 0; i < 6; i++) {
        // A distinct path each time, so every call is a cache miss and runs
        // the handler rather than replaying a cached 404.
        const context = createContext({
          url: new URL(`http://localhost/missing-${i}`),
          request: new Request(`http://localhost/missing-${i}`, {
            headers: { "x-project-id": "static-repeated-not-found" },
          }),
        });

        const result = await withProductionContext(() =>
          fetcher.fetch(throwing(notFound()), context)
        );

        assertEquals(result.notFound, true, `call ${i + 1} should still reach getStaticData`);
      }
    });
  });
});
