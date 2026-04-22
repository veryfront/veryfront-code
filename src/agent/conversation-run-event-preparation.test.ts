import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  prepareConversationRunExternalEvents,
  prepareConversationRunStreamEvents,
} from "./conversation-run-event-preparation.ts";

describe("agent/conversation-run-event-preparation", () => {
  it("encodes and normalizes stream events in one step", () => {
    const prepared = prepareConversationRunStreamEvents([
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "x".repeat(300 * 1024) },
    ]);

    assertEquals(prepared[0]?.type, "TEXT_MESSAGE_START");
    assertEquals(prepared.length > 2, true);
  });

  it("normalizes external events without re-encoding them", () => {
    const prepared = prepareConversationRunExternalEvents([
      { type: "TEXT_MESSAGE_CONTENT", delta: "x".repeat(300 * 1024) },
    ]);

    assertEquals(prepared.length > 1, true);
    assertEquals(prepared.every((event) => event.type === "TEXT_MESSAGE_CONTENT"), true);
  });
});
