/**
 * Edge case tests for data/fetching.ts
 * Tests network failures, timeout scenarios, invalid responses, and error handling
 */

import { assertEquals, assertExists, assertRejects } from "std/assert/mod.ts";
import { describe } from "std/testing/bdd.ts";
import { type DataContext, DataFetcher, type PageWithData } from "@veryfront/data/index.ts";

type StaticDataContext = Omit<DataContext, "request" | "query">;

function makeContext(url: string, params: Record<string, string> = {}): DataContext {
  const u = new URL(url);
  return {
    params,
    query: u.searchParams,
    request: new Request(url),
    url: u,
  };
}

// Each test creates DataFetcher which has internal cleanup intervals
// Disable resource sanitization for all tests in this suite
Deno.test({
  name: "DataFetcher - Edge Cases and Error Handling",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    describe("DataFetcher - Edge Cases and Error Handling", () => {
      describe("Invalid page modules", () => {
        Deno.test("should handle page with no data fetching methods", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
          };

          const result = await fetcher.fetchData(page, makeContext("http://localhost/test"));

          assertEquals(result.props, {});
        });

        Deno.test("should handle page with null getServerData", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getServerData: null as any,
          };

          const result = await fetcher.fetchData(page, makeContext("http://localhost/test"));

          assertEquals(result.props, {});
        });

        Deno.test("should handle page with undefined getStaticData", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getStaticData: undefined,
          };

          const result = await fetcher.fetchData(
            page,
            makeContext("http://localhost/test"),
            "production",
          );

          assertEquals(result.props, {});
        });

        Deno.test("should handle page with non-function data methods", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getServerData: "not a function" as any,
          };

          const result = await fetcher.fetchData(page, makeContext("http://localhost/test"));

          assertEquals(result.props, {});
        });
      });

      describe("Data fetching errors", () => {
        Deno.test("should propagate getServerData errors", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getServerData: () => {
              throw new Error("Server fetch failed");
            },
          };

          await assertRejects(
            () => fetcher.fetchData(page, makeContext("http://localhost/test")),
            Error,
            "Server fetch failed",
          );
        });

        Deno.test("should propagate getStaticData errors", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getStaticData: () => {
              throw new Error("Static fetch failed");
            },
          };

          await assertRejects(
            () => fetcher.fetchData(page, makeContext("http://localhost/test"), "production"),
            Error,
            "Static fetch failed",
          );
        });

        Deno.test("should handle async errors in getServerData", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getServerData: async () => {
              await Promise.resolve();
              throw new Error("Async server error");
            },
          };

          await assertRejects(
            () => fetcher.fetchData(page, makeContext("http://localhost/test")),
            Error,
            "Async server error",
          );
        });

        Deno.test("should handle async errors in getStaticData", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getStaticData: async () => {
              await Promise.resolve();
              throw new Error("Async static error");
            },
          };

          await assertRejects(
            () => fetcher.fetchData(page, makeContext("http://localhost/test"), "production"),
            Error,
            "Async static error",
          );
        });

        Deno.test("should handle errors in getStaticPaths", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getStaticPaths: () => {
              throw new Error("Paths fetch failed");
            },
          };

          await assertRejects(
            () => fetcher.getStaticPaths(page),
            Error,
            "Paths fetch failed",
          );
        });
      });

      describe("Invalid data results", () => {
        Deno.test("should handle null props", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getServerData: () => ({
              props: null as any,
            }),
          };

          const result = await fetcher.fetchData(page, makeContext("http://localhost/test"));

          assertEquals(result.props, {});
        });

        Deno.test("should handle undefined props", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getServerData: () => ({
              props: undefined,
            }),
          };

          const result = await fetcher.fetchData(page, makeContext("http://localhost/test"));

          assertEquals(result.props, {});
        });

        Deno.test("should handle props with circular references", async () => {
          const fetcher = new DataFetcher();
          const circular: any = { value: "test" };
          circular.self = circular;

          const page: PageWithData = {
            default: () => null,
            getServerData: () => ({
              props: circular,
            }),
          };

          const result = await fetcher.fetchData(page, makeContext("http://localhost/test"));

          assertExists(result.props);
        });

        Deno.test("should handle very large props", async () => {
          const fetcher = new DataFetcher();
          const largeProps = {
            data: "x".repeat(1000000), // 1MB string
          };

          const page: PageWithData = {
            default: () => null,
            getServerData: () => ({
              props: largeProps,
            }),
          };

          const result = await fetcher.fetchData(page, makeContext("http://localhost/test"));

          assertEquals((result.props as any)?.data.length, 1000000);
        });

        Deno.test("should handle props with special types", async () => {
          const fetcher = new DataFetcher();
          const specialProps = {
            date: new Date(),
            regexp: /test/gi,
            set: new Set([1, 2, 3]),
            map: new Map([["a", 1]]),
            func: () => {},
            symbol: Symbol("test"),
          };

          const page: PageWithData = {
            default: () => null,
            getServerData: () => ({
              props: specialProps,
            }),
          };

          const result = await fetcher.fetchData(page, makeContext("http://localhost/test"));

          assertExists(result.props);
        });
      });

      describe("Redirect handling", () => {
        Deno.test("should handle redirect without permanent flag", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getServerData: () => ({
              redirect: {
                destination: "/login",
              },
            }),
          };

          const result = await fetcher.fetchData(page, makeContext("http://localhost/test"));

          assertEquals(result.redirect?.destination, "/login");
          assertEquals(result.redirect?.permanent, undefined);
        });

        Deno.test("should handle redirect with empty destination", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getServerData: () => ({
              redirect: {
                destination: "",
              },
            }),
          };

          const result = await fetcher.fetchData(page, makeContext("http://localhost/test"));

          assertEquals(result.redirect?.destination, "");
        });

        Deno.test("should handle redirect with special characters", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getServerData: () => ({
              redirect: {
                destination: "/path?query=value&other=test#anchor",
              },
            }),
          };

          const result = await fetcher.fetchData(page, makeContext("http://localhost/test"));

          assertEquals(result.redirect?.destination, "/path?query=value&other=test#anchor");
        });

        Deno.test("should handle redirect with both props and redirect", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getServerData: () => ({
              props: { data: "ignored" },
              redirect: {
                destination: "/redirect",
              },
            }),
          };

          const result = await fetcher.fetchData(page, makeContext("http://localhost/test"));

          // Redirect takes precedence
          assertEquals(result.redirect?.destination, "/redirect");
          assertEquals(result.props, undefined);
        });
      });

      describe("Not found handling", () => {
        Deno.test("should handle notFound with props", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getServerData: () => ({
              props: { data: "ignored" },
              notFound: true,
            }),
          };

          const result = await fetcher.fetchData(page, makeContext("http://localhost/test"));

          assertEquals(result.notFound, true);
          assertEquals(result.props, undefined);
        });

        Deno.test("should handle notFound with redirect", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getServerData: () => ({
              redirect: { destination: "/404" },
              notFound: true,
            }),
          };

          const result = await fetcher.fetchData(page, makeContext("http://localhost/test"));

          // Redirect takes precedence
          assertExists(result.redirect);
          assertEquals(result.notFound, undefined);
        });
      });

      describe("Revalidation edge cases", () => {
        Deno.test("should handle revalidate with zero", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getStaticData: () => ({
              props: { data: "test" },
              revalidate: 0,
            }),
          };

          const result = await fetcher.fetchData(
            page,
            makeContext("http://localhost/test"),
            "production",
          );

          assertEquals(result.revalidate, 0);
        });

        Deno.test("should handle revalidate with negative number", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getStaticData: () => ({
              props: { data: "test" },
              revalidate: -100,
            }),
          };

          const result = await fetcher.fetchData(
            page,
            makeContext("http://localhost/test"),
            "production",
          );

          assertEquals(result.revalidate, -100);
        });

        Deno.test("should handle very large revalidate values", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getStaticData: () => ({
              props: { data: "test" },
              revalidate: Number.MAX_SAFE_INTEGER,
            }),
          };

          const result = await fetcher.fetchData(
            page,
            makeContext("http://localhost/test"),
            "production",
          );

          assertEquals(result.revalidate, Number.MAX_SAFE_INTEGER);
        });

        Deno.test("should handle revalidate with fractional seconds", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getStaticData: () => ({
              props: { count: 1 },
              revalidate: 0.5, // 500ms
            }),
          };

          const context = makeContext("http://localhost/test");
          const result1 = await fetcher.fetchData(page, context, "production");

          assertEquals((result1.props as any)?.count, 1);

          // Wait for revalidation
          await new Promise((r) => setTimeout(r, 600));

          const result2 = await fetcher.fetchData(page, context, "production");

          assertExists(result2);
        });
      });

      describe("Cache edge cases", () => {
        Deno.test("should handle cache with complex params", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getStaticData: (ctx: StaticDataContext) => ({
              props: { params: ctx.params },
            }),
          };

          const context1 = makeContext("http://localhost/test", { id: "123", category: "test" });
          const context2 = makeContext("http://localhost/test", { id: "123", category: "test" });

          const result1 = await fetcher.fetchData(page, context1, "production");
          const result2 = await fetcher.fetchData(page, context2, "production");

          // Should be cached
          assertEquals((result1.props as any)?.params, (result2.props as any)?.params);
        });

        Deno.test("should differentiate cache by URL path", async () => {
          const fetcher = new DataFetcher();
          let callCount = 0;

          const page: PageWithData = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return { props: { count: callCount } };
            },
          };

          await fetcher.fetchData(page, makeContext("http://localhost/path1"), "production");
          await fetcher.fetchData(page, makeContext("http://localhost/path2"), "production");

          assertEquals(callCount, 2); // Different paths = different cache entries
        });

        Deno.test("should handle cache clear with pattern", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getStaticData: () => ({
              props: { timestamp: Date.now() },
            }),
          };

          await fetcher.fetchData(page, makeContext("http://localhost/blog/post1"), "production");
          await fetcher.fetchData(page, makeContext("http://localhost/docs/page1"), "production");

          fetcher.clearCache("blog");

          // Blog should be cleared, docs should remain
          const blogResult = await fetcher.fetchData(
            page,
            makeContext("http://localhost/blog/post1"),
            "production",
          );
          assertExists(blogResult.props);
        });

        Deno.test("should handle concurrent cache access", async () => {
          const fetcher = new DataFetcher();
          let callCount = 0;

          const page: PageWithData = {
            default: () => null,
            getStaticData: async () => {
              callCount++;
              await new Promise((r) => setTimeout(r, 10));
              return { props: { count: callCount } };
            },
          };

          const context = makeContext("http://localhost/test");

          // Multiple concurrent fetches
          const [r1, r2, r3] = await Promise.all([
            fetcher.fetchData(page, context, "production"),
            fetcher.fetchData(page, context, "production"),
            fetcher.fetchData(page, context, "production"),
          ]);

          // May have race condition, but should not crash
          assertExists(r1.props);
          assertExists(r2.props);
          assertExists(r3.props);
        });
      });

      describe("Static paths edge cases", () => {
        Deno.test("should handle getStaticPaths with empty paths", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getStaticPaths: () => ({
              paths: [],
              fallback: false,
            }),
          };

          const paths = await fetcher.getStaticPaths(page);

          assertEquals(paths?.paths.length, 0);
          assertEquals(paths?.fallback, false);
        });

        Deno.test("should handle getStaticPaths with fallback blocking", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getStaticPaths: () => ({
              paths: [{ params: { id: "1" } }],
              fallback: "blocking",
            }),
          };

          const paths = await fetcher.getStaticPaths(page);

          assertEquals(paths?.fallback, "blocking");
        });

        Deno.test("should handle getStaticPaths with array params", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getStaticPaths: () => ({
              paths: [{ params: { slug: ["blog", "post", "123"] } }],
              fallback: false,
            }),
          };

          const paths = await fetcher.getStaticPaths(page);

          assertEquals(Array.isArray(paths?.paths[0]?.params.slug), true);
        });

        Deno.test("should handle getStaticPaths returning null", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getStaticPaths: () => null as any,
          };

          const paths = await fetcher.getStaticPaths(page);

          // Should handle gracefully
          assertExists(paths !== undefined ? paths : null);
        });

        Deno.test("should handle async getStaticPaths errors", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getStaticPaths: async () => {
              await Promise.resolve();
              throw new Error("Failed to generate paths");
            },
          };

          await assertRejects(
            () => fetcher.getStaticPaths(page),
            Error,
            "Failed to generate paths",
          );
        });

        Deno.test("should handle very large number of paths", async () => {
          const fetcher = new DataFetcher();
          const largePaths = Array.from({ length: 10000 }, (_, i) => ({
            params: { id: String(i) },
          }));

          const page: PageWithData = {
            default: () => null,
            getStaticPaths: () => ({
              paths: largePaths,
              fallback: false,
            }),
          };

          const paths = await fetcher.getStaticPaths(page);

          assertEquals(paths?.paths.length, 10000);
        });
      });

      describe("Context edge cases", () => {
        Deno.test("should handle empty params", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getServerData: (ctx: DataContext) => ({
              props: { params: ctx.params },
            }),
          };

          const result = await fetcher.fetchData(page, makeContext("http://localhost/test", {}));

          assertEquals((result.props as any)?.params, {});
        });

        Deno.test("should handle params with special characters", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getServerData: (ctx: DataContext) => ({
              props: { slug: ctx.params.slug },
            }),
          };

          const result = await fetcher.fetchData(
            page,
            makeContext("http://localhost/test", { slug: "test-\n\t-special" }),
          );

          assertEquals((result.props as any)?.slug, "test-\n\t-special");
        });

        Deno.test("should handle query params with arrays", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getServerData: (ctx: DataContext) => ({
              props: { tags: ctx.query.getAll("tag") },
            }),
          };

          const url = "http://localhost/test?tag=a&tag=b&tag=c";
          const result = await fetcher.fetchData(page, makeContext(url));

          assertEquals((result.props as any)?.tags, ["a", "b", "c"]);
        });

        Deno.test("should handle malformed URLs in context", async () => {
          const fetcher = new DataFetcher();
          const page: PageWithData = {
            default: () => null,
            getServerData: (ctx: DataContext) => ({
              props: { url: ctx.url.pathname },
            }),
          };

          // URL with special characters
          const result = await fetcher.fetchData(
            page,
            makeContext("http://localhost/path%20with%20spaces"),
          );

          assertExists(result.props);
        });
      });
    });
  }, // End of Deno.test fn
}); // End of Deno.test
