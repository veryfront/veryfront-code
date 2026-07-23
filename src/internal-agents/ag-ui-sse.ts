import type {
  AgUiBrowserEncodedEvent,
  AgUiBrowserEncoderState,
  AgUiBrowserRunFinishedMetadata,
  AgUiRuntimeStreamEvent,
} from "../agent/ag-ui/browser-encoder.ts";
export type {
  AgUiBrowserEncodedEvent,
  AgUiBrowserEncoderState,
  AgUiBrowserRunFinishedMetadata,
  AgUiRuntimeStreamEvent,
} from "../agent/ag-ui/browser-encoder.ts";
import type { AgentResponse } from "../agent/types.ts";
export type { AgentResponse } from "../agent/types.ts";
import {
  createAgUiBrowserEncoderState,
  finalizeAgUiBrowserEvents,
  mapRuntimeStreamEventToAgUiBrowserEvents,
} from "../agent/ag-ui/browser-encoder.ts";
import { resolveSchemaValidator } from "#veryfront/schemas/define.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";

const encoder = new TextEncoder();
const MAX_AG_UI_EVENT_BYTES = 4 * 1024 * 1024;
const MAX_RUNTIME_SSE_BUFFER_BYTES = 4 * 1024 * 1024;

/** Metadata emitted when an internal AG-UI run finishes. */
export type RunFinishedMetadata = AgUiBrowserRunFinishedMetadata;
/** Mutable state used while translating runtime events to AG-UI events. */
export type StreamTransformState = AgUiBrowserEncoderState;
/** AG-UI event produced by the internal runtime stream translator. */
export type MappedAgUiEvent = AgUiBrowserEncodedEvent;

/** Creates isolated state for one internal runtime stream translation. */
export function createStreamTransformState(): StreamTransformState {
  return createAgUiBrowserEncoderState();
}

function buildAgUiEventPayloadSchemas(): Record<string, Schema<Record<string, unknown>>> {
  const v = resolveSchemaValidator();
  const schemas: Record<string, Schema<Record<string, unknown>>> = {
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
    TextMessageStart: v.object({
      messageId: v.string().min(1),
      contentId: v.string().min(1),
      role: v.literal("assistant"),
    }),
    TextMessageContent: v.object({
      messageId: v.string().min(1),
      contentId: v.string().min(1),
      delta: v.string(),
    }),
    TextMessageEnd: v.object({
      messageId: v.string().min(1),
      contentId: v.string().min(1),
    }),
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
      result: v.unknown().refine((value) => value !== undefined, {
        message: "ToolCallResult.result is required",
      }),
      isError: v.boolean().optional(),
    }),
    Custom: v.object({
      name: v.string().min(1),
      value: v.unknown().refine((value) => value !== undefined, {
        message: "Custom.value is required",
      }),
    }),
    RunError: v.object({ code: v.string().min(1).optional(), message: v.string().min(1) }),
    RunFinished: v.object({
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

/** Validates and serializes one supported AG-UI event as an SSE frame. */
export function formatAgUiEvent(event: string, payload: Record<string, unknown>): Uint8Array {
  const schemas = resolveAgUiEventPayloadSchemas();
  const schema = schemas[event as AgUiEventName];
  if (!schema) {
    throw new TypeError("Unsupported AG-UI event");
  }
  const validatedPayload = schema.parse(payload);
  let serializedPayload: string;
  try {
    serializedPayload = JSON.stringify(validatedPayload);
  } catch {
    throw new TypeError("AG-UI event payload must be JSON serializable");
  }
  const frame = encoder.encode(`event: ${event}\ndata: ${serializedPayload}\n\n`);
  if (frame.byteLength > MAX_AG_UI_EVENT_BYTES) {
    throw new RangeError("AG-UI event exceeds the supported wire budget");
  }
  return frame;
}

/** Parses complete runtime data-stream events and returns the incomplete remainder. */
export function parseSseJsonEvents(chunk: string): {
  events: AgUiRuntimeStreamEvent[];
  remainder: string;
} {
  if (encoder.encode(chunk).byteLength > MAX_RUNTIME_SSE_BUFFER_BYTES) {
    throw new RangeError("Internal runtime SSE buffer exceeds the supported wire budget");
  }
  const normalizedChunk = chunk.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const blocks = normalizedChunk.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const events: AgUiRuntimeStreamEvent[] = [];
  for (const block of blocks) {
    const dataLines = block.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) continue;

    const payload = dataLines.join("\n");
    if (payload.trim() === "[DONE]") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new SyntaxError("Internal runtime SSE data must contain valid JSON");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new TypeError("Internal runtime SSE data must contain an event type");
    }
    const parsedEvent = parsed as Record<string, unknown>;
    if (typeof parsedEvent.type !== "string" || parsedEvent.type.length === 0) {
      throw new TypeError("Internal runtime SSE data must contain an event type");
    }
    events.push(parsedEvent as AgUiRuntimeStreamEvent);
  }
  return { events, remainder };
}

/** Maps one runtime stream event into zero or more AG-UI browser events. */
export function mapRuntimeEventToAgUi(
  state: StreamTransformState,
  event: AgUiRuntimeStreamEvent,
): MappedAgUiEvent[] {
  const mappedEvents = mapRuntimeStreamEventToAgUiBrowserEvents(state, event);
  return mappedEvents.map((mappedEvent) => {
    if (event.type === "error" && mappedEvent.event === "RunError") {
      return {
        event: "RunError",
        payload: { message: "Internal agent runtime failed" },
      };
    }
    if (
      (event.type === "tool-input-error" || event.type === "tool-output-error") &&
      mappedEvent.event === "ToolCallResult"
    ) {
      return {
        event: "ToolCallResult",
        payload: {
          toolCallId: mappedEvent.payload.toolCallId,
          result: { error: "Tool execution failed" },
          isError: true,
        },
      };
    }
    if (
      mappedEvent.event === "ToolCallResult" && mappedEvent.payload.result === undefined
    ) {
      return {
        ...mappedEvent,
        payload: { ...mappedEvent.payload, result: null },
      };
    }
    if (mappedEvent.event === "Custom" && mappedEvent.payload.value === undefined) {
      return {
        ...mappedEvent,
        payload: { ...mappedEvent.payload, value: null },
      };
    }
    return mappedEvent;
  });
}

/** Finalizes open event state and emits the terminal AG-UI events for a run. */
export function finalizeRunEvents(
  state: StreamTransformState,
  response: AgentResponse | null,
): MappedAgUiEvent[] {
  return finalizeAgUiBrowserEvents(state, response);
}
