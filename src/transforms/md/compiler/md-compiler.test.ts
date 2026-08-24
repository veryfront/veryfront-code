import "#veryfront/schemas/_test-setup.ts";
import "../../mdx/compiler/__tests__/content-processor-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  register as registerContract,
  tryResolve as tryResolveContract,
  unregister as unregisterContract,
} from "#veryfront/extensions/contracts.ts";
import type { ContentProcessor } from "#veryfront/extensions/content/index.ts";
import {
  createYamlParserProvider,
  YamlParserProviderName,
} from "#veryfront/extensions/parser/yaml-parser.ts";
import { compileMarkdownRuntime } from "./md-compiler.ts";

const markdownCompilationMode = "production";

async function withYamlSyntaxErrorProvider(body: () => Promise<void>): Promise<void> {
  const previous = tryResolveContract(YamlParserProviderName);
  registerContract(
    YamlParserProviderName,
    createYamlParserProvider(() => {
      throw new SyntaxError("invalid YAML");
    }),
  );
  try {
    await body();
  } finally {
    if (previous === undefined) {
      unregisterContract(YamlParserProviderName);
    } else {
      registerContract(YamlParserProviderName, previous);
    }
  }
}

describe(
  "transforms/md/compiler/md-compiler",
  () => {
    describe("compileMarkdownRuntime", () => {
      it("compiles simple markdown to a React component", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          "# Hello World\n\nSome paragraph text.",
        );
        assertEquals(typeof result.compiledCode, "string");
        assertEquals(result.compiledCode.includes("Hello World"), true);
        assertEquals(result.compiledCode.includes("jsx"), true);
      });

      it("returns frontmatter object", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          "---\ntitle: Test\nauthor: Jane\n---\n# Content",
        );
        assertEquals(typeof result.frontmatter, "object");
        assertEquals(result.frontmatter.title, "Test");
        assertEquals(result.frontmatter.author, "Jane");
      });

      it("classifies tenant Markdown frontmatter failures explicitly", async () => {
        const error = await assertRejects(
          () =>
            compileMarkdownRuntime(
              markdownCompilationMode,
              "/tmp/project",
              "---\ntitle: [unterminated\n---\n# Content",
              undefined,
              "broken.md",
            ),
          VeryfrontError,
        );

        assertInstanceOf(error, VeryfrontError);
        assertEquals(error.slug, "markdown-compile-error");
        assertEquals(error.category, "BUILD");
      });

      it("classifies provider-independent Markdown frontmatter SyntaxError failures", async () => {
        await withYamlSyntaxErrorProvider(async () => {
          const error = await assertRejects(
            () =>
              compileMarkdownRuntime(
                markdownCompilationMode,
                "/tmp/project",
                "---\ntitle: broken\n---\n# Content",
                undefined,
                "provider-frontmatter.md",
              ),
            VeryfrontError,
          );

          assertInstanceOf(error, VeryfrontError);
          assertEquals(error.slug, "markdown-compile-error");
          assertEquals(error.category, "BUILD");
        });
      });

      it("preserves non-source processor failures", async () => {
        const previous = tryResolveContract<ContentProcessor>("ContentProcessor");
        registerContract(
          "ContentProcessor",
          {
            compileMdx() {
              throw new Error("not used");
            },
            compileMarkdown() {
              throw new SyntaxError("YAML backend unavailable at line 1, column 1");
            },
            getRemarkPlugins() {
              return [];
            },
            getRehypePlugins() {
              return [];
            },
          } satisfies ContentProcessor,
        );

        try {
          const error = await assertRejects(() =>
            compileMarkdownRuntime(
              markdownCompilationMode,
              "/tmp/project",
              "# Content",
              undefined,
              "framework-failure.md",
            )
          );

          assertInstanceOf(error, Error);
          assertEquals(error instanceof VeryfrontError, false);
          assertEquals(
            (error as Error).message,
            "YAML backend unavailable at line 1, column 1",
          );
        } finally {
          registerContract("ContentProcessor", previous);
        }
      });

      it("extracts headings", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          "# First\n## Second\n### Third",
        );
        assertEquals(Array.isArray(result.headings), true);
        const headings = result.headings!;
        assertEquals(headings.length, 3);
        assertEquals(headings[0]!.text, "First");
        assertEquals(headings[0]!.level, 1);
        assertEquals(headings[1]!.text, "Second");
        assertEquals(headings[1]!.level, 2);
      });

      it("returns rawHtml", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          "# Hello",
        );
        assertEquals(typeof result.rawHtml, "string");
        assertEquals(result.rawHtml!.includes("Hello"), true);
      });

      it("handles empty content", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          "",
        );
        assertEquals(typeof result.compiledCode, "string");
      });

      it("passes frontmatter through when provided as parameter", async () => {
        const fm = { title: "Override", custom: "value" };
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
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
          markdownCompilationMode,
          "/tmp/project",
          markdown,
        );
        assertEquals(result.rawHtml!.includes("table"), true);
      });

      it("generates heading IDs (slugs)", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          "# Hello World",
        );
        const headings = result.headings!;
        assertEquals(headings[0]!.id, "hello-world");
      });

      it("compiles code blocks with syntax highlighting", async () => {
        const markdown = "```js\nconst x = 1;\n```";
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          markdown,
        );
        assertEquals(
          result.rawHtml!.includes('class="language-js"'),
          true,
          "code fence keeps its language class",
        );
        assertEquals(
          result.rawHtml!.includes("<span>const</span>"),
          true,
          "starry-night must tokenize the code block",
        );
      });

      it("uses preview wrapper for non-routable files", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          "# Readme Content",
          undefined,
          "README.md",
        );
        assertEquals(result.compiledCode.includes("markdown-body"), true);
      });

      it("uses the preview wrapper for pages/ files", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          "# Page Content",
          undefined,
          "pages/about.md",
        );
        assertEquals(
          result.compiledCode.includes('className: "markdown-body"'),
          true,
          "pages/ Markdown renders with the preview wrapper",
        );
        assertEquals(
          result.compiledCode.includes("params, className,"),
          false,
          "the preview wrapper does not forward a caller className",
        );
      });

      it("uses the standard wrapper when prose is disabled", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          "---\nprose: false\n---\n# Page Content",
          undefined,
          "pages/about.md",
        );
        assertEquals(
          result.compiledCode.includes("params, className,"),
          true,
          "prose: false forwards the caller className",
        );
        assertEquals(
          result.compiledCode.includes("markdown-body"),
          false,
          "the standard wrapper never hard-codes the preview class",
        );
      });
    });

    describe("HTML sanitization", () => {
      it("strips script tags from markdown", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          '# Title\n\n<script>alert("xss")</script>\n\nSafe text.',
        );
        assertEquals(result.rawHtml!.includes("<script>"), false);
        assertEquals(result.rawHtml!.includes("alert"), false);
        assertEquals(result.rawHtml!.includes("Safe text"), true);
      });

      it("strips onclick event handlers from HTML", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          '<div onclick="alert(1)">Click me</div>',
        );
        assertEquals(result.rawHtml!.includes("onclick"), false);
      });

      it("strips iframe tags", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          '<iframe src="https://evil.com"></iframe>\n\nSafe text.',
        );
        assertEquals(result.rawHtml!.includes("<iframe"), false);
        assertEquals(result.rawHtml!.includes("Safe text"), true);
      });

      it("strips javascript: URLs from links", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          "[click me](javascript:alert(1))",
        );
        assertEquals(result.rawHtml!.includes("javascript:"), false);
      });

      it("preserves safe HTML elements", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          "**bold** and *italic* and [link](https://example.com)",
        );
        assertEquals(result.rawHtml!.includes("<strong>"), true);
        assertEquals(result.rawHtml!.includes("<em>"), true);
        assertEquals(result.rawHtml!.includes("https://example.com"), true);
      });

      it("preserves images with safe src", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          '![alt text](https://example.com/img.png "title")',
        );
        assertEquals(result.rawHtml!.includes("<img"), true);
        assertEquals(
          result.rawHtml!.includes("https://example.com/img.png"),
          true,
        );
      });

      it("preserves safe embedded HTML like details/summary", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          "<details><summary>Click</summary>\n\nHidden content\n\n</details>",
        );
        assertEquals(result.rawHtml!.includes("<details>"), true);
        assertEquals(result.rawHtml!.includes("<summary>"), true);
        assertEquals(result.rawHtml!.includes("Hidden content"), true);
      });

      it("strips style tags", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          "# Title\n\n<style>body{display:none}</style>\n\nVisible text.",
        );
        assertEquals(result.rawHtml!.includes("<style>"), false);
        assertEquals(result.rawHtml!.includes("Visible text"), true);
      });

      it("preserves data-node attributes in studio embed mode", async () => {
        const result = await compileMarkdownRuntime(
          markdownCompilationMode,
          "/tmp/project",
          "# Hello\n\nSome paragraph.",
          undefined,
          "content/page.md",
          "server",
          undefined,
          true,
        );
        assertEquals(result.rawHtml!.includes("data-node-file"), true);
        assertEquals(result.rawHtml!.includes("data-node-line"), true);
        assertEquals(result.rawHtml!.includes("data-node-source"), true);
      });
    });
  },
);
