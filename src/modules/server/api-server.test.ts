import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { APIServer } from "./api-server.ts";
import type { PageRendererLike, PageRenderResult } from "./api-server.ts";

function createMockRenderer(
  result?: Partial<PageRenderResult>,
  error?: Error,
): PageRendererLike {
  return {
    renderPage: (_slug: string) => {
      if (error) throw error;
      return Promise.resolve({
        html: result?.html ?? "<p>Hello</p>",
        frontmatter: result?.frontmatter ?? {},
        headings: result?.headings,
      });
    },
  };
}

describe("modules/server/api-server", () => {
  describe("APIServer.handleRequest", () => {
    it("should return null for non-data paths", async () => {
      const server = new APIServer({ renderer: createMockRenderer() });

      const result = await server.handleRequest("/about");
      assertEquals(result, null);
    });

    it("should return null for root path", async () => {
      const server = new APIServer({ renderer: createMockRenderer() });

      const result = await server.handleRequest("/");
      assertEquals(result, null);
    });

    it("should return null for partial prefix match", async () => {
      const server = new APIServer({ renderer: createMockRenderer() });

      const result = await server.handleRequest("/_veryfront/other");
      assertEquals(result, null);
    });

    it("should handle data request for a page", async () => {
      const server = new APIServer({
        renderer: createMockRenderer({
          html: "<h1>About</h1>",
          frontmatter: { title: "About" },
        }),
      });

      const response = await server.handleRequest("/_veryfront/data/about.json");
      assertEquals(response instanceof Response, true);
      assertEquals(response!.headers.get("content-type"), "application/json");

      const body = await response!.json();
      assertEquals(body.slug, "about");
      assertEquals(body.html, "<h1>About</h1>");
      assertEquals(body.frontmatter.title, "About");
    });

    it("should handle index page (empty slug)", async () => {
      const server = new APIServer({
        renderer: createMockRenderer({ html: "<h1>Home</h1>" }),
      });

      const response = await server.handleRequest("/_veryfront/data/.json");
      assertEquals(response instanceof Response, true);

      const body = await response!.json();
      // Empty slug should default to "index" for rendering
      assertEquals(body.slug, "");
    });

    it("should include headings when present", async () => {
      const headings = [
        { depth: 1, text: "Title", id: "title" },
        { depth: 2, text: "Section", id: "section" },
      ];
      const server = new APIServer({
        renderer: createMockRenderer({ headings }),
      });

      const response = await server.handleRequest("/_veryfront/data/page.json");
      const body = await response!.json();
      assertEquals(body.headings, headings);
    });

    it("should return 404 on render error", async () => {
      const server = new APIServer({
        renderer: createMockRenderer(undefined, new Error("Page not found")),
      });

      const response = await server.handleRequest("/_veryfront/data/missing.json");
      assertEquals(response!.status, 404);

      const body = await response!.json();
      assertEquals(body.error, "Page not found");
    });

    it("should handle non-Error throws", async () => {
      const renderer: PageRendererLike = {
        renderPage: () => {
          throw "string error";
        },
      };
      const server = new APIServer({ renderer });

      const response = await server.handleRequest("/_veryfront/data/bad.json");
      assertEquals(response!.status, 404);

      const body = await response!.json();
      assertEquals(body.error, "string error");
    });

    it("should set no-cache header on success", async () => {
      const server = new APIServer({ renderer: createMockRenderer() });

      const response = await server.handleRequest("/_veryfront/data/page.json");
      assertEquals(response!.headers.get("cache-control"), "no-cache");
    });

    it("should handle nested page slugs", async () => {
      const server = new APIServer({
        renderer: createMockRenderer({ html: "<p>Blog post</p>" }),
      });

      const response = await server.handleRequest("/_veryfront/data/blog/my-post.json");
      const body = await response!.json();
      assertEquals(body.slug, "blog/my-post");
    });
  });
});
