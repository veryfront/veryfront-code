import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type {
  CacheEntry,
  DataContext,
  DataResult,
  InferGetServerDataProps,
  PageWithData,
  StaticPathsResult,
} from "./types.ts";

describe("types.ts", () => {
  describe("DataContext", () => {
    it("should define context structure for data fetching", () => {
      const context: DataContext = {
        params: { id: "123" },
        query: new URLSearchParams("?foo=bar"),
        request: new Request("http://localhost/test"),
        url: new URL("http://localhost/test"),
      };

      assertEquals(context.params.id, "123");
      assertEquals(context.query.get("foo"), "bar");
      assertExists(context.request);
      assertEquals(context.url.pathname, "/test");
    });

    it("should support array params for catch-all routes", () => {
      const context: DataContext = {
        params: { slug: ["a", "b", "c"] },
        query: new URLSearchParams(),
        request: new Request("http://localhost/docs/a/b/c"),
        url: new URL("http://localhost/docs/a/b/c"),
      };

      assertEquals(context.params.slug, ["a", "b", "c"]);
    });
  });

  describe("DataResult", () => {
    it("should support props result", () => {
      const result: DataResult<{ title: string }> = {
        props: { title: "Hello" },
      };

      assertEquals(result.props?.title, "Hello");
      assertEquals(result.redirect, undefined);
      assertEquals(result.notFound, undefined);
    });

    it("should support redirect result", () => {
      const result: DataResult = {
        redirect: {
          destination: "/login",
          permanent: false,
        },
      };

      assertEquals(result.redirect?.destination, "/login");
      assertEquals(result.redirect?.permanent, false);
    });

    it("should support permanent redirect", () => {
      const result: DataResult = {
        redirect: {
          destination: "/new-page",
          permanent: true,
        },
      };

      assertEquals(result.redirect?.permanent, true);
    });

    it("should support notFound result", () => {
      const result: DataResult = {
        notFound: true,
      };

      assertEquals(result.notFound, true);
    });

    it("should support revalidate option", () => {
      const result: DataResult = {
        props: {},
        revalidate: 60,
      };

      assertEquals(result.revalidate, 60);
    });

    it("should support revalidate: false for no revalidation", () => {
      const result: DataResult = {
        props: {},
        revalidate: false,
      };

      assertEquals(result.revalidate, false);
    });
  });

  describe("PageWithData", () => {
    it("should define page module structure", () => {
      const pageModule: PageWithData<{ name: string }> = {
        default: () => null,
        getServerData: (_context) => ({
          props: { name: "test" },
        }),
      };

      assertExists(pageModule.default);
      assertExists(pageModule.getServerData);
      assertEquals(pageModule.getStaticData, undefined);
      assertEquals(pageModule.getStaticPaths, undefined);
    });

    it("should support getStaticData", () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: (_context) => ({
          props: { data: "static" },
          revalidate: 60,
        }),
      };

      assertExists(pageModule.getStaticData);
    });

    it("should support getStaticPaths", () => {
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [{ params: { id: "1" } }, { params: { id: "2" } }],
          fallback: false,
        }),
      };

      assertExists(pageModule.getStaticPaths);
    });
  });

  describe("StaticPathsResult", () => {
    it("should define paths with fallback: false", () => {
      const result: StaticPathsResult = {
        paths: [
          { params: { id: "1" } },
          { params: { id: "2" } },
        ],
        fallback: false,
      };

      assertEquals(result.paths.length, 2);
      assertEquals(result.fallback, false);
    });

    it("should support fallback: true", () => {
      const result: StaticPathsResult = {
        paths: [],
        fallback: true,
      };

      assertEquals(result.fallback, true);
    });

    it("should support fallback: blocking", () => {
      const result: StaticPathsResult = {
        paths: [],
        fallback: "blocking",
      };

      assertEquals(result.fallback, "blocking");
    });

    it("should support array params for catch-all", () => {
      const result: StaticPathsResult = {
        paths: [
          { params: { slug: ["docs", "intro"] } },
          { params: { slug: ["docs", "getting-started"] } },
        ],
        fallback: false,
      };

      assertEquals(result.paths[0]?.params.slug, ["docs", "intro"]);
    });
  });

  describe("CacheEntry", () => {
    it("should define cache entry structure", () => {
      const entry: CacheEntry<{ title: string }> = {
        data: { props: { title: "Cached" } },
        timestamp: Date.now(),
        revalidate: 60,
      };

      assertEquals(entry.data.props?.title, "Cached");
      assertExists(entry.timestamp);
      assertEquals(entry.revalidate, 60);
    });

    it("should support revalidate: false", () => {
      const entry: CacheEntry = {
        data: { props: {} },
        timestamp: Date.now(),
        revalidate: false,
      };

      assertEquals(entry.revalidate, false);
    });
  });

  describe("InferGetServerDataProps", () => {
    it("should infer props type from PageWithData", () => {
      type TestPage = PageWithData<{ id: number; name: string }>;
      type InferredProps = InferGetServerDataProps<TestPage>;

      // Type-level test - if this compiles, the type inference works
      const props: InferredProps = { id: 1, name: "test" };
      assertEquals(props.id, 1);
      assertEquals(props.name, "test");
    });
  });
});
