import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { StaticPathsFetcher } from "./static-paths-fetcher.ts";
import type { PageWithData } from "./types.ts";

function createFetcher(): StaticPathsFetcher {
  return new StaticPathsFetcher();
}

function createPageModule(
  getStaticPaths?: PageWithData["getStaticPaths"],
): PageWithData {
  return { default: () => null, ...(getStaticPaths ? { getStaticPaths } : {}) };
}

describe("StaticPathsFetcher", () => {
  it("should create a new instance", () => {
    assertExists(createFetcher());
  });

  describe("fetch", () => {
    it("should return null when getStaticPaths is not defined", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule();

      const result = await fetcher.fetch(pageModule);

      assertEquals(result, null);
    });

    it("should return paths from getStaticPaths", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => ({
        paths: [
          { params: { id: "1" } },
          { params: { id: "2" } },
          { params: { id: "3" } },
        ],
        fallback: false,
      }));

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.paths.length, 3);
      assertEquals(result.paths[0]?.params.id, "1");
      assertEquals(result.paths[1]?.params.id, "2");
      assertEquals(result.paths[2]?.params.id, "3");
    });

    it("should return fallback: false", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => ({
        paths: [],
        fallback: false,
      }));

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.fallback, false);
    });

    it("should return fallback: true", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => ({
        paths: [{ params: { slug: "test" } }],
        fallback: true,
      }));

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.fallback, true);
    });

    it("should return fallback: blocking", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => ({
        paths: [],
        fallback: "blocking",
      }));

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.fallback, "blocking");
    });

    it("should handle array params for catch-all routes", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => ({
        paths: [
          { params: { slug: ["docs", "intro"] } },
          { params: { slug: ["docs", "getting-started"] } },
          { params: { slug: ["blog", "post-1"] } },
        ],
        fallback: false,
      }));

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.paths[0]?.params.slug, ["docs", "intro"]);
      assertEquals(result.paths[1]?.params.slug, ["docs", "getting-started"]);
    });

    it("should handle empty paths array", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => ({
        paths: [],
        fallback: true,
      }));

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.paths.length, 0);
    });

    it("should support synchronous getStaticPaths", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => ({
        paths: [{ params: { id: "sync" } }],
        fallback: false,
      }));

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.paths[0]?.params.id, "sync");
    });

    it("should throw when getStaticPaths throws", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => {
        throw new Error("Failed to fetch paths from API");
      });

      await assertRejects(
        () => fetcher.fetch(pageModule),
        Error,
        "Failed to fetch paths from API",
      );
    });

    it("should handle multiple params per path", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => ({
        paths: [
          { params: { category: "tech", slug: "post-1" } },
          { params: { category: "news", slug: "post-2" } },
        ],
        fallback: false,
      }));

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.paths[0]?.params.category, "tech");
      assertEquals(result.paths[0]?.params.slug, "post-1");
    });
  });
});
