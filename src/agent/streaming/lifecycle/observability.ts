import { setActiveSpanAttributes } from "#veryfront/observability";
import {
  recordStreamLifecycleDeadline,
  recordStreamLifecycleDuration,
  recordStreamLifecycleOutcome,
  recordStreamLifecycleRepair,
  recordStreamLifecycleShadowDivergence,
  recordStreamLifecycleTelemetry,
} from "#veryfront/observability/metrics/index.ts";
import type {
  StreamLifecycleFrame,
  StreamLifecycleObserver,
  StreamOutcome,
  StreamProviderDeadlineKind,
} from "./types.ts";

/** Bounded metric sink used by the lifecycle observer. */
export interface StreamLifecycleMetricSink {
  recordOutcome(attributes: Record<string, string>): void;
  recordDeadline(attributes: Record<string, string>): void;
  recordTelemetry(attributes: Record<string, string>): void;
  recordRepair(attributes: Record<string, string>): void;
  recordShadowDivergence(attributes: Record<string, string>): void;
  recordDuration(
    kind:
      | "attempt"
      | "first_progress"
      | "semantic_idle"
      | "tool_input"
      | "tool_execution",
    durationMs: number,
    attributes: Record<string, string>,
  ): void;
}

/** Minimal span surface the observer may decorate. */
export interface StreamLifecycleSpanTarget {
  setAttributes(
    attributes: Record<string, string | number | boolean>,
  ): unknown;
}

const DEFAULT_SINK: StreamLifecycleMetricSink = {
  recordOutcome: recordStreamLifecycleOutcome,
  recordDeadline: recordStreamLifecycleDeadline,
  recordTelemetry: recordStreamLifecycleTelemetry,
  recordRepair: recordStreamLifecycleRepair,
  recordShadowDivergence: recordStreamLifecycleShadowDivergence,
  recordDuration: recordStreamLifecycleDuration,
};

const REPAIR_CODE_ALLOWLIST = new Set([
  "implicit_text_start",
  "implicit_reasoning_start",
  "implicit_tool_input_start",
  "provider_tool_input_synthesized",
  "legacy_text_content_after_end",
]);

function normalizeProviderFamily(provider: string | undefined): string {
  const value = provider?.toLowerCase() ?? "";
  if (value.includes("azure")) return "azure_openai";
  if (value.includes("openai")) return "openai";
  if (value.includes("anthropic")) return "anthropic";
  if (value.includes("bedrock") || value.includes("aws")) return "aws_bedrock";
  if (value.includes("google") || value.includes("gemini")) return "google";
  return "other";
}

function normalizeModelFamily(model: string | undefined): string {
  const value = model?.toLowerCase() ?? "";
  if (/(^|[^a-z0-9])o[0-9]/.test(value)) return "openai_o_series";
  if (value.includes("gpt")) return "gpt";
  if (value.includes("claude")) return "claude";
  if (value.includes("gemini")) return "gemini";
  if (value.includes("llama")) return "llama";
  if (value.includes("mistral")) return "mistral";
  return "other";
}

function normalizeRepairCode(code: string): string {
  return REPAIR_CODE_ALLOWLIST.has(code) ? code : "other";
}

