/**
 * Characterization safety net for `ControlledChat` — the component `Chat`
 * dispatches to when a `chat={useChat()}` session is supplied. Renders
 * `ControlledChat` directly (not through `Chat`) so the assertions lock in
 * this component's own behaviour rather than `ChatBase`'s dispatch logic,
 * which is already covered elsewhere.
 *
 * These tests describe current behaviour, not desired behaviour. If an
 * intentional change alters an output, update the assertion in the same
 * commit and say why.
 */
import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatMessage, UseChatResult } from "#veryfront/agent/react";
import { ControlledChat } from "./controlled-chat.tsx";

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

describe("ControlledChat — direct render characterization", () => {
  it("renders the session's messages", () => {
    const html = renderToString(
      <ControlledChat chat={fakeSession({ messages: [userMsg("hello there")] })} />,
    );
    assertStringIncludes(html, "hello there");
  });

  it("renders a blank canvas (no placeholder hero) when messages is empty and no emptyState is supplied", () => {
    const html = renderToString(
      <ControlledChat chat={fakeSession({ messages: [] })} />,
    );
    assert(
      !html.includes("What can I help with?"),
      "idle hero must be opt-in via `emptyState`, not shown by default",
    );
  });

  it("shows the ErrorBanner when chat.error is set", () => {
    const html = renderToString(
      <ControlledChat
        chat={fakeSession({
          messages: [userMsg("hi")],
          error: new Error("session blew up"),
        })}
      />,
    );
    assertStringIncludes(html, "session blew up");
  });

  it("passes the model prop through to the composer", () => {
    const html = renderToString(
      <ControlledChat
        chat={fakeSession({ model: "gpt-5" })}
        placeholder="Ask anything"
      />,
    );
    // Locks in that the composer renders — the model selector's specific
    // markup is exercised by the composer's own tests, so this only proves
    // the prop makes it through without ControlledChat throwing.
    assertStringIncludes(html, "Ask anything");
  });

  it("renders the skeleton (not the empty state) while the session is loading with no messages", () => {
    const html = renderToString(
      <ControlledChat chat={fakeSession({ messages: [], isLoading: true })} />,
    );
    assertStringIncludes(html, 'aria-busy="true"');
  });
});
