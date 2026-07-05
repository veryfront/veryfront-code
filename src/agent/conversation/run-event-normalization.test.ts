import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getConversationRunEventJsonByteLength,
  MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES,
  normalizeConversationRunEvent,
  normalizeConversationRunEvents,
} from "./run-event-normalization.ts";

describe("agent/conversation-run-event-normalization", () => {
  it("returns UTF-8 byte length for JSON-serialized values", () => {
    assertEquals(
      getConversationRunEventJsonByteLength({ key: "value" }),
      new TextEncoder().encode('{"key":"value"}').byteLength,
    );
  });

  it("returns Infinity for circular references", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assertEquals(getConversationRunEventJsonByteLength(circular), Number.POSITIVE_INFINITY);
  });

  it("returns small events unchanged", () => {
    const event = { type: "TEXT_MESSAGE_CONTENT", delta: "Hello" };
    assertEquals(normalizeConversationRunEvent(event), [event]);
  });

  it("splits oversized string-delta events", () => {
    const largeDelta = "x".repeat(300 * 1024);
    const event = { type: "TEXT_MESSAGE_CONTENT", delta: largeDelta };
    const result = normalizeConversationRunEvent(event);

    assertEquals(result.length > 1, true);
    assertEquals(result.map((eventPart) => String(eventPart.delta ?? "")).join(""), largeDelta);
  });

  it("summarizes oversized tool results with string content", () => {
    const largeContent = "z".repeat(300 * 1024);
    const [result] = normalizeConversationRunEvent({
      type: "TOOL_CALL_RESULT",
      content: largeContent,
    });

    assertEquals(
      String(result?.content ?? "").includes("[tool result truncated in conversation-run event]"),
      true,
    );
  });

  it("keeps oversized tool results with escape-heavy content within the byte limit", () => {
    // Every `"` serializes to `\"` (2 bytes) in JSON, so truncating by raw UTF-8
    // bytes undershoots the JSON-measured limit the API actually enforces.
    const escapeHeavyContent = '"'.repeat(300 * 1024);
    const [result] = normalizeConversationRunEvent({
      type: "TOOL_CALL_RESULT",
      toolCallId: "tc_escape",
      content: escapeHeavyContent,
    });

    assertEquals(
      getConversationRunEventJsonByteLength(result) <= MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES,
      true,
    );
  });

  it("keeps tool results whose oversized data is outside content within the byte limit", () => {
    // The large payload lives in `input`, not `content`; the tool-result summarizer
    // must still clamp the whole event, not just the `content` field.
    const [result] = normalizeConversationRunEvent({
      type: "TOOL_CALL_RESULT",
      toolCallId: "tc_input",
      content: "ok",
      input: { blob: "x".repeat(300 * 1024) },
    });

    assertEquals(
      getConversationRunEventJsonByteLength(result) <= MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES,
      true,
    );
  });

  it("summarizes oversized generic events", () => {
    const [result] = normalizeConversationRunEvent({
      type: "SOME_OTHER_TYPE",
      payload: "x".repeat(300 * 1024),
    });

    assertEquals(result?.truncated, true);
    assertEquals(
      String(result?.note ?? "").includes("summarized to stay within storage limits"),
      true,
    );
  });

  it("keeps oversized generic events within the byte limit", () => {
    const [result] = normalizeConversationRunEvent({
      type: "SOME_OTHER_TYPE",
      payload: "x".repeat(300 * 1024),
    });

    assertEquals(
      getConversationRunEventJsonByteLength(result) <= MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES,
      true,
    );
  });

  it("keeps every split part of escape-heavy delta events within the byte limit", () => {
    const escapeHeavyDelta = '"'.repeat(300 * 1024);
    const parts = normalizeConversationRunEvent({
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "m1",
      delta: escapeHeavyDelta,
    });

    for (const part of parts) {
      assertEquals(
        getConversationRunEventJsonByteLength(part) <= MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES,
        true,
      );
    }
  });

  it("preserves all data when splitting escape-heavy delta events", () => {
    // Splitting by raw UTF-8 bytes would leave each part oversized once JSON-escaped,
    // forcing the size-limit backstop to truncate (drop) the tail. The split must be
    // escape-aware so the concatenated parts reconstruct the original delta losslessly.
    const escapeHeavyDelta = '"'.repeat(300 * 1024);
    const parts = normalizeConversationRunEvent({
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "m1",
      delta: escapeHeavyDelta,
    });

    assertEquals(parts.length > 1, true);
    assertEquals(parts.map((part) => part.delta).join(""), escapeHeavyDelta);
    for (const part of parts) {
      assertEquals(
        getConversationRunEventJsonByteLength(part) <= MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES,
        true,
      );
    }
  });

  it("preserves all data when splitting escape-heavy TOOL_CALL_ARGS deltas", () => {
    // TOOL_CALL_ARGS reassembles into a tool's JSON arguments; a dropped tail would
    // corrupt them, so escape-heavy args must split losslessly across parts.
    const escapeHeavyArgs = '"'.repeat(300 * 1024);
    const parts = normalizeConversationRunEvent({
      type: "TOOL_CALL_ARGS",
      toolCallId: "tc_args",
      delta: escapeHeavyArgs,
    });

    assertEquals(parts.map((part) => part.delta).join(""), escapeHeavyArgs);
    for (const part of parts) {
      assertEquals(
        getConversationRunEventJsonByteLength(part) <= MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES,
        true,
      );
    }
  });

  it("normalizes whole event lists", () => {
    const events = [
      { type: "TEXT_MESSAGE_CONTENT", delta: "ok" },
      { type: "TEXT_MESSAGE_CONTENT", delta: "x".repeat(300 * 1024) },
    ];

    const result = normalizeConversationRunEvents(events);
    assertEquals(result.length > 2, true);
  });
});
