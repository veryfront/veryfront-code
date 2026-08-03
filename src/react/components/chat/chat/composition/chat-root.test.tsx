import { renderToString } from "react-dom/server";
import { assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatMessage } from "#veryfront/agent/react";
import { ChatRoot } from "./chat-root.tsx";
import { useChatContext } from "../contexts/chat-context.tsx";

const messages: ChatMessage[] = [
  { id: "m-1", role: "user", parts: [{ type: "text", text: "Hello" }] },
];

function IsEmptyProbe() {
  const { isEmpty } = useChatContext();
  return <div data-is-empty={String(isEmpty)} />;
}

describe("ChatRoot", () => {
  it("renders the container with data-vf-chat and its children", () => {
    const html = renderToString(
      <ChatRoot messages={[]} input="">
        <div data-testid="child">child content</div>
      </ChatRoot>,
    );
    assertStringIncludes(html, "data-vf-chat");
    assertStringIncludes(html, "child content");
  });

  it("merges a caller className onto the container", () => {
    const html = renderToString(
      <ChatRoot messages={[]} input="" className="vf-custom-root">
        <div>child</div>
      </ChatRoot>,
    );
    assertStringIncludes(html, "vf-custom-root");
  });

  it("derives isEmpty: true from an empty messages array", () => {
    const html = renderToString(
      <ChatRoot messages={[]} input="">
        <IsEmptyProbe />
      </ChatRoot>,
    );
    assertStringIncludes(html, 'data-is-empty="true"');
  });

  it("derives isEmpty: false when messages are present", () => {
    const html = renderToString(
      <ChatRoot messages={messages} input="">
        <IsEmptyProbe />
      </ChatRoot>,
    );
    assertStringIncludes(html, 'data-is-empty="false"');
  });

  it("forwards messages/input into the chat context for descendants", () => {
    function ContextProbe() {
      const ctx = useChatContext();
      return <div data-count={ctx.messages.length}>{ctx.input}</div>;
    }
    const html = renderToString(
      <ChatRoot messages={messages} input="draft">
        <ContextProbe />
      </ChatRoot>,
    );
    assertStringIncludes(html, 'data-count="1"');
    assertStringIncludes(html, "draft");
  });
});
