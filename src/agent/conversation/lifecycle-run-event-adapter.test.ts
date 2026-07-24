import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { StreamLifecycleFrame } from "#veryfront/agent/streaming/lifecycle/index.ts";
import {
  createLifecycleRunEventAdapter,
  StreamProjectionInvariantError,
} from "./lifecycle-run-event-adapter.ts";
import { MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES } from "./run-event-normalization.ts";
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

function createCollector(overrides: {
  maxBufferedContentBytes?: number;
  flushDelayMs?: number;
} = {}) {
  const emitted: ConversationRunEvent[] = [];
  const adapter = createLifecycleRunEventAdapter({
    runId: "run-1",
    attemptId: "attempt-1",
    attemptIndex: 0,
    messageId: "message-1",
    onEvents: (events) => emitted.push(...events),
    setTimer: () => 1,
    clearTimer: () => {},
    ...overrides,
  });
  return { emitted, adapter };
}

describe("lifecycle run event adapter", () => {
  it("emits balanced coalesced version 2 events with unique identity", () => {
    const { emitted, adapter } = createCollector();
    for (
      const frame of frames([
        { event: { type: "message_start" } },
        { event: { type: "text_start", id: "text:0" } },
        { event: { type: "text_content", id: "text:0", delta: "hello " } },
        { event: { type: "text_content", id: "text:0", delta: "world" } },
        { event: { type: "text_end", id: "text:0" } },
        {
          class: "telemetry",
          event: {
            type: "tool_input_status",
            toolCallId: "tool-1",
            status: "pending_input",
          },
        },
        {
          class: "telemetry",
          event: {
            type: "tool_input_status",
            toolCallId: "tool-1",
            status: "pending_input",
          },
        },
        { event: { type: "step_finish", finishReason: "stop" } },
      ])
    ) {
      adapter.handleFrame(frame);
    }
    adapter.flush();
    adapter.dispose();

    assertEquals(emitted.map((event) => event.type), [
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "CUSTOM",
    ]);
    assertEquals(emitted[1]?.delta, "hello world");
    assertEquals(emitted[3], {
      type: "CUSTOM",
      name: "tool-call-status",
      value: { toolCallId: "tool-1", status: "pending_input" },
      stream_protocol_version: 2,
      attempt_id: "attempt-1",
      attempt_index: 0,
      logical_sequence: 4,
      idempotency_key: "stream-v2:run-1:attempt-1:4",
    });
    assertEquals(
      emitted.every((event) => event.stream_protocol_version === 2),
      true,
    );
    assertEquals(
      new Set(emitted.map((event) => event.logical_sequence)).size,
      emitted.length,
    );
    assertEquals(
      new Set(emitted.map((event) => event.idempotency_key)).size,
      emitted.length,
    );
  });

  it("keeps status transitions but drops repeated cadence ticks", () => {
    const { emitted, adapter } = createCollector();
    for (
      const status of [
        "streaming_input",
        "streaming_input",
        "pending_input",
        "pending_input",
      ] as const
    ) {
      adapter.handleFrame({
        class: "telemetry",
        event: { type: "tool_input_status", toolCallId: "tool-1", status },
        sequence: 1,
        elapsedMs: 0,
      });
    }
    adapter.dispose();
    assertEquals(
      emitted.map((event) => (event.value as { status: string }).status),
      ["streaming_input", "pending_input"],
    );
  });

  it("records no durable events for an unavailable tool rejection", () => {
    const { emitted, adapter } = createCollector();
    adapter.handleFrame(
      frames([{
        event: {
          type: "tool_input_rejected",
          toolCallId: "missing-1",
          toolName: "missing_tool",
          reason: "unavailable",
        },
      }])[0]!,
    );
    adapter.dispose();
    assertEquals(emitted, []);
  });

  it("splits oversized deltas with unique identity per split event", () => {
    const { emitted, adapter } = createCollector();
    const oversized = "a".repeat(MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES + 64);
    for (
      const frame of frames([
        { event: { type: "text_start", id: "text:0" } },
        { event: { type: "text_content", id: "text:0", delta: oversized } },
        { event: { type: "text_end", id: "text:0" } },
      ])
    ) {
      adapter.handleFrame(frame);
    }
    adapter.dispose();

    const contents = emitted.filter((event) => event.type === "TEXT_MESSAGE_CONTENT");
    assertEquals(contents.length >= 2, true);
    assertEquals(
      new Set(emitted.map((event) => event.logical_sequence)).size,
      emitted.length,
    );
    assertEquals(
      new Set(emitted.map((event) => event.idempotency_key)).size,
      emitted.length,
    );
  });

  it("rejects content without a lifecycle boundary instead of repairing", () => {
    const { adapter } = createCollector();
    assertThrows(
      () =>
        adapter.handleFrame(
          frames([{
            event: { type: "text_content", id: "text:0", delta: "orphan" },
          }])[0]!,
        ),
      StreamProjectionInvariantError,
    );
  });

  it("maps local and provider tool lifecycles to existing durable names", () => {
    const { emitted, adapter } = createCollector();
    for (
      const frame of frames([
        {
          event: {
            type: "tool_input_start",
            toolCallId: "native-1",
            toolName: "web_search",
            providerExecuted: true,
          },
        },
        {
          event: {
            type: "tool_input_content",
            toolCallId: "native-1",
            delta: '{"query":"x"}',
          },
        },
        {
          event: {
            type: "tool_input_ready",
            toolCallId: "native-1",
            toolName: "web_search",
            input: { query: "x" },
            providerExecuted: true,
          },
        },
        {
          event: {
            type: "provider_tool_start",
            toolCallId: "native-1",
            toolName: "web_search",
            providerExecuted: true,
          },
        },
        {
          event: {
            type: "provider_tool_result",
            toolCallId: "native-1",
            toolName: "web_search",
            output: { answer: 42 },
            isError: false,
            providerExecuted: true,
          },
        },
      ])
    ) {
      adapter.handleFrame(frame);
    }
    adapter.dispose();

    assertEquals(emitted.map((event) => event.type), [
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "TOOL_CALL_RESULT",
    ]);
    assertEquals(emitted[3]?.input, { query: "x" });
    assertEquals(emitted[3]?.isError, false);
  });

  it("records ready-only tool input before committing the durable tool call", () => {
    const { emitted, adapter } = createCollector();
    for (
      const frame of frames([
        {
          event: {
            type: "tool_input_start",
            toolCallId: "native-1",
            toolName: "create_file",
          },
        },
        {
          event: {
            type: "tool_input_ready",
            toolCallId: "native-1",
            toolName: "create_file",
            input: { path: "a.md" },
          },
        },
      ])
    ) {
      adapter.handleFrame(frame);
    }
    adapter.dispose();

    assertEquals(emitted.map((event) => event.type), [
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
    ]);
    assertEquals(emitted[1]?.delta, '{"path":"a.md"}');
  });

  it("closes streamed tool input after ready while retaining provider input", () => {
    const { emitted, adapter } = createCollector();
    for (
      const frame of frames([
        {
          event: {
            type: "tool_input_start",
            toolCallId: "native-1",
            toolName: "web_search",
            providerExecuted: true,
          },
        },
        {
          event: {
            type: "tool_input_content",
            toolCallId: "native-1",
            delta: '{"query":"x"}',
          },
        },
        {
          event: {
            type: "tool_input_ready",
            toolCallId: "native-1",
            toolName: "web_search",
            input: { query: "x" },
            providerExecuted: true,
          },
        },
      ])
    ) {
      adapter.handleFrame(frame);
    }

    assertThrows(
      () =>
        adapter.handleFrame(
          frames([{
            event: {
              type: "tool_input_content",
              toolCallId: "native-1",
              delta: "late",
            },
          }])[0]!,
        ),
      StreamProjectionInvariantError,
    );

    adapter.handleFrame(
      frames([{
        event: {
          type: "provider_tool_result",
          toolCallId: "native-1",
          toolName: "web_search",
          output: { answer: 42 },
          isError: false,
          providerExecuted: true,
        },
      }])[0]!,
    );
    adapter.dispose();

    assertEquals(emitted.map((event) => event.type), [
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "TOOL_CALL_RESULT",
    ]);
    assertEquals(emitted[3]?.input, { query: "x" });
  });
});
