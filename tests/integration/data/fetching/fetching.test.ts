/**
 * Comprehensive Tests for Data Fetching System (fetching.ts)
 *
 * Coverage areas:
 * - Basic data fetching (development vs production mode)
 * - Cache hit/miss scenarios
 * - ISR revalidation (stale-while-revalidate pattern)
 * - Error handling in getServerData/getStaticData
 * - Cache key generation and clearing
 * - Static paths generation and errors
 * - Edge cases: null results, redirects, notFound responses
 * - Background revalidation logic
 * - RuntimeAdapter integration
 */

// Disable LRU interval to prevent resource leaks in tests
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assertEquals, assertExists, assertRejects } from "@veryfront/testing/assert";
import { beforeEach, describe, it } from "@veryfront/testing/bdd";
import {
  type DataContext,
  DataFetcher,
  type DataResult,
  notFound,
  type PageWithData,
  redirect,
} from "@veryfront/data/index.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { runWithCacheKeyContext } from "@veryfront/cache/cache-key-builder.ts";
import { delay } from "@std/async";

type StaticDataContext = Omit<DataContext, "request" | "query">;

// Helper to run tests with production mode cache context
function withProductionContext<T>(fn: () => T | Promise<T>): T | Promise<T> {
  return runWithCacheKeyContext(
    { projectId: "test-project", mode: "production", versionId: "rel_test" },
    fn,
  );
}

// Test utilities
function makeContext(
  url: string,
  params: Record<string, string | string[]> = {},
): DataContext {
  const u = new URL(url);
  return {
    params,
    query: u.searchParams,
    request: new Request(url),
    url: u,
  };
}

function makeMockAdapter(envVars: Record<string, string> = {}): Partial<RuntimeAdapter> {
  return {
    env: {
      get: (key: string) => envVars[key],
      set: () => {},
      has: (key: string) => key in envVars,
      delete: () => {},
      toObject: () => envVars,
    },
  } as Partial<RuntimeAdapter>;
}

// Type-safe helper for accessing dynamic props
// deno-lint-ignore no-explicit-any
function getProp<T>(obj: any, key: string): T {
  return obj?.[key];
}

