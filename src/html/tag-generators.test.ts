import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  generateLinkTags,
  generateMetaTags,
  generateScriptTags,
  generateStyleTags,
} from "./tag-generators.ts";

describe("tag-generators", () => {
  describe("generateMetaTags", () => {
    it("should always include charset meta tag", () => {
      const result = generateMetaTags({});
      assertStringIncludes(result, '<meta charset="UTF-8">');
    });

    it("should include default viewport when not specified", () => {
      const result = generateMetaTags({});
      assertStringIncludes(result, 'name="viewport"');
      assertStringIncludes(result, "width=device-width, initial-scale=1.0");
    });

    it("should use custom viewport when specified", () => {
      const result = generateMetaTags({
        viewport: "width=device-width, initial-scale=1.0, maximum-scale=1.0",
      });
      assertStringIncludes(result, "maximum-scale=1.0");
    });

    it("should include description meta tag", () => {
      const result = generateMetaTags({ description: "Test description" });
      assertStringIncludes(result, 'name="description"');
      assertStringIncludes(result, 'content="Test description"');
    });

    it("should escape special characters in description", () => {
      const result = generateMetaTags({
        description: 'Test "quoted" & <special>',
      });
      assertStringIncludes(result, "&quot;quoted&quot;");
      assertStringIncludes(result, "&amp;");
      assertStringIncludes(result, "&lt;special&gt;");
    });

    it("should include custom meta tags", () => {
      const result = generateMetaTags({
        meta: [
          { name: "author", content: "John Doe" },
          { property: "og:title", content: "Open Graph Title" },
        ],
      });
      assertStringIncludes(result, 'name="author"');
      assertStringIncludes(result, 'content="John Doe"');
      assertStringIncludes(result, 'property="og:title"');
    });

    it("should include theme-color meta tag", () => {
      const result = generateMetaTags({ themeColor: "#ffffff" });
      assertStringIncludes(result, 'name="theme-color"');
      assertStringIncludes(result, 'content="#ffffff"');
    });
  });

  describe("generateLinkTags", () => {
    it("should return empty string when no links", () => {
      const result = generateLinkTags({});
      assertEquals(result, "");
    });

    it("should generate link tags", () => {
      const result = generateLinkTags({
        links: [{ rel: "stylesheet", href: "/styles.css" }],
      });
      assertStringIncludes(result, 'rel="stylesheet"');
      assertStringIncludes(result, 'href="/styles.css"');
    });

    it("should add crossorigin for font preloads", () => {
      const result = generateLinkTags({
        links: [
          { rel: "preload", as: "font", href: "/font.woff2", type: "font/woff2" },
        ],
      });
      assertStringIncludes(result, 'crossorigin="anonymous"');
    });

    it("should not override existing crossorigin", () => {
      const result = generateLinkTags({
        links: [
          {
            rel: "preload",
            as: "font",
            href: "/font.woff2",
            crossorigin: "use-credentials",
          },
        ],
      });
      assertStringIncludes(result, 'crossorigin="use-credentials"');
    });

    it("should generate icon tags", () => {
      const result = generateLinkTags({
        icons: [
          { href: "/favicon.ico" },
          { href: "/apple-touch-icon.png", rel: "apple-touch-icon", sizes: "180x180" },
        ],
      });
      assertStringIncludes(result, 'rel="icon"');
      assertStringIncludes(result, 'href="/favicon.ico"');
      assertStringIncludes(result, 'rel="apple-touch-icon"');
      assertStringIncludes(result, 'sizes="180x180"');
    });
  });

  describe("generateScriptTags", () => {
    it("should return empty string when no scripts", () => {
      const result = generateScriptTags({});
      assertEquals(result, "");
    });

    it("should generate external script tags", () => {
      const result = generateScriptTags({
        scripts: [{ src: "/app.js", async: "true" }],
      });
      assertStringIncludes(result, 'src="/app.js"');
      assertStringIncludes(result, 'async="true"');
    });

    it("should generate inline script tags", () => {
      const result = generateScriptTags({
        scripts: [{ content: "console.log('hello');" }],
      });
      assertStringIncludes(result, "console.log('hello');");
      assertStringIncludes(result, "</script>");
    });

    it("should add nonce to inline scripts", () => {
      const result = generateScriptTags(
        { scripts: [{ content: "alert(1);" }] },
        "abc123",
      );
      assertStringIncludes(result, 'nonce="abc123"');
    });

    it("should prioritize src over content", () => {
      // When both src and content are provided, src takes precedence
      const result = generateScriptTags({
        scripts: [{ content: "alert(1);", src: "/script.js" }],
      });
      assertStringIncludes(result, 'src="/script.js"');
      // Content is not included when src is present
      assertEquals(result.includes("alert(1);"), false);
    });

    it("should handle module scripts", () => {
      const result = generateScriptTags({
        scripts: [{ src: "/module.js", type: "module" }],
      });
      assertStringIncludes(result, 'type="module"');
    });
  });

  describe("generateStyleTags", () => {
    it("should return empty string when no styles", () => {
      const result = generateStyleTags({});
      assertEquals(result, "");
    });

    it("should generate external stylesheet links", () => {
      const result = generateStyleTags({
        styles: [{ href: "/styles.css" }],
      });
      assertStringIncludes(result, 'rel="stylesheet"');
      assertStringIncludes(result, 'href="/styles.css"');
    });

    it("should generate inline style tags", () => {
      const result = generateStyleTags({
        styles: [{ content: "body { color: red; }" }],
      });
      assertStringIncludes(result, "body { color: red; }");
      assertStringIncludes(result, "</style>");
    });

    it("should add nonce to inline styles", () => {
      const result = generateStyleTags(
        { styles: [{ content: ".test { color: blue; }" }] },
        "xyz789",
      );
      assertStringIncludes(result, 'nonce="xyz789"');
    });

    it("should handle media attribute", () => {
      const result = generateStyleTags({
        styles: [{ href: "/print.css", media: "print" }],
      });
      assertStringIncludes(result, 'media="print"');
    });
  });
});
