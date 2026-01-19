/**
 * Tests for Data Fetching System
 */

// Disable LRU interval to prevent resource leaks in tests
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assertEquals, assertExists, assertRejects } from "@veryfront/testing/assert";
import { beforeEach, describe, it } from "@veryfront/testing/bdd";
import {
  type DataContext,
  DataFetcher,
  notFound,
  type PageWithData,
  redirect,
} from "@veryfront/data/index.ts";
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

function makeContext(url: string): DataContext {
  const u = new URL(url);
  return {
    params: {},
    query: u.searchParams,
    request: new Request(url),
    url: u,
  } as const;
}

describe("DataFetcher", () => {
  describe("DataFetcher", () => {
      let fetcher: DataFetcher;
      let context: DataContext;

      beforeEach(() => {
        fetcher = new DataFetcher();
        context = {
          params: { id: "123" },
          query: new URLSearchParams("?sort=name"),
          request: new Request("http://localhost/test"),
          url: new URL("http://localhost/test"),
        };
      });

      describe("Server-side data fetching", () => {
        it("fetches data using getServerData", async () => {
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
          assertEquals((result.props as any).message, "Hello from server");
          assertEquals((result.props as any).id, "123");
        });

        it("handles redirect from getServerData", async () => {
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
        });

        it("handles notFound from getServerData", async () => {
          const pageModule: PageWithData = {
            default: () => null,
            getServerData: () => ({
              notFound: true,
            }),
          };

          const result = await fetcher.fetchData(pageModule, context);

          assertEquals(result.notFound, true);
        });

        it("passes context correctly to getServerData", async () => {
          let capturedContext: DataContext | undefined;

          const pageModule: PageWithData = {
            default: () => null,
            getServerData: (ctx: DataContext) => {
              capturedContext = ctx;
              return {
                props: {},
              };
            },
          };

          await fetcher.fetchData(pageModule, context);

          assertExists(capturedContext);
          assertEquals(capturedContext.params, { id: "123" });
          assertEquals(capturedContext.query.get("sort"), "name");
          assertEquals(capturedContext.url.pathname, "/test");
        });
      });

      describe("Static data fetching", () => {
        it("fetches data using getStaticData", async () => {
          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: (ctx: StaticDataContext) => ({
              props: {
                message: "Hello from static",
                id: ctx.params.id,
              },
            }),
          };

          const result = await fetcher.fetchData(pageModule, context, "production");

          assertExists(result.props);
          assertEquals((result.props as any).message, "Hello from static");
          assertEquals((result.props as any).id, "123");
        });

        it("caches static data", async () => {
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

            const result1 = await fetcher.fetchData(pageModule, context, "production");
            assertEquals((result1.props as any)?.count, 1);

            const result2 = await fetcher.fetchData(pageModule, context, "production");
            assertEquals((result2.props as any)?.count, 1);
            assertEquals(callCount, 1);
          });
        });

        it("respects revalidate time", async () => {
          await withProductionContext(async () => {
            let callCount = 0;

            const pageModule: PageWithData = {
              default: () => null,
              getStaticData: () => {
                callCount++;
                return {
                  props: { count: callCount },
                  revalidate: 0.1,
                };
              },
            };

            const result1 = await fetcher.fetchData(pageModule, context, "production");
            assertEquals((result1.props as any)?.count, 1);

            const result2 = await fetcher.fetchData(pageModule, context, "production");
            assertEquals((result2.props as any)?.count, 1);

            await delay(150);

            const result3 = await fetcher.fetchData(pageModule, context, "production");
            assertEquals((result3.props as any)?.count, 1);

            await delay(50);

            const result4 = await fetcher.fetchData(pageModule, context, "production");
            assertEquals((result4.props as any)?.count, 2);
          });
        });

        it("handles revalidate: false (never revalidate)", async () => {
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
            await fetcher.fetchData(pageModule, context, "production");
            await fetcher.fetchData(pageModule, context, "production");

            assertEquals(callCount, 1);
          });
        });
      });

      describe("Development mode", () => {
        it("always uses getServerData in development", async () => {
          let serverCalled = false;
          let staticCalled = false;

          const pageModule: PageWithData = {
            default: () => null,
            getServerData: () => {
              serverCalled = true;
              return { props: { from: "server" } };
            },
            getStaticData: () => {
              staticCalled = true;
              return { props: { from: "static" } };
            },
          };

          const result = await fetcher.fetchData(pageModule, context, "development");

          assertEquals(serverCalled, true);
          assertEquals(staticCalled, false);
          assertEquals((result.props as any)?.from, "server");
        });

        it(
          {
            name: "server vs static and cache revalidation",
            sanitizeResources: false,
            sanitizeOps: false,
          },
          async () => {
            await withProductionContext(async () => {
              const testFetcher = new DataFetcher();

              const pageDev: PageWithData<{ a: number }> = {
                default: () => null,
                getServerData() {
                  return { props: { a: 1 } };
                },
                getStaticData() {
                  return { props: { a: 2 } };
                },
              };
              const resDev = await testFetcher.fetchData(
                pageDev,
                makeContext("http://x"),
                "development",
              );
              assertEquals(resDev.props, { a: 1 });

              let _staticCalls = 0;
              const pageProd: PageWithData<{ t: number }> = {
                default: () => null,
                getStaticData() {
                  _staticCalls++;
                  return { props: { t: Date.now() }, revalidate: 0.001 };
                },
              };
              const url = "http://x/path";
              const c = makeContext(url);
              const first = await testFetcher.fetchData(pageProd, c, "production");
              const second = await testFetcher.fetchData(pageProd, c, "production");
              assertEquals((second.props as any)?.t === (first.props as any)?.t, true);
              await delay(5);
              const third = await testFetcher.fetchData(pageProd, c, "production");
              assertEquals((third.props as any)?.t === (first.props as any)?.t, true);
            });
          },
        );
      });

      describe("No data fetching", () => {
        it("returns empty props when no data fetching methods", async () => {
          const pageModule: PageWithData = {
            default: () => null,
          };

          const result = await fetcher.fetchData(pageModule, context);

          assertEquals(result, {
            props: {},
          });
        });
      });

      describe("Static paths", () => {
        it("gets static paths from getStaticPaths", async () => {
          const pageModule: PageWithData = {
            default: () => null,
            getStaticPaths: () => ({
              paths: [{ params: { id: "1" } }, { params: { id: "2" } }, { params: { id: "3" } }],
              fallback: false,
            }),
          };

          const paths = await fetcher.getStaticPaths(pageModule);

          assertExists(paths);
          assertEquals(paths.paths.length, 3);
          assertEquals(paths.paths[0]?.params.id, "1");
          assertEquals(paths.fallback, false);
        });

        it("returns null when no getStaticPaths", async () => {
          const pageModule: PageWithData = {
            default: () => null,
          };

          const paths = await fetcher.getStaticPaths(pageModule);

          assertEquals(paths, null);
        });
      });

      describe("Cache management", () => {
        it("clears all cache", async () => {
          await withProductionContext(async () => {
            const pageModule: PageWithData = {
              default: () => null,
              getStaticData: () => ({
                props: { timestamp: Date.now() },
              }),
            };

            const result1 = await fetcher.fetchData(pageModule, context, "production");
            const timestamp1 = (result1.props as any)?.timestamp;

            fetcher.clearCache();

            await delay(10);
            const result2 = await fetcher.fetchData(pageModule, context, "production");
            const timestamp2 = (result2.props as any)?.timestamp;

            assert(timestamp2 > timestamp1);
          });
        });

        it("clears cache by pattern", async () => {
          await withProductionContext(async () => {
            const context1 = { ...context, url: new URL("http://localhost/page1") };
            const context2 = { ...context, url: new URL("http://localhost/page2") };

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

            await fetcher.fetchData(pageModule, context1, "production");
            await fetcher.fetchData(pageModule, context2, "production");

            fetcher.clearCache("page1");

            const result1 = await fetcher.fetchData(pageModule, context1, "production");
            const result2 = await fetcher.fetchData(pageModule, context2, "production");

            assertEquals((result1.props as any)?.count, 3);
            assertEquals((result2.props as any)?.count, 2);
          });
        });
      });

      describe("Error handling", () => {
        it("propagates errors from getServerData", async () => {
          const pageModule: PageWithData = {
            default: () => null,
            getServerData: () => {
              throw new Error("Server error");
            },
          };

          await assertRejects(() => fetcher.fetchData(pageModule, context), Error, "Server error");
        });

        it("propagates errors from getStaticData", async () => {
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
      });

      describe("Helper functions", () => {
        it("redirect/notFound helpers", () => {
          const r = redirect("/to", true);
          const nf = notFound();
          assertEquals(r.redirect?.destination, "/to");
          assertEquals(nf.notFound, true);
        });
      });

      function assert(condition: boolean): asserts condition {
        if (!condition) {
          throw new Error("Assertion failed");
        }
      }
    });
});
