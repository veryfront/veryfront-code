import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isMarkdownPreview } from "./utils.ts";

describe("transforms/md/utils", () => {
  describe("isMarkdownPreview", () => {
    it("returns true for standalone markdown (no path)", () => {
      assertEquals(isMarkdownPreview(undefined), true);
    });

    it("returns true for root-level markdown", () => {
      assertEquals(isMarkdownPreview("README.md"), true);
    });

    it("returns true for docs directory markdown", () => {
      assertEquals(isMarkdownPreview("docs/guide.md"), true);
    });

    it("returns false for file in pages/ directory", () => {
      assertEquals(isMarkdownPreview("pages/index.md"), false);
    });

    it("returns false for file in app/ directory", () => {
      assertEquals(isMarkdownPreview("app/page.md"), false);
    });

    it("returns false for nested pages/ directory", () => {
      assertEquals(isMarkdownPreview("src/pages/about.md"), false);
    });

    it("returns false for nested app/ directory", () => {
      assertEquals(isMarkdownPreview("src/app/layout.md"), false);
    });

    it("returns false when frontmatter has prose: false", () => {
      assertEquals(isMarkdownPreview("README.md", { prose: false }), false);
    });

    it("returns true when frontmatter has prose: true", () => {
      assertEquals(isMarkdownPreview("README.md", { prose: true }), true);
    });

    it("returns true when frontmatter has unrelated keys", () => {
      assertEquals(isMarkdownPreview("README.md", { title: "Hi" }), true);
    });

    it("returns true for empty string path", () => {
      assertEquals(isMarkdownPreview(""), true);
    });

    it("prose: false takes precedence even for pages/ path", () => {
      // pages/ already returns false, prose: false also returns false
      assertEquals(isMarkdownPreview("pages/index.md", { prose: false }), false);
    });

    it("returns true when frontmatter is empty object", () => {
      assertEquals(isMarkdownPreview("README.md", {}), true);
    });
  });
});
