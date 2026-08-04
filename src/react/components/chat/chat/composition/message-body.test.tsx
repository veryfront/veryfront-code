import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatMessage } from "#veryfront/agent/react";
import type { MarkdownRendererProps } from "../../markdown.tsx";
import { MarkdownRendererProvider } from "../../markdown.tsx";
import { Message } from "./message.tsx";
import { Reasoning } from "../components/reasoning.tsx";

function assistantMessage(text: string): ChatMessage {
  return {
    id: "m-assistant",
    role: "assistant",
    parts: [{ type: "text", text }],
    metadata: {},
  };
}

function renderBody(text: string): string {
  return renderToString(
    <Message.Root message={assistantMessage(text)}>
      <Message.Content />
    </Message.Root>,
  );
}

describe("Message body — Markdown", () => {
  it("renders assistant Markdown semantically without extension setup", () => {
    const html = renderBody("## Quick answer\n\n- **Key point:** use `inline_code` here.\n");

    assertStringIncludes(html, "<h2");
    assertStringIncludes(html, ">Quick answer</h2>");
    assertStringIncludes(html, "<ul");
    assertStringIncludes(html, "<strong>Key point:</strong>");
    assertStringIncludes(html, "<code>inline_code</code>");
    assert(
      !html.includes("## Quick answer"),
      "the answer body must not fall back to raw Markdown source",
    );
  });

  it("keeps an application-installed renderer in charge", () => {
    function AppRenderer({ source }: MarkdownRendererProps): React.ReactElement {
      return <article data-app-renderer="true">{source}</article>;
    }

    const html = renderToString(
      <MarkdownRendererProvider renderer={AppRenderer}>
        <Message.Root message={assistantMessage("## Quick answer")}>
          <Message.Content />
        </Message.Root>
      </MarkdownRendererProvider>,
    );

    assertStringIncludes(html, 'data-app-renderer="true"');
    assert(!html.includes("<h2"), "the installed renderer must not be overridden by the default");
  });

  it("renders reasoning Markdown semantically too", () => {
    const reasoning = "**Calculating shares**\n\nStep one.";
    // The disclosure starts collapsed for a completed card, so open it here.
    const html = renderToString(<Reasoning text={reasoning} open />);

    assertStringIncludes(html, "<strong>Calculating shares</strong>");
  });
});
