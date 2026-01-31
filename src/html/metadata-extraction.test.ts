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

    it("should handle nested metadata object", () => {
      const meta = extractHTMLMetadata({
        metadata: { title: "Nested Title" },
      });
      assertEquals(meta.title, "Nested Title");
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
  });
});
