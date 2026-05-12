import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { type ChatStreamEvent } from "#veryfront/chat/protocol.ts";
import { normalizeConversationRunEvents } from "./conversation-run-event-normalization.ts";

export const conversationRunEventTypes = {
  custom: "CUSTOM",
  textMessageStart: "TEXT_MESSAGE_START",
  textMessageContent: "TEXT_MESSAGE_CONTENT",
  textMessageEnd: "TEXT_MESSAGE_END",
  reasoningMessageStart: "REASONING_MESSAGE_START",
  reasoningMessageContent: "REASONING_MESSAGE_CONTENT",
  reasoningMessageEnd: "REASONING_MESSAGE_END",
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

/** @deprecated Use getConversationRunEventSchema() */
export const ConversationRunEventSchema = getConversationRunEventSchema();

export type ConversationRunEvent = InferSchema<ReturnType<typeof getConversationRunEventSchema>>;

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

export class ConversationRunEventEncoder {
  private readonly streamedToolInputs = new Set<string>();
  private readonly toolInputs = new Map<string, unknown>();
  private activeMessageId: string | null = null;

  private getToolResultMessageId(toolCallId: string) {
    return this.activeMessageId
      ? `${this.activeMessageId}:tool:${toolCallId}`
      : `tool:${toolCallId}`;
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
    switch (chunk.type) {
      case "start":
        this.activeMessageId = chunk.messageId ?? null;
        return [];

      case "text-start":
        return [{
          type: conversationRunEventTypes.textMessageStart,
          messageId: chunk.id,
          role: "assistant",
        }];

      case "text-delta":
        return [{
          type: conversationRunEventTypes.textMessageContent,
          messageId: chunk.id,
          delta: chunk.delta,
        }];

      case "text-end":
        return [{ type: conversationRunEventTypes.textMessageEnd, messageId: chunk.id }];

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
        this.toolInputs.delete(chunk.toolCallId);
        return events;
      }

      case "tool-output-available":
        return [{
          type: conversationRunEventTypes.toolCallResult,
          messageId: this.getToolResultMessageId(chunk.toolCallId),
          toolCallId: chunk.toolCallId,
          content: this.serializeToolResultContent(chunk.output),
          role: "tool",
          ...(this.toolInputs.has(chunk.toolCallId)
            ? { input: this.toolInputs.get(chunk.toolCallId) }
            : {}),
        }];

      case "tool-output-error":
        return [{
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

      case "tool-output-denied":
        return [{
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

      case "error":
      case "finish":
      case "abort":
      case "message-metadata":
      case "source-url":
      case "source-document":
      case "file":
      case "tool-approval-request":
      case "start-step":
      case "finish-step":
        return [];

      default:
        return chunk.type.startsWith("data-") ? encodeCustomDataEvent(chunk) : [];
    }
  }
}

export function encodeConversationRunEvents(
  events: ChatStreamEvent[],
  encoder = new ConversationRunEventEncoder(),
): ConversationRunEvent[] {
  return events.flatMap((event) => encoder.encode(event));
}

export function normalizeEncodedConversationRunEvents(
  events: ChatStreamEvent[],
  encoder = new ConversationRunEventEncoder(),
): ConversationRunEvent[] {
  return normalizeConversationRunEvents(encodeConversationRunEvents(events, encoder));
}
