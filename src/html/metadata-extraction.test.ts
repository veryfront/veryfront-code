import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractHTMLMetadata } from "./metadata-extraction.ts";

describe("html/metadata-extraction", () => {
  describe("extractHTMLMetadata", () => {
    it("should extract title and description", () => {
      const meta = extractHTMLMetadata({ title: "My Page", description: "A page" });
      assertEquals(meta.title, "My Page");
      assertEquals(meta.description, "A page");
    });

    it("should use default title when not provided", () => {
      const meta = extractHTMLMetadata({});
      assertEquals(meta.title, "Veryfront App");
    });

    it("should merge layout and page frontmatter", () => {
      const meta = extractHTMLMetadata(
        { title: "Page Title" },
        { title: "Layout Title", description: "Layout Desc" },
      );
      assertEquals(meta.title, "Page Title");
      assertEquals(meta.description, "Layout Desc");
    });

    it("should extract og metadata into meta array", () => {
      const meta = extractHTMLMetadata({
        og: { title: "OG Title", image: "https://example.com/img.png" },
      });

      assertExists(meta.meta);
      assertEquals(meta.meta.length, 2);
      assertEquals(meta.meta[0]?.property, "og:title");
      assertEquals(meta.meta[0]?.content, "OG Title");
    });

    it("should extract twitter metadata into meta array", () => {
      const meta = extractHTMLMetadata({
        twitter: { card: "summary", site: "@veryfront" },
      });

      assertExists(meta.meta);
      assertEquals(meta.meta.length, 2);
      assertEquals(meta.meta[0]?.name, "twitter:card");
    });

    it("preserves finite numeric and boolean social metadata values", () => {
      const meta = extractHTMLMetadata({
        og: { imageWidth: 1200 },
        twitter: { enabled: true },
      });

      assertEquals(meta.meta, [
        { property: "og:imageWidth", content: "1200" },
        { name: "twitter:enabled", content: "true" },
      ]);
    });

    it("should handle nested metadata object", () => {
      const meta = extractHTMLMetadata({
        metadata: { title: "Nested Title" },
      });
      assertEquals(meta.title, "Nested Title");
      assertEquals(meta.metadata, { title: "Nested Title" });
    });

    it("preserves legacy layout and heading passthrough fields", () => {
      const meta = extractHTMLMetadata({
        layout: false,
        headings: [{ text: "Introduction", level: 2 }],
      });

      assertEquals(meta.layout, false);
      assertEquals(meta.headings, [{ text: "Introduction", level: 2 }]);
    });

    it("should pass through non-reserved keys", () => {
      const meta = extractHTMLMetadata({ customKey: "customValue" });
      assertEquals((meta as Record<string, unknown>).customKey, "customValue");
    });

    it("should handle arrays for meta, links, scripts, styles", () => {
      const meta = extractHTMLMetadata({
        meta: [{ name: "robots", content: "noindex" }],
        links: [{ rel: "canonical", href: "https://example.com" }],
        scripts: [{ src: "/app.js" }],
        styles: [{ href: "/style.css" }],
      });

      assertExists(meta.meta);
      assertExists(meta.links);
      assertExists(meta.scripts);
      assertExists(meta.styles);
      assertEquals(meta.meta.length, 1);
      assertEquals(meta.links.length, 1);
      assertEquals(meta.scripts.length, 1);
      assertEquals(meta.styles.length, 1);
    });

    it("does not mutate or alias structured metadata across extractions", () => {
      const source = {
        meta: [{ name: "robots", content: "index" }],
        links: [{ rel: "canonical", href: "https://example.com/original" }],
        scripts: [{ src: "/app.js" }],
        styles: [{ href: "/app.css" }],
        og: { title: "OpenGraph title" },
      };

      const first = extractHTMLMetadata(source);
      const second = extractHTMLMetadata(source);

      assertEquals(source.meta, [{ name: "robots", content: "index" }]);
      assertEquals(first.meta, [
        { name: "robots", content: "index" },
        { property: "og:title", content: "OpenGraph title" },
      ]);
      assertEquals(second.meta, first.meta);
      assertEquals(first.meta === second.meta, false);

      first.links![0]!.href = "https://example.com/changed";
      first.scripts![0]!.src = "/changed.js";
      first.styles![0]!.href = "/changed.css";

      assertEquals(source.links[0]?.href, "https://example.com/original");
      assertEquals(source.scripts[0]?.src, "/app.js");
      assertEquals(source.styles[0]?.href, "/app.css");
      assertEquals(second.links?.[0]?.href, "https://example.com/original");
      assertEquals(second.scripts?.[0]?.src, "/app.js");
      assertEquals(second.styles?.[0]?.href, "/app.css");
    });
  });
});
