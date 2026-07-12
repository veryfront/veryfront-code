/**
 * Characterization safety net for the `<Chat>` god file (plan E0.5).
 *
 * Locks the *observable* behaviour of the controlled render path — the surface
 * E1 (context spine) and E3 (state glue) will rewire — so a refactor that
 * changes what a consumer sees fails loudly. Uses the controlled `chat={…}`
 * entry (a fake `useChat()` session) so the assertions are deterministic and
 * network-free; the app-mode persistence effect's invariants are documented in
 * docs/plans/PROGRESS-implementation.md and characterized in the E3 PR (they
 * need a `useChat` mock).
 *
 * These tests describe CURRENT behaviour, not desired behaviour — if E1/E3
 * intentionally change an output, update the assertion in the same commit and
 * say why.
 */
import { renderToString } from "react-dom/server";
import { assert } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatMessage, UseChatResult } from "#veryfront/agent/react";
import { Chat } from "./index.tsx";

function fakeSession(overrides: Partial<UseChatResult> = {}): UseChatResult {
  const noop = () => {};
  return {
    messages: [],
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
    ...overrides,
  };
}

function userMsg(text: string): ChatMessage {
  return {
    id: `u-${text}`,
    role: "user",
    parts: [{ type: "text", text }],
  } as ChatMessage;
}

function assistantMsg(text: string): ChatMessage {
  return {
    id: `a-${text}`,
    role: "assistant",
    parts: [{ type: "text", text }],
  } as ChatMessage;
}

describe("Chat (god file) — controlled render characterization", () => {
  it("renders every message in the session, in order", () => {
    const html = renderToString(
      <Chat
        chat={fakeSession({
          messages: [userMsg("first question"), assistantMsg("first answer")],
        })}
      />,
    );
    assert(html.includes("first question"), "user message renders");
    assert(html.includes("first answer"), "assistant message renders");
    assert(
      html.indexOf("first question") < html.indexOf("first answer"),
      "messages render in session order",
    );
  });

  it("shows the supplied empty state when the thread is empty", () => {
    const html = renderToString(
      <Chat
        chat={fakeSession({ messages: [] })}
        emptyState={{ title: "Ask me anything", description: "I can help." }}
      />,
    );
    assert(html.includes("Ask me anything"), "empty-state title renders");
    assert(html.includes("I can help."), "empty-state description renders");
  });

  it("does not flash the placeholder empty-state title when messages exist", () => {
    const html = renderToString(
      <Chat chat={fakeSession({ messages: [userMsg("hi")] })} />,
    );
    assert(
      !html.includes("What can I help with?"),
      "default placeholder must not render alongside messages",
    );
  });

  it("surfaces a session error through the error banner", () => {
    const html = renderToString(
      <Chat
        chat={fakeSession({
          messages: [userMsg("hi")],
          error: new Error("stream exploded"),
        })}
      />,
    );
    assert(html.includes("stream exploded"), "error text renders");
  });

  it("renders the composer placeholder", () => {
    const html = renderToString(
      <Chat chat={fakeSession()} placeholder="Ask Veryfront anything" />,
    );
    assert(
      html.includes("Ask Veryfront anything"),
      "composer placeholder renders",
    );
  });

  it("compound children replace the default anatomy (render-or-compose)", () => {
    const html = renderToString(
      <Chat.Root messages={[userMsg("ignored by custom body")]} input="">
        <div data-custom-body="">totally custom layout</div>
      </Chat.Root>,
    );
    assert(html.includes("totally custom layout"), "custom children render");
    assert(html.includes('data-custom-body=""'), "custom structure preserved");
  });
});
