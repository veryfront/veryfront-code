import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { StreamLifecycleFrame } from "#veryfront/agent/streaming/lifecycle/index.ts";
import { createLifecycleAgUiBrowserAdapter } from "#veryfront/agent/ag-ui/lifecycle-browser-adapter.ts";
import fixture from "./fixtures/legacy-content-after-end.json" with {
  type: "json",
};
import { createLifecycleRunEventAdapter } from "./lifecycle-run-event-adapter.ts";
import { readConversationRunLifecycleFrames } from "./legacy-run-read-adapter.ts";
import { normalizeConversationRunEvents } from "./run-event-normalization.ts";
import type { ConversationRunEvent } from "./run-events.ts";

function frames(
  entries: readonly {
    class?: StreamLifecycleFrame["class"];
    event: unknown;
  }[],
): StreamLifecycleFrame[] {
  return entries.map((entry, index) => ({
    class: entry.class ?? "semantic",
    event: entry.event,
    sequence: index + 1,
    elapsedMs: index,
  } as StreamLifecycleFrame));
}

function writeDurableEvents(framesToWrite: readonly StreamLifecycleFrame[]) {
  const durableEvents: ConversationRunEvent[] = [];
  const writer = createLifecycleRunEventAdapter({
    runId: "run-1",
    attemptId: "attempt-1",
    attemptIndex: 0,
    messageId: "message-1",
    onEvents: (events) => durableEvents.push(...events),
    setTimer: () => 1,
    clearTimer: () => {},
  });
  for (const frame of framesToWrite) {
    writer.handleFrame(frame);
  }
  writer.dispose();
  return normalizeConversationRunEvents(durableEvents);
}

