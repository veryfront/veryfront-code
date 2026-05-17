import type {
  AgUiBrowserEncodedEvent,
  AgUiBrowserEncoderState,
  AgUiBrowserRunFinishedMetadata,
  AgUiRuntimeStreamEvent,
} from "../agent/ag-ui/browser-encoder.ts";
import { parseDataStreamSseEvents } from "#veryfront/agent/streaming/data-stream.ts";
import {
  createAgUiBrowserEncoderState,
  finalizeAgUiBrowserEvents,
  mapRuntimeStreamEventToAgUiBrowserEvents,
} from "../agent/ag-ui/browser-encoder.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";

const encoder = new TextEncoder();

type RuntimeDataEvent = AgUiRuntimeStreamEvent;
export type RunFinishedMetadata = AgUiBrowserRunFinishedMetadata;
export type StreamTransformState = AgUiBrowserEncoderState;
export type MappedAgUiEvent = AgUiBrowserEncodedEvent;

export function createStreamTransformState(): StreamTransformState {
  return createAgUiBrowserEncoderState();
}

const getAgUiEventPayloadSchemas = defineSchema((v) => {
  const schemas = {
    RunStarted: v.object({
      runId: v.string().min(1),
      threadId: v.string().min(1),
      agentId: v.string().min(1),
    }),
    StateSnapshot: v.object({ snapshot: v.record(v.string(), v.unknown()) }),
    MessagesSnapshot: v.object({
      messages: v.array(v.object({
        id: v.string().min(1),
        role: v.enum(["user", "assistant", "system", "tool"]),
        parts: v.array(v.record(v.string(), v.unknown())),
        metadata: v.record(v.string(), v.unknown()).optional(),
        createdAt: v.string().optional(),
      })),
    }),
    TextMessageStart: v.object({ messageId: v.string().min(1), role: v.literal("assistant") }),
    TextMessageContent: v.object({ messageId: v.string().min(1), delta: v.string() }),
    TextMessageEnd: v.object({ messageId: v.string().min(1) }),
    ReasoningMessageStart: v.object({ messageId: v.string().min(1), role: v.literal("reasoning") }),
    ReasoningMessageContent: v.object({ messageId: v.string().min(1), delta: v.string() }),
    ReasoningMessageEnd: v.object({ messageId: v.string().min(1) }),
    StepStarted: v.object({ stepName: v.string().min(1) }),
    StepFinished: v.object({ stepName: v.string().min(1) }),
    ToolCallStart: v.object({ toolCallId: v.string().min(1), toolCallName: v.string().min(1) }),
    ToolCallArgs: v.object({ toolCallId: v.string().min(1), delta: v.string() }),
    ToolCallEnd: v.object({ toolCallId: v.string().min(1) }),
    ToolCallResult: v.object({
      toolCallId: v.string().min(1),
      result: v.unknown(),
      isError: v.boolean().optional(),
    }),
    Custom: v.object({ name: v.string().min(1), value: v.unknown() }),
    RunError: v.object({ code: v.string().min(1).optional(), message: v.string().min(1) }),
    RunFinished: v.object({
      metadata: v.object({
        provider: v.string().optional(),
        model: v.string().optional(),
        inputTokens: v.number().int().nonnegative().optional(),
        outputTokens: v.number().int().nonnegative().optional(),
        totalTokens: v.number().int().nonnegative().optional(),
        finishReason: v.string().optional(),
      }),
    }),
  };
  // Return a record schema that validates to any - we only use this for per-key lookups
  return schemas as unknown as Schema<Record<string, unknown>>;
});

// Eagerly resolve the schemas map so lookup works at runtime
let _agUiEventPayloadSchemas: Record<string, Schema<Record<string, unknown>>> | null = null;

function resolveAgUiEventPayloadSchemas(): Record<string, Schema<Record<string, unknown>>> {
  if (!_agUiEventPayloadSchemas) {
    // The defineSchema factory above returns the schemas record (cast); unwrap it.
    _agUiEventPayloadSchemas = getAgUiEventPayloadSchemas() as unknown as Record<
      string,
      Schema<Record<string, unknown>>
    >;
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
