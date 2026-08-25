import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { type ChatStreamEvent } from "#veryfront/chat/protocol.ts";
import type { AgentRunEventTimingOptions } from "../../runtime/model-call-context.ts";
import { normalizeConversationRunEvents } from "./run-event-normalization.ts";

/** Shared conversation run event types value. */
export const conversationRunEventTypes = {
  custom: "CUSTOM",
  textMessageStart: "TEXT_MESSAGE_START",
  textMessageContent: "TEXT_MESSAGE_CONTENT",
  textMessageEnd: "TEXT_MESSAGE_END",
  reasoningMessageStart: "REASONING_MESSAGE_START",
  reasoningMessageContent: "REASONING_MESSAGE_CONTENT",
  reasoningMessageEnd: "REASONING_MESSAGE_END",
  stepStarted: "STEP_STARTED",
  stepFinished: "STEP_FINISHED",
  toolCallStart: "TOOL_CALL_START",
  toolCallArgs: "TOOL_CALL_ARGS",
  toolCallEnd: "TOOL_CALL_END",
  toolCallResult: "TOOL_CALL_RESULT",
} as const;

export const getConversationRunEventSchema = defineSchema((v) =>
  v.object({
    type: v.string().min(1),
  }).passthrough()
);

/** Schema for conversation run event.
 * @deprecated Use getConversationRunEventSchema()
 */
export const ConversationRunEventSchema = lazySchema(getConversationRunEventSchema);

/** Event emitted for conversation run. */
export type ConversationRunEvent =
  & InferSchema<ReturnType<typeof getConversationRunEventSchema>>
  & Record<string, unknown>;

function serializeToolInput(input: unknown): string {
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return "{}";
  }
}

/** Serialize tool output while preserving strings that would otherwise decode as JSON. */
export function serializeConversationToolResultContent(value: unknown): {
  content: string;
  contentEncoding?: "text";
} {
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return { content: value, contentEncoding: "text" };
    } catch {
      return { content: value };
    }
  }

  try {
    const encoded = JSON.stringify(value ?? null);
    // `JSON.stringify` returns `undefined`, not a string, for a top-level
    // function or symbol. Storing that would drop the result's content
    // entirely, so fall through to the textual rendering below.
    if (typeof encoded === "string") return { content: encoded };
  } catch {
    // A value that cannot be encoded at all falls through the same way.
  }

  // `String(value)` is a lossy rendering, not a JSON encoding: a bigint
  // renders as bare digits that a reader would decode back into a number it
  // cannot represent. Mark it text so replay returns the stored characters.
  return { content: String(value), contentEncoding: "text" };
}

/**
 * Carry a chunk's provider-execution marker into the durable record.
 *
 * The version 1 reader replays a stored result as a provider tool result only
 * when the durable call records that it was provider-executed; a call that
 * dropped the marker replays as an opaque legacy custom event instead. The
 * marker is written on both the call start and the call end because producers
 * do not agree on which one carries it: the live lifecycle adapter synthesizes
 * an unmarked `tool-input-start` and marks only `tool-input-available`.
 */
function providerExecutionMarker(
  chunk: { providerExecuted?: boolean },
): { providerExecuted?: true } {
  return chunk.providerExecuted === true ? { providerExecuted: true } : {};
}

function encodeCustomDataEvent(
  chunk: Extract<ChatStreamEvent, { type: `data-${string}` }>,
): ConversationRunEvent[] {
  const name = chunk.type.slice("data-".length);
  if (name.length === 0) {
    return [];
  }

  return [{
    type: conversationRunEventTypes.custom,
    name,
    value: chunk.data,
  }];
}

/** Implement conversation run event encoder. */
/** Options accepted by the conversation run event encoder. */
export interface ConversationRunEventEncoderOptions {
  /**
   * Monotonic time source, in milliseconds. Supply one to stamp every encoded
   * record with `elapsedMs`, measured from this encoder's creation.
   *
   * A persisted event otherwise carries only the time it was stored, which
   * tracks the writer rather than the run, so durations built from it do not
   * describe what the agent did. This stamp is taken at the point the event is
   * produced, which is the only place that observes it. Omit the clock and
   * nothing is stamped.
   */
  nowMs?: () => number;
  epochMs?: () => number;
  startedMs?: number;
}

