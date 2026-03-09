import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { compileMarkdownRuntime } from "./md-compiler.ts";

describe(
  "transforms/md/compiler/md-compiler",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    describe("compileMarkdownRuntime", () => {
      it("compiles simple markdown to a React component", async () => {
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          "# Hello World\n\nSome paragraph text.",
        );
        assertEquals(typeof result.compiledCode, "string");
        assertEquals(result.compiledCode.includes("Hello World"), true);
        assertEquals(result.compiledCode.includes("jsx"), true);
      });

      it("returns frontmatter object", async () => {
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          "---\ntitle: Test\nauthor: Jane\n---\n# Content",
        );
        assertEquals(typeof result.frontmatter, "object");
        assertEquals(result.frontmatter.title, "Test");
        assertEquals(result.frontmatter.author, "Jane");
      });

      it("extracts headings", async () => {
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          "# First\n## Second\n### Third",
        );
        assertEquals(Array.isArray(result.headings), true);
        assertEquals(result.headings.length, 3);
        assertEquals(result.headings[0]!.text, "First");
        assertEquals(result.headings[0]!.level, 1);
        assertEquals(result.headings[1]!.text, "Second");
        assertEquals(result.headings[1]!.level, 2);
      });

      it("returns rawHtml", async () => {
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          "# Hello",
        );
        assertEquals(typeof result.rawHtml, "string");
        assertEquals(result.rawHtml!.includes("Hello"), true);
      });

      it("handles empty content", async () => {
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          "",
        );
        assertEquals(typeof result.compiledCode, "string");
      });

      it("passes frontmatter through when provided as parameter", async () => {
        const fm = { title: "Override", custom: "value" };
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          "# Content",
          fm,
        );
        assertEquals(result.frontmatter.title, "Override");
        assertEquals(result.frontmatter.custom, "value");
      });

      it("handles GFM features like tables", async () => {
        const markdown = `
| Column A | Column B |
|----------|----------|
| Cell 1   | Cell 2   |
`;
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          markdown,
        );
        assertEquals(result.rawHtml!.includes("table"), true);
      });

      it("generates heading IDs (slugs)", async () => {
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          "# Hello World",
        );
        assertEquals(result.headings[0]!.id, "hello-world");
      });

      it("compiles code blocks with syntax highlighting", async () => {
        const markdown = "```js\nconst x = 1;\n```";
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          markdown,
        );
        assertEquals(typeof result.rawHtml, "string");
        assertEquals(result.rawHtml!.length > 0, true);
      });

      it("uses preview wrapper for non-routable files", async () => {
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          "# Readme Content",
          undefined,
          "README.md",
        );
        assertEquals(result.compiledCode.includes("markdown-body"), true);
      });

      it("uses standard wrapper for pages/ files", async () => {
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          "# Page Content",
          undefined,
          "pages/about.md",
        );
        assertEquals(result.compiledCode.includes("className"), true);
      });
    });
  },
);
