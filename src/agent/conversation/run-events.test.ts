import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  ConversationRunEventEncoder,
  conversationRunEventTypes,
  encodeConversationRunEvents,
  normalizeEncodedConversationRunEvents,
} from "./run-events.ts";

describe("agent/conversation-run-events", () => {
  it("captures active message ids from start events", () => {
    const encoder = new ConversationRunEventEncoder();
    assertEquals(encoder.encode({ type: "start", messageId: "msg-1" }), []);
    assertEquals(
      encoder.encode({ type: "tool-output-available", toolCallId: "tc-1", output: "ok" }),
      [{
        type: conversationRunEventTypes.toolCallResult,
        messageId: "msg-1:tool:tc-1",
        toolCallId: "tc-1",
        content: "ok",
        role: "tool",
      }],
    );
  });

  it("encodes text and reasoning events", () => {
    const encoder = new ConversationRunEventEncoder();
    assertEquals(
      encoder.encode({ type: "text-start", id: "msg-1" })[0]?.type,
      conversationRunEventTypes.textMessageStart,
    );
    assertEquals(
      encoder.encode({ type: "text-delta", id: "msg-1", delta: "hello" })[0]?.delta,
      "hello",
    );
    assertEquals(
      encoder.encode({ type: "reasoning-start", id: "r-1" })[0]?.type,
      conversationRunEventTypes.reasoningMessageStart,
    );
    assertEquals(
      encoder.encode({ type: "reasoning-delta", id: "r-1", delta: "think" })[0]?.type,
      conversationRunEventTypes.reasoningMessageContent,
    );
  });

  it("encodes text block ids as content ids when a durable message id is active", () => {
    const encoder = new ConversationRunEventEncoder();
    assertEquals(encoder.encode({ type: "start", messageId: "assistant-1" }), []);
    assertEquals(encoder.encode({ type: "text-start", id: "block-1" }), [{
      type: conversationRunEventTypes.textMessageStart,
      messageId: "assistant-1",
      contentId: "block-1",
      role: "assistant",
    }]);
    assertEquals(encoder.encode({ type: "text-delta", id: "block-1", delta: "hello" }), [{
      type: conversationRunEventTypes.textMessageContent,
      messageId: "assistant-1",
      contentId: "block-1",
      delta: "hello",
    }]);
    assertEquals(encoder.encode({ type: "text-end", id: "block-1" }), [{
      type: conversationRunEventTypes.textMessageEnd,
      messageId: "assistant-1",
      contentId: "block-1",
    }]);
  });

  it("encodes tool input availability with args when not previously streamed", () => {
    const encoder = new ConversationRunEventEncoder();
    assertEquals(
      encoder.encode({
        type: "tool-input-available",
        toolCallId: "tc-1",
        toolName: "bash",
        input: { command: "ls" },
      }),
      [
        {
          type: conversationRunEventTypes.toolCallArgs,
          toolCallId: "tc-1",
          delta: '{"command":"ls"}',
        },
        { type: conversationRunEventTypes.toolCallEnd, toolCallId: "tc-1" },
      ],
    );
  });

  it("skips repeated args when input was already streamed", () => {
    const encoder = new ConversationRunEventEncoder();
    encoder.encode({ type: "tool-input-delta", toolCallId: "tc-1", inputTextDelta: '{"cmd"' });
    assertEquals(
      encoder.encode({
        type: "tool-input-available",
        toolCallId: "tc-1",
        toolName: "bash",
        input: { command: "ls" },
      }),
      [{ type: conversationRunEventTypes.toolCallEnd, toolCallId: "tc-1" }],
    );
  });

  it("encodes tool errors and denial as tool results", () => {
    const encoder = new ConversationRunEventEncoder();
    assertEquals(
      encoder.encode({ type: "tool-output-error", toolCallId: "tc-1", errorText: "fail" })[0]
        ?.isError,
      true,
    );
    assertEquals(
      encoder.encode({ type: "tool-output-denied", toolCallId: "tc-1" })[0]?.content,
      "Tool output denied",
    );
  });

  it("encodes data-* chunks as custom events", () => {
    const encoder = new ConversationRunEventEncoder();
    assertEquals(
      encoder.encode({
        type: "data-tool-call-status",
        data: { toolCallId: "tc-1", status: "pending_input" },
      }),
      [
        {
          type: conversationRunEventTypes.custom,
          name: "tool-call-status",
          value: { toolCallId: "tc-1", status: "pending_input" },
        },
      ],
    );
  });

  it("encodes and normalizes whole event lists", () => {
    const events = [
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "x".repeat(300 * 1024) },
    ] as const;

    const encoded = encodeConversationRunEvents(events as never);
    assertEquals(encoded[0]?.type, conversationRunEventTypes.textMessageStart);
    const normalized = normalizeEncodedConversationRunEvents(events as never);
    assertEquals(normalized.length > encoded.length, true);
  });
});
