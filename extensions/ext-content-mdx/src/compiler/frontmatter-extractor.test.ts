import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { extractContentFrontmatter } from "./frontmatter-extractor.ts";

function extractFrontmatter(
  content: string,
  frontmatter?: Record<string, unknown>,
  syntax: "markdown" | "mdx" = "mdx",
) {
  return extractContentFrontmatter({
    content,
    frontmatter,
    syntax,
  });
}

describe("ext-content-mdx/frontmatter-extractor", () => {
  describe("extractFrontmatter", () => {
    it("should return empty frontmatter for content without frontmatter", () => {
      const content = "# Hello World";
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter, {});
      assertEquals(result.body, content);
    });

    it("should extract YAML frontmatter", () => {
      const content = `---
title: My Post
date: 2024-01-01
---
# Content here`;
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter.title, "My Post");
      assertEquals(result.body.includes("# Content here"), true);
    });

    it("extracts YAML frontmatter after a UTF-8 byte-order mark", () => {
      const content = "\uFEFF---\ntitle: BOM document\n---\n# Content";
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter.title, "BOM document");
      assertEquals(result.body.trim(), "# Content");
    });

    it("should merge provided frontmatter with extracted", () => {
      const content = `---
title: From YAML
---
Body text`;
      const result = extractFrontmatter(content, { author: "Test" });

      assertEquals(result.frontmatter.title, "From YAML");
      assertEquals(result.frontmatter.author, "Test");
    });

    it("rejects accessor-backed provided frontmatter without invoking it", () => {
      let accessorReads = 0;
      const provided = {};
      Object.defineProperty(provided, "author", {
        enumerable: true,
        get() {
          accessorReads++;
          return "Hidden";
        },
      });

      assertThrows(
        () => extractFrontmatter("# Content", provided),
        TypeError,
        "must be a data property",
      );
      assertEquals(accessorReads, 0);
    });

    it("copies __proto__ as data without mutating the result prototype", () => {
      const provided = Object.create(null) as Record<string, unknown>;
      provided.__proto__ = "metadata";

      const result = extractFrontmatter("# Content", provided);

      assertEquals(Object.getPrototypeOf(result.frontmatter), Object.prototype);
      assertEquals(result.frontmatter.__proto__, "metadata");
    });

    it("should extract export const strings", () => {
      const content = `export const title = "My Title";
export const draft = true;
# Content`;
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter.title, "My Title");
      assertEquals(result.frontmatter.draft, true);
    });

    it("should extract export const numbers", () => {
      const content = `export const order = 42;
export const rating = 4.5;
Body`;
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter.order, 42);
      assertEquals(result.frontmatter.rating, 4.5);
    });

    it("should extract export const false", () => {
      const content = `export const published = false;
Body`;
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter.published, false);
    });

    it("should extract export const null", () => {
      const content = `export const category = null;
Body`;
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter.category, null);
    });

    it("should remove extracted export lines from body", () => {
      const content = `export const title = "Test";
# Heading`;
      const result = extractFrontmatter(content);

      assertEquals(result.body.includes("export const title"), false);
      assertEquals(result.body.includes("# Heading"), true);
    });

    it("should handle content with both YAML and export constants", () => {
      const content = `---
layout: post
---
export const title = "Override";
# Hello`;
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter.layout, "post");
      assertEquals(result.frontmatter.title, "Override");
    });

    it("does not extract export examples from fenced code blocks", () => {
      const content = [
        "```ts",
        'export const title = "Example only";',
        "```",
        "# Content",
      ].join("\n");
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter, {});
      assertEquals(result.body, content);
    });

    it("classifies static metadata structurally in plain Markdown", () => {
      const content = [
        "```ts",
        'export const example = "Rendered code";',
        "```",
        "",
        'export const title = "Document metadata";',
      ].join("\n");
      const result = extractFrontmatter(content, undefined, "markdown");

      assertEquals(result.frontmatter, { title: "Document metadata" });
      assertEquals(result.body.includes("Rendered code"), true);
      assertEquals(result.body.includes("Document metadata"), false);
    });

    it("does not extract exports from multiline comments", () => {
      const content = [
        "<!--",
        'export const title = "Comment only";',
        "-->",
        "# Content",
      ].join("\n");
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter, {});
      assertEquals(result.body, content);
    });

    it("does not extract export-shaped text from an MDX expression", () => {
      const content = [
        "{`before",
        'export const title = "Expression text";',
        "after`}",
      ].join("\n");
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter, {});
      assertEquals(result.body, content);
    });

    it("still extracts a top-level export after rendered content", () => {
      const content = [
        "# Content",
        "",
        'export const title = "Late metadata";',
        "",
        "More content",
      ].join("\n");
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter.title, "Late metadata");
      assertEquals(result.body.includes("export const title"), false);
      assertEquals(result.body.includes("More content"), true);
    });

    it("preserves candidate exports when the surrounding MDX is invalid", () => {
      const content = [
        "{unclosedExpression",
        "",
        'export const title = "Must remain visible";',
      ].join("\n");
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter, {});
      assertEquals(result.body, content);
    });

    it("decodes supported JavaScript literals through the parser", () => {
      const content = [
        String.raw`export const title = "Line\nBreak";`,
        "export const order = -2.5;",
        "export const summary = `Static summary`;",
        "# Content",
      ].join("\n");
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter.title, "Line\nBreak");
      assertEquals(result.frontmatter.order, -2.5);
      assertEquals(result.frontmatter.summary, "Static summary");
      assertEquals(result.body.includes("export const"), false);
    });

    it("should handle empty content", () => {
      const result = extractFrontmatter("");

      assertEquals(result.body, "");
      assertEquals(result.frontmatter, {});
    });
  });
});
