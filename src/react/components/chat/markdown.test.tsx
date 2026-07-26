import { renderToString } from "react-dom/server";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { type CodeBlockProps, Markdown } from "./markdown.tsx";

describe("Markdown", () => {
  it("renders Markdown and GFM semantics during server rendering", () => {
    const html = renderToString(
      <Markdown>
        {"# Heading\n\n**bold** and ~~removed~~\n\n| A | B |\n| - | - |\n| 1 | 2 |"}
      </Markdown>,
    );

    assertStringIncludes(html, "<h1>Heading</h1>");
    assertStringIncludes(html, "<strong>bold</strong>");
    assertStringIncludes(html, "<del>removed</del>");
    assertStringIncludes(html, "<table");
    assertStringIncludes(html, "<td");
  });

  it("passes the complete fenced-code language identifier to custom renderers", () => {
    let received: CodeBlockProps | undefined;
    const html = renderToString(
      <Markdown
        renderCodeBlock={(props) => {
          received = props;
          return (
            <pre data-language={props.language}>
              <code>{props.code}</code>
            </pre>
          );
        }}
      >
        {"```c++\nint main() {}\n```"}
      </Markdown>,
    );

    assertEquals(received, {
      language: "c++",
      code: "int main() {}",
      inline: false,
    });
    assertStringIncludes(html, 'data-language="c++"');
  });

  it("preserves fenced-code whitespace in the default server-rendered code surface", () => {
    const html = renderToString(
      <Markdown>
        {"```text\n  indented\n\n```"}
      </Markdown>,
    );

    assertStringIncludes(html, "<code");
    assertStringIncludes(html, "  indented\n");
  });

  it("keeps Mermaid source readable during server rendering", () => {
    const html = renderToString(
      <Markdown>
        {"```mermaid\ngraph TD\n  A --> B\n```"}
      </Markdown>,
    );

    assertStringIncludes(html, "graph TD");
    assertStringIncludes(html, "A --&gt; B");
  });

  it("honors consumer component overrides during server rendering", () => {
    const html = renderToString(
      <Markdown
        components={{
          h2: ({ children }) => <h2 data-renderer="consumer">{children}</h2>,
        }}
      >
        {"## Custom"}
      </Markdown>,
    );

    assertStringIncludes(html, 'data-renderer="consumer"');
    assertStringIncludes(html, ">Custom</h2>");
  });

  it("preserves the readonly plugin-list contract", () => {
    const plugins = Object.freeze([]);
    const html = renderToString(
      <Markdown
        remarkPlugins={plugins}
        rehypePlugins={plugins}
      >
        {"**content**"}
      </Markdown>,
    );

    assertStringIncludes(html, "<strong>content</strong>");
  });

  it("does not emit raw HTML or unsafe link protocols by default", () => {
    const html = renderToString(
      <Markdown>
        {'<script>alert("raw")</script>\n\n[unsafe](javascript:alert("url"))'}
      </Markdown>,
    );

    assertEquals(html.includes("<script"), false);
    assertEquals(html.includes("javascript:"), false);
  });

  it("keeps long source links within the chat column", () => {
    const html = renderToString(
      <Markdown>
        {"long-source-link-without-natural-break-points"}
      </Markdown>,
    );

    assertStringIncludes(html, "min-w-0");
    assertStringIncludes(html, "overflow-hidden");
    assertStringIncludes(html, "break-words");
    assertStringIncludes(html, "[overflow-wrap:anywhere]");
  });
});
