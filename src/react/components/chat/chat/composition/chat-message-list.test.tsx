import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatMessage } from "#veryfront/agent/react";
import { ChatMessageList } from "./chat-message-list.tsx";

const message: ChatMessage = {
  id: "message-1",
  role: "user",
  parts: [{ type: "text", text: "Compose the transcript." }],
  metadata: {},
};

const toolMessage: ChatMessage = {
  id: "message-2",
  role: "assistant",
  parts: [{
    type: "dynamic-tool",
    toolCallId: "tool-search-docs",
    toolName: "search_docs",
    state: "output-available",
    input: { query: "composition" },
    output: { result: "Found" },
  }],
  metadata: {},
};

const sourceMessage: ChatMessage = {
  id: "message-3",
  role: "assistant",
  parts: [
    { type: "text", text: "See the source." },
    {
      type: "tool-result",
      toolCallId: "tool-search-docs",
      // deno-lint-ignore no-explicit-any
      result: { documents: [{ title: "Composition guide", url: "/guide" }] } as any,
      // deno-lint-ignore no-explicit-any
    } as any,
  ],
  metadata: {},
};

describe("ChatMessageList", () => {
  it("exposes the inner transcript column as a compound part", () => {
    assert(typeof ChatMessageList.Content === "function");

    const html = renderToString(
      <ChatMessageList messages={[message]}>
        <ChatMessageList.Content className="vf-transcript-column" />
      </ChatMessageList>,
    );

    assertStringIncludes(html, "vf-transcript-column");
    assertStringIncludes(html, "Compose the transcript.");
  });

  it("lets Content children replace the default transcript anatomy", () => {
    const html = renderToString(
      <ChatMessageList messages={[message]}>
        <ChatMessageList.Content>
          <div className="vf-custom-transcript">Custom transcript</div>
        </ChatMessageList.Content>
      </ChatMessageList>,
    );

    assertStringIncludes(html, "vf-custom-transcript");
    assert(!html.includes("Compose the transcript."));
  });

  it("uses renderMessage to replace a whole transcript row", () => {
    const html = renderToString(
      <ChatMessageList
        messages={[message]}
        renderMessage={(item) => (
          <article className="vf-custom-message" data-message-id={item.id}>
            Custom row
          </article>
        )}
      />,
    );

    assertStringIncludes(html, "vf-custom-message");
    assertStringIncludes(html, 'data-message-id="message-1"');
    assert(!html.includes("Compose the transcript."));
  });

  it("keeps the canonical tool rendering in the default transcript", () => {
    const html = renderToString(<ChatMessageList messages={[toolMessage]} />);

    assertStringIncludes(html, "search_docs");
  });

  it("forwards source selection to the default Message anatomy", () => {
    const html = renderToString(
      <ChatMessageList messages={[sourceMessage]} onSourceClick={() => {}} />,
    );

    assertStringIncludes(html, "Composition guide");
    assertStringIncludes(html, "cursor-pointer");
  });
});
