import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import type { RenderMetadata } from "#veryfront/types";
import { processMetadata } from "./metadata-builder.ts";

describe("html-generation/metadata-builder", () => {
  describe("processMetadata", () => {
    it("should process basic metadata", () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: { description: "Test description" },
      };

      const result = processMetadata(meta);

      assertEquals(result.effectiveTitle, "Test Page");
      assertEquals(result.metadata.description, "Test description");
      assertEquals(result.lang, "en");
    });

    it("preserves the complete top-level RenderMetadata input contract", () => {
      const meta: RenderMetadata = {
        description: "Top-level description",
        lang: "sv",
        bodyClass: "documentation",
        slug: "docs",
        layout: false,
        ssrHash: "hash",
      };

      const result = processMetadata(meta);

      assertEquals(result.metadata.description, "Top-level description");
      assertEquals(result.lang, "sv");
      assertEquals(result.bodyClass, "documentation");
    });

    it("should merge page and layout frontmatter", () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: { description: "Page description" },
        layoutFrontmatter: { themeColor: "#000000" },
      };

      const result = processMetadata(meta);

      assertEquals(result.metadata.description, "Page description");
      assertEquals(result.metadata.themeColor, "#000000");
    });

    it("should prioritize page frontmatter over layout", () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: { description: "Page description" },
        layoutFrontmatter: { description: "Layout description" },
      };

      const result = processMetadata(meta);

      assertEquals(result.metadata.description, "Page description");
    });

    it("does not let synthesized empty metadata erase layout fallbacks", () => {
      const result = processMetadata({
        title: "",
        description: "",
        frontmatter: {},
        layoutFrontmatter: {
          title: "Layout title",
          description: "Layout description",
          lang: "sv",
        },
      });

      assertEquals(result.effectiveTitle, "Layout title");
      assertEquals(result.metadata.description, "Layout description");
      assertEquals(result.lang, "sv");
    });

    it("propagates the response nonce to metadata scripts and styles", () => {
      const result = processMetadata(
        {
          frontmatter: {
            scripts: [{ src: "/app.js" }, { content: "globalThis.ready = true" }],
            styles: [{ href: "/app.css" }, { content: "body { color: black; }" }],
          },
        },
        "nonce-123",
      );

      assertStringIncludes(result.scriptTags, 'src="/app.js" nonce="nonce-123"');
      assertStringIncludes(result.scriptTags, '<script nonce="nonce-123"');
      assertStringIncludes(result.styleTags, 'href="/app.css" nonce="nonce-123"');
      assertStringIncludes(result.styleTags, '<style nonce="nonce-123"');
    });

    it("should generate meta tags", () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {
          description: "Test description",
          viewport: "width=device-width",
        },
      };

      const result = processMetadata(meta);

      assertStringIncludes(result.metaTags, 'charset="UTF-8"');
      assertStringIncludes(result.metaTags, 'name="description"');
      assertStringIncludes(result.metaTags, "Test description");
      assertStringIncludes(result.metaTags, 'name="viewport"');
    });

    it("rejects metadata that attempts to inject an attribute name", () => {
      assertThrows(
        () =>
          processMetadata({
            frontmatter: {
              links: [{
                rel: "canonical",
                href: "https://example.com",
                'x" onload="alert(1)': "payload",
              }],
            },
          }),
        TypeError,
        "attribute name",
      );
    });

    it("should handle custom body class", () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: { bodyClass: "custom-class" },
      };

      const result = processMetadata(meta);

      assertEquals(result.bodyClass, "custom-class");
    });

    it("should use default language when not specified", () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {},
      };

      const result = processMetadata(meta);

      assertEquals(result.lang, "en");
    });

    it("should use custom language when specified", () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: { lang: "ja" },
      };

      const result = processMetadata(meta);

      assertEquals(result.lang, "ja");
    });

    it("should fallback to default title when not provided", () => {
      const meta: RenderMetadata = {
        slug: "test",
        frontmatter: {},
      };

      const result = processMetadata(meta);

      assertEquals(result.effectiveTitle, "Veryfront App");
    });
  });
});
