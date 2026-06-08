import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgUiRuntimeChatStreamEncoder } from "./runtime-chat-stream-encoder.ts";

describe("agent/ag-ui-runtime-chat-stream-encoder", () => {
  it("replays pending tool-input deltas once the tool lifecycle becomes available", () => {
    const encoder = createAgUiRuntimeChatStreamEncoder({
      responseMessageId: "msg-1",
    });

    assertEquals(
      encoder.encode({
        type: "tool-input-delta",
        toolCallId: "tool-1",
        inputTextDelta: '{"query":"ag',
      }),
      [{ type: "start-step" }],
    );

    assertEquals(
      encoder.encode({
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "search_docs",
        input: {},
      }),
      [
        { type: "tool-input-start", toolCallId: "tool-1", toolName: "search_docs" },
        { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '{"query":"ag' },
        {
          type: "tool-input-available",
          toolCallId: "tool-1",
          toolName: "search_docs",
          input: {},
        },
      ],
    );
  });

  it("emits text events with the response message id and block content id", () => {
    const encoder = createAgUiRuntimeChatStreamEncoder({
      responseMessageId: "msg-1",
    });

    assertEquals(encoder.encode({ type: "text-start", id: "block-1" }), [{ type: "start-step" }]);
    assertEquals(encoder.encode({ type: "text-delta", id: "block-1", delta: "hello" }), [
      { type: "text-start", id: "msg-1", contentId: "block-1" },
      { type: "text-delta", id: "msg-1", contentId: "block-1", delta: "hello" },
    ]);
    assertEquals(encoder.encode({ type: "text-end", id: "block-1" }), [{
      type: "text-end",
      id: "msg-1",
      contentId: "block-1",
    }]);

    assertEquals(encoder.encode({ type: "text-delta", id: "msg-1", delta: "same message" }), [
      { type: "text-start", id: "msg-1", contentId: "msg-1" },
      { type: "text-delta", id: "msg-1", contentId: "msg-1", delta: "same message" },
    ]);

    assertEquals(encoder.encode({ type: "reasoning-start", id: "reason-1" }), [
      { type: "reasoning-start", id: "reason-1" },
    ]);
    assertEquals(encoder.encode({ type: "reasoning-delta", id: "reason-1", delta: "think" }), [
      { type: "reasoning-delta", id: "reason-1", delta: "think" },
    ]);
    assertEquals(encoder.encode({ type: "reasoning-end", id: "reason-1" }), [
      { type: "reasoning-end", id: "reason-1" },
    ]);
  });

  it("maps data events and updates finishReason on errors", () => {
    const encoder = createAgUiRuntimeChatStreamEncoder({
      responseMessageId: "msg-1",
      onError: (error) => `wrapped:${String(error)}`,
    });

    assertEquals(encoder.encode({ type: "data", data: { model: "openai/gpt-5.4" } }), [
      { type: "message-metadata", messageMetadata: { modelId: "openai/gpt-5.4" } },
    ]);
    assertEquals(
      encoder.encode({ type: "data", data: { name: "state-snapshot", value: { step: 1 } } }),
      [
        { type: "data-state-snapshot", data: { step: 1 } },
      ],
    );

    assertEquals(encoder.encode({ type: "error", error: "boom" }), [
      { type: "error", errorText: "wrapped:boom" },
    ]);
    assertEquals(encoder.state.finishReason, "error");
  });

  it("can suppress reasoning deltas while preserving reasoning lifecycle markers", () => {
    const encoder = createAgUiRuntimeChatStreamEncoder({
      responseMessageId: "msg-1",
      sendReasoning: false,
    });

    assertEquals(encoder.encode({ type: "reasoning-start", id: "reason-1" }), [
      { type: "start-step" },
      { type: "reasoning-start", id: "reason-1" },
    ]);
    assertEquals(encoder.encode({ type: "reasoning-delta", id: "reason-1", delta: "hidden" }), []);
    assertEquals(encoder.encode({ type: "reasoning-end", id: "reason-1" }), [
      { type: "reasoning-end", id: "reason-1" },
    ]);
  });
});
