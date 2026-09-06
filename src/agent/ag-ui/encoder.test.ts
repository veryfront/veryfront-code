import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildAgUiFinalizeResponse,
  createAgUiEncoderState,
  finalizeAgUiEvents,
  mapRuntimeStreamEventToAgUiEvents,
  stampAgUiEventTiming,
} from "./encoder.ts";

describe("agent/ag-ui-encoder", () => {
  it("maps text, reasoning, step, and tool lifecycle events into AG-UI payloads", () => {
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });

    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "message-start",
        messageId: "assistant-1",
      }),
      [],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "reasoning-start",
        id: "reasoning-1",
      }),
      [{
        event: "ReasoningMessageStart",
        payload: { messageId: "assistant-1:reasoning:0", role: "reasoning" },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "reasoning-delta",
        id: "reasoning-1",
        delta: "Thinking",
      }),
      [{
        event: "ReasoningMessageContent",
        payload: { messageId: "assistant-1:reasoning:0", delta: "Thinking" },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, { type: "reasoning-end", id: "reasoning-1" }),
      [{
        event: "ReasoningMessageEnd",
        payload: { messageId: "assistant-1:reasoning:0" },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, { type: "step-start" }),
      [{ event: "StepStarted", payload: { stepName: "step-1" } }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, { type: "text-delta", delta: "hello" }),
      [
        {
          event: "TextMessageStart",
          payload: { messageId: "assistant-1", contentId: "text:0", role: "assistant" },
        },
        {
          event: "TextMessageContent",
          payload: { messageId: "assistant-1", contentId: "text:0", delta: "hello" },
        },
      ],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "tool-input-start",
        toolCallId: "tool-1",
        toolName: "web_search",
      }),
      [
        {
          event: "TextMessageEnd",
          payload: { messageId: "assistant-1", contentId: "text:0" },
        },
        {
          event: "ToolCallStart",
          payload: { toolCallId: "tool-1", toolCallName: "web_search" },
        },
      ],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
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
      mapRuntimeStreamEventToAgUiEvents(state, {
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
      mapRuntimeStreamEventToAgUiEvents(state, { type: "step-end" }),
      [{ event: "StepFinished", payload: { stepName: "step-1" } }],
    );
  });

  it("stamps run-relative elapsedMs on encoded events by default", () => {
    let now = 1_000;
    const state = createAgUiEncoderState({ nowMs: () => now });

    mapRuntimeStreamEventToAgUiEvents(state, {
      type: "message-start",
      messageId: "assistant-1",
    });
    now = 1_025;
    const first = mapRuntimeStreamEventToAgUiEvents(state, { type: "start-step" });
    now = 1_400;
    const second = mapRuntimeStreamEventToAgUiEvents(state, { type: "finish-step" });

    assertEquals(first[0]?.payload.elapsedMs, 25, "elapsed is measured from state creation");
    assertEquals(second[0]?.payload.elapsedMs, 400, "elapsed accrues across events");
    assertEquals(
      first[0]?.payload.stepName,
      "step-1",
      "stamping must not disturb the existing payload",
    );
  });

  it("stamps an absolute emittedAt independent of the elapsed anchor", () => {
    // emittedAt is the durable primitive: elapsedMs is measured from this
    // encoder's construction, so reading it needs to know which encoder made
    // it, while emittedAt means the same thing everywhere. Both are stamped
    // because a wall clock can step backwards and the monotonic one cannot.
    const state = createAgUiEncoderState({
      nowMs: () => 5_000,
      epochMs: () => 1_786_000_000_123,
    });
    const events = mapRuntimeStreamEventToAgUiEvents(state, { type: "start-step" });

    assertEquals(
      events[0]?.payload.emittedAt,
      1_786_000_000_123,
      "emittedAt must be the wall clock in epoch milliseconds, not an offset",
    );
    assertEquals(
      events[0]?.payload.elapsedMs,
      0,
      "elapsedMs stays anchored to encoder construction",
    );
  });

  it("keeps emittedAt usable when the elapsed clock is opted out", () => {
    // The two clocks are independent; losing one must not silently lose the
    // other, which is the failure shape this whole field went through.
    const state = createAgUiEncoderState({
      nowMs: null,
      epochMs: () => 1_786_000_000_456,
    });
    const events = mapRuntimeStreamEventToAgUiEvents(state, { type: "start-step" });

    assertEquals(events[0]?.payload.emittedAt, 1_786_000_000_456);
    assertEquals("elapsedMs" in (events[0]?.payload ?? {}), false);
  });

  it("preserves valid supplied timing and rejects invalid present timing", () => {
    const state = createAgUiEncoderState({
      nowMs: () => Number.NaN,
      epochMs: () => -1,
    });
    const supplied = stampAgUiEventTiming(state, [{
      event: "Custom",
      payload: { elapsedMs: 12.5, emittedAt: 1_786_866_357_364 },
    }]);
    assertEquals(supplied[0]?.payload.elapsedMs, 12.5);
    assertEquals(supplied[0]?.payload.emittedAt, 1_786_866_357_364);

    assertThrows(
      () =>
        stampAgUiEventTiming(state, [{
          event: "Custom",
          payload: { elapsedMs: Number.POSITIVE_INFINITY, emittedAt: 1_786_866_357_364 },
        }]),
      TypeError,
      "elapsedMs must be a finite non-negative number",
    );
    assertThrows(
      () =>
        stampAgUiEventTiming(state, [{
          event: "Custom",
          payload: { elapsedMs: 0, emittedAt: -1 },
        }]),
      TypeError,
      "emittedAt must be a non-negative integer",
    );
  });

  it("rejects timing generated by invalid clocks", () => {
    const invalidElapsed = createAgUiEncoderState({
      nowMs: (() => {
        let reads = 0;
        return () => reads++ === 0 ? 0 : Number.NaN;
      })(),
      epochMs: null,
    });
    assertThrows(
      () => mapRuntimeStreamEventToAgUiEvents(invalidElapsed, { type: "start-step" }),
      TypeError,
      "elapsedMs must be a finite non-negative number",
    );

    const invalidEpoch = createAgUiEncoderState({ nowMs: null, epochMs: () => -1 });
    assertThrows(
      () => mapRuntimeStreamEventToAgUiEvents(invalidEpoch, { type: "start-step" }),
      TypeError,
      "emittedAt must be a non-negative integer",
    );
  });

  it("clocks the state unless a caller explicitly opts out", () => {
    // Three production composition roots build this state. An opt-in clock only
    // has to be missed at one of them to lose elapsedMs for every hosted run,
    // so the default itself is the thing worth pinning.
    const clocked = createAgUiEncoderState();
    const events = mapRuntimeStreamEventToAgUiEvents(clocked, { type: "start-step" });
    assertEquals(
      typeof events[0]?.payload.elapsedMs,
      "number",
      "the default state must stamp elapsedMs",
    );

    const optedOut = createAgUiEncoderState({ nowMs: null, epochMs: null });
    const bare = mapRuntimeStreamEventToAgUiEvents(optedOut, { type: "start-step" });
    assertEquals(
      "elapsedMs" in (bare[0]?.payload ?? {}),
      false,
      "an explicit opt-out must leave payloads untouched",
    );
  });

  it("maps custom data events and tool fallback error events", () => {
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });

    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "data-message-metadata",
        data: { status: "running" },
      }),
      [{
        event: "Custom",
        payload: { name: "message-metadata", value: { status: "running" } },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "data-veryfront.runtime_context",
        data: { runStartedAtUtc: "2026-07-19T07:30:00.000Z" },
      }),
      [{
        event: "Custom",
        payload: {
          name: "veryfront.runtime_context",
          value: { runStartedAtUtc: "2026-07-19T07:30:00.000Z" },
        },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
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
      mapRuntimeStreamEventToAgUiEvents(state, {
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
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "tool-output-denied",
        toolCallId: "tool-3",
      }),
      [{
        event: "ToolCallResult",
        payload: { toolCallId: "tool-3", result: { error: "Tool output denied" }, isError: true },
      }],
    );
  });

  it("keeps provider-executed tools open until the provider returns a result", () => {
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });

    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
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
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "tool-output-available",
        toolCallId: "tool-provider",
        output: { partial: true },
        providerExecuted: true,
        preliminary: true,
      }),
      [],
    );

    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
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
      ],
    );

    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "tool-output-available",
        toolCallId: "tool-provider",
        output: { type: "web_search_result", answer: "resident" },
        providerExecuted: true,
      }),
      [{
        event: "ToolCallResult",
        payload: {
          toolCallId: "tool-provider",
          result: { type: "web_search_result", answer: "resident" },
        },
      }],
    );
  });

  it("closes open text before orphan tool-input-delta is forwarded", () => {
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });

    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "message-start",
        messageId: "assistant-orphan",
      }),
      [],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "text-delta",
        delta: "Now I have enough material to write the file.",
      }),
      [
        {
          event: "TextMessageStart",
          payload: { messageId: "assistant-orphan", contentId: "text:0", role: "assistant" },
        },
        {
          event: "TextMessageContent",
          payload: {
            messageId: "assistant-orphan",
            contentId: "text:0",
            delta: "Now I have enough material to write the file.",
          },
        },
      ],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "tool-input-delta",
        toolCallId: "tool-orphan",
        inputTextDelta: '{"path":"research/ai-ontologies.md"',
      }),
      [
        {
          event: "TextMessageEnd",
          payload: { messageId: "assistant-orphan", contentId: "text:0" },
        },
        {
          event: "ToolCallArgs",
          payload: { toolCallId: "tool-orphan", delta: '{"path":"research/ai-ontologies.md"' },
        },
      ],
    );
  });

  it("closes open reasoning before orphan tool-input-delta is forwarded", () => {
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });

    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "message-start",
        messageId: "assistant-orphan-reasoning",
      }),
      [],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "reasoning-start",
        id: "reasoning-orphan",
      }),
      [{
        event: "ReasoningMessageStart",
        payload: {
          messageId: "assistant-orphan-reasoning:reasoning:0",
          role: "reasoning",
        },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "reasoning-delta",
        id: "reasoning-orphan",
        delta: "I should gather one more source before calling the tool.",
      }),
      [{
        event: "ReasoningMessageContent",
        payload: {
          messageId: "assistant-orphan-reasoning:reasoning:0",
          delta: "I should gather one more source before calling the tool.",
        },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "tool-input-delta",
        toolCallId: "tool-orphan-reasoning",
        inputTextDelta: '{"query":"ai ontologies"}',
      }),
      [
        {
          event: "ReasoningMessageEnd",
          payload: {
            messageId: "assistant-orphan-reasoning:reasoning:0",
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
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });

    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "message-start",
        messageId: "assistant-3",
      }),
      [],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "reasoning-start",
        id: "reasoning-1",
      }),
      [{
        event: "ReasoningMessageStart",
        payload: { messageId: "assistant-3:reasoning:0", role: "reasoning" },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "reasoning-delta",
        id: "reasoning-1",
        delta: "thinking",
      }),
      [{
        event: "ReasoningMessageContent",
        payload: { messageId: "assistant-3:reasoning:0", delta: "thinking" },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "tool-input-start",
        toolCallId: "tool-4",
        toolName: "web_search",
      }),
      [
        {
          event: "ReasoningMessageEnd",
          payload: { messageId: "assistant-3:reasoning:0" },
        },
        {
          event: "ToolCallStart",
          payload: { toolCallId: "tool-4", toolCallName: "web_search" },
        },
      ],
    );
  });

  it("preserves text block identity as contentId under the assistant message", () => {
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });

    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "message-start",
        messageId: "assistant-1",
      }),
      [],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "text-start",
        id: "block-1",
      }),
      [{
        event: "TextMessageStart",
        payload: { messageId: "assistant-1", contentId: "block-1", role: "assistant" },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "text-delta",
        id: "block-1",
        delta: "hello",
      }),
      [{
        event: "TextMessageContent",
        payload: { messageId: "assistant-1", contentId: "block-1", delta: "hello" },
      }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "text-end",
        id: "block-1",
      }),
      [{
        event: "TextMessageEnd",
        payload: { messageId: "assistant-1", contentId: "block-1" },
      }],
    );
  });

  it("starts a new AG-UI text block when the runtime text block id changes", () => {
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });
    mapRuntimeStreamEventToAgUiEvents(state, {
      type: "message-start",
      messageId: "assistant-1",
    });
    mapRuntimeStreamEventToAgUiEvents(state, {
      type: "text-delta",
      id: "block-1",
      delta: "first",
    });

    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "text-delta",
        id: "block-2",
        delta: "second",
      }),
      [
        {
          event: "TextMessageEnd",
          payload: { messageId: "assistant-1", contentId: "block-1" },
        },
        {
          event: "TextMessageStart",
          payload: { messageId: "assistant-1", contentId: "block-2", role: "assistant" },
        },
        {
          event: "TextMessageContent",
          payload: { messageId: "assistant-1", contentId: "block-2", delta: "second" },
        },
      ],
    );
  });

  it("finalizes metadata and emits terminal errors for empty output", () => {
    const visibleState = createAgUiEncoderState({ nowMs: null, epochMs: null });
    mapRuntimeStreamEventToAgUiEvents(visibleState, {
      type: "message-start",
      messageId: "assistant-2",
    });
    mapRuntimeStreamEventToAgUiEvents(visibleState, {
      type: "text-start",
      id: "text-1",
    });

    assertEquals(
      finalizeAgUiEvents(visibleState, {
        text: "done",
        messages: [],
        toolCalls: [],
        status: "completed",
        usage: {
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
          cachedInputTokens: 4,
          cacheCreationInputTokens: 6,
          cacheReadInputTokens: 4,
          reasoningTokens: 2,
          billableInputTokens: 12,
          billableOutputTokens: 10,
          costUsd: 0.002,
          providerInputCostUsd: 0.0004,
          providerOutputCostUsd: 0.0006,
          providerCostUsd: 0.001,
          veryfrontInputChargeUsd: 0.001,
          veryfrontOutputChargeUsd: 0.0015,
          veryfrontChargeUsd: 0.0025,
          costSource: "gateway",
          billingMode: "deferred",
          usageCaptureStatus: "complete",
        },
        metadata: {
          finishReason: "stop",
        },
      }),
      [
        {
          event: "TextMessageEnd",
          payload: { messageId: "assistant-2", contentId: "text-1" },
        },
        {
          event: "RunFinished",
          payload: {
            metadata: {
              inputTokens: 12,
              outputTokens: 8,
              totalTokens: 20,
              cachedInputTokens: 4,
              cacheCreationInputTokens: 6,
              cacheReadInputTokens: 4,
              billableInputTokens: 12,
              billableOutputTokens: 10,
              costUsd: 0.002,
              providerInputCostUsd: 0.0004,
              providerOutputCostUsd: 0.0006,
              providerCostUsd: 0.001,
              veryfrontInputChargeUsd: 0.001,
              veryfrontOutputChargeUsd: 0.0015,
              veryfrontChargeUsd: 0.0025,
              costSource: "gateway",
              billingMode: "deferred",
              reasoningTokens: 2,
              finishReason: "stop",
              usageCaptureStatus: "complete",
            },
          },
        },
      ],
    );

    const reasoningState = createAgUiEncoderState({ nowMs: null, epochMs: null });
    mapRuntimeStreamEventToAgUiEvents(reasoningState, {
      type: "message-start",
      messageId: "assistant-4",
    });
    mapRuntimeStreamEventToAgUiEvents(reasoningState, {
      type: "reasoning-start",
      id: "reasoning-2",
    });
    mapRuntimeStreamEventToAgUiEvents(reasoningState, {
      type: "reasoning-delta",
      id: "reasoning-2",
      delta: "Thinking",
    });

    assertEquals(
      finalizeAgUiEvents(reasoningState, {
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
          payload: { messageId: "assistant-4:reasoning:0" },
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

    const emptyState = createAgUiEncoderState({ nowMs: null, epochMs: null });
    assertEquals(
      finalizeAgUiEvents(emptyState, null),
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
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });

    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, { type: "step-start" }),
      [{ event: "StepStarted", payload: { stepName: "step-1" } }],
    );
    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, { type: "step-end" }),
      [{ event: "StepFinished", payload: { stepName: "step-1" } }],
    );

    assertEquals(
      finalizeAgUiEvents(state, null),
      [{
        event: "RunError",
        payload: {
          code: "EMPTY_ASSISTANT_OUTPUT",
          message: "Agent run produced no assistant-visible output",
        },
      }],
    );
  });

  it("preserves a runtime terminal error code in RunError", () => {
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });

    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "error",
        error: "Purchase additional credits or select a lower-cost model.",
        code: "INSUFFICIENT_CREDITS",
      }),
      [{
        event: "RunError",
        payload: {
          code: "INSUFFICIENT_CREDITS",
          message: "Purchase additional credits or select a lower-cost model.",
        },
      }],
    );
  });
});

