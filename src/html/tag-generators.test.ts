import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import {
  generateMetaTags,
  generateLinkTags,
  generateScriptTags,
  generateStyleTags,
} from "./tag-generators.ts";
import type { HTMLMetadata } from "@veryfront/transforms/mdx/types.ts";

describe("tag-generators", () => {
  describe("generateMetaTags", () => {
    it("should always include charset", () => {
      const tags = generateMetaTags({});

      assert(tags.includes('<meta charset="UTF-8">'));
    });

    it("should include default viewport if not specified", () => {
      const tags = generateMetaTags({});

      assert(tags.includes('<meta name="viewport" content="width=device-width, initial-scale=1.0">'));
    });

    it("should use custom viewport if specified", () => {
      const metadata: HTMLMetadata = {
        viewport: "width=1024",
      };
      const tags = generateMetaTags(metadata);

      assert(tags.includes('content="width=1024"'));
    });

    it("should include description meta tag", () => {
      const metadata: HTMLMetadata = {
        description: "Test description",
      };
      const tags = generateMetaTags(metadata);

      assert(tags.includes('<meta name="description" content="Test description">'));
    });

    it("should escape HTML in description", () => {
      const metadata: HTMLMetadata = {
        description: 'Test <script>alert("xss")</script>',
      };
      const tags = generateMetaTags(metadata);

      assert(tags.includes("&lt;script&gt;"));
      assert(!tags.includes("<script>"));
    });

    it("should include custom meta tags", () => {
      const metadata: HTMLMetadata = {
        meta: [
          { name: "author", content: "John Doe" },
          { name: "keywords", content: "test, example" },
        ],
      };
      const tags = generateMetaTags(metadata);

      assert(tags.includes('name="author"'));
      assert(tags.includes('content="John Doe"'));
    });

    it("should include theme-color if specified", () => {
      const metadata: HTMLMetadata = {
        themeColor: "#3b82f6",
      };
      const tags = generateMetaTags(metadata);

      assert(tags.includes('<meta name="theme-color" content="#3b82f6">'));
    });
  });

  describe("generateLinkTags", () => {
    it("should generate link tags", () => {
      const metadata: HTMLMetadata = {
        links: [
          { rel: "stylesheet", href: "/styles.css" },
          { rel: "canonical", href: "https://example.com" },
        ],
      };
      const tags = generateLinkTags(metadata);

      assert(tags.includes('<link rel="stylesheet" href="/styles.css">'));
      assert(tags.includes('<link rel="canonical" href="https://example.com">'));
    });

    it("should generate icon link tags", () => {
      const metadata: HTMLMetadata = {
        icons: [
          { href: "/favicon.ico" },
          { href: "/icon-192.png", sizes: "192x192", type: "image/png" },
        ],
      };
      const tags = generateLinkTags(metadata);

      assert(tags.includes('rel="icon"'));
      assert(tags.includes('href="/favicon.ico"'));
      assert(tags.includes('sizes="192x192"'));
    });

    it("should use custom rel for icons", () => {
      const metadata: HTMLMetadata = {
        icons: [
          { href: "/apple-touch-icon.png", rel: "apple-touch-icon" },
        ],
      };
      const tags = generateLinkTags(metadata);

      assert(tags.includes('rel="apple-touch-icon"'));
    });

    it("should handle empty links", () => {
      const tags = generateLinkTags({});

      assertEquals(tags, "");
    });
  });

  describe("generateScriptTags", () => {
    it("should generate script tags with src", () => {
      const metadata: HTMLMetadata = {
        scripts: [
          { src: "/script.js" },
        ],
      };
      const tags = generateScriptTags(metadata);

      assert(tags.includes('<script src="/script.js"></script>'));
    });

    it("should generate inline script tags", () => {
      const metadata: HTMLMetadata = {
        scripts: [
          { content: "console.log('hello');" },
        ],
      };
      const tags = generateScriptTags(metadata);

      assert(tags.includes("console.log('hello');"));
      assert(tags.includes("</script>"));
    });

    it("should add nonce to inline scripts", () => {
      const metadata: HTMLMetadata = {
        scripts: [
          { content: "console.log('test');" },
        ],
      };
      const tags = generateScriptTags(metadata, "test-nonce");

      assert(tags.includes('nonce="test-nonce"'));
    });

    it("should preserve script attributes", () => {
      const metadata: HTMLMetadata = {
        scripts: [
          { src: "/script.js", type: "module", async: "true" },
        ],
      };
      const tags = generateScriptTags(metadata);

      assert(tags.includes('type="module"'));
      assert(tags.includes('async="true"'));
    });

    it("should handle empty scripts", () => {
      const tags = generateScriptTags({});

      assertEquals(tags, "");
    });
  });

  describe("generateStyleTags", () => {
    it("should generate link tags for external styles", () => {
      const metadata: HTMLMetadata = {
        styles: [
          { href: "/styles.css" },
        ],
      };
      const tags = generateStyleTags(metadata);

      assert(tags.includes('<link rel="stylesheet" href="/styles.css">'));
    });

    it("should generate inline style tags", () => {
      const metadata: HTMLMetadata = {
        styles: [
          { content: "body { margin: 0; }" },
        ],
      };
      const tags = generateStyleTags(metadata);

      assert(tags.includes("body { margin: 0; }"));
      assert(tags.includes("</style>"));
    });

    it("should add nonce to inline styles", () => {
      const metadata: HTMLMetadata = {
        styles: [
          { content: "body { margin: 0; }" },
        ],
      };
      const tags = generateStyleTags(metadata, "test-nonce");

      assert(tags.includes('nonce="test-nonce"'));
    });

    it("should preserve style attributes for external styles", () => {
      const metadata: HTMLMetadata = {
        styles: [
          { href: "/styles.css", media: "print" },
        ],
      };
      const tags = generateStyleTags(metadata);

      assert(tags.includes('media="print"'));
    });

    it("should handle empty styles", () => {
      const tags = generateStyleTags({});

      assertEquals(tags, "");
    });
  });
});
