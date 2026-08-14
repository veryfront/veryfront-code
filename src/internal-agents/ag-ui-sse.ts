import type {
  AgUiBrowserEncodedEvent,
  AgUiBrowserEncoderState,
  AgUiBrowserRunFinishedMetadata,
  AgUiRuntimeStreamEvent,
} from "../agent/ag-ui/browser-encoder.ts";
import { parseDataStreamSseEvents } from "#veryfront/agent/streaming/data-stream.ts";
import {
  type AgUiBrowserEncoderStateOptions,
  createAgUiBrowserEncoderState,
  finalizeAgUiBrowserEvents,
  mapRuntimeStreamEventToAgUiBrowserEvents,
} from "../agent/ag-ui/browser-encoder.ts";
import { resolveSchemaValidator } from "#veryfront/schemas/define.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";

const encoder = new TextEncoder();
const AG_UI_EVENT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

type RuntimeDataEvent = AgUiRuntimeStreamEvent;
export type RunFinishedMetadata = AgUiBrowserRunFinishedMetadata;
export type StreamTransformState = AgUiBrowserEncoderState;
export type MappedAgUiEvent = AgUiBrowserEncodedEvent;

export function createStreamTransformState(
  options: AgUiBrowserEncoderStateOptions = {},
): StreamTransformState {
  return createAgUiBrowserEncoderState(options);
}

function buildAgUiEventPayloadSchemas(): Record<string, Schema<Record<string, unknown>>> {
  const v = resolveSchemaValidator();
  // Every encoded event carries timing from the browser-encoder: a run-relative
  // `elapsedMs` and an absolute `emittedAt` in epoch milliseconds. These payload
  // schemas are an allow-list and `parse` returns only what they declare, so a
  // field missing from one is silently dropped before it reaches the wire --
  // which is exactly how `elapsedMs` went missing through two releases after it
  // was already being stamped. Declaring timing here once keeps that from
  // recurring per event type, and means adding a timing field is one edit here
  // plus one in the encoder, never a per-schema sweep.
  const withTiming = (
    shape: Record<string, unknown>,
  ): Schema<Record<string, unknown>> =>
    // deno-lint-ignore no-explicit-any
    (v.object({
      ...shape,
      elapsedMs: v.number().optional(),
      emittedAt: v.number().optional(),
    } as any) as unknown) as Schema<
      Record<string, unknown>
    >;
  const schemas: Record<string, Schema<Record<string, unknown>>> = {
    RunStarted: withTiming({
      runId: v.string().min(1),
      threadId: v.string().min(1),
      agentId: v.string().min(1),
    }),
    StateSnapshot: withTiming({ snapshot: v.record(v.string(), v.unknown()) }),
    MessagesSnapshot: withTiming({
      messages: v.array(v.object({
        id: v.string().min(1),
        role: v.enum(["user", "assistant", "system", "tool"]),
        parts: v.array(v.record(v.string(), v.unknown())),
        metadata: v.record(v.string(), v.unknown()).optional(),
        createdAt: v.string().optional(),
      })),
    }),
    TextMessageStart: withTiming({
      messageId: v.string().min(1),
      contentId: v.string().min(1),
      role: v.literal("assistant"),
    }),
    TextMessageContent: withTiming({
      messageId: v.string().min(1),
      contentId: v.string().min(1),
      delta: v.string(),
    }),
    TextMessageEnd: withTiming({
      messageId: v.string().min(1),
      contentId: v.string().min(1),
    }),
    ReasoningMessageStart: withTiming({
      messageId: v.string().min(1),
      role: v.literal("reasoning"),
    }),
    ReasoningMessageContent: withTiming({ messageId: v.string().min(1), delta: v.string() }),
    ReasoningMessageEnd: withTiming({ messageId: v.string().min(1) }),
    StepStarted: withTiming({ stepName: v.string().min(1) }),
    StepFinished: withTiming({ stepName: v.string().min(1) }),
    ToolCallStart: withTiming({ toolCallId: v.string().min(1), toolCallName: v.string().min(1) }),
    ToolCallArgs: withTiming({ toolCallId: v.string().min(1), delta: v.string() }),
    ToolCallEnd: withTiming({ toolCallId: v.string().min(1) }),
    ToolCallResult: withTiming({
      toolCallId: v.string().min(1),
      result: v.unknown(),
      isError: v.boolean().optional(),
    }),
    Custom: withTiming({ name: v.string().min(1), value: v.unknown() }),
    RunError: withTiming({ code: v.string().min(1).optional(), message: v.string().min(1) }),
    RunFinished: withTiming({
      metadata: v.object({
        provider: v.string().optional(),
        model: v.string().optional(),
        inputTokens: v.number().int().nonnegative().optional(),
        outputTokens: v.number().int().nonnegative().optional(),
        totalTokens: v.number().int().nonnegative().optional(),
        cachedInputTokens: v.number().int().nonnegative().optional(),
        cacheCreationInputTokens: v.number().int().nonnegative().optional(),
        cacheReadInputTokens: v.number().int().nonnegative().optional(),
        reasoningTokens: v.number().int().nonnegative().optional(),
        billableInputTokens: v.number().int().nonnegative().optional(),
        billableOutputTokens: v.number().int().nonnegative().optional(),
        costUsd: v.number().nonnegative().optional(),
        providerInputCostUsd: v.number().nonnegative().optional(),
        providerOutputCostUsd: v.number().nonnegative().optional(),
        providerCostUsd: v.number().nonnegative().optional(),
        veryfrontInputChargeUsd: v.number().nonnegative().optional(),
        veryfrontOutputChargeUsd: v.number().nonnegative().optional(),
        veryfrontChargeUsd: v.number().nonnegative().optional(),
        veryfrontBilledUsd: v.number().nonnegative().optional(),
        costCredits: v.number().nonnegative().optional(),
        costSource: v.enum(["gateway", "missing", "partial"] as const).optional(),
        billingMode: v.enum(["direct", "deferred"] as const).optional(),
        usageCaptureStatus: v.enum(["complete", "partial", "missing"] as const).optional(),
        finishReason: v.string().optional(),
      }),
    }),
  };
  return schemas;
}

