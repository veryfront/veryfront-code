import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatMessage } from "#veryfront/agent/react";
import {
  MessageContextProvider,
  useMessageContext,
  useMessageContextOptional,
  useMessageParts,
} from "./message-context.tsx";
import type { MessageContextValue } from "./message-context.tsx";

const message: ChatMessage = {
  id: "m-1",
  role: "assistant",
  parts: [{ type: "text", text: "Answer body." }],
};

const fakeContext: MessageContextValue = {
  message,
  role: "assistant",
  isStreaming: false,
  parts: [{ type: "text", content: "Answer body." }],
  textContent: "Answer body.",
  branch: null,
  onCopy: async () => {},
  copied: false,
};

describe("MessageContextProvider / useMessageContext", () => {
  it("supplies the provided value to a descendant", () => {
    function Consumer() {
      const ctx = useMessageContext();
      return <div data-role={ctx.role}>{ctx.textContent}</div>;
    }
    const html = renderToString(
      <MessageContextProvider value={fakeContext}>
        <Consumer />
      </MessageContextProvider>,
    );
    assertStringIncludes(html, "Answer body.");
    assertStringIncludes(html, 'data-role="assistant"');
  });

  it("fails fast when used outside a Message", () => {
    function Orphan() {
      useMessageContext();
      return null;
    }
    let threw = false;
    try {
      renderToString(<Orphan />);
    } catch {
      threw = true;
    }
    assert(threw, "a misplaced useMessageContext is a loud error, not silent");
  });

  it("useMessageContextOptional returns null outside a provider, without throwing", () => {
    function OptionalConsumer() {
      const ctx = useMessageContextOptional();
      return <div data-has-context={String(ctx !== null)} />;
    }
    const html = renderToString(<OptionalConsumer />);
    assertStringIncludes(html, 'data-has-context="false"');
  });
});

describe("useMessageParts — via a raw MessageContextProvider", () => {
  it("exposes { parts, textContent } directly from the context value", () => {
    function PartsProbe() {
      const { parts, textContent } = useMessageParts();
      return <div data-count={parts.length}>{textContent}</div>;
    }
    const html = renderToString(
      <MessageContextProvider value={fakeContext}>
        <PartsProbe />
      </MessageContextProvider>,
    );
    assertStringIncludes(html, "Answer body.");
    assertStringIncludes(html, 'data-count="1"');
  });
});
