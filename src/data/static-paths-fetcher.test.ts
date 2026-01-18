import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { StaticPathsFetcher } from "./static-paths-fetcher.ts";
import type { PageWithData } from "./types.ts";

describe("StaticPathsFetcher", () => {
  describe("constructor", () => {
    it("should create a new instance", () => {
      const fetcher = new StaticPathsFetcher();
      assertExists(fetcher);
    });
  });

  describe("fetch", () => {
    it("should return null when getStaticPaths is not defined", async () => {
      const fetcher = new StaticPathsFetcher();
      const pageModule: PageWithData = {
        default: () => null,
      };

      const result = await fetcher.fetch(pageModule);

      assertEquals(result, null);
    });

    it("should return paths from getStaticPaths", async () => {
      const fetcher = new StaticPathsFetcher();
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

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.paths.length, 3);
      assertEquals(result.paths[0]?.params.id, "1");
      assertEquals(result.paths[1]?.params.id, "2");
      assertEquals(result.paths[2]?.params.id, "3");
    });

    it("should return fallback: false", async () => {
      const fetcher = new StaticPathsFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [],
          fallback: false,
        }),
      };

      const result = await fetcher.fetch(pageModule);

      assertEquals(result!.fallback, false);
    });

    it("should return fallback: true", async () => {
      const fetcher = new StaticPathsFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [{ params: { slug: "test" } }],
          fallback: true,
        }),
      };

      const result = await fetcher.fetch(pageModule);

      assertEquals(result!.fallback, true);
    });

    it("should return fallback: blocking", async () => {
      const fetcher = new StaticPathsFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [],
          fallback: "blocking",
        }),
      };

      const result = await fetcher.fetch(pageModule);

      assertEquals(result!.fallback, "blocking");
    });

    it("should handle array params for catch-all routes", async () => {
      const fetcher = new StaticPathsFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [
            { params: { slug: ["docs", "intro"] } },
            { params: { slug: ["docs", "getting-started"] } },
            { params: { slug: ["blog", "post-1"] } },
          ],
          fallback: false,
        }),
      };

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.paths[0]?.params.slug, ["docs", "intro"]);
      assertEquals(result.paths[1]?.params.slug, ["docs", "getting-started"]);
    });

    it("should handle empty paths array", async () => {
      const fetcher = new StaticPathsFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [],
          fallback: true,
        }),
      };

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.paths.length, 0);
    });

    it("should support synchronous getStaticPaths", async () => {
      const fetcher = new StaticPathsFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [{ params: { id: "sync" } }],
          fallback: false,
        }),
      };

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.paths[0]?.params.id, "sync");
    });

    it("should throw when getStaticPaths throws", async () => {
      const fetcher = new StaticPathsFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => {
          throw new Error("Failed to fetch paths from API");
        },
      };

      await assertRejects(
        () => fetcher.fetch(pageModule),
        Error,
        "Failed to fetch paths from API",
      );
    });

    it("should handle multiple params per path", async () => {
      const fetcher = new StaticPathsFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [
            { params: { category: "tech", slug: "post-1" } },
            { params: { category: "news", slug: "post-2" } },
          ],
          fallback: false,
        }),
      };

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.paths[0]?.params.category, "tech");
      assertEquals(result.paths[0]?.params.slug, "post-1");
    });
  });
});
