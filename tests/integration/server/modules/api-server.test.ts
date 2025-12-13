
import { assertEquals, assertExists } from "std/assert/mod.ts";
import {
  APIServer,
  type APIServerOptions,
  type PageRendererLike,
  type PageRenderResult,
} from "../../../../src/module-system/server/index.ts";

class MockRenderer implements PageRendererLike {
  private pages: Map<string, PageRenderResult> = new Map();

  setPage(slug: string, result: PageRenderResult): void {
    this.pages.set(slug, result);
  }

  renderPage(slug: string): Promise<PageRenderResult> {
    const page = this.pages.get(slug);
    if (!page) {
      throw new Error(`Page not found: ${slug}`);
    }
    return Promise.resolve(page);
  }
}

Deno.test({
  name: "APIServer - creates instance with renderer",
  fn: () => {
    const renderer = new MockRenderer();
    const server = new APIServer({ renderer });

    assertExists(server, "Should create APIServer instance");
  },
});

Deno.test({
  name: "APIServer - returns null for non-API routes",
  fn: async () => {
    const renderer = new MockRenderer();
    const server = new APIServer({ renderer });

    const response = await server.handleRequest("/");
    assertEquals(response, null, "Should return null for root path");

    const response2 = await server.handleRequest("/about");
    assertEquals(response2, null, "Should return null for regular pages");

    const response3 = await server.handleRequest("/static/style.css");
    assertEquals(response3, null, "Should return null for static assets");
  },
});

Deno.test({
  name: "APIServer - handles page data API for valid pages",
  fn: async () => {
    const renderer = new MockRenderer();
    renderer.setPage("about", {
      html: "<h1>About</h1>",
      frontmatter: { title: "About Page" },
      headings: [{ depth: 1, text: "About", id: "about" }],
    });

    const server = new APIServer({ renderer });
    const response = await server.handleRequest("/_veryfront/data/about.json");

    assertExists(response, "Should return response for page data API");
    assertEquals(response!.status, 200, "Should return 200 status");
    assertEquals(
      response!.headers.get("content-type"),
      "application/json",
      "Should return JSON content-type",
    );

    const data = await response!.json();
    assertEquals(data.slug, "about", "Should include slug in response");
    assertEquals(data.frontmatter.title, "About Page", "Should include frontmatter");
    assertEquals(data.html, "<h1>About</h1>", "Should include rendered HTML");
    assertEquals(data.headings.length, 1, "Should include headings");
  },
});

Deno.test({
  name: "APIServer - handles index page data API",
  fn: async () => {
    const renderer = new MockRenderer();
    renderer.setPage("index", {
      html: "<h1>Home</h1>",
      frontmatter: { title: "Home" },
    });

    const server = new APIServer({ renderer });
    const response = await server.handleRequest("/_veryfront/data/.json");

    assertExists(response, "Should return response for index page");
    assertEquals(response!.status, 200, "Should return 200 status");

    const data = await response!.json();
    assertEquals(data.slug, "", "Should have empty slug for index");
    assertEquals(data.frontmatter.title, "Home", "Should include frontmatter");
  },
});

Deno.test({
  name: "APIServer - sets no-cache headers for page data",
  fn: async () => {
    const renderer = new MockRenderer();
    renderer.setPage("test", {
      html: "<div>Test</div>",
      frontmatter: {},
    });

    const server = new APIServer({ renderer });
    const response = await server.handleRequest("/_veryfront/data/test.json");

    assertEquals(
      response!.headers.get("cache-control"),
      "no-cache",
      "Should set no-cache header for dynamic data",
    );
  },
});

Deno.test({
  name: "APIServer - returns 404 for missing pages",
  fn: async () => {
    const renderer = new MockRenderer();
    const server = new APIServer({ renderer });

    const response = await server.handleRequest("/_veryfront/data/nonexistent.json");

    assertExists(response, "Should return response for missing pages");
    assertEquals(response!.status, 404, "Should return 404 status");
    assertEquals(
      response!.headers.get("content-type"),
      "application/json",
      "Should still return JSON",
    );

    const data = await response!.json();
    assertExists(data.error, "Should include error message");
    assertEquals(
      data.error,
      "Page not found: nonexistent",
      "Should include specific error message",
    );
  },
});

