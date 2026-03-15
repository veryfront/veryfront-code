import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createStreamTransformState,
  finalizeRunEvents,
  formatAgUiEvent,
  mapRuntimeEventToAgUi,
  parseSseJsonEvents,
} from "./ag-ui-sse.ts";

describe("internal-agents/ag-ui-sse", () => {
  it("parses complete SSE data frames and preserves incomplete remainder", () => {
    const parsed = parseSseJsonEvents(
      'data: {"type":"text-delta","id":"text-1","delta":"hello"}\n\n' +
        'data: {"type":"step-end"}\n\n' +
        'data: {"type":"message-start"',
    );

    assertEquals(parsed.events, [
      { type: "text-delta", id: "text-1", delta: "hello" },
      { type: "step-end" },
    ]);
    assertEquals(parsed.remainder, 'data: {"type":"message-start"');
  });

  it("maps runtime tool and text events to AG-UI wire events", () => {
    const state = createStreamTransformState();

    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "message-start", messageId: "assistant-1" }),
      [],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "text-start", id: "text-1" }),
      [{ event: "TextMessageStart", payload: { messageId: "assistant-1", role: "assistant" } }],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "text-delta", id: "text-1", delta: "hello" }),
      [{ event: "TextMessageContent", payload: { messageId: "assistant-1", delta: "hello" } }],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, {
        type: "tool-input-start",
        toolCallId: "tool-1",
        toolName: "studio_focus_component",
      }),
      [{
        event: "ToolCallStart",
        payload: { toolCallId: "tool-1", toolCallName: "studio_focus_component" },
      }],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, {
        type: "tool-output-error",
        toolCallId: "tool-1",
        errorText: "boom",
      }),
      [{
        event: "ToolCallResult",
        payload: { toolCallId: "tool-1", result: { error: "boom" }, isError: true },
      }],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "error", error: "Runtime failed" }),
      [{ event: "RunError", payload: { message: "Runtime failed" } }],
    );
  });

  it("covers implicit text start, tool transitions, steps, metadata, and terminal errors", () => {
    const state = createStreamTransformState();

    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "message-start", id: "assistant-2" }),
      [],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "text-delta", delta: "hello" }),
      [
        { event: "TextMessageStart", payload: { messageId: "assistant-2", role: "assistant" } },
        { event: "TextMessageContent", payload: { messageId: "assistant-2", delta: "hello" } },
      ],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "text-end" }),
      [{ event: "TextMessageEnd", payload: { messageId: "assistant-2" } }],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, {
        type: "tool-input-delta",
        toolCallId: "tool-2",
        inputTextDelta: '{"path":"app/page.tsx"}',
      }),
      [{
        event: "ToolCallArgs",
        payload: { toolCallId: "tool-2", delta: '{"path":"app/page.tsx"}' },
      }],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "tool-input-available", toolCallId: "tool-2" }),
      [{ event: "ToolCallEnd", payload: { toolCallId: "tool-2" } }],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, {
        type: "tool-output-available",
        toolCallId: "tool-2",
        output: { ok: true },
      }),
      [{
        event: "ToolCallResult",
        payload: { toolCallId: "tool-2", result: { ok: true } },
      }],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "step-start" }),
      [{ event: "StepStarted", payload: { stepIndex: 1 } }],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "step-end" }),
      [{ event: "StepFinished", payload: { stepIndex: 1 } }],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, {
        type: "data",
        data: { model: "anthropic/claude-sonnet-4-6" },
      }),
      [],
    );
    assertEquals(state.metadata, {
      model: "anthropic/claude-sonnet-4-6",
      provider: "anthropic",
    });
    assertEquals(mapRuntimeEventToAgUi(state, { type: "unknown-event" }), []);
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "error", error: 123 }),
      [{ event: "RunError", payload: { message: "Agent run failed" } }],
    );
    assertEquals(finalizeRunEvents(state, null), []);
  });

  it("finalizes open assistant text with usage metadata", () => {
    const state = createStreamTransformState();
    mapRuntimeEventToAgUi(state, { type: "message-start", messageId: "assistant-1" });
    mapRuntimeEventToAgUi(state, { type: "text-start", id: "text-1" });

    assertEquals(
      finalizeRunEvents(state, {
        text: "Done.",
        messages: [],
        toolCalls: [],
        status: "completed",
        usage: {
          promptTokens: 3,
          completionTokens: 5,
          totalTokens: 8,
        },
        metadata: {
          finishReason: "stop",
        },
      }),
      [
        {
          event: "TextMessageEnd",
          payload: { messageId: "assistant-1" },
        },
        {
          event: "RunFinished",
          payload: {
            metadata: {
              inputTokens: 3,
              outputTokens: 5,
              totalTokens: 8,
              finishReason: "stop",
            },
          },
        },
      ],
    );
  });

  it("formats AG-UI events as SSE frames", () => {
    const payload = formatAgUiEvent("RunStarted", {
      runId: "run_1",
      threadId: "thread-1",
      agentId: "assistant-1",
    });

    assertEquals(
      new TextDecoder().decode(payload),
      'event: RunStarted\ndata: {"runId":"run_1","threadId":"thread-1","agentId":"assistant-1"}\n\n',
    );
  });
});
