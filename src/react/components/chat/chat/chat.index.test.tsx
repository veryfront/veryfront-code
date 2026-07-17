/**
 * Characterization safety net for `./chat/index.tsx` itself — the barrel that
 * assembles the `Chat` compound (`ChatBase` + `Object.assign`). The render
 * behaviour of `ChatBase`'s dispatch and the controlled/app-mode paths is
 * already characterized by `chat.characterization.test.tsx` and
 * `chat.controlled.test.tsx`, so this file focuses on what's genuinely
 * uncovered by name: that the compound's sub-component identities are wired
 * to the exact composition-module exports (not copies/wrappers), that a
 * sample of the re-exports exist with the expected shape, and one smoke
 * render to prove the compound still works end to end.
 *
 * These tests describe current behaviour, not desired behaviour. If an
 * intentional change alters an output, update the assertion in the same
 * commit and say why.
 */
import { renderToString } from "react-dom/server";
import { assert, assertStrictEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { UseChatResult } from "#veryfront/agent/react";
import { Chat, FadeIn, useConversationChat } from "./index.tsx";
import { ChatRoot } from "./composition/chat-root.tsx";
import { ChatMessageList } from "./composition/chat-message-list.tsx";
import { ChatInput } from "./composition/chat-composer.tsx";
import { ChatEmpty } from "./composition/chat-empty.tsx";
import { ChatIf } from "./composition/chat-if.tsx";
import { ErrorBanner } from "./composition/error-banner.tsx";
import { Message } from "./composition/message.tsx";
import { ChatMessagesSkeleton } from "./components/chat-messages-skeleton.tsx";

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

describe("Chat compound — sub-component identity", () => {
  it("Chat.Root / Chat.MessageList / Chat.Input are the exact composition exports", () => {
    assertStrictEquals(Chat.Root, ChatRoot);
    assertStrictEquals(Chat.MessageList, ChatMessageList);
    assertStrictEquals(Chat.Input, ChatInput);
  });

  it("Chat.Empty / Chat.Skeleton / Chat.If are the exact composition exports", () => {
    assertStrictEquals(Chat.Empty, ChatEmpty);
    assertStrictEquals(Chat.Skeleton, ChatMessagesSkeleton);
    assertStrictEquals(Chat.If, ChatIf);
  });

  it("Chat.Message / Chat.ErrorBanner are the exact composition exports", () => {
    assertStrictEquals(Chat.Message, Message);
    assertStrictEquals(Chat.ErrorBanner, ErrorBanner);
  });
});

describe("Chat compound — re-export sample", () => {
  it("re-exports FadeIn as a function component", () => {
    assert(typeof FadeIn === "function", "FadeIn must be a function");
  });

  it("re-exports useConversationChat as a function", () => {
    assert(typeof useConversationChat === "function", "useConversationChat must be a function");
  });
});

describe("Chat compound — smoke render", () => {
  it("renders through ChatBase's controlled branch end to end", () => {
    const html = renderToString(
      <Chat chat={fakeSession({ messages: [] })} placeholder="Say something" />,
    );
    assertStringIncludes(html, "Say something");
  });
});