Deno.test({
  name: "APIServer - handles renderer errors gracefully",
  fn: async () => {
    const renderer: PageRendererLike = {
      renderPage(_slug: string): Promise<PageRenderResult> {
        return Promise.reject(new Error("Render failed unexpectedly"));
      },
    };

    const server = new APIServer({ renderer });
    const response = await server.handleRequest("/_veryfront/data/error.json");

    assertExists(response, "Should return response even when renderer fails");
    assertEquals(response!.status, 404, "Should return 404 for render errors");

    const data = await response!.json();
    assertEquals(data.error, "Render failed unexpectedly", "Should include error message");
  },
});

Deno.test({
  name: "APIServer - returns null for user-defined API routes",
  fn: async () => {
    const renderer = new MockRenderer();
    const server = new APIServer({ renderer });

    const response = await server.handleRequest("/api/users");
    assertEquals(response, null, "Should return null for /api/ routes");

    const response2 = await server.handleRequest("/api/posts/123");
    assertEquals(response2, null, "Should return null for nested API routes");
  },
});

Deno.test({
  name: "APIServer - handles nested page slugs",
  fn: async () => {
    const renderer = new MockRenderer();
    renderer.setPage("docs/getting-started", {
      html: "<h1>Getting Started</h1>",
      frontmatter: { title: "Getting Started" },
    });

    const server = new APIServer({ renderer });
    const response = await server.handleRequest("/_veryfront/data/docs/getting-started.json");

    assertExists(response, "Should handle nested slugs");
    assertEquals(response!.status, 200, "Should return 200 for nested pages");

    const data = await response!.json();
    assertEquals(data.slug, "docs/getting-started", "Should preserve nested slug structure");
  },
});

Deno.test({
  name: "APIServer - includes all page data fields in response",
  fn: async () => {
    const renderer = new MockRenderer();
    renderer.setPage("complete", {
      html: "<article>Content</article>",
      frontmatter: {
        title: "Complete Page",
        author: "Test Author",
        date: "2024-01-01",
      },
      headings: [
        { depth: 1, text: "Main Title", id: "main" },
        { depth: 2, text: "Subtitle", id: "subtitle" },
      ],
    });

    const server = new APIServer({ renderer });
    const response = await server.handleRequest("/_veryfront/data/complete.json");

    const data = await response!.json();

    assertExists(data.slug, "Should include slug");
    assertExists(data.frontmatter, "Should include frontmatter");
    assertExists(data.headings, "Should include headings");
    assertExists(data.html, "Should include HTML");

    assertEquals(data.frontmatter.title, "Complete Page", "Should include title");
    assertEquals(data.frontmatter.author, "Test Author", "Should include author");
    assertEquals(data.frontmatter.date, "2024-01-01", "Should include date");
    assertEquals(data.headings.length, 2, "Should include all headings");
  },
});

Deno.test({
  name: "APIServer - handles pages without headings",
  fn: async () => {
    const renderer = new MockRenderer();
    renderer.setPage("no-headings", {
      html: "<p>Simple content</p>",
      frontmatter: { title: "Simple" },
    });

    const server = new APIServer({ renderer });
    const response = await server.handleRequest("/_veryfront/data/no-headings.json");

    const data = await response!.json();
    assertEquals(data.headings, undefined, "Headings should be undefined when not provided");
  },
});

Deno.test({
  name: "APIServer - handles empty frontmatter",
  fn: async () => {
    const renderer = new MockRenderer();
    renderer.setPage("minimal", {
      html: "<div>Minimal</div>",
      frontmatter: {},
    });

    const server = new APIServer({ renderer });
    const response = await server.handleRequest("/_veryfront/data/minimal.json");

    const data = await response!.json();
    assertExists(data.frontmatter, "Frontmatter should exist");
    assertEquals(Object.keys(data.frontmatter).length, 0, "Frontmatter should be empty object");
  },
});

Deno.test({
  name: "APIServer - removes .json extension from slugs",
  fn: async () => {
    const renderer = new MockRenderer();
    renderer.setPage("blog/post", {
      html: "<article>Post</article>",
      frontmatter: {},
    });

    const server = new APIServer({ renderer });
    const response = await server.handleRequest("/_veryfront/data/blog/post.json");

    const data = await response!.json();
    assertEquals(data.slug, "blog/post", "Should remove .json extension from slug");
  },
});

