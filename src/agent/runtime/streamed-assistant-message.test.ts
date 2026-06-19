import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatStreamState } from "./chat-stream-handler.ts";
import { buildStreamedAssistantMessage } from "./streamed-assistant-message.ts";

describe("agent/streamed-assistant-message", () => {
  it("builds an assistant message from completed stream state", () => {
    const state: ChatStreamState = {
      accumulatedText: "Final answer",
      reasoningParts: [
        { id: "reasoning_empty", text: "" },
        { id: "reasoning_text", text: "internal note", signature: "sig_1" },
        { id: "reasoning_redacted", text: "", redactedData: "redacted_1" },
      ],
      finishReason: "tool-calls",
      toolCalls: new Map([
        [
          "call_1",
          {
            id: "call_1",
            name: "lookup",
            arguments: '{"query":"docs"}',
            inputAvailable: true,
          },
        ],
        [
          "call_2",
          {
            id: "call_2",
            name: "web_search",
            arguments: '{"q":"Veryfront"}',
            inputAvailable: true,
            providerExecuted: true,
          },
        ],
      ]),
      suppressedToolCalls: [],
      toolResults: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };

    const message = buildStreamedAssistantMessage(state, {
      id: "msg_fixed",
      timestamp: 123,
    });

    assertEquals(message, {
      id: "msg_fixed",
      role: "assistant",
      timestamp: 123,
      parts: [
        { type: "reasoning", text: "internal note", signature: "sig_1" },
        { type: "reasoning", redactedData: "redacted_1" },
        { type: "text", text: "Final answer" },
        {
          type: "tool-lookup",
          toolCallId: "call_1",
          toolName: "lookup",
          args: { query: "docs" },
          inputText: '{"query":"docs"}',
        },
        {
          type: "tool-web_search",
          toolCallId: "call_2",
          toolName: "web_search",
          args: { q: "Veryfront" },
          inputText: '{"q":"Veryfront"}',
          providerExecuted: true,
        },
      ],
    });
  });

  it("omits recoverable placeholder tool parts when assistant text exists", () => {
    const state: ChatStreamState = {
      accumulatedText: "Created the Outlook assistant.",
      reasoningParts: [],
      finishReason: "tool-calls",
      toolCalls: new Map([
        [
          "call_placeholder",
          {
            id: "call_placeholder",
            name: "studio_suggestions",
            arguments: "{}",
            inputAvailable: false,
          },
        ],
      ]),
      suppressedToolCalls: [],
      toolResults: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };

    const message = buildStreamedAssistantMessage(state, {
      id: "msg_text_only",
      timestamp: 456,
    });

    assertEquals(message, {
      id: "msg_text_only",
      role: "assistant",
      timestamp: 456,
      parts: [
        { type: "text", text: "Created the Outlook assistant." },
      ],
    });
  });
});
