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

  it("keeps a language id that is not all word characters", () => {
    let seen: string | undefined;
    renderToString(
      <Markdown
        renderer={MarkdownRenderer}
        renderCodeBlock={({ language, code }) => {
          seen = language;
          return <pre>{code}</pre>;
        }}
      >
        {"```c++\nint main() {}\n```"}
      </Markdown>,
    );

    assertEquals(seen, "c++");
  });

  it("renders a fence with no language as escaped source", () => {
    const html = render("```\nplain fence\n```");

    assertStringIncludes(html, "<pre");
    assertStringIncludes(html, "plain fence");
  });

  it("renders LaTeX math as MathML without a stylesheet", () => {
    const html = render("Tip: \\(0.18 \\times 84.50\\) per head.");

    assertStringIncludes(html, "<math");
    assertStringIncludes(html, "</math>");
    // MathML output needs no KaTeX stylesheet or web fonts.
    assert(!html.includes("katex-html"), "HTML output would require the KaTeX stylesheet");
    // KaTeX keeps the TeX in an <annotation>; what matters is that the visible
    // output is MathML rather than the raw backslash form.
    assertStringIncludes(html, "<mo>\u00d7</mo>");
  });

  it("renders display math from bracket delimiters", () => {
    const html = render("\\[a^2 + b^2 = c^2\\]");

    assertStringIncludes(html, "<math");
    assertStringIncludes(html, 'display="block"');
  });

  it("renders double-dollar math", () => {
    const html = render("Euler: $$e^{i\\pi} + 1 = 0$$");

    assertStringIncludes(html, "<math");
  });

  it("leaves currency amounts as text", () => {
    // Chat answers quote money constantly. Two dollar signs in one sentence
    // must not be read as an inline math span.
    const html = render("Total: $84.50 and the split is $33.24 each.");

    assert(!html.includes("<math"), "currency must not parse as math");
    assertStringIncludes(html, "$84.50");
    assertStringIncludes(html, "$33.24");
  });

  it("keeps TeX inside a code fence literal", () => {
    const html = render("```tex\n\\(x + y\\)\n```");

    assert(!html.includes("<math"), "code samples must not render as math");
    assertStringIncludes(html, "x + y");
  });

  it("does not throw on a malformed expression", () => {
    const html = render("Broken: \\(\\frac{1\\)");

    assertStringIncludes(html, "Broken:");
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
