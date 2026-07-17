/**
 * Characterization safety net for the top-level `chat.tsx` re-export
 * aggregator — distinct from `chat/index.tsx` (which it re-exports from,
 * alongside `./chat/model-selector.tsx`). Pure barrel: this only proves the
 * re-export wiring itself (representative exports exist with the expected
 * type) plus one smoke render through this specific import path, since the
 * deeper `Chat` render behaviour is already characterized against
 * `chat/index.tsx` directly.
 *
 * These tests describe current behaviour, not desired behaviour. If an
 * intentional change alters an output, update the assertion in the same
 * commit and say why.
 */
import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { UseChatResult } from "#veryfront/agent/react";
import {
  Chat,
  ChatRoot,
  ModelSelector,
  useChatContext,
  useConversationChat,
  useConversations,
  useModelSelector,
  useUpload,
} from "./chat.tsx";

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

describe("chat.tsx — top-level barrel re-exports", () => {
  it("re-exports the Chat compound and ChatRoot as functions", () => {
    assert(typeof Chat === "function", "Chat must be a function");
    assert(typeof ChatRoot === "function", "ChatRoot must be a function");
  });

  it("re-exports ModelSelector-related exports from ./chat/model-selector.tsx", () => {
    assert(typeof ModelSelector === "function", "ModelSelector must be a function");
    assert(typeof useModelSelector === "function", "useModelSelector must be a function");
  });

  it("re-exports representative hooks from ./chat/index.tsx", () => {
    assert(typeof useChatContext === "function", "useChatContext must be a function");
    assert(typeof useConversationChat === "function", "useConversationChat must be a function");
    assert(typeof useConversations === "function", "useConversations must be a function");
    assert(typeof useUpload === "function", "useUpload must be a function");
  });

  it("renders Chat via this top-level import path (proves the re-export wiring)", () => {
    const html = renderToString(
      <Chat chat={fakeSession()} placeholder="Ask via the top-level barrel" />,
    );
    assertStringIncludes(html, "Ask via the top-level barrel");
  });
});
