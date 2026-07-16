import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatMessage } from "#veryfront/agent/react";
import { Message } from "./message.tsx";
import { MessageSources } from "./message-sources.tsx";

const baseMessage: ChatMessage = {
  id: "m-1",
  role: "assistant",
  parts: [{ type: "text", text: "See sources." }],
  metadata: {},
};

function withDocs(documents: Array<Record<string, unknown>>): ChatMessage {
  return {
    ...baseMessage,
    parts: [
      ...baseMessage.parts,
      {
        type: "tool-result",
        toolCallId: "tool-search-docs",
        // deno-lint-ignore no-explicit-any
        result: { documents } as any,
        // deno-lint-ignore no-explicit-any
      } as any,
    ],
  };
}

describe("Message.Sources (MessageSources)", () => {
  it("renders nothing when the message has no extractable sources", () => {
    const html = renderToString(
      <Message.Root message={baseMessage}>
        <MessageSources />
      </Message.Root>,
    );
    assert(!html.includes("<a") && !html.includes("<button"), "no sources means no pills render");
  });

  it("renders the default pill anatomy for each extracted source", () => {
    const message = withDocs([{ title: "Runs guide", url: "/runs" }]);
    const html = renderToString(
      <Message.Root message={message}>
        <MessageSources />
      </Message.Root>,
    );
    assertStringIncludes(html, "Runs guide");
  });

  it("maps each source through a function child instead of the default pill", () => {
    const message = withDocs([{ title: "Runs guide", url: "/runs" }]);
    const html = renderToString(
      <Message.Root message={message}>
        <MessageSources>
          {(source, index) => <span key={index} data-testid="custom-source">{source.title}</span>}
        </MessageSources>
      </Message.Root>,
    );
    assertStringIncludes(html, "custom-source");
    assertStringIncludes(html, "Runs guide");
  });

  it("maps each source through a renderItem callback", () => {
    const message = withDocs([{ title: "Runs guide", url: "/runs" }]);
    const seen: string[] = [];
    const html = renderToString(
      <Message.Root message={message}>
        <MessageSources
          renderItem={({ item }) => {
            seen.push(item.title);
            return <span data-testid="render-item">{item.title}</span>;
          }}
        />
      </Message.Root>,
    );
    assertStringIncludes(html, "render-item");
    assert(seen.includes("Runs guide"));
  });

  it("throws when used outside a Message.Root", () => {
    let threw = false;
    try {
      renderToString(<MessageSources />);
    } catch {
      threw = true;
    }
    assert(threw, "MessageSources reads useMessageContext, which requires Message.Root");
  });
});
