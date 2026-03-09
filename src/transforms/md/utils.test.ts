import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isMarkdownPreview } from "./utils.ts";

describe("transforms/md/utils", () => {
  describe("isMarkdownPreview", () => {
    it("returns true for standalone markdown file", () => {
      assertEquals(isMarkdownPreview("README.md"), true);
    });

    it("returns true when filePath is undefined", () => {
      assertEquals(isMarkdownPreview(undefined), true);
    });

    it("returns false for file in pages/ directory", () => {
      assertEquals(isMarkdownPreview("pages/about.md"), false);
    });

    it("returns false for file in app/ directory", () => {
      assertEquals(isMarkdownPreview("app/docs/intro.md"), false);
    });

    it("returns false for nested pages/ directory", () => {
      assertEquals(isMarkdownPreview("src/pages/about.md"), false);
    });

    it("returns false for nested app/ directory", () => {
      assertEquals(isMarkdownPreview("src/app/docs/intro.md"), false);
    });

    it("returns false when frontmatter has prose: false", () => {
      assertEquals(isMarkdownPreview("README.md", { prose: false }), false);
    });

    it("returns true when frontmatter has prose: true", () => {
      assertEquals(isMarkdownPreview("README.md", { prose: true }), true);
    });

    it("returns true when frontmatter has no prose key", () => {
      assertEquals(isMarkdownPreview("README.md", { title: "Hello" }), true);
    });

    it("returns true for deeply nested non-routable path", () => {
      assertEquals(isMarkdownPreview("docs/guides/getting-started.md"), true);
    });
  });
});
