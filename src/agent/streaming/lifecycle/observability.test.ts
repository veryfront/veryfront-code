import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createStreamLifecycleObserver,
  recordStreamLifecycleShadowReport,
  type StreamLifecycleMetricSink,
} from "./observability.ts";
import type { StreamLifecycleFrame } from "./types.ts";

const ALLOWED_LABEL_KEYS = new Set([
  "status",
  "phase",
  "error_code",
  "cancellation_source",
  "provider",
  "model_family",
  "deadline_kind",
  "telemetry_kind",
  "repair_code",
  "divergence_category",
  "mode",
]);

function createRecordingSink() {
  const attributes: Record<string, string>[] = [];
  const durations: { kind: string; durationMs: number }[] = [];
  const sink: StreamLifecycleMetricSink = {
    recordOutcome: (attrs) => attributes.push(attrs),
    recordDeadline: (attrs) => attributes.push(attrs),
    recordTelemetry: (attrs) => attributes.push(attrs),
    recordRepair: (attrs) => attributes.push(attrs),
    recordShadowDivergence: (attrs) => attributes.push(attrs),
    recordDuration: (kind, durationMs, attrs) => {
      durations.push({ kind, durationMs });
      attributes.push(attrs);
    },
  };
  return { sink, attributes, durations };
}

function frame(
  cls: StreamLifecycleFrame["class"],
  event: unknown,
  elapsedMs = 0,
): StreamLifecycleFrame {
  return {
    class: cls,
    event,
    sequence: 1,
    elapsedMs,
  } as StreamLifecycleFrame;
}

