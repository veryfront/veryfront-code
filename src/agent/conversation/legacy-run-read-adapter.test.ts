import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import fixture from "./fixtures/legacy-content-after-end.json" with {
  type: "json",
};
import { readConversationRunLifecycleFrames } from "./legacy-run-read-adapter.ts";

describe("conversation run lifecycle read adapter", () => {
  it("repairs legacy content after end without rewriting source events", () => {
    const source = structuredClone(fixture.events);
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 1,
      events: fixture.events,
    });

    assertEquals(fixture.events, source);
    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(result.repairs, ["legacy_text_content_after_end"]);
    const text = result.frames.filter((frame) =>
      frame.class === "semantic" && frame.event.type === "text_content"
    );
    assertEquals(
      text.map((frame) => (frame.event as { delta: string }).delta),
      ["first", "second"],
    );
    assertEquals(
      new Set(text.map((frame) => (frame.event as { id?: string }).id)).size,
      2,
    );
    assertEquals(
      result.frames.filter((frame) =>
        frame.class === "semantic" && frame.event.type === "text_start"
      ).length,
      2,
    );
    assertEquals(
      result.frames.filter((frame) => frame.class === "semantic" && frame.event.type === "text_end")
        .length,
      2,
    );
  });

  it("rejects the same malformed sequence for version 2", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: fixture.events.map((event, index) => ({
        ...event,
        stream_protocol_version: 2,
        logical_sequence: index + 1,
        idempotency_key: `fixture:${index + 1}`,
      })),
    });
    assertEquals(result.status, "invalid");
    if (result.status === "invalid") {
      assertEquals(result.code, "VERSION_2_LIFECYCLE_VIOLATION");
    }
  });

  it("sanitizes unknown legacy events and tolerates frozen input", () => {
    const events = Object.freeze([
      Object.freeze({
        type: "FUTURE_EVENT",
        secret: "sentinel-token-abcdef",
      }),
    ]);
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 1,
      events,
    });
    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(
      result.frames.map((frame) => frame.event.type),
      ["provider_part_rejected"],
    );
    assertEquals(
      JSON.stringify(result).includes("sentinel-token-abcdef"),
      false,
    );
  });

  it("rejects unsupported durable events for version 2", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [{
        type: "FUTURE_EVENT",
        stream_protocol_version: 2,
        logical_sequence: 1,
        idempotency_key: "future:1",
      }],
    });
    assertEquals(result.status, "invalid");
    if (result.status === "invalid") {
      assertEquals(result.code, "UNSUPPORTED_DURABLE_EVENT");
    }
  });

  it("preserves stored version 2 tool arguments when replaying a committed call", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [
        {
          type: "TOOL_CALL_START",
          toolCallId: "tool-1",
          toolName: "create_file",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "tool:1",
        },
        {
          type: "TOOL_CALL_ARGS",
          toolCallId: "tool-1",
          delta: '{"path":"a.md"}',
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "tool:2",
        },
        {
          type: "TOOL_CALL_END",
          toolCallId: "tool-1",
          toolName: "create_file",
          stream_protocol_version: 2,
          logical_sequence: 3,
          idempotency_key: "tool:3",
        },
      ],
    });

    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    const ready = result.frames.find((frame) =>
      frame.class === "semantic" && frame.event.type === "tool_input_ready"
    );
    assertEquals(ready?.event, {
      type: "tool_input_ready",
      toolCallId: "tool-1",
      toolName: "create_file",
      input: { path: "a.md" },
    });
  });
});