export class ConversationRunEventEncoder {
  private readonly streamedToolInputs = new Set<string>();
  private readonly toolInputs = new Map<string, unknown>();
  private activeMessageId: string | null = null;
  private activeTextContentId: string | null = null;
  private textContentIndex = 0;
  private activeStepName: string | null = null;
  private stepCount = 0;
  private readonly nowMs?: () => number;
  private readonly startedMs?: number;
  private readonly epochMs?: () => number;

  // One encoder spans a whole run: it carries stepCount and the active message
  // across every step, so elapsed measured from here is run-relative and needs no
  // per-attempt anchor. Add it to the run's start time to get wall clock.
  constructor(options: ConversationRunEventEncoderOptions = {}) {
    if (options.nowMs) {
      this.nowMs = options.nowMs;
      this.startedMs = options.startedMs ?? options.nowMs();
    }
    this.epochMs = options.epochMs;
  }

  /** Return the run timing anchor owned by this encoder, when it has one. */
  getTimingAnchor(): AgentRunEventTimingOptions | undefined {
    if (!this.nowMs && !this.epochMs) return undefined;
    return {
      ...(this.nowMs ? { nowMs: this.nowMs } : {}),
      ...(this.epochMs ? { epochMs: this.epochMs } : {}),
      ...(this.startedMs !== undefined ? { startedMs: this.startedMs } : {}),
    };
  }

  private nextStepName(): string {
    this.stepCount += 1;
    this.activeStepName = `step-${this.stepCount}`;
    return this.activeStepName;
  }

  private finishStepName(): string {
    const stepName = this.activeStepName ?? `step-${Math.max(this.stepCount, 1)}`;
    this.activeStepName = null;
    return stepName;
  }

  private getToolResultMessageId(toolCallId: string) {
    return this.activeMessageId
      ? `${this.activeMessageId}:tool:${toolCallId}`
      : `tool:${toolCallId}`;
  }

  private getTextMessagePayload(
    chunk: Extract<ChatStreamEvent, { type: "text-start" | "text-delta" | "text-end" }>,
  ) {
    const explicitMessageId = typeof chunk.messageId === "string" && chunk.messageId.length > 0
      ? chunk.messageId
      : null;
    const messageId = explicitMessageId ?? this.activeMessageId ?? chunk.id;
    const explicitContentId = typeof chunk.contentId === "string" && chunk.contentId.length > 0
      ? chunk.contentId
      : null;
    const chunkContentId = chunk.id !== messageId ? chunk.id : null;
    const contentId = explicitContentId ?? chunkContentId ?? this.activeTextContentId ??
      `text:${this.textContentIndex++}`;
    this.activeTextContentId = chunk.type === "text-end" ? null : contentId;

    return {
      messageId,
      contentId,
    };
  }

  // Tool call state is only needed until the call resolves; keeping it for the
  // whole run would grow unbounded over long agent sessions.
  private releaseToolCallState(toolCallId: string): void {
    this.toolInputs.delete(toolCallId);
    this.streamedToolInputs.delete(toolCallId);
  }

  encode(chunk: ChatStreamEvent): ConversationRunEvent[] {
    return this.stampElapsed(this.encodeChunk(chunk));
  }

