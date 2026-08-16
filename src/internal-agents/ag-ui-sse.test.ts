import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createStreamTransformState,
  finalizeRunEvents,
  formatAgUiEvent,
  mapRuntimeEventToAgUi,
  parseSseJsonEvents,
} from "./ag-ui-sse.ts";

describe("internal-agents/ag-ui-sse", () => {
  const CANONICAL_TOOL_CALL_ID = "tool-call-1";
  const CANONICAL_TOOL_NAME = "web_search";
  const CANONICAL_TOOL_ARGS = '{"query":"Veryfront"}';
  const CANONICAL_TOOL_RESULT = { ok: true, result: "Veryfront search result" };

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

  it("skips malformed SSE payloads and continues parsing", () => {
    const parsed = parseSseJsonEvents(
      'data: {"type":"text-delta","id":"text-1","delta":"hello"}\n\n' +
        'data: {"type":"broken"\n\n' +
        'data: {"type":"step-end"}\n\n',
    );

    assertEquals(parsed.events, [
      { type: "text-delta", id: "text-1", delta: "hello" },
      { type: "step-end" },
    ]);
    assertEquals(parsed.remainder, "");
  });

  it("maps runtime tool and text events to AG-UI wire events", () => {
    const state = createStreamTransformState({ nowMs: null, epochMs: null });

    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "message-start", messageId: "assistant-1" }),
      [],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "text-start", id: "text-1" }),
      [{
        event: "TextMessageStart",
        payload: { messageId: "assistant-1", contentId: "text-1", role: "assistant" },
      }],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "text-delta", id: "text-1", delta: "hello" }),
      [{
        event: "TextMessageContent",
        payload: { messageId: "assistant-1", contentId: "text-1", delta: "hello" },
      }],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, {
        type: "tool-input-start",
        toolCallId: "tool-1",
        toolName: "studio_focus_component",
      }),
      [
        {
          event: "TextMessageEnd",
          payload: { messageId: "assistant-1", contentId: "text-1" },
        },
        {
          event: "ToolCallStart",
          payload: { toolCallId: "tool-1", toolCallName: "studio_focus_component" },
        },
      ],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, {
        type: "tool-output-error",
        toolCallId: "tool-1",
        errorText: "boom",
      }),
      // `tool-1` opened with `tool-input-start` above and never reached a
      // terminal input event, so its input is closed here before the result.
      // This expectation previously omitted `ToolCallEnd`, which left the
      // client holding an open tool-input lifecycle for the whole run (#3737).
      [
        { event: "ToolCallEnd", payload: { toolCallId: "tool-1" } },
        {
          event: "ToolCallResult",
          payload: { toolCallId: "tool-1", result: { error: "boom" }, isError: true },
        },
      ],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "error", error: "Runtime failed" }),
      [{ event: "RunError", payload: { message: "Runtime failed" } }],
    );
  });

  it("covers implicit text start, tool transitions, steps, metadata, and terminal errors", () => {
    const state = createStreamTransformState({ nowMs: null, epochMs: null });

    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "message-start", id: "assistant-2" }),
      [],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "text-delta", delta: "hello" }),
      [
        {
          event: "TextMessageStart",
          payload: { messageId: "assistant-2", contentId: "text:0", role: "assistant" },
        },
        {
          event: "TextMessageContent",
          payload: { messageId: "assistant-2", contentId: "text:0", delta: "hello" },
        },
      ],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "text-end" }),
      [{ event: "TextMessageEnd", payload: { messageId: "assistant-2", contentId: "text:0" } }],
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
      [{ event: "StepStarted", payload: { stepName: "step-1" } }],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "step-end" }),
      [{ event: "StepFinished", payload: { stepName: "step-1" } }],
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

  it("maps browser-facing custom, tool fallback, and tool error events", () => {
    const state = createStreamTransformState({ nowMs: null, epochMs: null });

    assertEquals(
      mapRuntimeEventToAgUi(state, {
        type: "data-message-metadata",
        data: {
          status: "running",
        },
      }),
      [{
        event: "Custom",
        payload: {
          name: "message-metadata",
          value: {
            status: "running",
          },
        },
      }],
    );

    assertEquals(
      mapRuntimeEventToAgUi(state, {
        type: "tool-input-available",
        toolCallId: "tool-3",
        toolName: "web_search",
        input: { query: "Veryfront" },
      }),
      [
        {
          event: "ToolCallArgs",
          payload: { toolCallId: "tool-3", delta: '{"query":"Veryfront"}' },
        },
        {
          event: "ToolCallEnd",
          payload: { toolCallId: "tool-3" },
        },
      ],
    );

    assertEquals(
      mapRuntimeEventToAgUi(state, {
        type: "tool-input-error",
        toolCallId: "tool-4",
        toolName: "web_fetch",
        input: { url: "https://example.com" },
        errorText: "invalid url",
      }),
      [
        {
          event: "ToolCallArgs",
          payload: { toolCallId: "tool-4", delta: '{"url":"https://example.com"}' },
        },
        {
          event: "ToolCallEnd",
          payload: { toolCallId: "tool-4" },
        },
        {
          event: "ToolCallResult",
          payload: {
            toolCallId: "tool-4",
            result: { error: "invalid url" },
            isError: true,
          },
        },
      ],
    );

    assertEquals(
      mapRuntimeEventToAgUi(state, {
        type: "tool-output-denied",
        toolCallId: "tool-5",
      }),
      [{
        event: "ToolCallResult",
        payload: {
          toolCallId: "tool-5",
          result: { error: "Tool output denied" },
          isError: true,
        },
      }],
    );
  });

  it("maps runtime reasoning events to AG-UI reasoning message events", () => {
    const state = createStreamTransformState({ nowMs: null, epochMs: null });

    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "message-start", messageId: "assistant-3" }),
      [],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "reasoning-start", id: "reasoning-1" }),
      [{
        event: "ReasoningMessageStart",
        payload: { messageId: "assistant-3:reasoning:0", role: "reasoning" },
      }],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, {
        type: "reasoning-delta",
        id: "reasoning-1",
        delta: "thinking...",
      }),
      [{
        event: "ReasoningMessageContent",
        payload: { messageId: "assistant-3:reasoning:0", delta: "thinking..." },
      }],
    );
    assertEquals(
      mapRuntimeEventToAgUi(state, { type: "reasoning-end", id: "reasoning-1" }),
      [{
        event: "ReasoningMessageEnd",
        payload: { messageId: "assistant-3:reasoning:0" },
      }],
    );
  });

  it("finalizes open assistant text with usage metadata", () => {
    const state = createStreamTransformState({ nowMs: null, epochMs: null });
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
          payload: { messageId: "assistant-1", contentId: "text-1" },
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

  it("fails closed when the runtime completed without assistant-visible output", () => {
    const state = createStreamTransformState({ nowMs: null, epochMs: null });

    assertEquals(
      finalizeRunEvents(state, {
        text: "",
        messages: [],
        toolCalls: [],
        status: "completed",
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        metadata: {
          finishReason: "stop",
        },
      }),
      [
        {
          event: "RunError",
          payload: {
            code: "EMPTY_ASSISTANT_OUTPUT",
            message: "Agent run produced no assistant-visible output",
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
      emittedAt: 8,
    });

    assertEquals(
      new TextDecoder().decode(payload),
      'event: RunStarted\ndata: {"runId":"run_1","threadId":"thread-1","agentId":"assistant-1","emittedAt":8}\n\n',
    );
  });

  it("carries elapsedMs through to the wire without widening the allow-list", () => {
    // These payload schemas are an allow-list and `parse` returns only what
    // they declare, so a stamped field missing from a schema is dropped
    // silently between the encoder and the wire. That is how elapsedMs went
    // missing through two releases after it was already being stamped, so
    // both halves are pinned: the field survives, and nothing else does.
    const stamped = new TextDecoder().decode(
      formatAgUiEvent("StepStarted", { stepName: "step-1", elapsedMs: 42 }),
    );
    assertEquals(
      stamped.includes('"elapsedMs":42'),
      true,
      `elapsedMs must reach the wire, got ${JSON.stringify(stamped)}`,
    );

    const withEmittedAt = new TextDecoder().decode(
      formatAgUiEvent("StepStarted", { stepName: "step-1", emittedAt: 1_786_000_000_123 }),
    );
    assertEquals(
      withEmittedAt.includes('"emittedAt":1786000000123'),
      true,
      `emittedAt must reach the wire, got ${JSON.stringify(withEmittedAt)}`,
    );

    const leaked = new TextDecoder().decode(
      formatAgUiEvent("StepStarted", { stepName: "step-1", unexpected: "x" }),
    );
    assertEquals(
      leaked.includes("unexpected"),
      false,
      `the allow-list must still drop undeclared fields, got ${JSON.stringify(leaked)}`,
    );
  });

  it("stamps elapsedMs end to end from the runtime encoder root", () => {
    const state = createStreamTransformState();
    mapRuntimeEventToAgUi(state, { type: "message-start", messageId: "assistant-1" });
    const events = mapRuntimeEventToAgUi(state, { type: "start-step" });
    const frame = new TextDecoder().decode(
      formatAgUiEvent(events[0]!.event, events[0]!.payload),
    );
    assertEquals(
      /"elapsedMs":\d+/.test(frame),
      true,
      `the production encoder root must emit elapsedMs, got ${JSON.stringify(frame)}`,
    );
  });

  it("accepts extension event tokens without weakening SSE framing", () => {
    const payload = formatAgUiEvent("Done.custom-v1", { ok: true, emittedAt: 8 });

    assertEquals(
      new TextDecoder().decode(payload),
      'event: Done.custom-v1\ndata: {"ok":true,"emittedAt":8}\n\n',
    );
  });

  it("rejects event names that could inject or corrupt SSE frames", () => {
    for (
      const event of [
        "",
        "RunError\n",
        "RunError\r",
        "RunError\ndata: forged",
        "RunError\r\n\r\nevent: Forged",
        "RunError\u0000Forged",
        "Run Error",
        `A${"b".repeat(128)}`,
      ]
    ) {
      assertThrows(
        () => formatAgUiEvent(event, { message: "original" }),
        TypeError,
        "AG-UI event names",
      );
    }
  });

  it("preserves extended usage metadata in RunFinished frames", () => {
    const payload = formatAgUiEvent("RunFinished", {
      metadata: {
        provider: "veryfront-cloud",
        model: "anthropic/claude-sonnet-4-6",
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        cachedInputTokens: 4,
        cacheCreationInputTokens: 6,
        cacheReadInputTokens: 4,
        reasoningTokens: 2,
        billableInputTokens: 10,
        billableOutputTokens: 7,
        costUsd: 0.002,
        providerInputCostUsd: 0.001,
        providerOutputCostUsd: 0.0005,
        providerCostUsd: 0.0015,
        veryfrontInputChargeUsd: 0.0012,
        veryfrontOutputChargeUsd: 0.0007,
        veryfrontChargeUsd: 0.0019,
        veryfrontBilledUsd: 0.002,
        costCredits: 2,
        costSource: "gateway",
        billingMode: "deferred",
        usageCaptureStatus: "complete",
        finishReason: "stop",
      },
      emittedAt: 8,
    });

    assertEquals(
      new TextDecoder().decode(payload),
      'event: RunFinished\ndata: {"metadata":{"provider":"veryfront-cloud","model":"anthropic/claude-sonnet-4-6","inputTokens":12,"outputTokens":8,"totalTokens":20,"cachedInputTokens":4,"cacheCreationInputTokens":6,"cacheReadInputTokens":4,"reasoningTokens":2,"billableInputTokens":10,"billableOutputTokens":7,"costUsd":0.002,"providerInputCostUsd":0.001,"providerOutputCostUsd":0.0005,"providerCostUsd":0.0015,"veryfrontInputChargeUsd":0.0012,"veryfrontOutputChargeUsd":0.0007,"veryfrontChargeUsd":0.0019,"veryfrontBilledUsd":0.002,"costCredits":2,"costSource":"gateway","billingMode":"deferred","usageCaptureStatus":"complete","finishReason":"stop"},"emittedAt":8}\n\n',
    );
  });

  it("preserves text content ids when formatting AG-UI events", () => {
    const payload = formatAgUiEvent("TextMessageContent", {
      messageId: "assistant-1",
      contentId: "block-1",
      delta: "hello",
      emittedAt: 8,
    });

    assertEquals(
      new TextDecoder().decode(payload),
      'event: TextMessageContent\ndata: {"messageId":"assistant-1","contentId":"block-1","delta":"hello","emittedAt":8}\n\n',
    );
  });

  it("matches the canonical assistant text and tool trace used across repos", () => {
    const state = createStreamTransformState({ nowMs: null, epochMs: null });

    const mappedEvents = [
      { type: "message-start", messageId: "assistant-msg-1" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Let me check." },
      { type: "text-end", id: "text-1" },
      {
        type: "tool-input-start",
        toolCallId: CANONICAL_TOOL_CALL_ID,
        toolName: CANONICAL_TOOL_NAME,
      },
      {
        type: "tool-input-delta",
        toolCallId: CANONICAL_TOOL_CALL_ID,
        inputTextDelta: CANONICAL_TOOL_ARGS,
      },
      {
        type: "tool-input-available",
        toolCallId: CANONICAL_TOOL_CALL_ID,
      },
      {
        type: "tool-output-available",
        toolCallId: CANONICAL_TOOL_CALL_ID,
        output: CANONICAL_TOOL_RESULT,
      },
    ].flatMap((event) => mapRuntimeEventToAgUi(state, event));

    const finalizedEvents = finalizeRunEvents(state, {
      text: "Let me check.",
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
    });

    assertEquals([...mappedEvents, ...finalizedEvents], [
      {
        event: "TextMessageStart",
        payload: { messageId: "assistant-msg-1", contentId: "text-1", role: "assistant" },
      },
      {
        event: "TextMessageContent",
        payload: { messageId: "assistant-msg-1", contentId: "text-1", delta: "Let me check." },
      },
      {
        event: "TextMessageEnd",
        payload: { messageId: "assistant-msg-1", contentId: "text-1" },
      },
      {
        event: "ToolCallStart",
        payload: {
          toolCallId: CANONICAL_TOOL_CALL_ID,
          toolCallName: CANONICAL_TOOL_NAME,
        },
      },
      {
        event: "ToolCallArgs",
        payload: {
          toolCallId: CANONICAL_TOOL_CALL_ID,
          delta: CANONICAL_TOOL_ARGS,
        },
      },
      {
        event: "ToolCallEnd",
        payload: { toolCallId: CANONICAL_TOOL_CALL_ID },
      },
      {
        event: "ToolCallResult",
        payload: {
          toolCallId: CANONICAL_TOOL_CALL_ID,
          result: CANONICAL_TOOL_RESULT,
        },
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
    ]);
  });
});
