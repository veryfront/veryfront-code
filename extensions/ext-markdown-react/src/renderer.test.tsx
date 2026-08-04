import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { Markdown, MarkdownRendererProvider } from "veryfront/markdown";
import { MarkdownRenderer } from "./renderer.tsx";

function render(source: string): string {
  return renderToString(
    <MarkdownRendererProvider renderer={MarkdownRenderer}>
      <Markdown>{source}</Markdown>
    </MarkdownRendererProvider>,
  );
}

describe("MarkdownRenderer", () => {
  it("renders CommonMark structure as semantic elements", () => {
    const html = render("## Quick answer\n\n- **Key point:** use `inline_code` here.\n");

    assertStringIncludes(html, 'data-vf-markdown-renderer="extension"');
    assertStringIncludes(html, ">Quick answer</h2>");
    assertStringIncludes(html, "<ul");
    assertStringIncludes(html, "<strong>Key point:</strong>");
    assertStringIncludes(html, "<code>inline_code</code>");
    assert(!html.includes("## Quick answer"), "source must not survive as literal text");
  });

  it("renders GFM tables and strikethrough", () => {
    const html = render(
      ["| Check | Result |", "| --- | ---: |", "| Tests | ~~failed~~ passed |"].join("\n"),
    );

    assertStringIncludes(html, "<table");
    assertStringIncludes(html, ">Check</th>");
    assertStringIncludes(html, "<del>failed</del>");
  });

  it("drops unsafe link protocols", () => {
    const html = render("[run](javascript:alert(1)) and [docs](https://veryfront.com)");

    assert(!html.includes("javascript:"), "javascript: targets must not reach the DOM");
    assertStringIncludes(html, 'href="https://veryfront.com"');
  });

  it("never emits Markdown-authored raw HTML", () => {
    const html = render('Before\n\n<script>alert("raw")</script>\n\nAfter');

    assertEquals(html.includes("<script>"), false);
    assertStringIncludes(html, "&lt;script&gt;");
  });

  it("routes fenced code through the caller's code-block override", () => {
    const html = renderToString(
      <Markdown
        renderer={MarkdownRenderer}
        renderCodeBlock={({ language, code }) => (
          <pre data-language={language}>
            <code>{code}</code>
          </pre>
        )}
      >
        {"```ts\nconst release = await deploy();\n```"}
      </Markdown>,
    );

    assertStringIncludes(html, 'data-language="ts"');
    assertStringIncludes(html, "const release = await deploy();");
  });

  it("lets caller component overrides win over the built-ins", () => {
    const html = renderToString(
      <Markdown
        renderer={MarkdownRenderer}
        components={{ a: ({ href, children }) => <a data-custom="true" href={href}>{children}</a> }}
      >
        {"[docs](https://veryfront.com)"}
      </Markdown>,
    );

    assertStringIncludes(html, 'data-custom="true"');
  });
});