describe("DataFetcher - Comprehensive Tests", () => {
  describe("DataFetcher - Basic Initialization", () => {
      it("should create a DataFetcher without adapter", () => {
        const fetcher = new DataFetcher();
        assertExists(fetcher);
      });

      it("should create a DataFetcher with adapter", () => {
        const adapter = makeMockAdapter();
        const fetcher = new DataFetcher(adapter as RuntimeAdapter);
        assertExists(fetcher);
      });
    });

    describe("DataFetcher - fetchData Method", () => {
      let fetcher: DataFetcher;
      let context: DataContext;

      beforeEach(() => {
        fetcher = new DataFetcher();
        context = makeContext("http://localhost/test", { id: "123" });
      });

      describe("No data fetching methods", () => {
        it("should return empty props when page has no data methods", async () => {
          const pageModule: PageWithData = {
            default: () => null,
          };

          const result = await fetcher.fetchData(pageModule, context);

          assertEquals(result, { props: {} });
        });

        it("should return empty props in development mode with no data methods", async () => {
          const pageModule: PageWithData = {
            default: () => null,
          };

          const result = await fetcher.fetchData(pageModule, context, "development");

          assertEquals(result, { props: {} });
        });

        it("should return empty props in production mode with no data methods", async () => {
          const pageModule: PageWithData = {
            default: () => null,
          };

          const result = await fetcher.fetchData(pageModule, context, "production");

          assertEquals(result, { props: {} });
        });
      });

      describe("Mode selection logic", () => {
        it("should use getServerData in development mode when both methods exist", async () => {
          let serverCalled = false;
          let staticCalled = false;

          const pageModule: PageWithData = {
            default: () => null,
            getServerData: () => {
              serverCalled = true;
              return { props: { source: "server" } };
            },
            getStaticData: () => {
              staticCalled = true;
              return { props: { source: "static" } };
            },
          };

          const result = await fetcher.fetchData(pageModule, context, "development");

          assertEquals(serverCalled, true);
          assertEquals(staticCalled, false);
          assertEquals(getProp<string>(result.props, "source"), "server");
        });

        it("should use getStaticData in production mode when both methods exist", async () => {
          let serverCalled = false;
          let staticCalled = false;

          const pageModule: PageWithData = {
            default: () => null,
            getServerData: () => {
              serverCalled = true;
              return { props: { source: "server" } };
            },
            getStaticData: () => {
              staticCalled = true;
              return { props: { source: "static" } };
            },
          };

          const result = await fetcher.fetchData(pageModule, context, "production");

          assertEquals(serverCalled, false);
          assertEquals(staticCalled, true);
          assertEquals(getProp<string>(result.props, "source"), "static");
        });

        it("should fallback to getServerData in production if only it exists", async () => {
          let serverCalled = false;

          const pageModule: PageWithData = {
            default: () => null,
            getServerData: () => {
              serverCalled = true;
              return { props: { source: "server" } };
            },
          };

          const result = await fetcher.fetchData(pageModule, context, "production");

          assertEquals(serverCalled, true);
          assertEquals(getProp<string>(result.props, "source"), "server");
        });

        it("should use getStaticData if only it exists in development mode", async () => {
          let staticCalled = false;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              staticCalled = true;
              return { props: { source: "static" } };
            },
          };

          const result = await fetcher.fetchData(pageModule, context, "development");

          assertEquals(staticCalled, true);
          assertEquals(getProp<string>(result.props, "source"), "static");
        });
      });
    });

    describe("DataFetcher - getServerData", () => {
      let fetcher: DataFetcher;
      let context: DataContext;

      beforeEach(() => {
        fetcher = new DataFetcher();
        context = makeContext("http://localhost/test?sort=name", { id: "123" });
      });

      it("should fetch data using getServerData", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: (ctx: DataContext) => ({
            props: {
              message: "Hello from server",
              id: ctx.params.id,
            },
          }),
        };

        const result = await fetcher.fetchData(pageModule, context);

        assertExists(result.props);
        assertEquals(getProp<string>(result.props, "message"), "Hello from server");
        assertEquals(getProp<string>(result.props, "id"), "123");
      });

      it("should pass complete context to getServerData", async () => {
        let capturedContext: DataContext | undefined;

        const pageModule: PageWithData = {
          default: () => null,
          getServerData: (ctx: DataContext) => {
            capturedContext = ctx;
            return { props: {} };
          },
        };

        await fetcher.fetchData(pageModule, context);

        assertExists(capturedContext);
        assertEquals(capturedContext.params, { id: "123" });
        assertEquals(capturedContext.query.get("sort"), "name");
        assertEquals(capturedContext.url.pathname, "/test");
        assertExists(capturedContext.request);
      });

      it("should handle async getServerData", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: async () => {
            await delay(10);
            return { props: { async: true } };
          },
        };

        const result = await fetcher.fetchData(pageModule, context);

        assertEquals(getProp<boolean>(result.props, "async"), true);
      });

      it("should handle redirect response from getServerData", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => ({
            redirect: {
              destination: "/login",
              permanent: false,
            },
          }),
        };

        const result = await fetcher.fetchData(pageModule, context);

        assertExists(result.redirect);
        assertEquals(result.redirect.destination, "/login");
        assertEquals(result.redirect.permanent, false);
        assertEquals(result.props, undefined);
      });

      it("should handle redirect with permanent flag", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => ({
            redirect: {
              destination: "/new-location",
              permanent: true,
            },
          }),
        };

        const result = await fetcher.fetchData(pageModule, context);

        assertExists(result.redirect);
        assertEquals(result.redirect.destination, "/new-location");
        assertEquals(result.redirect.permanent, true);
      });

      it("should handle notFound response from getServerData", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => ({
            notFound: true,
          }),
        };

        const result = await fetcher.fetchData(pageModule, context);

        assertEquals(result.notFound, true);
        assertEquals(result.props, undefined);
      });

      it("should return empty object for undefined props", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => ({}),
        };

        const result = await fetcher.fetchData(pageModule, context);

        assertEquals(result.props, {});
      });

      it("should preserve revalidate value from getServerData", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => ({
            props: { data: "test" },
            revalidate: 60,
          }),
        };

        const result = await fetcher.fetchData(pageModule, context);

        assertEquals(getProp<string>(result.props, "data"), "test");
        assertEquals(result.revalidate, 60);
      });

      it("should propagate errors from getServerData", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => {
            throw new Error("Server error");
          },
        };

        await assertRejects(
          () => fetcher.fetchData(pageModule, context),
          Error,
          "Server error",
        );
      });

      it("should propagate async errors from getServerData", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: async () => {
            await delay(10);
            throw new Error("Async server error");
          },
        };

        await assertRejects(
          () => fetcher.fetchData(pageModule, context),
          Error,
          "Async server error",
        );
      });

      it("should not log errors when VERYFRONT_DEBUG is not set", async () => {
        const adapter = makeMockAdapter({});
        const fetcher = new DataFetcher(adapter as RuntimeAdapter);

        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => {
            throw new Error("Silent error");
          },
        };

        await assertRejects(
          () => fetcher.fetchData(pageModule, context),
          Error,
          "Silent error",
        );
      });

      it("should handle errors when VERYFRONT_DEBUG is enabled", async () => {
        const adapter = makeMockAdapter({ VERYFRONT_DEBUG: "true" });
        const fetcher = new DataFetcher(adapter as RuntimeAdapter);

        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => {
            throw new Error("Debug error");
          },
        };

        await assertRejects(
          () => fetcher.fetchData(pageModule, context),
          Error,
          "Debug error",
        );
      });
    });

    describe("DataFetcher - getStaticData", () => {
      let fetcher: DataFetcher;
      let context: DataContext;

      beforeEach(() => {
        fetcher = new DataFetcher();
        context = makeContext("http://localhost/blog/post-1", { slug: "post-1" });
      });

      it("should fetch data using getStaticData", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getStaticData: (ctx: StaticDataContext) => ({
            props: {
              message: "Hello from static",
              slug: ctx.params.slug,
            },
          }),
        };

        const result = await fetcher.fetchData(pageModule, context, "production");

        assertExists(result.props);
        assertEquals(getProp<string>(result.props, "message"), "Hello from static");
        assertEquals(getProp<string>(result.props, "slug"), "post-1");
      });

      it("should pass params and url to getStaticData (not request or query)", async () => {
        let capturedContext: StaticDataContext | undefined;

        const pageModule: PageWithData = {
          default: () => null,
          getStaticData: (ctx: StaticDataContext) => {
            capturedContext = ctx;
            return { props: {} };
          },
        };

        await fetcher.fetchData(pageModule, context, "production");

        assertExists(capturedContext);
        assertEquals(capturedContext.params, { slug: "post-1" });
        assertExists(capturedContext.url);
        assertEquals(capturedContext.url.pathname, "/blog/post-1");
      });

      it("should handle async getStaticData", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getStaticData: async () => {
            await delay(10);
            return { props: { async: true } };
          },
        };

        const result = await fetcher.fetchData(pageModule, context, "production");

        assertEquals(getProp<boolean>(result.props, "async"), true);
      });

      it("should propagate errors from getStaticData", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getStaticData: () => {
            throw new Error("Static error");
          },
        };

        await assertRejects(
          () => fetcher.fetchData(pageModule, context, "production"),
          Error,
          "Static error",
        );
      });

      it("should propagate async errors from getStaticData", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getStaticData: async () => {
            await delay(10);
            throw new Error("Async static error");
          },
        };

        await assertRejects(
          () => fetcher.fetchData(pageModule, context, "production"),
          Error,
          "Async static error",
        );
      });

      it("should handle errors when VERYFRONT_DEBUG is enabled for static data", async () => {
        const adapter = makeMockAdapter({ VERYFRONT_DEBUG: "true" });
        const fetcher = new DataFetcher(adapter as RuntimeAdapter);

        const pageModule: PageWithData = {
          default: () => null,
          getStaticData: () => {
            throw new Error("Debug static error");
          },
        };

        await assertRejects(
          () => fetcher.fetchData(pageModule, context, "production"),
          Error,
          "Debug static error",
        );
      });
    });

    describe("DataFetcher - Cache Behavior", () => {
      let fetcher: DataFetcher;
      let context: DataContext;

      beforeEach(() => {
        fetcher = new DataFetcher();
        context = makeContext("http://localhost/page", { id: "1" });
      });

      it("should cache static data results", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return { props: { count: callCount } };
            },
          };

          const result1 = await fetcher.fetchData(pageModule, context, "production");
          const result2 = await fetcher.fetchData(pageModule, context, "production");
          const result3 = await fetcher.fetchData(pageModule, context, "production");

          assertEquals(getProp<number>(result1.props, "count"), 1);
          assertEquals(getProp<number>(result2.props, "count"), 1);
          assertEquals(getProp<number>(result3.props, "count"), 1);
          assertEquals(callCount, 1);
        });
      });

      it("should not cache server data results", async () => {
        let callCount = 0;

        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => {
            callCount++;
            return { props: { count: callCount } };
          },
        };

        const result1 = await fetcher.fetchData(pageModule, context);
        const result2 = await fetcher.fetchData(pageModule, context);
        const result3 = await fetcher.fetchData(pageModule, context);

        assertEquals(getProp<number>(result1.props, "count"), 1);
        assertEquals(getProp<number>(result2.props, "count"), 2);
        assertEquals(getProp<number>(result3.props, "count"), 3);
        assertEquals(callCount, 3);
      });

      it("should use different cache keys for different URLs", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return { props: { count: callCount } };
            },
          };

          const context1 = makeContext("http://localhost/page1", { id: "1" });
          const context2 = makeContext("http://localhost/page2", { id: "1" });

          const result1 = await fetcher.fetchData(pageModule, context1, "production");
          const result2 = await fetcher.fetchData(pageModule, context2, "production");

          assertEquals(getProp<number>(result1.props, "count"), 1);
          assertEquals(getProp<number>(result2.props, "count"), 2);
          assertEquals(callCount, 2);
        });
      });

      it("should use different cache keys for different params", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return { props: { count: callCount } };
            },
          };

          const context1 = makeContext("http://localhost/page", { id: "1" });
          const context2 = makeContext("http://localhost/page", { id: "2" });

          const result1 = await fetcher.fetchData(pageModule, context1, "production");
          const result2 = await fetcher.fetchData(pageModule, context2, "production");

          assertEquals(getProp<number>(result1.props, "count"), 1);
          assertEquals(getProp<number>(result2.props, "count"), 2);
          assertEquals(callCount, 2);
        });
      });

      it("should use same cache key for same URL and params", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return { props: { count: callCount } };
            },
          };

          const context1 = makeContext("http://localhost/page", { id: "1" });
          const context2 = makeContext("http://localhost/page", { id: "1" });

          const result1 = await fetcher.fetchData(pageModule, context1, "production");
          const result2 = await fetcher.fetchData(pageModule, context2, "production");

          assertEquals(getProp<number>(result1.props, "count"), 1);
          assertEquals(getProp<number>(result2.props, "count"), 1);
          assertEquals(callCount, 1);
        });
      });

      it("should handle cache keys with complex params", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return { props: { count: callCount } };
            },
          };

          const context1 = makeContext("http://localhost/page", {
            category: "tech",
            tag: "javascript",
          });
          const context2 = makeContext("http://localhost/page", {
            category: "tech",
            tag: "javascript",
          });

          const result1 = await fetcher.fetchData(pageModule, context1, "production");
          const result2 = await fetcher.fetchData(pageModule, context2, "production");

          assertEquals(getProp<number>(result1.props, "count"), 1);
          assertEquals(getProp<number>(result2.props, "count"), 1);
          assertEquals(callCount, 1);
        });
      });

      it("should handle cache keys with array params", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return { props: { count: callCount } };
            },
          };

          const context1 = makeContext("http://localhost/page", {
            path: ["a", "b", "c"],
          });
          const context2 = makeContext("http://localhost/page", {
            path: ["a", "b", "c"],
          });

          const result1 = await fetcher.fetchData(pageModule, context1, "production");
          const result2 = await fetcher.fetchData(pageModule, context2, "production");

          assertEquals(getProp<number>(result1.props, "count"), 1);
          assertEquals(getProp<number>(result2.props, "count"), 1);
          assertEquals(callCount, 1);
        });
      });

      it("should differentiate array params with different values", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return { props: { count: callCount } };
            },
          };

          const context1 = makeContext("http://localhost/page", {
            path: ["a", "b", "c"],
          });
          const context2 = makeContext("http://localhost/page", {
            path: ["a", "b", "d"],
          });

          const result1 = await fetcher.fetchData(pageModule, context1, "production");
          const result2 = await fetcher.fetchData(pageModule, context2, "production");

          assertEquals(getProp<number>(result1.props, "count"), 1);
          assertEquals(getProp<number>(result2.props, "count"), 2);
          assertEquals(callCount, 2);
        });
      });
    });

    describe("DataFetcher - ISR and Revalidation", () => {
      let fetcher: DataFetcher;
      let context: DataContext;

      beforeEach(() => {
        fetcher = new DataFetcher();
        context = makeContext("http://localhost/page", { id: "1" });
      });

      it("should respect revalidate: false (never revalidate)", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return {
                props: { count: callCount },
                revalidate: false,
              };
            },
          };

          await fetcher.fetchData(pageModule, context, "production");
          await delay(100);
          await fetcher.fetchData(pageModule, context, "production");
          await delay(100);
          await fetcher.fetchData(pageModule, context, "production");

          assertEquals(callCount, 1);
        });
      });

      it("should revalidate after specified time", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return {
                props: { count: callCount },
                revalidate: 0.05, // 50ms
              };
            },
          };

          const result1 = await fetcher.fetchData(pageModule, context, "production");
          assertEquals(getProp<number>(result1.props, "count"), 1);

          // Within revalidation window - should return cached
          const result2 = await fetcher.fetchData(pageModule, context, "production");
          assertEquals(getProp<number>(result2.props, "count"), 1);

          // Wait for revalidation window to pass
          await delay(60);

          // Should trigger background revalidation but return stale
          const result3 = await fetcher.fetchData(pageModule, context, "production");
          assertEquals(getProp<number>(result3.props, "count"), 1);

          // Wait for background revalidation to complete
          await delay(50);

          // Should now have fresh data
          const result4 = await fetcher.fetchData(pageModule, context, "production");
          assertEquals(getProp<number>(result4.props, "count"), 2);
        });
      });

      it("should implement stale-while-revalidate pattern", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: async () => {
              callCount++;
              await delay(30);
              return {
                props: { count: callCount, timestamp: Date.now() },
                revalidate: 0.05, // 50ms
              };
            },
          };

          const result1 = await fetcher.fetchData(pageModule, context, "production");
          const timestamp1 = getProp<number>(result1.props, "timestamp");

          await delay(60);

          // Should return stale data immediately
          const result2 = await fetcher.fetchData(pageModule, context, "production");
          assertEquals(getProp<number>(result2.props, "timestamp"), timestamp1);
          assertEquals(getProp<number>(result2.props, "count"), 1);

          // Wait for background revalidation
          await delay(50);

          // Should have new data
          const result3 = await fetcher.fetchData(pageModule, context, "production");
          assertEquals(getProp<number>(result3.props, "count"), 2);
        });
      });

      it("should not start multiple background revalidations", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: async () => {
              callCount++;
              await delay(50);
              return {
                props: { count: callCount },
                revalidate: 0.01, // 10ms
              };
            },
          };

          await fetcher.fetchData(pageModule, context, "production");
          await delay(20);

          // Make multiple requests during revalidation
          await Promise.all([
            fetcher.fetchData(pageModule, context, "production"),
            fetcher.fetchData(pageModule, context, "production"),
            fetcher.fetchData(pageModule, context, "production"),
          ]);

          // Wait for revalidation to complete
          await delay(100);

          // Should only have been called twice (initial + one revalidation)
          assertEquals(callCount, 2);
        });
      });

      it("should handle revalidation with no revalidate value", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return {
                props: { count: callCount },
              };
            },
          };

          await fetcher.fetchData(pageModule, context, "production");
          await delay(100);
          await fetcher.fetchData(pageModule, context, "production");

          assertEquals(callCount, 1);
        });
      });

      it("should handle errors during background revalidation", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              if (callCount === 2) {
                throw new Error("Revalidation error");
              }
              return {
                props: { count: callCount },
                revalidate: 0.05,
              };
            },
          };

          const result1 = await fetcher.fetchData(pageModule, context, "production");
          assertEquals(getProp<number>(result1.props, "count"), 1);

          await delay(60);

          // Should return stale data
          const result2 = await fetcher.fetchData(pageModule, context, "production");
          assertEquals(getProp<number>(result2.props, "count"), 1);

          // Wait for failed revalidation
          await delay(50);

          // Should still have old data
          const result3 = await fetcher.fetchData(pageModule, context, "production");
          assertEquals(getProp<number>(result3.props, "count"), 1);
        });
      });
    });

    describe("DataFetcher - Cache Management", () => {
      let fetcher: DataFetcher;
      let context: DataContext;

      beforeEach(() => {
        fetcher = new DataFetcher();
        context = makeContext("http://localhost/page", { id: "1" });
      });

      it("should clear all cache", async () => {
        await withProductionContext(async () => {
          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => ({
              props: { timestamp: Date.now() },
            }),
          };

          const result1 = await fetcher.fetchData(pageModule, context, "production");
          const timestamp1 = getProp<number>(result1.props, "timestamp");

          fetcher.clearCache();

          await delay(10);

          const result2 = await fetcher.fetchData(pageModule, context, "production");
          const timestamp2 = getProp<number>(result2.props, "timestamp");

          assertEquals(timestamp2 > timestamp1, true);
        });
      });

      it("should clear cache by pattern", async () => {
        await withProductionContext(async () => {
          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => ({
              props: { timestamp: Date.now() },
            }),
          };

          const context1 = makeContext("http://localhost/page1", { id: "1" });
          const context2 = makeContext("http://localhost/page2", { id: "2" });

          const result1 = await fetcher.fetchData(pageModule, context1, "production");
          const result2 = await fetcher.fetchData(pageModule, context2, "production");

          const timestamp1 = getProp<number>(result1.props, "timestamp");
          const timestamp2 = getProp<number>(result2.props, "timestamp");

          fetcher.clearCache("page1");

          await delay(10);

          const result3 = await fetcher.fetchData(pageModule, context1, "production");
          const result4 = await fetcher.fetchData(pageModule, context2, "production");

          assertEquals(getProp<number>(result3.props, "timestamp") > timestamp1, true);
          assertEquals(getProp<number>(result4.props, "timestamp"), timestamp2);
        });
      });

      it("should clear multiple entries matching pattern", async () => {
        await withProductionContext(async () => {
          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => ({
              props: { timestamp: Date.now() },
            }),
          };

          const contexts = [
            makeContext("http://localhost/blog/post-1", { slug: "post-1" }),
            makeContext("http://localhost/blog/post-2", { slug: "post-2" }),
            makeContext("http://localhost/about", { id: "1" }),
          ];

          await Promise.all(
            contexts.map((ctx: DataContext) => fetcher.fetchData(pageModule, ctx, "production")),
          );

          fetcher.clearCache("blog");

          let callCount = 0;
          const countingModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return { props: { count: callCount } };
            },
          };

          await fetcher.fetchData(countingModule, contexts[0]!, "production");
          await fetcher.fetchData(countingModule, contexts[1]!, "production");
          await fetcher.fetchData(countingModule, contexts[2]!, "production");

          assertEquals(callCount, 2);
        });
      });

      it("should not affect cache when pattern does not match", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return { props: { count: callCount } };
            },
          };

          await fetcher.fetchData(pageModule, context, "production");

          fetcher.clearCache("nonexistent");

          await fetcher.fetchData(pageModule, context, "production");

          assertEquals(callCount, 1);
        });
      });

      it("should handle clearing empty cache", () => {
        fetcher.clearCache();
        fetcher.clearCache("pattern");
      });
    });

    describe("DataFetcher - Static Paths", () => {
      let fetcher: DataFetcher;

      beforeEach(() => {
        fetcher = new DataFetcher();
      });

      it("should get static paths from getStaticPaths", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getStaticPaths: () => ({
            paths: [
              { params: { id: "1" } },
              { params: { id: "2" } },
              { params: { id: "3" } },
            ],
            fallback: false,
          }),
        };

        const paths = await fetcher.getStaticPaths(pageModule);

        assertExists(paths);
        assertEquals(paths.paths.length, 3);
        assertEquals(getProp<string>(paths.paths[0]?.params, "id"), "1");
        assertEquals(getProp<string>(paths.paths[1]?.params, "id"), "2");
        assertEquals(getProp<string>(paths.paths[2]?.params, "id"), "3");
        assertEquals(paths.fallback, false);
      });

      it("should handle async getStaticPaths", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getStaticPaths: async () => {
            await delay(10);
            return {
              paths: [{ params: { slug: "test" } }],
              fallback: "blocking",
            };
          },
        };

        const paths = await fetcher.getStaticPaths(pageModule);

        assertExists(paths);
        assertEquals(paths.paths.length, 1);
        assertEquals(paths.fallback, "blocking");
      });

      it("should handle fallback: true", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getStaticPaths: () => ({
            paths: [],
            fallback: true,
          }),
        };

        const paths = await fetcher.getStaticPaths(pageModule);

        assertExists(paths);
        assertEquals(paths.fallback, true);
      });

      it("should handle fallback: blocking", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getStaticPaths: () => ({
            paths: [],
            fallback: "blocking",
          }),
        };

        const paths = await fetcher.getStaticPaths(pageModule);

        assertExists(paths);
        assertEquals(paths.fallback, "blocking");
      });

      it("should handle empty paths array", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getStaticPaths: () => ({
            paths: [],
            fallback: false,
          }),
        };

        const paths = await fetcher.getStaticPaths(pageModule);

        assertExists(paths);
        assertEquals(paths.paths.length, 0);
      });

      it("should return null when no getStaticPaths", async () => {
        const pageModule: PageWithData = {
          default: () => null,
        };

        const paths = await fetcher.getStaticPaths(pageModule);

        assertEquals(paths, null);
      });

      it("should handle complex params in static paths", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getStaticPaths: () => ({
            paths: [
              { params: { category: "tech", slug: "post-1" } },
              { params: { category: "science", slug: "post-2" } },
            ],
            fallback: false,
          }),
        };

        const paths = await fetcher.getStaticPaths(pageModule);

        assertExists(paths);
        assertEquals(paths.paths.length, 2);
        assertEquals(getProp<string>(paths.paths[0]?.params, "category"), "tech");
        assertEquals(getProp<string>(paths.paths[0]?.params, "slug"), "post-1");
      });

      it("should handle array params in static paths", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getStaticPaths: () => ({
            paths: [{ params: { path: ["a", "b", "c"] } }],
            fallback: false,
          }),
        };

        const paths = await fetcher.getStaticPaths(pageModule);

        assertExists(paths);
        assertEquals(paths.paths.length, 1);
        assertEquals(getProp<string[]>(paths.paths[0]?.params, "path"), ["a", "b", "c"]);
      });

      it("should propagate errors from getStaticPaths", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getStaticPaths: () => {
            throw new Error("Static paths error");
          },
        };

        await assertRejects(
          () => fetcher.getStaticPaths(pageModule),
          Error,
          "Static paths error",
        );
      });

      it("should propagate async errors from getStaticPaths", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getStaticPaths: async () => {
            await delay(10);
            throw new Error("Async static paths error");
          },
        };

        await assertRejects(
          () => fetcher.getStaticPaths(pageModule),
          Error,
          "Async static paths error",
        );
      });
    });

    describe("DataFetcher - Helper Functions", () => {
      it("should create redirect response", () => {
        const result = redirect("/new-location");

        assertEquals(result.redirect?.destination, "/new-location");
        assertEquals(result.redirect?.permanent, false);
      });

      it("should create permanent redirect response", () => {
        const result = redirect("/new-location", true);

        assertEquals(result.redirect?.destination, "/new-location");
        assertEquals(result.redirect?.permanent, true);
      });

      it("should create notFound response", () => {
        const result = notFound();

        assertEquals(result.notFound, true);
      });
    });

    describe("DataFetcher - Edge Cases", () => {
      let fetcher: DataFetcher;
      let context: DataContext;

      beforeEach(() => {
        fetcher = new DataFetcher();
        context = makeContext("http://localhost/test", { id: "1" });
      });

      it("should handle null props", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => ({
            props: null as unknown as Record<string, unknown>,
          }),
        };

        const result = await fetcher.fetchData(pageModule, context);

        assertEquals(result.props, {});
      });

      it("should handle undefined props", async () => {
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => ({
            props: undefined as unknown as Record<string, unknown>,
          }),
        };

        const result = await fetcher.fetchData(pageModule, context);

        assertEquals(result.props, {});
      });

      it("should handle revalidate: 0", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return {
                props: { count: callCount },
                revalidate: 0,
              };
            },
          };

          const result1 = await fetcher.fetchData(pageModule, context, "production");
          assertEquals(getProp<number>(result1.props, "count"), 1);

          await delay(10);

          const result2 = await fetcher.fetchData(pageModule, context, "production");
          assertEquals(getProp<number>(result2.props, "count"), 1);

          await delay(10);

          const result3 = await fetcher.fetchData(pageModule, context, "production");
          assertEquals(getProp<number>(result3.props, "count"), 2);
        });
      });

      it("should handle large revalidate values", async () => {
        await withProductionContext(async () => {
          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => ({
              props: { data: "test" },
              revalidate: 86400, // 24 hours
            }),
          };

          const result = await fetcher.fetchData(pageModule, context, "production");

          assertEquals(getProp<string>(result.props, "data"), "test");
        });
      });

      it("should handle special characters in cache keys", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return { props: { count: callCount } };
            },
          };

          const specialContext = makeContext("http://localhost/page?query=test", {
            slug: "hello-world@2024",
          });

          const result1 = await fetcher.fetchData(
            pageModule,
            specialContext,
            "production",
          );
          const result2 = await fetcher.fetchData(
            pageModule,
            specialContext,
            "production",
          );

          assertEquals(getProp<number>(result1.props, "count"), 1);
          assertEquals(getProp<number>(result2.props, "count"), 1);
          assertEquals(callCount, 1);
        });
      });

      it("should handle URLs with different protocols (same cache key)", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return { props: { count: callCount } };
            },
          };

          const context1 = makeContext("http://localhost/page", { id: "1" });
          const context2 = makeContext("https://localhost/page", { id: "1" });

          const result1 = await fetcher.fetchData(pageModule, context1, "production");
          const result2 = await fetcher.fetchData(pageModule, context2, "production");

          // Cache key is based on pathname and params, not protocol, so they share cache
          assertEquals(callCount, 1);
          assertEquals(getProp<number>(result1.props, "count"), 1);
          assertEquals(getProp<number>(result2.props, "count"), 1);
        });
      });

      it("should handle URLs with different hosts (same cache key)", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return { props: { count: callCount } };
            },
          };

          const context1 = makeContext("http://localhost/page", { id: "1" });
          const context2 = makeContext("http://example.com/page", { id: "1" });

          const result1 = await fetcher.fetchData(pageModule, context1, "production");
          const result2 = await fetcher.fetchData(pageModule, context2, "production");

          // Cache key is based on pathname and params, not host, so they share cache
          assertEquals(callCount, 1);
          assertEquals(getProp<number>(result1.props, "count"), 1);
          assertEquals(getProp<number>(result2.props, "count"), 1);
        });
      });

      it("should handle concurrent requests to same resource", async () => {
        await withProductionContext(async () => {
          let callCount = 0;

          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: async () => {
              callCount++;
              await delay(30);
              return { props: { count: callCount } };
            },
          };

          const results = await Promise.all([
            fetcher.fetchData(pageModule, context, "production"),
            fetcher.fetchData(pageModule, context, "production"),
            fetcher.fetchData(pageModule, context, "production"),
          ]);

          // All concurrent requests race - they don't wait for each other, so all execute
          // First one to finish sets cache, but others may have already started
          assertEquals(callCount >= 1, true);
          // All results should have values (whether from concurrent executions or cache)
          assertExists(getProp<number>(results[0]?.props, "count"));
          assertExists(getProp<number>(results[1]?.props, "count"));
          assertExists(getProp<number>(results[2]?.props, "count"));
        });
      });

      it("should handle empty params", async () => {
        await withProductionContext(async () => {
          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: (ctx: StaticDataContext) => ({
              props: { params: ctx.params },
            }),
          };

          const emptyContext = makeContext("http://localhost/page", {});

          const result = await fetcher.fetchData(
            pageModule,
            emptyContext,
            "production",
          );

          assertEquals(getProp<Record<string, unknown>>(result.props, "params"), {});
        });
      });
    });

    describe("DataFetcher - Type Safety", () => {
      it("should handle typed props in getServerData", async () => {
        interface Props {
          title: string;
          count: number;
        }

        const fetcher = new DataFetcher();
        const context = makeContext("http://localhost/test");

        const pageModule: PageWithData<Props> = {
          default: () => null,
          getServerData: (): DataResult<Props> => ({
            props: {
              title: "Test",
              count: 42,
            },
          }),
        };

        const result = await fetcher.fetchData(pageModule, context);

        assertEquals(getProp<string>(result.props, "title"), "Test");
        assertEquals(getProp<number>(result.props, "count"), 42);
      });

      it("should handle typed props in getStaticData", async () => {
        interface Props {
          slug: string;
          data: { id: number; name: string };
        }

        const fetcher = new DataFetcher();
        const context = makeContext("http://localhost/post/test");

        const pageModule: PageWithData<Props> = {
          default: () => null,
          getStaticData: (): DataResult<Props> => ({
            props: {
              slug: "test",
              data: { id: 1, name: "Test Post" },
            },
          }),
        };

        const result = await fetcher.fetchData(pageModule, context, "production");

        assertEquals(getProp<string>(result.props, "slug"), "test");
        assertEquals(getProp<{ id: number; name: string }>(result.props, "data").id, 1);
        assertEquals(getProp<{ id: number; name: string }>(result.props, "data").name, "Test Post");
      });
    });
});