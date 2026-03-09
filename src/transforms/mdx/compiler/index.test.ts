import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { compileContent } from "./index.ts";

describe("transforms/mdx/compiler/index", { sanitizeResources: false, sanitizeOps: false }, () => {
  describe("compileContent", () => {
    it("routes .md files to markdown compiler", async () => {
      const result = await compileContent(
        "runtime",
        "/tmp/project",
        "# Hello World\n\nSome content.",
        undefined,
        "docs/readme.md",
        "server",
      );
      assertEquals(typeof result.compiledCode, "string");
      assertEquals(result.compiledCode.includes("Hello World"), true);
      assertEquals(typeof result.frontmatter, "object");
    });

    it("routes .mdx files to MDX compiler", async () => {
      const result = await compileContent(
        "runtime",
        "/tmp/project",
        "# Hello MDX\n\nSome **bold** content.",
        undefined,
        "docs/page.mdx",
        "server",
      );
      assertEquals(typeof result.compiledCode, "string");
      assertEquals(typeof result.frontmatter, "object");
    });

    it("defaults target to server", async () => {
      const result = await compileContent(
        "runtime",
        "/tmp/project",
        "# Test",
        undefined,
        "test.md",
      );
      assertEquals(typeof result.compiledCode, "string");
    });

    it("passes frontmatter through to markdown compiler", async () => {
      const fm = { title: "My Doc", prose: false };
      const result = await compileContent(
        "runtime",
        "/tmp/project",
        "---\ntitle: My Doc\nprose: false\n---\n# Content",
        fm,
        "doc.md",
      );
      assertEquals(result.frontmatter.title, "My Doc");
    });

    it("handles files without extension as MDX", async () => {
      const result = await compileContent(
        "runtime",
        "/tmp/project",
        "# No Extension",
        undefined,
        undefined,
        "server",
      );
      assertEquals(typeof result.compiledCode, "string");
    });
  });
});