/** Create a fail-open bounded-label lifecycle observer. */
export function createStreamLifecycleObserver(input: {
  provider?: string;
  model?: string;
  mode: "legacy" | "shadow" | "active";
  sink?: StreamLifecycleMetricSink;
  span?: StreamLifecycleSpanTarget;
}): StreamLifecycleObserver {
  const sink = input.sink ?? DEFAULT_SINK;
  const base: Record<string, string> = {
    provider: normalizeProviderFamily(input.provider),
    model_family: normalizeModelFamily(input.model),
    mode: input.mode,
  };
  const toolInputStartedAtMs = new Map<string, number>();
  const toolExecutionStartedAtMs = new Map<string, number>();
  let sawFirstProgress = false;

  const setSpanAttributes = (
    attributes: Record<string, string | number | boolean>,
  ): void => {
    if (input.span) {
      input.span.setAttributes(attributes);
      return;
    }
    setActiveSpanAttributes(attributes);
  };

  return {
    onFrame(frame: StreamLifecycleFrame) {
      if (frame.class === "telemetry") {
        sink.recordTelemetry({ ...base, telemetry_kind: frame.event.type });
        return;
      }
      if (frame.class === "diagnostic") {
        if (frame.event.type === "protocol_repair") {
          sink.recordRepair({
            ...base,
            repair_code: normalizeRepairCode(frame.event.code),
          });
        }
        return;
      }
      const event = frame.event;
      if (event.type === "tool_input_start") {
        toolInputStartedAtMs.set(event.toolCallId, frame.elapsedMs);
        return;
      }
      if (
        event.type === "tool_input_ready" ||
        event.type === "tool_input_rejected"
      ) {
        const startedAt = toolInputStartedAtMs.get(event.toolCallId);
        if (startedAt !== undefined) {
          toolInputStartedAtMs.delete(event.toolCallId);
          sink.recordDuration("tool_input", frame.elapsedMs - startedAt, base);
        }
        return;
      }
      if (event.type === "provider_tool_start") {
        toolExecutionStartedAtMs.set(event.toolCallId, frame.elapsedMs);
        return;
      }
      if (
        event.type === "provider_tool_result" ||
        event.type === "provider_tool_denied" ||
        event.type === "provider_tool_cancelled"
      ) {
        const startedAt = toolExecutionStartedAtMs.get(event.toolCallId);
        if (startedAt !== undefined) {
          toolExecutionStartedAtMs.delete(event.toolCallId);
          sink.recordDuration(
            "tool_execution",
            frame.elapsedMs - startedAt,
            base,
          );
        }
      }
    },
    onSemanticProgress(progress) {
      if (!sawFirstProgress) {
        sawFirstProgress = true;
        sink.recordDuration("first_progress", progress.elapsedMs, base);
        return;
      }
      if (progress.sincePreviousProgressMs !== null) {
        sink.recordDuration(
          "semantic_idle",
          progress.sincePreviousProgressMs,
          base,
        );
      }
    },
    onDeadline(deadline: StreamProviderDeadlineKind | "attempt") {
      sink.recordDeadline({ ...base, deadline_kind: deadline });
    },
    onOutcome(outcome: StreamOutcome) {
      const attributes: Record<string, string> = {
        ...base,
        status: outcome.status,
        phase: outcome.status === "failed" ? outcome.error.phase : outcome.phase,
        ...(outcome.status === "failed" ? { error_code: outcome.error.code } : {}),
        ...(outcome.status === "cancelled" ? { cancellation_source: outcome.source } : {}),
      };
      sink.recordOutcome(attributes);
      sink.recordDuration("attempt", outcome.elapsedMs, base);
      setSpanAttributes({
        "stream.lifecycle.status": outcome.status,
        "stream.lifecycle.phase": attributes.phase ?? outcome.phase,
        ...(outcome.status === "failed"
          ? { "stream.lifecycle.error_code": outcome.error.code }
          : {}),
        ...(outcome.status === "cancelled"
          ? { "stream.lifecycle.cancellation_source": outcome.source }
          : {}),
        "stream.lifecycle.mode": input.mode,
      });
    },
  };
}

/** Record a bounded shadow divergence report. */
export function recordStreamLifecycleShadowReport(input: {
  report: { count: number; categories: readonly string[] };
  mode: "shadow";
  sink?: StreamLifecycleMetricSink;
}): void {
  const sink = input.sink ?? DEFAULT_SINK;
  for (const category of input.report.categories) {
    sink.recordShadowDivergence({
      mode: input.mode,
      divergence_category: category,
    });
  }
}
