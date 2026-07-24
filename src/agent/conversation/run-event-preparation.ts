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
import type { StreamLifecycleFrame } from "#veryfront/agent/streaming/lifecycle/index.ts";
import { createLifecycleRunEventAdapter } from "./lifecycle-run-event-adapter.ts";

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

/** Event emitted for to conversation run stream. */
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

/** Prepare conversation run stream events. */
export function prepareConversationRunStreamEvents(
  events: ChatStreamEvent[],
  encoder = new ConversationRunEventEncoder(),
): ConversationRunEvent[] {
  return normalizeConversationRunEvents(encodeConversationRunEvents(events, encoder));
}

/** Prepare conversation run chunk events. */
export function prepareConversationRunChunkEvents(
  chunks: ChatUiMessageChunk<ChatMessageMetadata>[],
  encoder = new ConversationRunEventEncoder(),
): ConversationRunEvent[] {
  return prepareConversationRunStreamEvents(
    chunks.map((chunk) => toConversationRunStreamEvent(chunk)),
    encoder,
  );
}

/** Prepare conversation run external events. */
export function prepareConversationRunExternalEvents(
  events: ConversationRunEvent[],
): ConversationRunEvent[] {
  return normalizeConversationRunEvents(events);
}

/**
 * Pure version 2 preparation entry point for fixtures and the future Stream
 * Delivery module. No production mirror calls this in Gate 4: wiring it into a
 * hosted mirror before a source-tagged delivery contract exists would
 * double-write lifecycle-owned UI chunks and lose local tool events that occur
 * after handoff.
 */
export function prepareConversationRunLifecycleEvents(input: {
  runId: string;
  attemptId: string;
  attemptIndex: number;
  messageId: string;
  frames: readonly StreamLifecycleFrame[];
}): ConversationRunEvent[] {
  const events: ConversationRunEvent[] = [];
  const adapter = createLifecycleRunEventAdapter({
    ...input,
    onEvents: (batch) => events.push(...batch),
  });
  for (const frame of input.frames) adapter.handleFrame(frame);
  adapter.flush();
  adapter.dispose();
  return events;
}
