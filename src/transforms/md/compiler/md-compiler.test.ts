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

    describe("HTML sanitization", () => {
      it("strips script tags from markdown", async () => {
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          '# Title\n\n<script>alert("xss")</script>\n\nSafe text.',
        );
        assertEquals(result.rawHtml!.includes("<script>"), false);
        assertEquals(result.rawHtml!.includes("alert"), false);
        assertEquals(result.rawHtml!.includes("Safe text"), true);
      });

      it("strips onclick event handlers from HTML", async () => {
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          '<div onclick="alert(1)">Click me</div>',
        );
        assertEquals(result.rawHtml!.includes("onclick"), false);
      });

      it("strips iframe tags", async () => {
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          '<iframe src="https://evil.com"></iframe>\n\nSafe text.',
        );
        assertEquals(result.rawHtml!.includes("<iframe"), false);
        assertEquals(result.rawHtml!.includes("Safe text"), true);
      });

      it("strips javascript: URLs from links", async () => {
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          "[click me](javascript:alert(1))",
        );
        assertEquals(result.rawHtml!.includes("javascript:"), false);
      });

      it("preserves safe HTML elements", async () => {
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          "**bold** and *italic* and [link](https://example.com)",
        );
        assertEquals(result.rawHtml!.includes("<strong>"), true);
        assertEquals(result.rawHtml!.includes("<em>"), true);
        assertEquals(result.rawHtml!.includes("https://example.com"), true);
      });

      it("preserves images with safe src", async () => {
        const result = await compileMarkdownRuntime(
          "runtime",
          "/tmp/project",
          '![alt text](https://example.com/img.png "title")',
        );
        assertEquals(result.rawHtml!.includes("<img"), true);
        assertEquals(result.rawHtml!.includes("https://example.com/img.png"), true);
      });
    });
  },
);
