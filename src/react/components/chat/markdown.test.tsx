import * as React from "react";
import { renderToString } from "react-dom/server";
import {
  assertEquals,
  assertInstanceOf,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  type CodeBlockProps,
  Markdown,
  MarkdownRendererCapabilityError,
  type MarkdownRendererProps,
  MarkdownRendererProvider,
} from "./markdown.tsx";

function TestRenderer({
  source,
  components,
  renderCodeBlock,
}: MarkdownRendererProps): React.ReactElement {
  const Heading = components?.h1;
  const fence = /^```([^\n]*)\n([\s\S]*?)\n```$/u.exec(source);
  if (fence && renderCodeBlock) {
    return (
      <>{renderCodeBlock({ language: fence[1] || undefined, code: fence[2]!, inline: false })}</>
    );
  }
  if (Heading && source.startsWith("# ")) {
    return <Heading>{source.slice(2)}</Heading>;
  }
  return <article data-source={source}>rich output</article>;
}

describe("Markdown", () => {
  it("renders escaped source explicitly when no rich renderer is installed", () => {
    const source = '# Heading\n\n<script>alert("raw")</script>\n\n[unsafe](javascript:run())';
    const html = renderToString(<Markdown>{source}</Markdown>);

    assertStringIncludes(html, 'data-vf-markdown-renderer="plain"');
    assertStringIncludes(html, 'aria-label="Markdown source"');
    assertStringIncludes(html, "# Heading");
    assertStringIncludes(html, "&lt;script&gt;");
    assertStringIncludes(html, "javascript:run()");
    assertEquals(html.includes("<script>"), false);
    assertEquals(html.includes("href="), false);
    assertEquals(html.includes("<h1>"), false);
  });

  it("selects a per-instance rich renderer and forwards its exact source", () => {
    const html = renderToString(
      <Markdown renderer={TestRenderer}># Result</Markdown>,
    );

    assertStringIncludes(html, 'data-vf-markdown-renderer="extension"');
    assertStringIncludes(html, 'data-source="# Result"');
    assertStringIncludes(html, ">rich output</article>");
  });

  it("selects a provider renderer for nested chat surfaces", () => {
    const html = renderToString(
      <MarkdownRendererProvider renderer={TestRenderer}>
        <Markdown>provider source</Markdown>
      </MarkdownRendererProvider>,
    );

    assertStringIncludes(html, 'data-source="provider source"');
  });

  it("allows a nested surface to explicitly select plain source", () => {
    const html = renderToString(
      <MarkdownRendererProvider renderer={TestRenderer}>
        <Markdown renderer={null}># Plain</Markdown>
      </MarkdownRendererProvider>,
    );

    assertStringIncludes(html, 'data-vf-markdown-renderer="plain"');
    assertEquals(html.includes("<article"), false);
  });

  it("forwards framework-neutral component overrides to the injected renderer", () => {
    const html = renderToString(
      <Markdown
        renderer={TestRenderer}
        components={{
          h1: ({ children }) => <h1 data-renderer="consumer">{children}</h1>,
        }}
      >
        # Custom
      </Markdown>,
    );

    assertStringIncludes(html, 'data-renderer="consumer"');
    assertStringIncludes(html, ">Custom</h1>");
  });

  it("forwards fenced-code rendering only through the explicit capability", () => {
    let received: CodeBlockProps | undefined;
    const html = renderToString(
      <Markdown
        renderer={TestRenderer}
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

  it("fails closed when rich-renderer options would otherwise be ignored", () => {
    let error: unknown;
    try {
      renderToString(
        <Markdown renderCodeBlock={() => null}>```text\nsource\n```</Markdown>,
      );
    } catch (cause) {
      error = cause;
    }
    assertInstanceOf(error, MarkdownRendererCapabilityError);
    assertEquals(error.code, "VF_REACT_MARKDOWN_RENDERER_REQUIRED");
  });

  it("fails closed when components are supplied without a rich renderer", () => {
    let error: unknown;
    try {
      renderToString(
        <Markdown components={{ h1: () => null }}># Heading</Markdown>,
      );
    } catch (cause) {
      error = cause;
    }
    assertInstanceOf(error, MarkdownRendererCapabilityError);
    assertEquals(
      error.code,
      "VF_REACT_MARKDOWN_RENDERER_REQUIRED",
      "components without a renderer must fail closed",
    );
  });

  it("fails closed for components when a provider disabled the inherited renderer", () => {
    let error: unknown;
    try {
      renderToString(
        <MarkdownRendererProvider renderer={null}>
          <Markdown components={{ h1: () => null }}># Heading</Markdown>
        </MarkdownRendererProvider>,
      );
    } catch (cause) {
      error = cause;
    }
    assertInstanceOf(error, MarkdownRendererCapabilityError);
    assertEquals(
      error.code,
      "VF_REACT_MARKDOWN_RENDERER_REQUIRED",
      "a disabled inherited renderer does not rescue component overrides",
    );
  });

  it("rejects removed parser options instead of silently ignoring them", () => {
    const legacyProps = {
      children: "source",
      remarkPlugins: [],
    } as unknown as React.ComponentProps<typeof Markdown>;

    assertThrows(
      () => renderToString(React.createElement(Markdown, legacyProps)),
      TypeError,
      "Unsupported Markdown prop: remarkPlugins",
    );
  });

  it("does not replace a rich-renderer failure with plain output", () => {
    function BrokenRenderer(): React.ReactElement {
      throw new Error("extension render failed");
    }

    assertThrows(
      () => renderToString(<Markdown renderer={BrokenRenderer}>source</Markdown>),
      Error,
      "extension render failed",
    );
  });

  it("styles renderer output but leaves plain source unstyled", () => {
    function PassThrough({ source }: MarkdownRendererProps): React.ReactElement {
      return <div>{source}</div>;
    }
    const rendered = renderToString(<Markdown renderer={PassThrough}>text</Markdown>);
    const plain = renderToString(<Markdown>text</Markdown>);

    // `&` is HTML-escaped inside the class attribute.
    assertStringIncludes(rendered, "[&amp;_ul]:list-disc");
    assertStringIncludes(rendered, "[&amp;_table]:w-full");
    assertEquals(plain.includes("_ul]:list-disc"), false);
  });

  it("keeps long source within the chat column", () => {
    const html = renderToString(
      <Markdown>long-source-link-without-natural-break-points</Markdown>,
    );

    assertStringIncludes(html, "min-w-0");
    assertStringIncludes(html, "overflow-hidden");
    assertStringIncludes(html, "break-words");
    assertStringIncludes(html, "[overflow-wrap:anywhere]");
  });
});
