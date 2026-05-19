import { type ChatStreamEvent } from "#veryfront/chat/protocol.ts";
import { type ConversationRunEvent, ConversationRunEventEncoder } from "./run-events.ts";
import {
  type ConversationRunMirror,
  type ConversationRunMirrorHighBacklogState,
  type ConversationRunMirrorRetryScheduledState,
  type ConversationRunMirrorStoppedState,
  createConversationRunMirror,
} from "./run-mirror.ts";
import { normalizeConversationRunEvents } from "./run-event-normalization.ts";
import { type ConversationRunEventQueueController } from "./durable.ts";

/** Public API contract for conversation run stream mirror. */
export interface ConversationRunStreamMirror {
  handleStreamEvent(event: ChatStreamEvent): void;
  appendEvents(events: ConversationRunEvent[]): void;
  flush(): Promise<void>;
  getSnapshot(): ReturnType<ConversationRunMirror["getSnapshot"]>;
  dispose(): void;
}

/** Create conversation run stream mirror. */
export function createConversationRunStreamMirror(input: {
  queueController: ConversationRunEventQueueController;
  immediateFlushEventCount: number;
  encoder?: ConversationRunEventEncoder;
  flushDelayMs?: number;
  getRetryDelayMs?: (consecutiveFailures: number) => number;
  highBacklogEventCount?: number;
  onHighBacklog?: (state: ConversationRunMirrorHighBacklogState) => Promise<void> | void;
  onRetryScheduled?: (state: ConversationRunMirrorRetryScheduledState) => Promise<void> | void;
  onStopped?: (state: ConversationRunMirrorStoppedState) => Promise<void> | void;
}): ConversationRunStreamMirror {
  const encoder = input.encoder ?? new ConversationRunEventEncoder();
  const mirror = createConversationRunMirror({
    queueController: input.queueController,
    immediateFlushEventCount: input.immediateFlushEventCount,
    ...(input.flushDelayMs !== undefined ? { flushDelayMs: input.flushDelayMs } : {}),
    ...(input.getRetryDelayMs ? { getRetryDelayMs: input.getRetryDelayMs } : {}),
    ...(input.highBacklogEventCount !== undefined
      ? { highBacklogEventCount: input.highBacklogEventCount }
      : {}),
    ...(input.onHighBacklog ? { onHighBacklog: input.onHighBacklog } : {}),
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