describe("stream lifecycle observability", () => {
  it("emits only bounded label keys and no payload content", () => {
    const { sink, attributes, durations } = createRecordingSink();
    const spanAttributes: Record<string, unknown> = {};
    const observer = createStreamLifecycleObserver({
      provider: "openai/prompt SENTINEL_PROVIDER",
      model: "gpt-5.4 SENTINEL_MODEL",
      mode: "active",
      sink,
      span: {
        setAttributes(values) {
          Object.assign(spanAttributes, values);
          return this;
        },
      },
    });

    observer.onFrame(frame("telemetry", {
      type: "tool_input_status",
      toolCallId: "tool-call-SENTINEL_ID",
      status: "pending_input",
    }));
    observer.onFrame(frame("diagnostic", {
      type: "protocol_repair",
      code: "totally_unknown_repair SENTINEL_REPAIR",
    }));
    observer.onFrame(frame("semantic", {
      type: "tool_input_start",
      toolCallId: "tool-call-SENTINEL_ID",
      toolName: "create_file",
    }, 5));
    observer.onFrame(frame("semantic", {
      type: "tool_input_ready",
      toolCallId: "tool-call-SENTINEL_ID",
      toolName: "create_file",
      input: { prompt: "SENTINEL_PROMPT" },
    }, 25));
    observer.onSemanticProgress({
      elapsedMs: 40,
      sincePreviousProgressMs: null,
      phase: "streaming",
    });
    observer.onSemanticProgress({
      elapsedMs: 60,
      sincePreviousProgressMs: 20,
      phase: "streaming",
    });
    observer.onDeadline("tool_input_idle");
    observer.onOutcome({
      status: "failed",
      error: {
        code: "TOOL_INPUT_TIMEOUT",
        phase: "awaiting_tool_input",
        source: "tool",
        retryable: false,
        publicMessage: "Tool input did not arrive before the deadline",
      },
      snapshot: {
        phase: "failed",
        accumulatedText: "SENTINEL_TEXT",
        reasoning: [],
        tools: [],
        finishReason: null,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        hasStreamOutput: false,
        hasSemanticProgress: true,
      },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      elapsedMs: 90,
      phase: "failed",
    });
    recordStreamLifecycleShadowReport({
      report: { count: 1, categories: ["text"] },
      mode: "shadow",
      sink,
    });

    for (const attrs of attributes) {
      for (const key of Object.keys(attrs)) {
        assertEquals(ALLOWED_LABEL_KEYS.has(key), true, key);
      }
    }
    const serialized = JSON.stringify(attributes);
    for (
      const sentinel of [
        "SENTINEL_PROVIDER",
        "SENTINEL_MODEL",
        "SENTINEL_ID",
        "SENTINEL_REPAIR",
        "SENTINEL_PROMPT",
        "SENTINEL_TEXT",
      ]
    ) {
      assertEquals(serialized.includes(sentinel), false, sentinel);
    }
    assertEquals(
      durations,
      [
        { kind: "tool_input", durationMs: 20 },
        { kind: "first_progress", durationMs: 40 },
        { kind: "semantic_idle", durationMs: 20 },
        { kind: "attempt", durationMs: 90 },
      ],
      "each recorded duration must span the frames it measures",
    );
    assertEquals(
      Object.keys(spanAttributes).every((key) => key.startsWith("stream.lifecycle.")),
      true,
    );
    assertEquals(spanAttributes["stream.lifecycle.status"], "failed");
    assertEquals(
      spanAttributes["stream.lifecycle.error_code"],
      "TOOL_INPUT_TIMEOUT",
    );
  });

  it("records provider tool execution duration between start and result", () => {
    const { sink, durations } = createRecordingSink();
    const observer = createStreamLifecycleObserver({
      provider: "openai",
      model: "gpt-5.4",
      mode: "active",
      sink,
    });

    observer.onFrame(frame("semantic", {
      type: "provider_tool_start",
      toolCallId: "t1",
      toolName: "web_search",
    }, 10));
    observer.onFrame(frame("semantic", {
      type: "provider_tool_result",
      toolCallId: "t1",
      toolName: "web_search",
      output: {},
      isError: false,
    }, 35));

    assertEquals(
      durations,
      [{ kind: "tool_execution", durationMs: 25 }],
      "provider tool execution must record the start-to-result span",
    );
  });

  it("labels cancelled outcomes with their cancellation source", () => {
    const { sink, attributes } = createRecordingSink();
    const spanAttributes: Record<string, unknown> = {};
    const observer = createStreamLifecycleObserver({
      provider: "openai",
      model: "gpt-5.4",
      mode: "active",
      sink,
      span: {
        setAttributes(values) {
          Object.assign(spanAttributes, values);
          return this;
        },
      },
    });

    observer.onOutcome({
      status: "cancelled",
      source: "client_disconnected",
      publicMessage: "The client disconnected",
      snapshot: {
        phase: "cancelled",
        accumulatedText: "",
        reasoning: [],
        tools: [],
        finishReason: null,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        hasStreamOutput: false,
        hasSemanticProgress: false,
      },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      elapsedMs: 40,
      phase: "cancelled",
    });

    assertEquals(
      attributes.at(0)?.cancellation_source,
      "client_disconnected",
      "a cancelled outcome must carry its cancellation source label",
    );
    assertEquals(
      spanAttributes["stream.lifecycle.cancellation_source"],
      "client_disconnected",
      "the span must carry the cancellation source",
    );
    for (const attrs of attributes) {
      for (const key of Object.keys(attrs)) {
        assertEquals(ALLOWED_LABEL_KEYS.has(key), true, key);
      }
    }
  });

  it("normalizes provider, model, and repair labels to a closed vocabulary", () => {
    const { sink, attributes } = createRecordingSink();
    const observer = createStreamLifecycleObserver({
      provider: "Azure-OpenAI-Gateway",
      model: "o3-mini-preview",
      mode: "shadow",
      sink,
    });
    observer.onFrame(frame("diagnostic", {
      type: "protocol_repair",
      code: "implicit_text_start",
    }));
    observer.onDeadline("attempt");
    assertEquals(attributes[0]?.provider, "azure_openai");
    assertEquals(attributes[0]?.model_family, "openai_o_series");
    assertEquals(attributes[0]?.repair_code, "implicit_text_start");
    assertEquals(attributes[1]?.deadline_kind, "attempt");
    assertEquals(attributes[1]?.mode, "shadow");
  });

  it("normalizes shadow divergence labels to a closed vocabulary", () => {
    const { sink, attributes } = createRecordingSink();

    recordStreamLifecycleShadowReport({
      report: {
        count: 3,
        categories: [
          "text",
          "customer-123 SENTINEL_DIVERGENCE",
          "request-456 SENTINEL_DIVERGENCE",
        ],
      },
      mode: "shadow",
      sink,
    });

    assertEquals(attributes, [
      { mode: "shadow", divergence_category: "text" },
      { mode: "shadow", divergence_category: "other" },
    ]);
    assertEquals(
      JSON.stringify(attributes).includes("SENTINEL_DIVERGENCE"),
      false,
    );
  });
});
