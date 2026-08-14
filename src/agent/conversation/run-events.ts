import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { type ChatStreamEvent } from "#veryfront/chat/protocol.ts";
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

  // One encoder spans a whole run: it carries stepCount and the active message
  // across every step, so elapsed measured from here is run-relative and needs no
  // per-attempt anchor. Add it to the run's start time to get wall clock.
  constructor(options: ConversationRunEventEncoderOptions = {}) {
    if (options.nowMs) {
      this.nowMs = options.nowMs;
      this.startedMs = options.nowMs();
    }
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

  private serializeToolResultContent(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    try {
      return JSON.stringify(value ?? null);
    } catch {
      return String(value);
    }
  }

  encode(chunk: ChatStreamEvent): ConversationRunEvent[] {
    return this.stampElapsed(this.encodeChunk(chunk));
  }

  // Stamped on the way out rather than in each case arm, so every emitted record
  // is treated alike -- including the ones this encoder synthesises, such as the
  // terminal result for a provider-executed call the provider never resolved.
  private stampElapsed(events: ConversationRunEvent[]): ConversationRunEvent[] {
    if (!this.nowMs || this.startedMs === undefined) {
      return events;
    }

    const elapsedMs = Math.max(0, Math.round(this.nowMs() - this.startedMs));
    return events.map((event) => ({ ...event, elapsedMs }));
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
        events.push({ type: conversationRunEventTypes.toolCallEnd, toolCallId: chunk.toolCallId });
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
        events.push({ type: conversationRunEventTypes.toolCallEnd, toolCallId: chunk.toolCallId });
        events.push({
          type: conversationRunEventTypes.toolCallResult,
          messageId: this.getToolResultMessageId(chunk.toolCallId),
          toolCallId: chunk.toolCallId,
          content: this.serializeToolResultContent(chunk.errorText),
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
        const events: ConversationRunEvent[] = [{
          type: conversationRunEventTypes.toolCallResult,
          messageId: this.getToolResultMessageId(chunk.toolCallId),
          toolCallId: chunk.toolCallId,
          content: this.serializeToolResultContent(chunk.output),
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
          content: this.serializeToolResultContent(chunk.errorText),
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
