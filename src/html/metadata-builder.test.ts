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

    it("preserves valid titles and body classes without silent truncation", () => {
      const title = "t".repeat(9_000);
      const bodyClass = "c".repeat(5_000);
      const result = processMetadata({
        slug: "test",
        title,
        frontmatter: { bodyClass },
      });

      assertEquals(result.effectiveTitle, title);
      assertEquals(result.bodyClass, bodyClass);
    });

    it("rejects oversized render titles instead of silently truncating them", () => {
      assertThrows(
        () =>
          processMetadata({
            slug: "test",
            title: "t".repeat(16 * 1024 + 1),
            frontmatter: {},
          }),
        Error,
        "title exceeds",
      );
    });

    it("rejects invalid explicit language tags instead of replacing them", () => {
      assertThrows(
        () => processMetadata({ slug: "test", frontmatter: { lang: "invalid language" } }),
        Error,
        "language tag",
      );
    });

    it("ignores non-string title values at runtime", () => {
      const result = processMetadata({
        slug: "test",
        title: { unsafe: true },
        frontmatter: { title: ["unsafe"] },
      } as never);

      assertEquals(result.effectiveTitle, "Veryfront App");
    });

    it("propagates CSP nonces to metadata scripts and styles", () => {
      const result = processMetadata(
        {
          slug: "test",
          frontmatter: {
            scripts: [{ src: "/app.js" }, { content: "globalThis.ready = true" }],
            styles: [{ content: "body { color: black; }" }],
          },
        },
        "nonce-123",
      );

      assertStringIncludes(result.scriptTags, 'src="/app.js" nonce="nonce-123"');
      assertStringIncludes(result.scriptTags, '<script nonce="nonce-123"');
      assertStringIncludes(result.styleTags, '<style nonce="nonce-123"');
    });

    it("does not execute render metadata accessors", () => {
      let accessorCalls = 0;
      const meta: Record<string, unknown> = { slug: "test" };
      Object.defineProperty(meta, "title", {
        enumerable: true,
        get() {
          accessorCalls++;
          return "Private title";
        },
      });

      assertThrows(
        () => processMetadata(meta as never),
        TypeError,
        "render metadata must not contain accessor properties",
      );
      assertEquals(accessorCalls, 0);
    });

    it("does not execute nested frontmatter accessors", () => {
      let accessorCalls = 0;
      const frontmatter: Record<string, unknown> = {};
      Object.defineProperty(frontmatter, "title", {
        enumerable: true,
        get() {
          accessorCalls++;
          return "Private title";
        },
      });

      assertThrows(
        () => processMetadata({ slug: "test", frontmatter } as never),
        TypeError,
        "frontmatter must not contain accessor properties",
      );
      assertEquals(accessorCalls, 0);
    });
  });
});
