import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatMessage } from "#veryfront/agent/react";
import { ChatContextProvider, useChatContext, useChatContextOptional } from "./chat-context.tsx";
import type { ChatContextValue } from "./chat-context.tsx";

const messages: ChatMessage[] = [
  { id: "m-1", role: "user", parts: [{ type: "text", text: "Hi there" }] },
];

const fakeContext: ChatContextValue = {
  messages,
  isLoading: false,
  error: null,
  input: "draft reply",
  setInput: () => {},
  onSubmit: () => {},
  models: [],
  attachments: [],
  isEmpty: false,
  isAtBottom: true,
  scrollToBottom: () => {},
  theme: {},
};

describe("ChatContextProvider / useChatContext", () => {
  it("supplies the provided value to a descendant", () => {
    function Consumer() {
      const ctx = useChatContext();
      return <div data-count={ctx.messages.length}>{ctx.input}</div>;
    }
    const html = renderToString(
      <ChatContextProvider value={fakeContext}>
        <Consumer />
      </ChatContextProvider>,
    );
    assertStringIncludes(html, "draft reply");
    assertStringIncludes(html, 'data-count="1"');
  });

  it("fails fast when used outside a ChatRoot", () => {
    function Orphan() {
      useChatContext();
      return null;
    }
    let threw = false;
    try {
      renderToString(<Orphan />);
    } catch {
      threw = true;
    }
    assert(threw, "a misplaced useChatContext is a loud error, not silent");
  });

  it("useChatContextOptional returns null outside a provider, without throwing", () => {
    function OptionalConsumer() {
      const ctx = useChatContextOptional();
      return <div data-has-context={String(ctx !== null)} />;
    }
    const html = renderToString(<OptionalConsumer />);
    assertStringIncludes(html, 'data-has-context="false"');
  });
});