  // Stamped on the way out rather than in each case arm, so every emitted record
  // is treated alike -- including the ones this encoder synthesises, such as the
  // terminal result for a provider-executed call the provider never resolved.
  private stampElapsed(events: ConversationRunEvent[]): ConversationRunEvent[] {
    if (events.length === 0) {
      return events;
    }

    for (const event of events) {
      if (Object.hasOwn(event, "elapsedMs")) assertValidElapsedMs(event.elapsedMs);
      if (Object.hasOwn(event, "emittedAt")) assertValidEmittedAt(event.emittedAt);
    }

    const needsElapsedMs = events.some((event) => !Object.hasOwn(event, "elapsedMs"));
    const needsEmittedAt = events.some((event) => !Object.hasOwn(event, "emittedAt"));
    const elapsedMs = needsElapsedMs && this.nowMs && this.startedMs !== undefined
      ? Math.max(0, Math.round(this.nowMs() - this.startedMs))
      : undefined;
    const emittedAt = needsEmittedAt && this.epochMs ? Math.round(this.epochMs()) : undefined;
    if (elapsedMs !== undefined) assertValidElapsedMs(elapsedMs);
    if (emittedAt !== undefined) assertValidEmittedAt(emittedAt);
    if (elapsedMs === undefined && emittedAt === undefined) {
      return events;
    }
    return events.map((event) => ({
      ...event,
      ...(elapsedMs !== undefined && !Object.hasOwn(event, "elapsedMs") ? { elapsedMs } : {}),
      ...(emittedAt !== undefined && !Object.hasOwn(event, "emittedAt") ? { emittedAt } : {}),
    }));
  }

  /** Stamp externally-created checkpoints against this encoder's run anchor. */
  stamp(events: ConversationRunEvent[]): ConversationRunEvent[] {
    return this.stampElapsed(events);
  }

