import { type ChatStreamEvent } from "../chat/protocol.ts";
import {
  type ConversationRunEvent,
  ConversationRunEventEncoder,
  encodeConversationRunEvents,
} from "./conversation-run-events.ts";
import { normalizeConversationRunEvents } from "./conversation-run-event-normalization.ts";

export function prepareConversationRunStreamEvents(
  events: ChatStreamEvent[],
  encoder = new ConversationRunEventEncoder(),
): ConversationRunEvent[] {
  return normalizeConversationRunEvents(encodeConversationRunEvents(events, encoder));
}

export function prepareConversationRunExternalEvents(
  events: ConversationRunEvent[],
): ConversationRunEvent[] {
  return normalizeConversationRunEvents(events);
}
