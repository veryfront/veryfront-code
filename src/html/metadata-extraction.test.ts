import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import { extractHTMLMetadata } from "./metadata-extraction.ts";
import type { MDXFrontmatter } from "@veryfront/transforms/mdx/types.ts";

describe("metadata-extraction", () => {
  describe("extractHTMLMetadata", () => {
    it("should extract basic title and description", () => {
      const frontmatter: MDXFrontmatter = {
        title: "My Page",
        description: "Page description",
      };

      const metadata = extractHTMLMetadata(frontmatter);

      assertEquals(metadata.title, "My Page");
      assertEquals(metadata.description, "Page description");
    });

    it("should use default title if not provided", () => {
      const metadata = extractHTMLMetadata({});

      assertEquals(metadata.title, "Veryfront App");
    });

    it("should merge layout and page frontmatter", () => {
      const layout: MDXFrontmatter = {
        title: "Layout Title",
        description: "Layout Desc",
      };
      const page: MDXFrontmatter = {
        title: "Page Title",
      };

      const metadata = extractHTMLMetadata(page, layout);

      assertEquals(metadata.title, "Page Title");
      assertEquals(metadata.description, "Layout Desc");
    });

    it("should extract meta tags", () => {
      const frontmatter: MDXFrontmatter = {
        meta: [
          { name: "author", content: "Test Author" },
          { name: "keywords", content: "test, keywords" },
        ],
      };

      const metadata = extractHTMLMetadata(frontmatter);

      assertEquals(metadata.meta?.length, 2);
      assertEquals(metadata.meta?.[0]?.name, "author");
    });

    it("should convert og metadata to meta tags", () => {
      const frontmatter: MDXFrontmatter = {
        og: {
          title: "OG Title",
          description: "OG Description",
        },
      };

      const metadata = extractHTMLMetadata(frontmatter);

      assert(metadata.meta?.some(m => m.property === "og:title"));
      assert(metadata.meta?.some(m => m.property === "og:description"));
    });

    it("should convert twitter metadata to meta tags", () => {
      const frontmatter: MDXFrontmatter = {
        twitter: {
          card: "summary",
          site: "@example",
        },
      };

      const metadata = extractHTMLMetadata(frontmatter);

      assert(metadata.meta?.some(m => m.name === "twitter:card"));
      assert(metadata.meta?.some(m => m.name === "twitter:site"));
    });

    it("should extract links", () => {
      const frontmatter: MDXFrontmatter = {
        links: [
          { rel: "stylesheet", href: "/styles.css" },
        ],
      };

      const metadata = extractHTMLMetadata(frontmatter);

      assertEquals(metadata.links?.length, 1);
      assertEquals(metadata.links?.[0]?.rel, "stylesheet");
    });

    it("should extract icons", () => {
      const frontmatter: MDXFrontmatter = {
        icons: [
          { href: "/favicon.ico", rel: "icon" },
        ],
      };

      const metadata = extractHTMLMetadata(frontmatter);

      assertEquals(metadata.icons?.length, 1);
    });

    it("should extract scripts", () => {
      const frontmatter: MDXFrontmatter = {
        scripts: [
          { src: "/script.js" },
        ],
      };

      const metadata = extractHTMLMetadata(frontmatter);

      assertEquals(metadata.scripts?.length, 1);
    });

    it("should extract styles", () => {
      const frontmatter: MDXFrontmatter = {
        styles: [
          { href: "/styles.css" },
        ],
      };

      const metadata = extractHTMLMetadata(frontmatter);

      assertEquals(metadata.styles?.length, 1);
    });

    it("should extract viewport", () => {
      const frontmatter: MDXFrontmatter = {
        viewport: "width=device-width, initial-scale=1",
      };

      const metadata = extractHTMLMetadata(frontmatter);

      assertEquals(metadata.viewport, "width=device-width, initial-scale=1");
    });

    it("should extract themeColor", () => {
      const frontmatter: MDXFrontmatter = {
        themeColor: "#3b82f6",
      };

      const metadata = extractHTMLMetadata(frontmatter);

      assertEquals(metadata.themeColor, "#3b82f6");
    });

    it("should merge metadata property into metadata", () => {
      const frontmatter: MDXFrontmatter = {
        metadata: {
          customField: "custom value",
        },
      };

      const metadata = extractHTMLMetadata(frontmatter);

      assertEquals(metadata.customField, "custom value");
    });

    it("should copy other properties to metadata", () => {
      const frontmatter: MDXFrontmatter = {
        customProp: "value",
        anotherProp: 123,
      };

      const metadata = extractHTMLMetadata(frontmatter);

      assertEquals(metadata.customProp, "value");
      assertEquals(metadata.anotherProp, 123);
    });

    it("should handle empty frontmatter", () => {
      const metadata = extractHTMLMetadata({});

      assertEquals(metadata.title, "Veryfront App");
      assertEquals(metadata.description, "");
      assertEquals(metadata.meta, []);
      assertEquals(metadata.links, []);
    });
  });
});