// Lazily build and memoize the per-event payload schema map. Built on first use
// so the SchemaValidator extension is resolved only once it is needed.
let _agUiEventPayloadSchemas: Record<string, Schema<Record<string, unknown>>> | null = null;

function resolveAgUiEventPayloadSchemas(): Record<string, Schema<Record<string, unknown>>> {
  if (!_agUiEventPayloadSchemas) {
    _agUiEventPayloadSchemas = buildAgUiEventPayloadSchemas();
  }
  return _agUiEventPayloadSchemas;
}

type AgUiEventName =
  | "RunStarted"
  | "StateSnapshot"
  | "MessagesSnapshot"
  | "TextMessageStart"
  | "TextMessageContent"
  | "TextMessageEnd"
  | "ReasoningMessageStart"
  | "ReasoningMessageContent"
  | "ReasoningMessageEnd"
  | "StepStarted"
  | "StepFinished"
  | "ToolCallStart"
  | "ToolCallArgs"
  | "ToolCallEnd"
  | "ToolCallResult"
  | "Custom"
  | "RunError"
  | "RunFinished";

export function formatAgUiEvent(event: string, payload: Record<string, unknown>): Uint8Array {
  const eventNameMatch = AG_UI_EVENT_NAME_PATTERN.exec(event);
  if (!eventNameMatch || eventNameMatch[0] !== event) {
    throw new TypeError(
      "AG-UI event names must be 1-128 character ASCII tokens beginning with a letter",
    );
  }

  const schemas = resolveAgUiEventPayloadSchemas();
  const schema = schemas[event as AgUiEventName];
  const validatedPayload = schema ? schema.parse(payload) : payload;
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(validatedPayload)}\n\n`);
}

export function parseSseJsonEvents(chunk: string): {
  events: RuntimeDataEvent[];
  remainder: string;
} {
  const parsed = parseDataStreamSseEvents(chunk);
  return {
    events: parsed.events,
    remainder: parsed.remainder,
  };
}

export function mapRuntimeEventToAgUi(
  state: StreamTransformState,
  event: RuntimeDataEvent,
): MappedAgUiEvent[] {
  return mapRuntimeStreamEventToAgUiBrowserEvents(state, event);
}

export function finalizeRunEvents(
  state: StreamTransformState,
  response: Parameters<typeof finalizeAgUiBrowserEvents>[1],
): MappedAgUiEvent[] {
  return finalizeAgUiBrowserEvents(state, response);
}
