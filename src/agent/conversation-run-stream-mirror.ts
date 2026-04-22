import { type ChatStreamEvent } from "../chat/protocol.ts";
import {
  type ConversationRunEvent,
  ConversationRunEventEncoder,
} from "./conversation-run-events.ts";
import {
  type ConversationRunMirror,
  type ConversationRunMirrorRetryScheduledState,
  type ConversationRunMirrorStoppedState,
  createConversationRunMirror,
} from "./conversation-run-mirror.ts";
import { normalizeConversationRunEvents } from "./conversation-run-event-normalization.ts";
import { type ConversationRunEventQueueController } from "./durable.ts";

export interface ConversationRunStreamMirror {
  handleStreamEvent(event: ChatStreamEvent): void;
  appendEvents(events: ConversationRunEvent[]): void;
  flush(): Promise<void>;
  getSnapshot(): ReturnType<ConversationRunMirror["getSnapshot"]>;
  dispose(): void;
}

export function createConversationRunStreamMirror(input: {
  queueController: ConversationRunEventQueueController;
  immediateFlushEventCount: number;
  encoder?: ConversationRunEventEncoder;
  flushDelayMs?: number;
  getRetryDelayMs?: (consecutiveFailures: number) => number;
  onRetryScheduled?: (state: ConversationRunMirrorRetryScheduledState) => Promise<void> | void;
  onStopped?: (state: ConversationRunMirrorStoppedState) => Promise<void> | void;
}): ConversationRunStreamMirror {
  const encoder = input.encoder ?? new ConversationRunEventEncoder();
  const mirror = createConversationRunMirror({
    queueController: input.queueController,
    immediateFlushEventCount: input.immediateFlushEventCount,
    ...(input.flushDelayMs !== undefined ? { flushDelayMs: input.flushDelayMs } : {}),
    ...(input.getRetryDelayMs ? { getRetryDelayMs: input.getRetryDelayMs } : {}),
    ...(input.onRetryScheduled ? { onRetryScheduled: input.onRetryScheduled } : {}),
    ...(input.onStopped ? { onStopped: input.onStopped } : {}),
  });

  return {
    handleStreamEvent(event) {
      mirror.enqueue(normalizeConversationRunEvents(encoder.encode(event)));
    },
    appendEvents(events) {
      mirror.enqueue(normalizeConversationRunEvents(events));
    },
    flush() {
      return mirror.flush();
    },
    getSnapshot() {
      return mirror.getSnapshot();
    },
    dispose() {
      mirror.dispose();
    },
  };
}
