import { renderToString } from "react-dom/server";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { Markdown, type PluggableList } from "./markdown.tsx";

const emphasisMarkdown = "Hello **production**.";
const tableMarkdown = "| A | B |\n| - | - |\n| 1 | 2 |";
const titledLinkMarkdown = '[docs](https://example.com "Reference")';
const defaultCodeMarkdown = "```ts\nconst answer = 42;\n```";

function annotateTableElements(node: unknown): void {
  if (node === null || typeof node !== "object") return;

  const candidate = node as {
    children?: unknown;
    properties?: Record<string, unknown>;
    tagName?: unknown;
    type?: unknown;
  };
  if (
    candidate.type === "element" &&
    typeof candidate.tagName === "string" &&
    ["blockquote", "table", "td", "th"].includes(candidate.tagName)
  ) {
    candidate.properties = {
      ...candidate.properties,
      className: [`plugin-${candidate.tagName}`],
    };
  }

  if (Array.isArray(candidate.children)) {
    for (const child of candidate.children) annotateTableElements(child);
  }
}

function rehypeAnnotateTableElements() {
  return (tree: unknown): void => annotateTableElements(tree);
}

function rehypeTurnParagraphIntoPre() {
  return (tree: unknown): void => {
    if (tree === null || typeof tree !== "object") return;
    const children = (tree as { children?: unknown }).children;
    if (!Array.isArray(children)) return;

    const paragraph = children.find((child) =>
      child !== null && typeof child === "object" &&
      (child as { tagName?: unknown }).tagName === "p"
    ) as { tagName: string } | undefined;
    if (paragraph) paragraph.tagName = "pre";
  };
}

function wrapCodeText(node: unknown): boolean {
  if (node === null || typeof node !== "object") return false;
  const candidate = node as {
    children?: unknown;
    tagName?: unknown;
    type?: unknown;
  };
  if (candidate.type === "element" && candidate.tagName === "code") {
    candidate.children = [
      { type: "text", value: "nested " },
      {
        type: "element",
        tagName: "span",
        properties: {},
        children: [{ type: "text", value: "code" }],
      },
    ];
    return true;
  }

  if (Array.isArray(candidate.children)) {
    return candidate.children.some(wrapCodeText);
  }
  return false;
}

function rehypeWrapCodeText() {
  return (tree: unknown): void => {
    wrapCodeText(tree);
  };
}

describe("Markdown", () => {
  it("renders markdown during server rendering", () => {
    const html = renderToString(
      <Markdown>{emphasisMarkdown}</Markdown>,
    );

    assertStringIncludes(html, "Hello <strong>production</strong>.");
  });

  it("renders GFM tables during server rendering", () => {
    const html = renderToString(
      <Markdown>{tableMarkdown}</Markdown>,
    );

    assertStringIncludes(html, "<table");
    assertStringIncludes(html, "<th");
    assertStringIncludes(html, "<td");
  });

  it("preserves punctuation in fenced-code language identifiers", () => {
    let received: { language: string | undefined; code: string } | undefined;

    renderToString(
      <Markdown
        renderCodeBlock={({ language, code }) => {
          received = { language, code };
          return <pre>{code}</pre>;
        }}
      >
        {"```c++\nstd::vector<int> values;\n```"}
      </Markdown>,
    );

    assertEquals(received, {
      language: "c++",
      code: "std::vector<int> values;",
    });
  });

  it("renders fenced code through the default code block", () => {
    const html = renderToString(
      <Markdown>{defaultCodeMarkdown}</Markdown>,
    );

    assertStringIncludes(html, 'class="language-ts"');
    assertStringIncludes(html, "const answer = 42;");
  });

  it("extracts code text from plugin-created nested elements", () => {
    let receivedCode: string | undefined;
    const html = renderToString(
      <Markdown
        rehypePlugins={[rehypeWrapCodeText]}
        renderCodeBlock={({ code }) => {
          receivedCode = code;
          return <pre>{code}</pre>;
        }}
      >
        {"```txt\noriginal\n```"}
      </Markdown>,
    );

    assertEquals(receivedCode, "nested code");
    assertStringIncludes(html, "nested code");
  });

  it("filters unsafe URLs and protects links opened in a new context", () => {
    const html = renderToString(
      <Markdown>
        {"[safe](https://example.com) [unsafe](javascript:alert(1))"}
      </Markdown>,
    );

    assertStringIncludes(html, 'href="https://example.com"');
    assertStringIncludes(html, 'target="_blank"');
    assertStringIncludes(html, 'rel="noopener noreferrer"');
    assertEquals(html.includes("javascript:"), false);
  });

  it("preserves markdown link titles", () => {
    const html = renderToString(
      <Markdown>{titledLinkMarkdown}</Markdown>,
    );

    assertStringIncludes(html, 'title="Reference"');
  });

  it("lets custom components deliberately replace built-in renderers", () => {
    const html = renderToString(
      <Markdown
        components={{
          a({
            children,
            node: _node,
            ...props
          }: React.ComponentProps<"a"> & { node?: unknown }) {
            return <a {...props} data-renderer="custom">{children}</a>;
          },
        }}
      >
        {"[docs](https://example.com)"}
      </Markdown>,
    );

    assertStringIncludes(html, 'data-renderer="custom"');
    assertEquals(html.includes('target="_blank"'), false);
  });

  it("preserves plugin attributes on built-in block renderers", () => {
    const rehypePlugins: PluggableList = Object.freeze([
      Object.freeze([rehypeAnnotateTableElements] as const),
    ]);
    const html = renderToString(
      <Markdown rehypePlugins={rehypePlugins}>
        {"> quoted\n\n| A |\n| - |\n| 1 |"}
      </Markdown>,
    );

    assertStringIncludes(html, "plugin-blockquote");
    assertStringIncludes(html, "plugin-table");
    assertStringIncludes(html, "plugin-th");
    assertStringIncludes(html, "plugin-td");
  });

  it("preserves plain preformatted blocks created by plugins", () => {
    const html = renderToString(
      <Markdown rehypePlugins={[rehypeTurnParagraphIntoPre]}>
        Plain preformatted text.
      </Markdown>,
    );

    assertStringIncludes(html, "<pre>Plain preformatted text.</pre>");
  });

  it("does not interpret raw HTML from markdown input", () => {
    const html = renderToString(
      <Markdown>{'<script data-test="unsafe">alert(1)</script>'}</Markdown>,
    );

    assertEquals(html.includes("<script"), false);
    assertStringIncludes(html, "&lt;script");
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