function projectDurableEventsToAgUi(events: readonly ConversationRunEvent[]) {
  const read = readConversationRunLifecycleFrames({
    streamProtocolVersion: 2,
    events,
  });
  assertEquals(read.status, "ok");
  if (read.status !== "ok") return [];
  const agui = createLifecycleAgUiBrowserAdapter({ messageId: "message-1" });
  return read.frames.flatMap((frame) => agui.encode(frame));
}

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

  it("projects a legacy completed tool call without a result as an explicit error", () => {
    const events = [
      {
        type: "TOOL_CALL_START",
        toolCallId: "legacy-fetch",
        toolCallName: "web_fetch",
        providerExecuted: true,
      },
      {
        type: "TOOL_CALL_ARGS",
        toolCallId: "legacy-fetch",
        delta: '{"url":"https://docs.example/page"}',
      },
      {
        type: "TOOL_CALL_END",
        toolCallId: "legacy-fetch",
      },
    ];
    const source = structuredClone(events);

    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 1,
      events,
    });

    assertEquals(events, source);
    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(result.repairs, ["legacy_missing_tool_result"]);
    const agui = createLifecycleAgUiBrowserAdapter({ messageId: "message-1" });
    assertEquals(
      result.frames.flatMap((frame) => agui.encode(frame)).filter((event) =>
        event.event === "ToolCallResult"
      ),
      [{
        event: "ToolCallResult",
        payload: {
          toolCallId: "legacy-fetch",
          result: { error: "Stored tool call ended without a result" },
          isError: true,
        },
      }],
    );
  });

  it("leaves an unmarked legacy local tool handoff unresolved", () => {
    const events = [
      {
        type: "TOOL_CALL_START",
        toolCallId: "legacy-local",
        toolCallName: "request_approval",
      },
      {
        type: "TOOL_CALL_ARGS",
        toolCallId: "legacy-local",
        delta: '{"message":"Continue?"}',
      },
      {
        type: "TOOL_CALL_END",
        toolCallId: "legacy-local",
      },
    ];

    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 1,
      events,
    });

    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(result.repairs, []);
    assertEquals(
      result.frames.some((frame) =>
        frame.class === "semantic" && frame.event.type === "provider_tool_result"
      ),
      false,
    );
    assertEquals(
      result.frames.some((frame) =>
        frame.class === "semantic" && frame.event.type === "tool_input_ready"
      ),
      true,
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

  it("rejects version 2 durable events with missing lifecycle identities", () => {
    const cases = [
      [
        {
          type: "TEXT_MESSAGE_START",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "text:1",
        },
        {
          type: "TEXT_MESSAGE_END",
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "text:2",
        },
      ],
      [
        {
          type: "TOOL_CALL_START",
          toolName: "get_file",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "tool:1",
        },
        {
          type: "TOOL_CALL_END",
          toolName: "get_file",
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "tool:2",
        },
      ],
      [
        {
          type: "TOOL_CALL_START",
          toolCallId: "tool-1",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "tool-name:1",
        },
        {
          type: "TOOL_CALL_END",
          toolCallId: "tool-1",
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "tool-name:2",
        },
      ],
    ];

    for (const events of cases) {
      const result = readConversationRunLifecycleFrames({
        streamProtocolVersion: 2,
        events,
      });
      assertEquals(result.status, "invalid");
      if (result.status === "invalid") {
        assertEquals(result.code, "VERSION_2_LIFECYCLE_VIOLATION");
      }
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

  it("round trips provider-executed success results through durable v2 as AG-UI tool results", () => {
    const durableEvents = writeDurableEvents(frames([
      {
        event: {
          type: "tool_input_start",
          toolCallId: "provider-1",
          toolName: "web_search",
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "tool_input_ready",
          toolCallId: "provider-1",
          toolName: "web_search",
          input: { query: "weather" },
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "provider_tool_result",
          toolCallId: "provider-1",
          toolName: "web_search",
          output: { forecast: "sunny" },
          isError: false,
          providerExecuted: true,
        },
      },
    ]));

    const storedResult = durableEvents.find((event) => event.type === "TOOL_CALL_RESULT");
    assertEquals(storedResult?.providerExecuted, true);
    const aguiEvents = projectDurableEventsToAgUi(durableEvents);
    assertEquals(
      aguiEvents.filter((event) => event.event === "ToolCallResult"),
      [{
        event: "ToolCallResult",
        payload: { toolCallId: "provider-1", result: { forecast: "sunny" } },
      }],
    );
  });

  it("rejects result-only provider tool history instead of repairing v2", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [{
        type: "TOOL_CALL_RESULT",
        toolCallId: "provider-1",
        toolName: "web_search",
        content: '{"answer":42}',
        isError: false,
        providerExecuted: true,
        stream_protocol_version: 2,
        logical_sequence: 1,
        idempotency_key: "tool:1",
      }],
    });

    assertEquals(result.status, "invalid");
    if (result.status === "invalid") {
      assertEquals(result.code, "VERSION_2_LIFECYCLE_VIOLATION");
    }
  });

  it("rejects provider-executed v2 tool results before the tool lifecycle completes", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [
        {
          type: "TOOL_CALL_START",
          toolCallId: "provider-open",
          toolName: "web_search",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "tool:open:start",
        },
        {
          type: "TOOL_CALL_RESULT",
          toolCallId: "provider-open",
          toolName: "web_search",
          content: '{"answer":42}',
          isError: false,
          providerExecuted: true,
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "tool:open:result",
        },
      ],
    });

    assertEquals(result.status, "invalid");
    if (result.status === "invalid") {
      assertEquals(result.code, "VERSION_2_LIFECYCLE_VIOLATION");
    }
  });

  it("rejects provider-executed v2 tool results after malformed tool input", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [
        {
          type: "TOOL_CALL_START",
          toolCallId: "provider-bad",
          toolName: "web_search",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "tool:bad:start",
        },
        {
          type: "TOOL_CALL_ARGS",
          toolCallId: "provider-bad",
          delta: '{"query":',
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "tool:bad:args",
        },
        {
          type: "TOOL_CALL_END",
          toolCallId: "provider-bad",
          toolName: "web_search",
          stream_protocol_version: 2,
          logical_sequence: 3,
          idempotency_key: "tool:bad:end",
        },
        {
          type: "TOOL_CALL_RESULT",
          toolCallId: "provider-bad",
          toolName: "web_search",
          content: '{"answer":42}',
          isError: false,
          providerExecuted: true,
          stream_protocol_version: 2,
          logical_sequence: 4,
          idempotency_key: "tool:bad:result",
        },
      ],
    });

    assertEquals(result.status, "invalid");
    if (result.status === "invalid") {
      assertEquals(result.code, "VERSION_2_LIFECYCLE_VIOLATION");
    }
  });

  it("rejects duplicate provider-executed v2 tool results", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [
        {
          type: "TOOL_CALL_START",
          toolCallId: "provider-dupe",
          toolName: "web_search",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "tool:dupe:start",
        },
        {
          type: "TOOL_CALL_ARGS",
          toolCallId: "provider-dupe",
          delta: '{"query":"weather"}',
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "tool:dupe:args",
        },
        {
          type: "TOOL_CALL_END",
          toolCallId: "provider-dupe",
          toolName: "web_search",
          stream_protocol_version: 2,
          logical_sequence: 3,
          idempotency_key: "tool:dupe:end",
        },
        {
          type: "TOOL_CALL_RESULT",
          toolCallId: "provider-dupe",
          toolName: "web_search",
          content: '{"answer":42}',
          isError: false,
          providerExecuted: true,
          stream_protocol_version: 2,
          logical_sequence: 4,
          idempotency_key: "tool:dupe:result:1",
        },
        {
          type: "TOOL_CALL_RESULT",
          toolCallId: "provider-dupe",
          toolName: "web_search",
          content: '{"answer":43}',
          isError: false,
          providerExecuted: true,
          stream_protocol_version: 2,
          logical_sequence: 5,
          idempotency_key: "tool:dupe:result:2",
        },
      ],
    });

    assertEquals(result.status, "invalid");
    if (result.status === "invalid") {
      assertEquals(result.code, "VERSION_2_LIFECYCLE_VIOLATION");
    }
  });

  it("round trips provider-executed structured errors through durable v2", () => {
    const diagnostic = {
      error: "invalid_skill",
      code: "invalid_skill",
      message: "Skill validation failed",
      request_id: "request-123",
    };
    const durableEvents = writeDurableEvents(frames([
      {
        event: {
          type: "tool_input_start",
          toolCallId: "provider-err",
          toolName: "web_search",
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "tool_input_ready",
          toolCallId: "provider-err",
          toolName: "web_search",
          input: { query: "weather" },
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "provider_tool_result",
          toolCallId: "provider-err",
          toolName: "web_search",
          output: diagnostic,
          isError: true,
          providerExecuted: true,
        },
      },
    ]));

    const storedResult = durableEvents.find((event) => event.type === "TOOL_CALL_RESULT");
    assertEquals(storedResult?.providerExecuted, true);
    const aguiEvents = projectDurableEventsToAgUi(durableEvents);
    assertEquals(
      aguiEvents.filter((event) => event.event === "ToolCallResult"),
      [{
        event: "ToolCallResult",
        payload: {
          toolCallId: "provider-err",
          result: diagnostic,
          isError: true,
        },
      }],
    );
  });

  it("keeps unmarked version 2 tool results on the custom compatibility path", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [
        {
          type: "TOOL_CALL_START",
          toolCallId: "tool-1",
          toolName: "web_search",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "tool:1",
        },
        {
          type: "TOOL_CALL_ARGS",
          toolCallId: "tool-1",
          delta: '{"query":"weather"}',
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "tool:2",
        },
        {
          type: "TOOL_CALL_END",
          toolCallId: "tool-1",
          toolName: "web_search",
          stream_protocol_version: 2,
          logical_sequence: 3,
          idempotency_key: "tool:3",
        },
        {
          type: "TOOL_CALL_RESULT",
          toolCallId: "tool-1",
          toolName: "web_search",
          content: "legacy",
          isError: false,
          stream_protocol_version: 2,
          logical_sequence: 4,
          idempotency_key: "tool:4",
        },
      ],
    });

    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(
      result.frames.filter((frame) =>
        frame.class === "semantic" && frame.event.type === "provider_tool_result"
      ),
      [],
    );
    const agui = createLifecycleAgUiBrowserAdapter({ messageId: "message-1" });
    const aguiEvents = result.frames.flatMap((frame) => agui.encode(frame));
    assertEquals(
      aguiEvents.filter((event) => event.event === "Custom"),
      [{
        event: "Custom",
        payload: {
          name: "tool-call-result",
          value: {
            toolCallId: "tool-1",
            toolName: "web_search",
            content: "legacy",
            isError: false,
          },
        },
      }],
    );
  });
});