describe("buildAgUiFinalizeResponse", () => {
  it("returns null when metadata is empty", () => {
    assertEquals(buildAgUiFinalizeResponse({}), null);
  });

  it("maps finishReason and usage into an AgentResponse", () => {
    assertEquals(
      buildAgUiFinalizeResponse({
        finishReason: "stop",
        inputTokens: 10,
        outputTokens: 5,
        cachedInputTokens: 2,
        cacheCreationInputTokens: 3,
        cacheReadInputTokens: 2,
        reasoningTokens: 1,
        billableInputTokens: 10,
        billableOutputTokens: 5,
        providerInputCostUsd: 0.008,
        providerOutputCostUsd: 0.012,
        providerCostUsd: 0.02,
        veryfrontInputChargeUsd: 0.02,
        veryfrontOutputChargeUsd: 0.03,
        veryfrontChargeUsd: 0.05,
        veryfrontBilledUsd: 0.2,
        costCredits: 2,
        costSource: "gateway",
        billingMode: "direct",
        usageCaptureStatus: "complete",
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
          cachedInputTokens: 2,
          cacheCreationInputTokens: 3,
          cacheReadInputTokens: 2,
          reasoningTokens: 1,
          billableInputTokens: 10,
          billableOutputTokens: 5,
          providerInputCostUsd: 0.008,
          providerOutputCostUsd: 0.012,
          providerCostUsd: 0.02,
          veryfrontInputChargeUsd: 0.02,
          veryfrontOutputChargeUsd: 0.03,
          veryfrontChargeUsd: 0.05,
          veryfrontBilledUsd: 0.2,
          costCredits: 2,
          costSource: "gateway",
          billingMode: "direct",
          usageCaptureStatus: "complete",
        },
        metadata: {
          cachedInputTokens: 2,
          cacheCreationInputTokens: 3,
          cacheReadInputTokens: 2,
          billableInputTokens: 10,
          billableOutputTokens: 5,
          providerInputCostUsd: 0.008,
          providerOutputCostUsd: 0.012,
          providerCostUsd: 0.02,
          veryfrontInputChargeUsd: 0.02,
          veryfrontOutputChargeUsd: 0.03,
          veryfrontChargeUsd: 0.05,
          veryfrontBilledUsd: 0.2,
          costCredits: 2,
          costSource: "gateway",
          billingMode: "direct",
          finishReason: "stop",
          reasoningTokens: 1,
          usageCaptureStatus: "complete",
        },
      },
    );
  });

  it("respects an explicit total token count when provided", () => {
    assertEquals(
      buildAgUiFinalizeResponse({
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

  // Providers restart part ids at `reasoning-0` in every step, so composing the
  // AG-UI id from the part id alone collides across a multi-step run: every
  // reasoning block in the run comes out as `<messageId>:reasoning:reasoning-0`.
  it("gives each reasoning span a distinct messageId when a provider reuses part ids", () => {
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });
    mapRuntimeStreamEventToAgUiEvents(state, {
      type: "message-start",
      messageId: "assistant-multistep",
    });

    const startedMessageIds: string[] = [];
    for (const stepName of ["step-1", "step-2", "step-3"]) {
      mapRuntimeStreamEventToAgUiEvents(state, { type: "start-step", stepName });

      const started = mapRuntimeStreamEventToAgUiEvents(state, {
        type: "reasoning-start",
        id: "reasoning-0",
      });
      const startEvent = started.find((entry) => entry.event === "ReasoningMessageStart");
      startedMessageIds.push(startEvent?.payload.messageId as string);

      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "reasoning-delta",
        id: "reasoning-0",
        delta: `thinking in ${stepName}`,
      });
      mapRuntimeStreamEventToAgUiEvents(state, {
        type: "reasoning-end",
        id: "reasoning-0",
      });
      mapRuntimeStreamEventToAgUiEvents(state, { type: "finish-step", stepName });
    }

    assertEquals(
      new Set(startedMessageIds).size,
      startedMessageIds.length,
      `each reasoning span needs its own messageId, got ${JSON.stringify(startedMessageIds)}`,
    );
  });

  it("keeps delta and end on the messageId opened by their reasoning span", () => {
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });
    mapRuntimeStreamEventToAgUiEvents(state, {
      type: "message-start",
      messageId: "assistant-span-identity",
    });

    const collected: { first: string[]; second: string[] } = { first: [], second: [] };
    for (const slot of ["first", "second"] as const) {
      const ids = collected[slot];
      for (
        const event of [
          { type: "reasoning-start", id: "reasoning-0" },
          { type: "reasoning-delta", id: "reasoning-0", delta: "a" },
          { type: "reasoning-delta", id: "reasoning-0", delta: "b" },
          { type: "reasoning-end", id: "reasoning-0" },
        ]
      ) {
        for (const encoded of mapRuntimeStreamEventToAgUiEvents(state, event)) {
          if (encoded.event.startsWith("ReasoningMessage")) {
            ids.push(encoded.payload.messageId as string);
          }
        }
      }
    }

    assertEquals(
      new Set(collected.first).size,
      1,
      `first span must use one messageId throughout, got ${JSON.stringify(collected.first)}`,
    );
    assertEquals(
      new Set(collected.second).size,
      1,
      `second span must use one messageId throughout, got ${JSON.stringify(collected.second)}`,
    );
    assertEquals(
      collected.first[0] === collected.second[0],
      false,
      "the two spans must not share a messageId",
    );
  });

  it("drops a reasoning end that closes no open span", () => {
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });
    mapRuntimeStreamEventToAgUiEvents(state, {
      type: "message-start",
      messageId: "assistant-unmatched-end",
    });

    assertEquals(
      mapRuntimeStreamEventToAgUiEvents(state, { type: "reasoning-end", id: "reasoning-0" }),
      [],
      "an end with no span open must not emit a ReasoningMessageEnd",
    );

    // The dropped end must not consume an ordinal: the next real span is still 0.
    const started = mapRuntimeStreamEventToAgUiEvents(state, {
      type: "reasoning-start",
      id: "reasoning-0",
    });
    assertEquals(started, [{
      event: "ReasoningMessageStart",
      payload: { messageId: "assistant-unmatched-end:reasoning:0", role: "reasoning" },
    }]);
  });
});

