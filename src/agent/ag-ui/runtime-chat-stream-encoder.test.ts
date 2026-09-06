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

  it("recovers buffered tool input when tool-input-available carries an empty object", () => {
    const encoder = createAgUiRuntimeChatStreamEncoder({
      responseMessageId: "msg-1",
    });

    assertEquals(
      encoder.encode({
        type: "tool-input-delta",
        toolCallId: "tool-2",
        inputTextDelta: '{"query":"docs"}',
      }),
      [{ type: "start-step" }],
      "a delta for an unopened tool part is buffered rather than emitted",
    );

    assertEquals(
      encoder.encode({
        type: "tool-input-available",
        toolCallId: "tool-2",
        toolName: "search_docs",
        input: {},
      }),
      [
        { type: "tool-input-start", toolCallId: "tool-2", toolName: "search_docs" },
        { type: "tool-input-delta", toolCallId: "tool-2", inputTextDelta: '{"query":"docs"}' },
        {
          type: "tool-input-available",
          toolCallId: "tool-2",
          toolName: "search_docs",
          input: { query: "docs" },
        },
      ],
      "a complete buffered delta must reconstruct the tool input when the provider sends an empty object",
    );
  });

  it("replays buffered deltas after a late tool-input-start", () => {
    const encoder = createAgUiRuntimeChatStreamEncoder({
      responseMessageId: "msg-1",
    });

    assertEquals(
      encoder.encode({
        type: "tool-input-delta",
        toolCallId: "tool-3",
        inputTextDelta: '{"query":"docs"}',
      }),
      [{ type: "start-step" }],
      "a delta for an unopened tool part is buffered rather than emitted",
    );

    assertEquals(
      encoder.encode({
        type: "tool-input-start",
        toolCallId: "tool-3",
        toolName: "search_docs",
      }),
      [
        { type: "tool-input-start", toolCallId: "tool-3", toolName: "search_docs" },
        { type: "tool-input-delta", toolCallId: "tool-3", inputTextDelta: '{"query":"docs"}' },
      ],
      "buffered deltas must be replayed after the tool-input-start that opens the part",
    );
  });

  it("preserves providerExecuted on runtime tool lifecycle events", () => {
    const encoder = createAgUiRuntimeChatStreamEncoder({
      responseMessageId: "msg-1",
    });

    assertEquals(
      encoder.encode({
        type: "tool-input-start",
        toolCallId: "tool-provider-fetch",
        toolName: "web_fetch",
        providerExecuted: true,
      }),
      [
        { type: "start-step" },
        {
          type: "tool-input-start",
          toolCallId: "tool-provider-fetch",
          toolName: "web_fetch",
          providerExecuted: true,
        },
      ],
    );
    assertEquals(
      encoder.encode({
        type: "tool-input-available",
        toolCallId: "tool-provider-fetch",
        toolName: "web_fetch",
        input: { url: "https://example.com/docs" },
        providerExecuted: true,
      }),
      [
        {
          type: "tool-input-available",
          toolCallId: "tool-provider-fetch",
          toolName: "web_fetch",
          input: { url: "https://example.com/docs" },
          providerExecuted: true,
        },
      ],
    );
    assertEquals(
      encoder.encode({
        type: "tool-output-error",
        toolCallId: "tool-provider-fetch",
        errorText: "provider failed",
        providerExecuted: true,
      }),
      [
        {
          type: "tool-output-error",
          toolCallId: "tool-provider-fetch",
          errorText: "provider failed",
          providerExecuted: true,
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
    const sourceUrl = {
      type: "source-url" as const,
      sourceId: "docs-1",
      url: "https://example.com/docs",
      title: "Docs",
    };
    assertEquals(
      encoder.encode({ type: "data", data: { name: "source-url", value: sourceUrl } }),
      [sourceUrl],
    );
    assertEquals(encoder.encode(sourceUrl), [sourceUrl]);

    assertEquals(encoder.encode({ type: "error", error: "boom", code: "INSUFFICIENT_CREDITS" }), [
      { type: "error", errorText: "wrapped:boom", code: "INSUFFICIENT_CREDITS" },
    ]);
    assertEquals(encoder.encode({ type: "error", error: "unknown" }), [
      { type: "error", errorText: "wrapped:unknown" },
    ]);
    assertEquals(encoder.state.finishReason, "error");
  });

  it("captures finish reason and usage from message-finish events", () => {
    const encoder = createAgUiRuntimeChatStreamEncoder({
      responseMessageId: "msg-1",
    });

    assertEquals(
      encoder.encode({
        type: "message-finish",
        finishReason: "max_tokens",
        totalUsage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20,
          cacheReadInputTokens: 3,
          cacheCreationInputTokens: 4,
          reasoningTokens: 2,
          costCredits: 0.25,
        },
      }),
      [],
    );

    assertEquals(encoder.state.finishReason, "length");
    assertEquals(encoder.state.totalUsage, {
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      inputTokenDetails: {
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
      },
      outputTokenDetails: {
        reasoningTokens: 2,
      },
      costCredits: 0.25,
    });
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
