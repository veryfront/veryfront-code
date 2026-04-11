import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAgUiBrowserEncoderState,
  finalizeAgUiBrowserEvents,
  mapRuntimeStreamEventToAgUiBrowserEvents,
} from "./ag-ui-browser-encoder.ts";

describe("agent/ag-ui-browser-encoder", () => {
  it("maps text, reasoning, step, and tool lifecycle events into browser AG-UI payloads", () => {
    const state = createAgUiBrowserEncoderState();

    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "message-start",
        messageId: "assistant-1",
      }),
      [],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "reasoning-start",
        id: "reasoning-1",
      }),
      [{
        event: "ReasoningMessageStart",
        payload: { messageId: "assistant-1:reasoning:reasoning-1", role: "reasoning" },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "reasoning-delta",
        id: "reasoning-1",
        delta: "Thinking",
      }),
      [{
        event: "ReasoningMessageContent",
        payload: { messageId: "assistant-1:reasoning:reasoning-1", delta: "Thinking" },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, { type: "reasoning-end", id: "reasoning-1" }),
      [{
        event: "ReasoningMessageEnd",
        payload: { messageId: "assistant-1:reasoning:reasoning-1" },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, { type: "step-start" }),
      [{ event: "StepStarted", payload: { stepName: "step-1" } }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, { type: "text-delta", delta: "hello" }),
      [
        { event: "TextMessageStart", payload: { messageId: "assistant-1", role: "assistant" } },
        { event: "TextMessageContent", payload: { messageId: "assistant-1", delta: "hello" } },
      ],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "tool-input-start",
        toolCallId: "tool-1",
        toolName: "web_search",
      }),
      [{
        event: "ToolCallStart",
        payload: { toolCallId: "tool-1", toolCallName: "web_search" },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "web_search",
        input: { query: "Veryfront" },
      }),
      [
        {
          event: "ToolCallArgs",
          payload: { toolCallId: "tool-1", delta: '{"query":"Veryfront"}' },
        },
        {
          event: "ToolCallEnd",
          payload: { toolCallId: "tool-1" },
        },
      ],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "tool-output-available",
        toolCallId: "tool-1",
        output: { ok: true },
      }),
      [{
        event: "ToolCallResult",
        payload: { toolCallId: "tool-1", result: { ok: true } },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, { type: "step-end" }),
      [{ event: "StepFinished", payload: { stepName: "step-1" } }],
    );
  });

  it("maps custom data events and tool fallback error events", () => {
    const state = createAgUiBrowserEncoderState();

    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "data-message-metadata",
        data: { status: "running" },
      }),
      [{
        event: "Custom",
        payload: { name: "message-metadata", value: { status: "running" } },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "tool-input-error",
        toolCallId: "tool-2",
        input: { url: "https://example.com" },
        errorText: "invalid url",
      }),
      [
        {
          event: "ToolCallArgs",
          payload: { toolCallId: "tool-2", delta: '{"url":"https://example.com"}' },
        },
        {
          event: "ToolCallEnd",
          payload: { toolCallId: "tool-2" },
        },
        {
          event: "ToolCallResult",
          payload: { toolCallId: "tool-2", result: { error: "invalid url" }, isError: true },
        },
      ],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "tool-output-denied",
        toolCallId: "tool-3",
      }),
      [{
        event: "ToolCallResult",
        payload: { toolCallId: "tool-3", result: { error: "Tool output denied" }, isError: true },
      }],
    );
  });

  it("finalizes metadata and emits terminal errors for empty output", () => {
    const visibleState = createAgUiBrowserEncoderState();
    mapRuntimeStreamEventToAgUiBrowserEvents(visibleState, {
      type: "message-start",
      messageId: "assistant-2",
    });
    mapRuntimeStreamEventToAgUiBrowserEvents(visibleState, {
      type: "text-start",
      id: "text-1",
    });

    assertEquals(
      finalizeAgUiBrowserEvents(visibleState, {
        text: "done",
        messages: [],
        toolCalls: [],
        status: "completed",
        usage: {
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
        },
        metadata: {
          finishReason: "stop",
        },
      }),
      [
        {
          event: "TextMessageEnd",
          payload: { messageId: "assistant-2" },
        },
        {
          event: "RunFinished",
          payload: {
            metadata: {
              inputTokens: 12,
              outputTokens: 8,
              totalTokens: 20,
              finishReason: "stop",
            },
          },
        },
      ],
    );

    const emptyState = createAgUiBrowserEncoderState();
    assertEquals(
      finalizeAgUiBrowserEvents(emptyState, null),
      [{
        event: "RunError",
        payload: {
          code: "EMPTY_ASSISTANT_OUTPUT",
          message: "Agent run produced no assistant-visible output",
        },
      }],
    );
  });
});
