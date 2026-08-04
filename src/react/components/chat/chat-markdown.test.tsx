import * as React from "react";
import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { MarkdownRendererProps } from "./markdown.tsx";
import { MarkdownRendererProvider } from "./markdown.tsx";
import { ChatMarkdown } from "./chat-markdown.tsx";

function AppRenderer({ source }: MarkdownRendererProps): React.ReactElement {
  return <article data-app-renderer="true">{source}</article>;
}

describe("ChatMarkdown — renderer resolution", () => {
  it("falls back to the built-in extension renderer", () => {
    const html = renderToString(<ChatMarkdown># Heading</ChatMarkdown>);

    assertStringIncludes(html, 'data-vf-markdown-renderer="extension"');
    assertStringIncludes(html, ">Heading</h1>");
  });

  it("prefers an application-installed renderer over the built-in one", () => {
    const html = renderToString(
      <MarkdownRendererProvider renderer={AppRenderer}>
        <ChatMarkdown># Heading</ChatMarkdown>
      </MarkdownRendererProvider>,
    );

    assertStringIncludes(html, 'data-app-renderer="true"');
    assert(!html.includes("<h1"), "the built-in renderer must not win over an installed one");
  });

  it("prefers an explicit per-instance renderer over both", () => {
    const html = renderToString(
      <MarkdownRendererProvider renderer={AppRenderer}>
        <ChatMarkdown renderer={({ source }) => <b>{source}</b>}># Heading</ChatMarkdown>
      </MarkdownRendererProvider>,
    );

    assertStringIncludes(html, "<b># Heading</b>");
  });

  it("keeps renderer={null} on the plain-source contract", () => {
    const html = renderToString(<ChatMarkdown renderer={null}># Heading</ChatMarkdown>);

    assertStringIncludes(html, 'data-vf-markdown-renderer="plain"');
    assertStringIncludes(html, "# Heading");
    assert(!html.includes("<h1"), "an explicit null must not fall through to a renderer");
  });

  it("applies prose styling only on the renderer branch", () => {
    const rendered = renderToString(<ChatMarkdown>text</ChatMarkdown>);
    const plain = renderToString(<ChatMarkdown renderer={null}>text</ChatMarkdown>);

    // `&` is HTML-escaped inside the class attribute.
    assertStringIncludes(rendered, "[&amp;_ul]:list-disc");
    assert(!plain.includes("_ul]:list-disc"), "plain source has no elements to style");
  });
});