Deno.test({
  name: "APIServer - handles non-Error exceptions",
  fn: async () => {
    const renderer: PageRendererLike = {
      renderPage(_slug: string): Promise<PageRenderResult> {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        return Promise.reject("String error message");
      },
    };

    const server = new APIServer({ renderer });
    const response = await server.handleRequest("/_veryfront/data/test.json");

    assertExists(response, "Should handle non-Error exceptions");
    assertEquals(response!.status, 404, "Should return 404");

    const data = await response!.json();
    assertEquals(data.error, "String error message", "Should convert non-Error to string");
  },
});

Deno.test({
  name: "APIServer - handles multiple sequential requests",
  fn: async () => {
    const renderer = new MockRenderer();
    renderer.setPage("page1", {
      html: "<h1>Page 1</h1>",
      frontmatter: { title: "Page 1" },
    });
    renderer.setPage("page2", {
      html: "<h1>Page 2</h1>",
      frontmatter: { title: "Page 2" },
    });

    const server = new APIServer({ renderer });

    const response1 = await server.handleRequest("/_veryfront/data/page1.json");
    const data1 = await response1!.json();
    assertEquals(data1.frontmatter.title, "Page 1", "First request should succeed");

    const response2 = await server.handleRequest("/_veryfront/data/page2.json");
    const data2 = await response2!.json();
    assertEquals(data2.frontmatter.title, "Page 2", "Second request should succeed");
  },
});

Deno.test({
  name: "APIServer - accepts valid options interface",
  fn: () => {
    const renderer = new MockRenderer();
    const options: APIServerOptions = {
      renderer,
    };

    const server = new APIServer(options);
    assertExists(server, "Should accept options interface");
  },
});

Deno.test({
  name: "APIServer - correctly identifies page data endpoints",
  fn: async () => {
    const renderer = new MockRenderer();
    const server = new APIServer({ renderer });

    const response1 = await server.handleRequest("/_veryfront/data/test.json");
    assertExists(response1, "Should handle /_veryfront/data/ prefix");

    const response2 = await server.handleRequest("/veryfront/data/test.json");
    assertEquals(response2, null, "Should not handle without leading underscore");

    const response3 = await server.handleRequest("/_veryfront/api/test.json");
    assertEquals(response3, null, "Should not handle different /_veryfront/ paths");
  },
});

Deno.test({
  name: "APIServer - works with any PageRendererLike implementation",
  fn: async () => {
    const customRenderer: PageRendererLike = {
      renderPage(slug: string): Promise<PageRenderResult> {
        return Promise.resolve({
          html: `<div>${slug}</div>`,
          frontmatter: { slug },
          headings: [],
        });
      },
    };

    const server = new APIServer({ renderer: customRenderer });
    const response = await server.handleRequest("/_veryfront/data/custom.json");

    const data = await response!.json();
    assertEquals(data.html, "<div>custom</div>", "Should work with custom renderer");
    assertEquals(data.frontmatter.slug, "custom", "Should pass slug to renderer");
  },
});

Deno.test({
  name: "APIServer - sets consistent headers for all responses",
  fn: async () => {
    const renderer = new MockRenderer();
    renderer.setPage("test", {
      html: "<div>Test</div>",
      frontmatter: {},
    });

    const server = new APIServer({ renderer });

    const successResponse = await server.handleRequest("/_veryfront/data/test.json");
    assertEquals(successResponse!.headers.get("content-type"), "application/json");

    const errorResponse = await server.handleRequest("/_veryfront/data/missing.json");
    assertEquals(errorResponse!.headers.get("content-type"), "application/json");
  },
});

Deno.test({
  name: "APIServer - handles special characters in slugs",
  fn: async () => {
    const renderer = new MockRenderer();
    renderer.setPage("blog/my-post-2024", {
      html: "<article>Post</article>",
      frontmatter: { title: "My Post" },
    });

    const server = new APIServer({ renderer });
    const response = await server.handleRequest("/_veryfront/data/blog/my-post-2024.json");

    const data = await response!.json();
    assertEquals(data.slug, "blog/my-post-2024", "Should handle hyphens and numbers in slugs");
  },
});

Deno.test({
  name: "APIServer - continues on logging errors",
  fn: async () => {
    const renderer: PageRendererLike = {
      renderPage(_slug: string): Promise<PageRenderResult> {
        return Promise.reject(new Error("Test error"));
      },
    };

    const server = new APIServer({ renderer });
    const response = await server.handleRequest("/_veryfront/data/test.json");

    assertExists(response, "Should return response despite potential logging errors");
    assertEquals(response!.status, 404, "Should return 404 for render errors");
  },
});
