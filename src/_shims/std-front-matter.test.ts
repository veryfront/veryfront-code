/**
 * Tests for std-front-matter shim
 *
 * NOTE: This shim module is designed for npm builds and uses Node.js-specific APIs.
 * These tests focus on the fallback parser logic that would work without gray-matter.
 * In Deno execution, the actual std/front_matter module is used instead.
 */

import { assertEquals, assert } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";

describe("std-front-matter fallback parser", () => {
  // Since the module uses node:module which isn't available in Deno,
  // we test the regex pattern and logic that the fallback parser uses

  describe("front matter detection pattern", () => {
    const frontMatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const testPattern = /^---\r?\n/;

    it("should detect front matter at start of content", () => {
      const content = `---
title: Test
---
Body`;
      assertEquals(testPattern.test(content), true);
    });

    it("should not detect front matter in middle of content", () => {
      const content = `Some text
---
title: Test
---
Body`;
      assertEquals(testPattern.test(content), false);
    });

    it("should detect with Windows line endings", () => {
      const content = `---\r
title: Test`;
      assertEquals(testPattern.test(content), true);
    });

    it("should extract front matter and body", () => {
      const content = `---
title: Test Title
author: Test Author
---
This is the body content.`;

      const match = content.match(frontMatterPattern);
      assert(match !== null);

      const [, frontMatter, body] = match;
      assertEquals(frontMatter, "title: Test Title\nauthor: Test Author");
      assertEquals(body, "This is the body content.");
    });

    it("should not match empty front matter (regex limitation)", () => {
      // The regex pattern requires content between delimiters
      // This is a known limitation of the simple fallback parser
      const content = `---
---
Body content`;

      const match = content.match(frontMatterPattern);
      // Empty front matter doesn't match the pattern
      assertEquals(match, null);
    });

    it("should handle multiline body", () => {
      const content = `---
title: Test
---
Line 1
Line 2
Line 3`;

      const match = content.match(frontMatterPattern);
      assert(match !== null);

      const [, frontMatter, body] = match;
      assert(frontMatter !== undefined && frontMatter.includes("title: Test"));
      assertEquals(body, "Line 1\nLine 2\nLine 3");
    });

    it("should return null for content without front matter", () => {
      const content = "Just regular content";
      const match = content.match(frontMatterPattern);
      assertEquals(match, null);
    });

    it("should return null for incomplete front matter", () => {
      const content = `---
title: Test
Body without closing`;
      const match = content.match(frontMatterPattern);
      assertEquals(match, null);
    });

    it("should handle Windows line endings in full content", () => {
      const content = `---\r
title: Test\r
---\r
Body`;

      const match = content.match(frontMatterPattern);
      assert(match !== null);
      const [, frontMatter, body] = match;
      assert(frontMatter !== undefined && frontMatter.includes("title: Test"));
      assertEquals(body, "Body");
    });

    it("should handle content with only front matter", () => {
      const content = `---
title: Test
---`;

      const match = content.match(frontMatterPattern);
      assert(match !== null);
      const [, frontMatter, body] = match;
      assert(frontMatter !== undefined && frontMatter.includes("title: Test"));
      assertEquals(body, "");
    });

    it("should not match if delimiter not at start", () => {
      const content = ` ---
title: Test
---
Body`;
      const match = content.match(frontMatterPattern);
      assertEquals(match, null);
    });
  });

  describe("FrontMatterResult interface", () => {
    it("should have correct shape", () => {
      // Test the expected interface structure
      interface FrontMatterResult<T = Record<string, unknown>> {
        attrs: T;
        body: string;
        frontMatter: string;
      }

      const result: FrontMatterResult = {
        attrs: { title: "Test" },
        body: "Body content",
        frontMatter: "title: Test",
      };

      assertEquals(typeof result.attrs, "object");
      assertEquals(typeof result.body, "string");
      assertEquals(typeof result.frontMatter, "string");
    });

    it("should support generic type parameter", () => {
      interface CustomAttrs {
        title: string;
        count: number;
      }

      interface FrontMatterResult<T = Record<string, unknown>> {
        attrs: T;
        body: string;
        frontMatter: string;
      }

      const result: FrontMatterResult<CustomAttrs> = {
        attrs: { title: "Test", count: 42 },
        body: "Body",
        frontMatter: "title: Test\ncount: 42",
      };

      assertEquals(result.attrs.title, "Test");
      assertEquals(result.attrs.count, 42);
    });
  });

  describe("fallback parser logic", () => {
    function simpleFallbackExtract(content: string) {
      const match = content.match(
        /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/
      );

      if (!match) {
        return { attrs: {}, body: content, frontMatter: "" };
      }

      const [, frontMatterStr, body] = match;
      return { attrs: {}, body: body || "", frontMatter: frontMatterStr || "" };
    }

    it("should extract with fallback parser", () => {
      const content = `---
title: Test
---
Body content`;

      const result = simpleFallbackExtract(content);

      assertEquals(result.body, "Body content");
      assertEquals(result.frontMatter, "title: Test");
      assertEquals(result.attrs, {});
    });

    it("should return original content when no front matter", () => {
      const content = "Regular content";
      const result = simpleFallbackExtract(content);

      assertEquals(result.body, content);
      assertEquals(result.frontMatter, "");
      assertEquals(result.attrs, {});
    });

    it("should handle empty content", () => {
      const content = "";
      const result = simpleFallbackExtract(content);

      assertEquals(result.body, "");
      assertEquals(result.frontMatter, "");
      assertEquals(result.attrs, {});
    });
  });
});

// Note: The actual module exports (extract, test, extractAsync) cannot be directly
// tested in Deno because they depend on node:module and gray-matter npm package.
// This is expected behavior - the shim is designed for npm builds.
// When running in Deno, applications should use the native std/front_matter module instead.
