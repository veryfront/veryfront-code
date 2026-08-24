import { renderToString } from "react-dom/server";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatMessage, UseChatResult } from "#veryfront/agent/react";
import { ChatRoot } from "./chat-root.tsx";
import { useChatContext } from "../contexts/chat-context.tsx";

const messages: ChatMessage[] = [
  { id: "m-1", role: "user", parts: [{ type: "text", text: "Hello" }] },
];

function makeChat(overrides: Partial<UseChatResult> = {}): UseChatResult {
  return {
    messages: [],
    input: "",
    isLoading: false,
    status: "ready",
    streamingMessageId: null,
    error: null,
    model: undefined,
    activeModel: undefined,
    inferenceMode: "cloud",
    setInput: () => {},
    setModel: () => {},
    sendMessage: () => Promise.resolve(),
    editMessage: () => Promise.resolve(),
    getBranches: () => ({ current: 0, total: 1 }),
    switchBranch: () => {},
    reload: () => Promise.resolve(),
    stop: () => {},
    setMessages: () => {},
    addToolOutput: () => {},
    handleInputChange: () => {},
    handleSubmit: () => Promise.resolve(),
    ...overrides,
  };
}

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

  it("blocks the context submit while an attachment is pending", () => {
    let sendCalls = 0;
    let submitCalls = 0;
    const session = makeChat({
      input: "draft",
      sendMessage: () => {
        sendCalls++;
        return Promise.resolve();
      },
      handleSubmit: () => {
        submitCalls++;
        return Promise.resolve();
      },
    });
    let onSubmit: ((e?: React.FormEvent) => unknown) | undefined;
    function SubmitProbe() {
      onSubmit = useChatContext().onSubmit;
      return null;
    }
    renderToString(
      <ChatRoot chat={session} attachments={[{ id: "p", name: "p.txt", state: "uploading" }]}>
        <SubmitProbe />
      </ChatRoot>,
    );
    let prevented = false;
    onSubmit?.({
      preventDefault() {
        prevented = true;
      },
    } as React.FormEvent);
    assertEquals(submitCalls, 0, "a pending upload must not fall through to handleSubmit");
    assertEquals(sendCalls, 0, "a pending upload must block the context submit");
    assertEquals(prevented, true, "the form submit is prevented while an upload is pending");
  });
});
