import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractExports } from "./frontmatter-parser.ts";

describe("build/compiler/mdx-compiler/frontmatter-parser", () => {
  describe("extractExports", () => {
    it("should extract string exports", () => {
      const { frontmatter } = extractExports('export const title = "Hello World"');
      assertEquals(frontmatter.title, "Hello World");
    });

    it("should extract boolean exports", () => {
      const { frontmatter } = extractExports("export const draft = true");
      assertEquals(frontmatter.draft, true);
    });

    it("should extract number exports", () => {
      const { frontmatter } = extractExports("export const order = 42");
      assertEquals(frontmatter.order, 42);
    });

    it("should extract null exports", () => {
      const { frontmatter } = extractExports("export const value = null");
      assertEquals(frontmatter.value, null);
    });

    it("should extract object exports", () => {
      const { frontmatter } = extractExports(
        'export const meta = {"key": "val"}',
      );
      assertEquals(frontmatter.meta, { key: "val" });
    });

    it("should extract array exports", () => {
      const { frontmatter } = extractExports(
        'export const tags = ["a", "b"]',
      );
      assertEquals(frontmatter.tags, ["a", "b"]);
    });

    it("should extract multiple exports", () => {
      const code = [
        'export const title = "Page"',
        "export const draft = false",
        "",
        "# Content here",
      ].join("\n");
      const { frontmatter, content } = extractExports(code);
      assertEquals(frontmatter.title, "Page");
      assertEquals(frontmatter.draft, false);
      assertEquals(content.includes("# Content here"), true);
    });

    it("should remove export lines from content", () => {
      const code = 'export const title = "test"\n\nHello';
      const { content } = extractExports(code);
      assertEquals(content.includes("export const title"), false);
      assertEquals(content.includes("Hello"), true);
    });

    it("should handle content with no exports", () => {
      const code = "# Just markdown\n\nNo exports here.";
      const { frontmatter, content } = extractExports(code);
      assertEquals(Object.keys(frontmatter).length, 0);
      assertEquals(content, code);
    });
  });
});
