/**
 * Tests for Static Site Generation (SSG) - Pages Router
 *
 * Tests getStaticPaths generation, dynamic route handling, and build output
 */

import { assertEquals, assertExists } from "@std/assert";
import { afterAll, beforeEach, describe, it } from "@std/testing/bdd.ts";
import { DataFetcher, type PageWithData } from "@veryfront/data";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe("SSG - Pages Router", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up renderer intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  let fetcher: DataFetcher;

  beforeEach(() => {
    fetcher = new DataFetcher();
  });

  describe("getStaticPaths - Basic paths", () => {
    it("should generate paths for simple dynamic route", async () => {
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

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.paths.length, 3);
      assertEquals(result!.fallback, false);
    });

    it("should handle slug-based dynamic routes", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [
            { params: { slug: "hello-world" } },
            { params: { slug: "getting-started" } },
            { params: { slug: "advanced-usage" } },
          ],
          fallback: false,
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.paths.length, 3);
      assertEquals(result!.paths[0]?.params.slug, "hello-world");
    });

    it("should handle numeric IDs", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [
            { params: { id: "123" } },
            { params: { id: "456" } },
            { params: { id: "789" } },
          ],
          fallback: false,
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.paths.length, 3);
      assertEquals(result!.paths[2]?.params.id, "789");
    });
  });

  describe("getStaticPaths - Nested dynamic routes", () => {
    it("should handle nested dynamic parameters", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [
            { params: { category: "tech", slug: "ai-trends" } },
            { params: { category: "tech", slug: "web-dev" } },
            { params: { category: "business", slug: "startup-tips" } },
          ],
          fallback: false,
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.paths.length, 3);
      assertEquals(result!.paths[0]?.params.category, "tech");
      assertEquals(result!.paths[0]?.params.slug, "ai-trends");
    });

    it("should handle deeply nested paths", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [
            { params: { org: "acme", repo: "project1", issue: "42" } },
            { params: { org: "acme", repo: "project2", issue: "101" } },
          ],
          fallback: "blocking",
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.paths.length, 2);
      assertEquals(result!.paths[0]?.params.org, "acme");
      assertEquals(result!.paths[0]?.params.issue, "42");
      assertEquals(result!.fallback, "blocking");
    });
  });

  describe("getStaticPaths - Catch-all routes", () => {
    it("should handle catch-all dynamic segments", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [
            { params: { slug: ["docs"] } },
            { params: { slug: ["docs", "getting-started"] } },
            { params: { slug: ["docs", "api", "reference"] } },
          ],
          fallback: false,
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.paths.length, 3);
      assertEquals(Array.isArray(result!.paths[0]?.params.slug), true);
      assertEquals((result!.paths[2]?.params.slug as string[]).length, 3);
    });

    it("should handle optional catch-all routes", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [
            { params: { slug: [] } }, // Root level
            { params: { slug: ["about"] } },
            { params: { slug: ["team", "engineering"] } },
          ],
          fallback: false,
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.paths.length, 3);
      assertEquals((result!.paths[0]?.params.slug as string[]).length, 0);
    });
  });

  describe("getStaticPaths - Fallback modes", () => {
    it("should support fallback: false", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [{ params: { id: "1" } }],
          fallback: false,
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.fallback, false);
    });

    it("should support fallback: true", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [{ params: { id: "1" } }],
          fallback: true,
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.fallback, true);
    });

    it('should support fallback: "blocking"', async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [{ params: { id: "1" } }],
          fallback: "blocking",
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.fallback, "blocking");
    });
  });

  describe("getStaticPaths - Async paths", () => {
    it("should handle async getStaticPaths", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: async () => {
          // Simulate fetching from API
          await new Promise((r) => setTimeout(r, 10));
          return {
            paths: [
              { params: { id: "async-1" } },
              { params: { id: "async-2" } },
            ],
            fallback: false,
          };
        },
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.paths.length, 2);
      assertEquals(result!.paths[0]?.params.id, "async-1");
    });

    it("should handle paths from external API", async () => {
      // Simulate fetching blog posts from CMS
      const fetchPosts = async () => {
        await new Promise((r) => setTimeout(r, 5));
        return [
          { id: "post-1", slug: "first-post" },
          { id: "post-2", slug: "second-post" },
          { id: "post-3", slug: "third-post" },
        ];
      };

      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: async () => {
          const posts = await fetchPosts();
          return {
            paths: posts.map((post) => ({
              params: { slug: post.slug },
            })),
            fallback: "blocking",
          };
        },
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.paths.length, 3);
      assertEquals(result!.paths[1]?.params.slug, "second-post");
    });
  });

  describe("getStaticPaths - Edge cases", () => {
    it("should handle empty paths array", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [],
          fallback: true,
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.paths.length, 0);
      assertEquals(result!.fallback, true);
    });

    it("should handle special characters in params", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [
            { params: { slug: "hello-world" } },
            { params: { slug: "foo_bar" } },
            { params: { slug: "test.html" } },
            { params: { slug: "2024-01-01" } },
          ],
          fallback: false,
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.paths.length, 4);
      assertEquals(result!.paths[2]?.params.slug, "test.html");
    });

    it("should handle unicode characters in slugs", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [
            { params: { slug: "こんにちは" } },
            { params: { slug: "привет" } },
            { params: { slug: "你好" } },
          ],
          fallback: false,
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.paths.length, 3);
      assertEquals(result!.paths[0]?.params.slug, "こんにちは");
    });

    it("should handle very long slugs", async () => {
      const longSlug = "a".repeat(200);
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [{ params: { slug: longSlug } }],
          fallback: false,
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals((result!.paths[0]?.params.slug as string).length, 200);
    });

    it("should handle large number of paths", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: Array.from({ length: 1000 }, (_, i) => ({
            params: { id: String(i) },
          })),
          fallback: false,
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result!.paths.length, 1000);
      assertEquals(result!.paths[999]?.params.id, "999");
    });

    it("should return null when getStaticPaths is undefined", async () => {
      const pageModule: PageWithData = {
        default: () => null,
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertEquals(result, null);
    });

    it("should throw errors from getStaticPaths", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => {
          throw new Error("API fetch failed");
        },
      };

      // Should throw the error (after logging it)
      let thrown = false;
      try {
        await fetcher.getStaticPaths(pageModule);
      } catch (error) {
        thrown = true;
        assertEquals((error as Error).message, "API fetch failed");
      }
      assertEquals(thrown, true);
    });
  });

  describe("getStaticPaths - Combined with getStaticData", () => {
    it("should work with getStaticData for full SSG", async () => {
      const pageModule: PageWithData<{ title: string; content: string }> = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [
            { params: { id: "1" } },
            { params: { id: "2" } },
          ],
          fallback: false,
        }),
        getStaticData: (ctx) => ({
          props: {
            title: `Post ${ctx.params.id}`,
            content: `Content for post ${ctx.params.id}`,
          },
        }),
      };

      // Get paths
      const paths = await fetcher.getStaticPaths(pageModule);
      assertExists(paths);
      assertEquals(paths.paths.length, 2);

      // Get data for each path
      const data1 = await fetcher.fetchData(
        pageModule,
        {
          params: { id: "1" },
          query: new URLSearchParams(),
          request: new Request("http://localhost/posts/1"),
          url: new URL("http://localhost/posts/1"),
        },
        "production",
      );

      assertEquals((data1.props as { title: string; content: string }).title, "Post 1");
      assertEquals(
        (data1.props as { title: string; content: string }).content,
        "Content for post 1",
      );
    });
  });

  describe("getStaticPaths - Incremental Static Regeneration (ISR)", () => {
    it("should support revalidate with paths", async () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [{ params: { id: "1" } }],
          fallback: "blocking",
        }),
        getStaticData: () => ({
          props: { timestamp: Date.now() },
          revalidate: 60, // Revalidate every 60 seconds
        }),
      };

      const paths = await fetcher.getStaticPaths(pageModule);
      assertExists(paths);
      assertEquals(paths.fallback, "blocking");
    });
  });
});
