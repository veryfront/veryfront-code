import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAgUiChatEventDecoderState,
  decodeAgUiSseChunk,
  flushAgUiSseChunk,
  parseSseEvent,
} from "./ag-ui.ts";

describe("chat/ag-ui", () => {
  it("parses SSE frames with ids, events, and multi-line data", () => {
    const parsed = parseSseEvent(
      'id: 12\nevent: Custom\ndata: {"name":"alpha",\ndata: "value":1}\n',
    );

    assertEquals(parsed.id, 12);
    assertEquals(parsed.event, "Custom");
    assertEquals(parsed.data, '{"name":"alpha",\n"value":1}');
  });

  it("decodes AG-UI SSE chunks into canonical chat stream events", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      [
        "id: 1",
        "event: RunStarted",
        'data: {"runId":"run-1","threadId":"thread-1","agentId":"veryfront"}',
        "",
        "id: 2",
        "event: TextMessageStart",
        'data: {"messageId":"msg-1","role":"assistant"}',
        "",
        "id: 3",
        "event: TextMessageContent",
        'data: {"messageId":"msg-1","delta":"Hello"}',
        "",
        "id: 4",
        "event: ToolCallStart",
        'data: {"toolCallId":"tool-1","toolCallName":"load_skill"}',
        "",
        "id: 5",
        "event: ToolCallArgs",
        'data: {"toolCallId":"tool-1","delta":"{}"}',
        "",
        "id: 6",
        "event: ToolCallArgs",
        'data: {"toolCallId":"tool-1","delta":"{\\"skillId\\":\\"plan\\"}"}',
        "",
        "id: 7",
        "event: ToolCallEnd",
        'data: {"toolCallId":"tool-1"}',
        "",
        "id: 8",
        "event: ToolCallResult",
        'data: {"toolCallId":"tool-1","result":"{\\"loaded\\":true}"}',
        "",
        "id: 9",
        "event: Custom",
        'data: {"name":"file","value":{"type":"file","url":"https://cdn.example.com/spec.md","mediaType":"text/markdown","filename":"spec.md"}}',
        "",
        "id: 10",
        "event: RunFinished",
        'data: {"metadata":{"finishReason":"stop"}}',
        "",
        "",
      ].join("\n"),
    );

    assertEquals(result.events.map((entry) => entry.eventId), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assertEquals(state.lastEventId, 10);
    assertEquals(result.remainder, "");

    const chatEvents = result.events.flatMap((entry) => entry.chatEvents);
    assertEquals(chatEvents, [
      {
        type: "start",
        messageMetadata: { agentId: "veryfront", runId: "run-1", threadId: "thread-1" },
      },
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "Hello" },
      {
        type: "tool-input-start",
        toolCallId: "tool-1",
        toolName: "load_skill",
        providerExecuted: true,
      },
      { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: "{}" },
      { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '{"skillId":"plan"}' },
      {
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "load_skill",
        input: { skillId: "plan" },
        providerExecuted: true,
      },
      {
        type: "tool-output-available",
        toolCallId: "tool-1",
        output: { loaded: true },
        providerExecuted: true,
      },
      {
        type: "file",
        url: "https://cdn.example.com/spec.md",
        mediaType: "text/markdown",
        filename: "spec.md",
      },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  it("flushes a final AG-UI SSE frame without a trailing blank line", () => {
    const state = createAgUiChatEventDecoderState();
    const initial = decodeAgUiSseChunk(
      state,
      'id: 1\nevent: TextMessageContent\ndata: {"messageId":"msg-1","delta":"partial"}',
    );

    assertEquals(initial.events, []);
    assertEquals(initial.remainder.length > 0, true);

    const flushed = flushAgUiSseChunk(state);
    assertEquals(flushed.events.map((entry) => entry.eventId), [1]);
    assertEquals(flushed.events[0]?.chatEvents, [{
      type: "text-delta",
      id: "msg-1",
      delta: "partial",
    }]);
    assertEquals(flushed.remainder, "");
  });

  it("ignores duplicate and malformed frames while advancing the SSE cursor", () => {
    const state = createAgUiChatEventDecoderState({ lastEventId: 2 });
    const result = decodeAgUiSseChunk(
      state,
      [
        "id: 2",
        "event: TextMessageContent",
        'data: {"messageId":"msg-1","delta":"old"}',
        "",
        "id: 3",
        "event: ToolCallStart",
        "data: not-json",
        "",
        "id: 4",
        "event: UnsupportedEvent",
        'data: {"foo":"bar"}',
        "",
        "",
      ].join("\n"),
    );

    assertEquals(result.events, []);
    assertEquals(state.lastEventId, 4);
  });

  it("maps cancellation errors to abort events", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      'event: RunError\ndata: {"code":"CANCELLED","message":"Stopped"}\n\n',
    );

    assertEquals(result.events.length, 1);
    assertEquals(result.events[0]?.chatEvents, [{ type: "abort" }]);
  });

  it("keeps fallback reasoning ids stable across start, delta, and end", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      [
        "event: ReasoningMessageStart",
        'data: {"role":"assistant"}',
        "",
        "event: ReasoningMessageContent",
        'data: {"delta":"Thinking"}',
        "",
        "event: ReasoningMessageEnd",
        "data: {}",
        "",
        "",
      ].join("\n"),
    );

    const chatEvents = result.events.flatMap((entry) => entry.chatEvents);
    assertEquals(chatEvents, [
      { type: "reasoning-start", id: "agui-reasoning:1" },
      { type: "reasoning-delta", id: "agui-reasoning:1", delta: "Thinking" },
      { type: "reasoning-end", id: "agui-reasoning:1" },
    ]);
    assertEquals(state.activeFallbackReasoningPartId, null);
  });

  it("preserves non-renderable custom events as data chunks", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      'event: Custom\ndata: {"name":"progress","value":{"percent":42}}\n\n',
    );

    assertEquals(result.events.length, 1);
    assertEquals(result.events[0]?.chatEvents, [
      { type: "data-progress", data: { percent: 42 } },
    ]);
  });

  it("emits tool output errors when AG-UI result payloads are marked as failures", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      [
        "event: ToolCallStart",
        'data: {"toolCallId":"tool-err","toolCallName":"search"}',
        "",
        "event: ToolCallResult",
        'data: {"toolCallId":"tool-err","result":{"message":"No results"},"isError":true}',
        "",
        "",
      ].join("\n"),
    );

    const chatEvents = result.events.flatMap((entry) => entry.chatEvents);
    assertEquals(chatEvents, [
      {
        type: "tool-input-start",
        toolCallId: "tool-err",
        toolName: "search",
        providerExecuted: true,
      },
      {
        type: "tool-output-error",
        toolCallId: "tool-err",
        errorText: "No results",
        providerExecuted: true,
      },
    ]);
  });

  it("retains decoded wire events alongside canonical chat events", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      'id: 7\nevent: StateDelta\ndata: {"delta":{"phase":"planning"}}\n\n',
    );

    assertEquals(result.events.length, 1);
    assertExists(result.events[0]);
    assertEquals(result.events[0].eventId, 7);
    assertEquals(result.events[0].wireEvent.eventName, "StateDelta");
    assertEquals(result.events[0].chatEvents, [{
      type: "data-state-delta",
      data: { phase: "planning" },
    }]);
  });
});
