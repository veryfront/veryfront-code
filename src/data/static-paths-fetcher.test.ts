import { assertEquals, assertRejects } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { StaticPathsFetcher } from "./static-paths-fetcher.ts";
import type { PageWithData, StaticPathsResult } from "./types.ts";

describe("StaticPathsFetcher", () => {
  describe("fetch", () => {
    it("should return null when getStaticPaths is not defined", async () => {
      const fetcher = new StaticPathsFetcher();
      const pageModule: PageWithData = {
        default: () => null,
      };

      const result = await fetcher.fetch(pageModule);

      assertEquals(result, null);
    });

    it("should return paths when getStaticPaths is defined", async () => {
      const fetcher = new StaticPathsFetcher();
      const expectedResult: StaticPathsResult = {
        paths: [
          { params: { id: "1" } },
          { params: { id: "2" } },
        ],
        fallback: false,
      };

      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: async () => expectedResult,
      };

      const result = await fetcher.fetch(pageModule);

      assertEquals(result, expectedResult);
    });

    it("should handle synchronous getStaticPaths", async () => {
      const fetcher = new StaticPathsFetcher();
      const expectedResult: StaticPathsResult = {
        paths: [
          { params: { slug: "hello" } },
        ],
        fallback: true,
      };

      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => expectedResult,
      };

      const result = await fetcher.fetch(pageModule);

      assertEquals(result, expectedResult);
    });

    it("should handle blocking fallback", async () => {
      const fetcher = new StaticPathsFetcher();
      const expectedResult: StaticPathsResult = {
        paths: [
          { params: { category: "tech" } },
          { params: { category: "news" } },
        ],
        fallback: "blocking",
      };

      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: async () => expectedResult,
      };

      const result = await fetcher.fetch(pageModule);

      assertEquals(result, expectedResult);
    });

    it("should handle empty paths array", async () => {
      const fetcher = new StaticPathsFetcher();
      const expectedResult: StaticPathsResult = {
        paths: [],
        fallback: true,
      };

      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: async () => expectedResult,
      };

      const result = await fetcher.fetch(pageModule);

      assertEquals(result, expectedResult);
    });

    it("should handle complex param structures", async () => {
      const fetcher = new StaticPathsFetcher();
      const expectedResult: StaticPathsResult = {
        paths: [
          { params: { category: "tech", slug: ["post", "1"] } },
          { params: { category: "news", slug: ["article", "2"] } },
        ],
        fallback: false,
      };

      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: async () => expectedResult,
      };

      const result = await fetcher.fetch(pageModule);

      assertEquals(result, expectedResult);
    });

    it("should throw error when getStaticPaths throws", async () => {
      const fetcher = new StaticPathsFetcher();
      const error = new Error("Failed to fetch paths");

      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: async () => {
          throw error;
        },
      };

      await assertRejects(
        async () => await fetcher.fetch(pageModule),
        Error,
        "Failed to fetch paths",
      );
    });

    it("should handle getStaticPaths that rejects with custom error", async () => {
      const fetcher = new StaticPathsFetcher();

      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: async () => {
          throw new Error("Database connection failed");
        },
      };

      await assertRejects(
        async () => await fetcher.fetch(pageModule),
        Error,
        "Database connection failed",
      );
    });
  });
});
