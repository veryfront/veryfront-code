import {
  type ChatFinishReason,
  type ChatMessageMetadata,
  type ChatStreamEvent,
  type ChatUiMessageChunk,
} from "../../chat/protocol.ts";
import {
  type ConversationRunEvent,
  ConversationRunEventEncoder,
  encodeConversationRunEvents,
} from "./run-events.ts";
import { normalizeConversationRunEvents } from "./run-event-normalization.ts";

function normalizeFinishReason(reason?: string): ChatFinishReason | undefined {
  switch (reason) {
    case "stop":
    case "length":
    case "tool-calls":
    case "content-filter":
    case "error":
    case "other":
      return reason;
    default:
      return undefined;
  }
}

export function toConversationRunStreamEvent(
  chunk: ChatUiMessageChunk<ChatMessageMetadata>,
): ChatStreamEvent {
  switch (chunk.type) {
    case "start":
      return {
        type: "start",
        ...(chunk.messageId !== undefined ? { messageId: chunk.messageId } : {}),
        ...(chunk.messageMetadata !== undefined ? { messageMetadata: chunk.messageMetadata } : {}),
      };
    case "finish": {
      const finishReason = normalizeFinishReason(chunk.finishReason);
      return {
        type: "finish",
        ...(finishReason !== undefined ? { finishReason } : {}),
      };
    }
    case "message-metadata":
      return {
        type: "message-metadata",
        messageMetadata: chunk.messageMetadata,
      };
    default:
      return chunk;
  }
}

export function prepareConversationRunStreamEvents(
  events: ChatStreamEvent[],
  encoder = new ConversationRunEventEncoder(),
): ConversationRunEvent[] {
  return normalizeConversationRunEvents(encodeConversationRunEvents(events, encoder));
}

export function prepareConversationRunChunkEvents(
  chunks: ChatUiMessageChunk<ChatMessageMetadata>[],
  encoder = new ConversationRunEventEncoder(),
): ConversationRunEvent[] {
  return prepareConversationRunStreamEvents(
    chunks.map((chunk) => toConversationRunStreamEvent(chunk)),
    encoder,
  );
}

export function prepareConversationRunExternalEvents(
  events: ConversationRunEvent[],
): ConversationRunEvent[] {
  return normalizeConversationRunEvents(events);
}
