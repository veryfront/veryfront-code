/**
 * `<Chat chat={useChat()}>` — the consolidated controlled API (Step 3). Proves
 * the whole-session object drives the surface, superseding the legacy flat
 * `messages`/`input`/… spread (kept working as a one-release fallback).
 */
import { renderToString } from "react-dom/server";
import { assert } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatMessage, UseChatResult } from "#veryfront/agent/react";
import { Chat } from "./index.tsx";

function fakeSession(messages: ChatMessage[]): UseChatResult {
  const noop = () => {};
  return {
    messages,
    input: "",
    isLoading: false,
    error: null,
    model: undefined,
    activeModel: undefined,
    inferenceMode: "cloud",
    setInput: noop,
    setModel: noop,
    sendMessage: () => Promise.resolve(),
    editMessage: () => Promise.resolve(),
    getBranches: () => ({ current: 1, total: 1 }),
    switchBranch: noop,
    reload: () => Promise.resolve(),
    stop: noop,
    setMessages: noop,
    addToolOutput: noop,
    handleInputChange: noop,
    handleSubmit: () => Promise.resolve(),
    onChange: noop,
    onSubmit: () => Promise.resolve(),
    onModelChange: noop,
  };
}

function userMsg(text: string): ChatMessage {
  return { id: `m-${text}`, role: "user", parts: [{ type: "text", text }] } as ChatMessage;
}

describe("Chat — controlled via chat={useChat()}", () => {
  it("renders the session's messages (the object drives the surface)", () => {
    const html = renderToString(
      <Chat chat={fakeSession([userMsg("Hello from session")])} />,
    );
    assert(html.includes("Hello from session"), "message text renders from chat.messages");
  });

  it("treats chat={} as controlled — no agentId/app-mode fetch needed", () => {
    const html = renderToString(<Chat chat={fakeSession([])} />);
    assert(html.length > 0, "renders an empty controlled chat");
  });
});
