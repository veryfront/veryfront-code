import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildAgUiBrowserFinalizeResponse,
  createAgUiBrowserEncoderState,
  finalizeAgUiBrowserEvents,
  mapRuntimeStreamEventToAgUiBrowserEvents,
} from "./browser-encoder.ts";

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
      [
        {
          event: "TextMessageEnd",
          payload: { messageId: "assistant-1" },
        },
        {
          event: "ToolCallStart",
          payload: { toolCallId: "tool-1", toolCallName: "web_search" },
        },
      ],
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
        type: "data-tool-call-status",
        data: { toolCallId: "tool-1", status: "pending_input" },
      }),
      [{
        event: "Custom",
        payload: {
          name: "tool-call-status",
          value: { toolCallId: "tool-1", status: "pending_input" },
        },
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

  it("marks provider-executed tools complete when the provider owns execution", () => {
    const state = createAgUiBrowserEncoderState();

    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "tool-input-start",
        toolCallId: "tool-provider",
        toolName: "web_search",
      }),
      [{
        event: "ToolCallStart",
        payload: { toolCallId: "tool-provider", toolCallName: "web_search" },
      }],
    );

    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "tool-input-available",
        toolCallId: "tool-provider",
        toolName: "web_search",
        input: { query: "Swedish tax residency" },
        providerExecuted: true,
      }),
      [
        {
          event: "ToolCallArgs",
          payload: {
            toolCallId: "tool-provider",
            delta: '{"query":"Swedish tax residency"}',
          },
        },
        {
          event: "ToolCallEnd",
          payload: { toolCallId: "tool-provider" },
        },
        {
          event: "ToolCallResult",
          payload: { toolCallId: "tool-provider", result: null },
        },
      ],
    );
  });

  it("closes open text before orphan tool-input-delta is forwarded", () => {
    const state = createAgUiBrowserEncoderState();

    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "message-start",
        messageId: "assistant-orphan",
      }),
      [],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "text-delta",
        delta: "Now I have enough material to write the file.",
      }),
      [
        {
          event: "TextMessageStart",
          payload: { messageId: "assistant-orphan", role: "assistant" },
        },
        {
          event: "TextMessageContent",
          payload: {
            messageId: "assistant-orphan",
            delta: "Now I have enough material to write the file.",
          },
        },
      ],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "tool-input-delta",
        toolCallId: "tool-orphan",
        inputTextDelta: '{"path":"research/ai-ontologies.md"',
      }),
      [
        {
          event: "TextMessageEnd",
          payload: { messageId: "assistant-orphan" },
        },
        {
          event: "ToolCallArgs",
          payload: { toolCallId: "tool-orphan", delta: '{"path":"research/ai-ontologies.md"' },
        },
      ],
    );
  });

  it("closes open reasoning before orphan tool-input-delta is forwarded", () => {
    const state = createAgUiBrowserEncoderState();

    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "message-start",
        messageId: "assistant-orphan-reasoning",
      }),
      [],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "reasoning-start",
        id: "reasoning-orphan",
      }),
      [{
        event: "ReasoningMessageStart",
        payload: {
          messageId: "assistant-orphan-reasoning:reasoning:reasoning-orphan",
          role: "reasoning",
        },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "reasoning-delta",
        id: "reasoning-orphan",
        delta: "I should gather one more source before calling the tool.",
      }),
      [{
        event: "ReasoningMessageContent",
        payload: {
          messageId: "assistant-orphan-reasoning:reasoning:reasoning-orphan",
          delta: "I should gather one more source before calling the tool.",
        },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "tool-input-delta",
        toolCallId: "tool-orphan-reasoning",
        inputTextDelta: '{"query":"ai ontologies"}',
      }),
      [
        {
          event: "ReasoningMessageEnd",
          payload: {
            messageId: "assistant-orphan-reasoning:reasoning:reasoning-orphan",
          },
        },
        {
          event: "ToolCallArgs",
          payload: {
            toolCallId: "tool-orphan-reasoning",
            delta: '{"query":"ai ontologies"}',
          },
        },
      ],
    );
  });

  it("closes reasoning when non-reasoning events interrupt it", () => {
    const state = createAgUiBrowserEncoderState();

    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "message-start",
        messageId: "assistant-3",
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
        payload: { messageId: "assistant-3:reasoning:reasoning-1", role: "reasoning" },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "reasoning-delta",
        id: "reasoning-1",
        delta: "thinking",
      }),
      [{
        event: "ReasoningMessageContent",
        payload: { messageId: "assistant-3:reasoning:reasoning-1", delta: "thinking" },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, {
        type: "tool-input-start",
        toolCallId: "tool-4",
        toolName: "web_search",
      }),
      [
        {
          event: "ReasoningMessageEnd",
          payload: { messageId: "assistant-3:reasoning:reasoning-1" },
        },
        {
          event: "ToolCallStart",
          payload: { toolCallId: "tool-4", toolCallName: "web_search" },
        },
      ],
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

    const reasoningState = createAgUiBrowserEncoderState();
    mapRuntimeStreamEventToAgUiBrowserEvents(reasoningState, {
      type: "message-start",
      messageId: "assistant-4",
    });
    mapRuntimeStreamEventToAgUiBrowserEvents(reasoningState, {
      type: "reasoning-start",
      id: "reasoning-2",
    });
    mapRuntimeStreamEventToAgUiBrowserEvents(reasoningState, {
      type: "reasoning-delta",
      id: "reasoning-2",
      delta: "Thinking",
    });

    assertEquals(
      finalizeAgUiBrowserEvents(reasoningState, {
        text: "done",
        messages: [],
        toolCalls: [],
        status: "completed",
        usage: {
          promptTokens: 2,
          completionTokens: 1,
          totalTokens: 3,
        },
        metadata: {
          finishReason: "stop",
        },
      }),
      [
        {
          event: "ReasoningMessageEnd",
          payload: { messageId: "assistant-4:reasoning:reasoning-2" },
        },
        {
          event: "RunFinished",
          payload: {
            metadata: {
              inputTokens: 2,
              outputTokens: 1,
              totalTokens: 3,
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

  it("does not treat step lifecycle events as assistant-visible output", () => {
    const state = createAgUiBrowserEncoderState();

    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, { type: "step-start" }),
      [{ event: "StepStarted", payload: { stepName: "step-1" } }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiBrowserEvents(state, { type: "step-end" }),
      [{ event: "StepFinished", payload: { stepName: "step-1" } }],
    );

    assertEquals(
      finalizeAgUiBrowserEvents(state, null),
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

describe("buildAgUiBrowserFinalizeResponse", () => {
  it("returns null when metadata is empty", () => {
    assertEquals(buildAgUiBrowserFinalizeResponse({}), null);
  });

  it("maps finishReason and usage into an AgentResponse", () => {
    assertEquals(
      buildAgUiBrowserFinalizeResponse({
        finishReason: "stop",
        inputTokens: 10,
        outputTokens: 5,
      }),
      {
        text: "",
        messages: [],
        toolCalls: [],
        status: "completed",
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
        metadata: { finishReason: "stop" },
      },
    );
  });

  it("respects an explicit total token count when provided", () => {
    assertEquals(
      buildAgUiBrowserFinalizeResponse({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 99,
      }),
      {
        text: "",
        messages: [],
        toolCalls: [],
        status: "completed",
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 99,
        },
      },
    );
  });
});