describe("agent/ag-ui-encoder tool-input lifecycle", () => {
  // Raised in review on #3737. A truncated local tool call terminalizes as
  // `tool-input-start` (+ any partial deltas) followed by `tool-output-error`.
  // Unlike `tool-input-available` and `tool-input-error`, the output-error
  // branch never closed the input, so AG-UI clients saw ToolCallStart and
  // ToolCallResult with no ToolCallEnd and an input lifecycle left open.
  it("closes an open tool input before emitting its output error", () => {
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });

    mapRuntimeStreamEventToAgUiEvents(state, {
      type: "tool-input-start",
      toolCallId: "truncated-1",
      toolName: "search",
    });
    const events = mapRuntimeStreamEventToAgUiEvents(state, {
      type: "tool-output-error",
      toolCallId: "truncated-1",
      errorText: "interrupted",
    });

    const names = events.map((entry) => entry.event);
    assertEquals(names, ["ToolCallEnd", "ToolCallResult"]);
    assertEquals(
      events[0],
      { event: "ToolCallEnd", payload: { toolCallId: "truncated-1" } },
    );
  });

  it("tolerates a state object built without the tracker", () => {
    // `AgUiEncoderState` is re-exported from `veryfront/agent`, so a
    // consumer may hold a state object built against the shape this type had
    // before `openToolCallIds` existed. A required field would crash on the
    // first `tool-input-start`; `reasoningSpanIndex` is optional for the same
    // reason.
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });
    delete (state as { openToolCallIds?: Set<string> }).openToolCallIds;

    mapRuntimeStreamEventToAgUiEvents(state, {
      type: "tool-input-start",
      toolCallId: "legacy-1",
      toolName: "search",
    });
    const events = mapRuntimeStreamEventToAgUiEvents(state, {
      type: "tool-output-error",
      toolCallId: "legacy-1",
      errorText: "interrupted",
    });

    assertEquals(events.map((entry) => entry.event), ["ToolCallEnd", "ToolCallResult"]);
  });

  it("does not close a tool input that was already completed", () => {
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });

    mapRuntimeStreamEventToAgUiEvents(state, {
      type: "tool-input-start",
      toolCallId: "settled-1",
      toolName: "search",
    });
    mapRuntimeStreamEventToAgUiEvents(state, {
      type: "tool-input-available",
      toolCallId: "settled-1",
      toolName: "search",
      input: { q: "veryfront" },
    });
    const events = mapRuntimeStreamEventToAgUiEvents(state, {
      type: "tool-output-error",
      toolCallId: "settled-1",
      errorText: "upstream 500",
    });

    // Exactly one ToolCallEnd per call: the input-available branch already
    // emitted it, so a normal tool failure must not emit a second.
    assertEquals(events.map((entry) => entry.event), ["ToolCallResult"]);
  });

  it("never carries reasoning signatures or redacted data into AG-UI payloads", () => {
    // Signed reasoning blocks are replayed through the private provider replay
    // channel (veryfront-issue-inbox#522); the AG-UI transcript boundary must
    // stay signature-free so signed material cannot reach display text.
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });
    const signature = "sig-secret-3c2b1a";
    const redactedData = "redacted-secret-4d5e6f";

    const events = [
      ...mapRuntimeStreamEventToAgUiEvents(state, {
        type: "message-start",
        messageId: "assistant-signed",
      }),
      ...mapRuntimeStreamEventToAgUiEvents(state, {
        type: "reasoning-start",
        id: "reasoning-signed",
      }),
      ...mapRuntimeStreamEventToAgUiEvents(state, {
        type: "reasoning-delta",
        id: "reasoning-signed",
        delta: "",
      }),
      ...mapRuntimeStreamEventToAgUiEvents(state, {
        type: "reasoning-end",
        id: "reasoning-signed",
        signature,
        redactedData,
      }),
    ];

    assertEquals(
      events.map((entry) => entry.event),
      ["ReasoningMessageStart", "ReasoningMessageContent", "ReasoningMessageEnd"],
      "reasoning lifecycle only",
    );
    const serialized = JSON.stringify(events);
    assertEquals(serialized.includes(signature), false, "signature never leaves the runtime");
    assertEquals(
      serialized.includes(redactedData),
      false,
      "redacted data never leaves the runtime",
    );
    assertEquals(
      events.at(-1),
      {
        event: "ReasoningMessageEnd",
        payload: { messageId: "assistant-signed:reasoning:0" },
      },
      "reasoning end carries only its message anchor",
    );
  });
});
