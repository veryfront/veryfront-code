import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getConversationRunEventJsonByteLength,
  normalizeConversationRunEvent,
  normalizeConversationRunEvents,
} from "./conversation-run-event-normalization.ts";

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

  it("normalizes whole event lists", () => {
    const events = [
      { type: "TEXT_MESSAGE_CONTENT", delta: "ok" },
      { type: "TEXT_MESSAGE_CONTENT", delta: "x".repeat(300 * 1024) },
    ];

    const result = normalizeConversationRunEvents(events);
    assertEquals(result.length > 2, true);
  });
});
