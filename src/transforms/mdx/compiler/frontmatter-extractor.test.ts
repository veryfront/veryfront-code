import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractFrontmatter } from "./frontmatter-extractor.ts";

describe("transforms/mdx/compiler/frontmatter-extractor", () => {
  describe("extractFrontmatter", () => {
    it("should return empty frontmatter for content without frontmatter", () => {
      const result = extractFrontmatter("# Hello World");
      assertEquals(result.frontmatter, {});
      assertEquals(result.body, "# Hello World");
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

    it("should merge provided frontmatter with extracted", () => {
      const content = `---
title: From YAML
---
Body text`;
      const result = extractFrontmatter(content, { author: "Test" });
      assertEquals(result.frontmatter.title, "From YAML");
      assertEquals(result.frontmatter.author, "Test");
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

    it("should handle empty content", () => {
      const result = extractFrontmatter("");
      assertEquals(result.body, "");
      assertEquals(result.frontmatter, {});
    });
  });
});
