import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import { injectHTMLContent } from "./html-injection.ts";
import type { HTMLMetadata } from "@veryfront/transforms/mdx/types.ts";

describe("html-injection", () => {
  describe("injectHTMLContent", () => {
    const basicTemplate = `
<!DOCTYPE html>
<html>
<head>
  <title>{{ title }}</title>
  <meta name="description" content="{{ description }}">
  {{ meta }}
  {{ links }}
  {{ scripts }}
  {{ styles }}
  {{ devStyles }}
</head>
<body>
  {{ content }}
  {{ devScripts }}
</body>
</html>`;

    const metadata: HTMLMetadata = {
      title: "Test Page",
      description: "Test Description",
      meta: [{ name: "author", content: "Test Author" }],
      links: [{ rel: "stylesheet", href: "/styles.css" }],
      scripts: [{ src: "/script.js" }],
      styles: [{ content: "body { margin: 0; }" }],
    };

    it("should inject basic content and metadata", () => {
      const result = injectHTMLContent(
        basicTemplate,
        "<div>Hello World</div>",
        { title: "My Page", description: "My Desc" },
        { mode: "production", slug: "test" }
      );

      assert(result.includes("<title>My Page</title>"));
      assert(result.includes('content="My Desc"'));
      assert(result.includes("<div>Hello World</div>"));
    });

    it("should handle case-insensitive template placeholders", () => {
      const template = "{{ CONTENT }} {{ Title }} {{ DESCRIPTION }}";
      const result = injectHTMLContent(
        template,
        "test content",
        { title: "Test", description: "Desc" },
        { mode: "production", slug: "test" }
      );

      assert(result.includes("test content"));
      assert(result.includes("Test"));
      assert(result.includes("Desc"));
    });

    it("should inject meta tags", () => {
      const result = injectHTMLContent(
        basicTemplate,
        "",
        metadata,
        { mode: "production", slug: "test" }
      );

      assert(result.includes('<meta name="author"'));
      assert(result.includes('content="Test Author"'));
    });

    it("should inject link tags", () => {
      const result = injectHTMLContent(
        basicTemplate,
        "",
        metadata,
        { mode: "production", slug: "test" }
      );

      assert(result.includes('<link rel="stylesheet"'));
      assert(result.includes('href="/styles.css"'));
    });

    it("should inject script tags", () => {
      const result = injectHTMLContent(
        basicTemplate,
        "",
        metadata,
        { mode: "production", slug: "test" }
      );

      assert(result.includes('<script src="/script.js"'));
    });

    it("should inject style tags", () => {
      const result = injectHTMLContent(
        basicTemplate,
        "",
        metadata,
        { mode: "production", slug: "test" }
      );

      assert(result.includes("body { margin: 0; }"));
    });

    it("should inject dev scripts in development mode", () => {
      const result = injectHTMLContent(
        basicTemplate,
        "",
        {},
        { mode: "development", slug: "test" }
      );

      assert(result.includes("/_veryfront/rsc/client.js"));
      assert(result.includes("/_veryfront/hmr.js"));
    });

    it("should inject dev scripts with custom port", () => {
      const result = injectHTMLContent(
        basicTemplate,
        "",
        {},
        { mode: "development", slug: "test", devPort: 5555 }
      );

      assert(result.includes("/_veryfront/hmr.js?port=5555"));
    });

    it("should inject dev styles in development mode", () => {
      const result = injectHTMLContent(
        basicTemplate,
        "",
        {},
        { mode: "development", slug: "test" }
      );

      assert(result.includes(".dev-indicator"));
      assert(result.includes("#veryfront-error-overlay"));
    });

    it("should inject production scripts in production mode", () => {
      const result = injectHTMLContent(
        basicTemplate,
        "",
        {},
        { mode: "production", slug: "test-page" }
      );

      assert(result.includes("/_veryfront/hydrate.js?slug=test-page"));
      assert(!result.includes("/_veryfront/hmr.js"));
    });

    it("should remove dev placeholders in production mode", () => {
      const result = injectHTMLContent(
        basicTemplate,
        "",
        {},
        { mode: "production", slug: "test" }
      );

      assert(!result.includes("{{ devScripts }}"));
      assert(!result.includes("{{ devStyles }}"));
    });

    it("should inject hydration data for client pages", () => {
      const template = "<body>{{ content }}</body>";
      const result = injectHTMLContent(
        template,
        "test",
        {},
        { mode: "development", slug: "test", pagePath: "/test", isClientPage: true }
      );

      assert(result.includes('id="veryfront-hydration-data"'));
      assert(result.includes('"pagePath":"/test"'));
      assert(result.includes('"slug":"test"'));
      assert(result.includes('"isClientPage":true'));
    });

    it("should not inject hydration data for non-client pages", () => {
      const template = "<body>{{ content }}</body>";
      const result = injectHTMLContent(
        template,
        "test",
        {},
        { mode: "development", slug: "test", pagePath: "/test", isClientPage: false }
      );

      assert(!result.includes('id="veryfront-hydration-data"'));
    });

    it("should inject dev scripts before closing body tag if no placeholder", () => {
      const template = "<body>{{ content }}</body>";
      const result = injectHTMLContent(
        template,
        "test",
        {},
        { mode: "development", slug: "test" }
      );

      assert(result.includes("/_veryfront/rsc/client.js"));
      assert(result.includes("/_veryfront/hmr.js"));
      assert(result.includes(".dev-indicator"));
      assert(result.endsWith("</body>"));
    });

    it("should inject prod scripts before closing body tag if no placeholder", () => {
      const template = "<body>{{ content }}</body>";
      const result = injectHTMLContent(
        template,
        "test",
        {},
        { mode: "production", slug: "test-slug" }
      );

      assert(result.includes("/_veryfront/hydrate.js?slug=test-slug"));
      assert(result.endsWith("</body>"));
    });

    it("should handle template without body tag", () => {
      const template = "<div>{{ content }}</div>";
      const result = injectHTMLContent(
        template,
        "test",
        {},
        { mode: "development", slug: "test" }
      );

      assertEquals(result, "<div>test</div>");
    });

    it("should handle empty metadata", () => {
      const template = "{{ content }} {{ title }} {{ description }}";
      const result = injectHTMLContent(
        template,
        "test",
        {},
        { mode: "production", slug: "test" }
      );

      assert(result.includes("test"));
    });

    it("should handle whitespace in placeholders", () => {
      const template = "{{  content  }} {{   title   }}";
      const result = injectHTMLContent(
        template,
        "content here",
        { title: "Title Here" },
        { mode: "production", slug: "test" }
      );

      assert(result.includes("content here"));
      assert(result.includes("Title Here"));
    });

    it("should URL encode slug in production scripts", () => {
      const template = "<body>{{ content }}</body>";
      const result = injectHTMLContent(
        template,
        "test",
        {},
        { mode: "production", slug: "test/page with spaces" }
      );

      const encoded = encodeURIComponent("test/page with spaces");
      assert(result.includes(`/_veryfront/hydrate.js?slug=${encoded}`));
    });

    it("should prefer placeholder injection over auto-injection", () => {
      const template = "<body>{{ content }}{{ devScripts }}</body>";
      const result = injectHTMLContent(
        template,
        "test",
        {},
        { mode: "development", slug: "test" }
      );

      const scriptMatches = (result.match(/\/_veryfront\/rsc\/client\.js/g) || []).length;
      assertEquals(scriptMatches, 1, "Should only inject scripts once via placeholder");
    });
  });
});