  private encodeChunk(chunk: ChatStreamEvent): ConversationRunEvent[] {
    switch (chunk.type) {
      case "start":
        this.activeMessageId = chunk.messageId ?? null;
        return [];

      case "text-start":
        return [{
          type: conversationRunEventTypes.textMessageStart,
          ...this.getTextMessagePayload(chunk),
          role: "assistant",
        }];

      case "text-delta":
        return [{
          type: conversationRunEventTypes.textMessageContent,
          ...this.getTextMessagePayload(chunk),
          delta: chunk.delta,
        }];

      case "text-end":
        return [{
          type: conversationRunEventTypes.textMessageEnd,
          ...this.getTextMessagePayload(chunk),
        }];

      case "reasoning-start":
        return [{
          type: conversationRunEventTypes.reasoningMessageStart,
          messageId: chunk.id,
          role: "assistant",
        }];

      case "reasoning-delta":
        return [{
          type: conversationRunEventTypes.reasoningMessageContent,
          messageId: chunk.id,
          delta: chunk.delta,
        }];

      case "reasoning-end":
        return [{ type: conversationRunEventTypes.reasoningMessageEnd, messageId: chunk.id }];

      case "tool-input-start":
        return [{
          type: conversationRunEventTypes.toolCallStart,
          toolCallId: chunk.toolCallId,
          toolCallName: chunk.toolName,
          ...providerExecutionMarker(chunk),
        }];

      case "tool-input-delta":
        this.streamedToolInputs.add(chunk.toolCallId);
        return [{
          type: conversationRunEventTypes.toolCallArgs,
          toolCallId: chunk.toolCallId,
          delta: chunk.inputTextDelta,
        }];

      case "tool-input-available": {
        this.toolInputs.set(chunk.toolCallId, chunk.input);
        const events: ConversationRunEvent[] = [];
        if (!this.streamedToolInputs.has(chunk.toolCallId)) {
          events.push({
            type: conversationRunEventTypes.toolCallArgs,
            toolCallId: chunk.toolCallId,
            delta: serializeToolInput(chunk.input),
          });
        }
        events.push({
          type: conversationRunEventTypes.toolCallEnd,
          toolCallId: chunk.toolCallId,
          ...providerExecutionMarker(chunk),
        });
        return events;
      }

      case "tool-input-error": {
        this.toolInputs.set(chunk.toolCallId, chunk.input);
        const events: ConversationRunEvent[] = [];
        if (!this.streamedToolInputs.has(chunk.toolCallId)) {
          events.push({
            type: conversationRunEventTypes.toolCallArgs,
            toolCallId: chunk.toolCallId,
            delta: serializeToolInput(chunk.input),
          });
        }
        events.push({
          type: conversationRunEventTypes.toolCallEnd,
          toolCallId: chunk.toolCallId,
          ...providerExecutionMarker(chunk),
        });
        events.push({
          type: conversationRunEventTypes.toolCallResult,
          messageId: this.getToolResultMessageId(chunk.toolCallId),
          toolCallId: chunk.toolCallId,
          ...serializeConversationToolResultContent(chunk.errorText),
          role: "tool",
          ...(this.toolInputs.has(chunk.toolCallId)
            ? { input: this.toolInputs.get(chunk.toolCallId) }
            : {}),
          isError: true,
        });
        this.releaseToolCallState(chunk.toolCallId);
        return events;
      }

      case "tool-output-available": {
        if (chunk.preliminary === true) return [];
        const events: ConversationRunEvent[] = [{
          type: conversationRunEventTypes.toolCallResult,
          messageId: this.getToolResultMessageId(chunk.toolCallId),
          toolCallId: chunk.toolCallId,
          ...serializeConversationToolResultContent(chunk.output),
          role: "tool",
          ...(this.toolInputs.has(chunk.toolCallId)
            ? { input: this.toolInputs.get(chunk.toolCallId) }
            : {}),
        }];
        this.releaseToolCallState(chunk.toolCallId);
        return events;
      }

      case "tool-output-error": {
        const events: ConversationRunEvent[] = [{
          type: conversationRunEventTypes.toolCallResult,
          messageId: this.getToolResultMessageId(chunk.toolCallId),
          toolCallId: chunk.toolCallId,
          ...serializeConversationToolResultContent(chunk.errorText),
          role: "tool",
          ...(this.toolInputs.has(chunk.toolCallId)
            ? { input: this.toolInputs.get(chunk.toolCallId) }
            : {}),
          isError: true,
        }];
        this.releaseToolCallState(chunk.toolCallId);
        return events;
      }

      case "tool-output-denied": {
        const events: ConversationRunEvent[] = [{
          type: conversationRunEventTypes.toolCallResult,
          messageId: this.getToolResultMessageId(chunk.toolCallId),
          toolCallId: chunk.toolCallId,
          content: "Tool output denied",
          role: "tool",
          ...(this.toolInputs.has(chunk.toolCallId)
            ? { input: this.toolInputs.get(chunk.toolCallId) }
            : {}),
          isError: true,
        }];
        this.releaseToolCallState(chunk.toolCallId);
        return events;
      }

      case "source-document":
      case "source-url":
      case "file":
        return [{
          type: conversationRunEventTypes.custom,
          name: chunk.type,
          value: chunk,
        }];

      case "start-step":
        return [{
          type: conversationRunEventTypes.stepStarted,
          stepName: this.nextStepName(),
        }];

      case "finish-step":
        return [{
          type: conversationRunEventTypes.stepFinished,
          stepName: this.finishStepName(),
        }];

      case "error":
      case "finish":
      case "abort":
      case "message-metadata":
      case "tool-approval-request":
        return [];

      default:
        return chunk.type.startsWith("data-") ? encodeCustomDataEvent(chunk) : [];
    }
  }
}

function assertValidElapsedMs(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError("elapsedMs must be a finite non-negative number");
  }
}

function assertValidEmittedAt(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError("emittedAt must be a non-negative integer");
  }
}

/** Encode conversation run events helper. */
export function encodeConversationRunEvents(
  events: ChatStreamEvent[],
  encoder = new ConversationRunEventEncoder(),
): ConversationRunEvent[] {
  return events.flatMap((event) => encoder.encode(event));
}

/** Normalizes encoded conversation run events. */
export function normalizeEncodedConversationRunEvents(
  events: ChatStreamEvent[],
  encoder = new ConversationRunEventEncoder(),
): ConversationRunEvent[] {
  return normalizeConversationRunEvents(encodeConversationRunEvents(events, encoder));
}
