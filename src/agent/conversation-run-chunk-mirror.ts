import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
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
import {
  prepareConversationRunChunkEvents,
  prepareConversationRunExternalEvents,
} from "./conversation-run-event-preparation.ts";
import {
  type ConversationRunEventQueueController,
  createConversationRunEventQueueController,
} from "./durable.ts";

const DEFAULT_IMMEDIATE_FLUSH_EVENT_COUNT = 24;
const DEFAULT_MAX_CURSOR_RESYNCS_PER_FLUSH = 3;

export interface ConversationRunChunkMirror {
  handleChunk(chunk: ChatUiMessageChunk<ChatMessageMetadata>): Promise<void>;
  appendEvents(events: ConversationRunEvent[]): Promise<void>;
  flush(): Promise<void>;
  getSnapshot(): ReturnType<ConversationRunMirror["getSnapshot"]>;
  dispose(): void;
}

export interface ConversationRunChunkMirrorPreparedChunk {
  chunk: ChatUiMessageChunk<ChatMessageMetadata>;
  events: ConversationRunEvent[];
}

export interface ConversationRunChunkMirrorPreparedEvents {
  events: ConversationRunEvent[];
}

export interface ConversationRunChunkMirrorPrepareChunkEventsInput {
  chunk: ChatUiMessageChunk<ChatMessageMetadata>;
  defaultPrepare: () => ConversationRunEvent[];
}

export interface ConversationRunChunkMirrorPrepareExternalEventsInput {
  events: ConversationRunEvent[];
  defaultPrepare: () => ConversationRunEvent[];
}

interface ConversationRunChunkMirrorSharedOptions {
  immediateFlushEventCount?: number;
  encoder?: ConversationRunEventEncoder;
  flushDelayMs?: number;
  getRetryDelayMs?: (consecutiveFailures: number) => number;
  onRetryScheduled?: (state: ConversationRunMirrorRetryScheduledState) => Promise<void> | void;
  onStopped?: (state: ConversationRunMirrorStoppedState) => Promise<void> | void;
  prepareChunkEvents?: (
    input: ConversationRunChunkMirrorPrepareChunkEventsInput,
  ) => Promise<ConversationRunEvent[]> | ConversationRunEvent[];
  prepareExternalEvents?: (
    input: ConversationRunChunkMirrorPrepareExternalEventsInput,
  ) => Promise<ConversationRunEvent[]> | ConversationRunEvent[];
  onChunkPrepared?: (input: ConversationRunChunkMirrorPreparedChunk) => Promise<void> | void;
  onExternalEventsPrepared?: (
    input: ConversationRunChunkMirrorPreparedEvents,
  ) => Promise<void> | void;
}

export interface ConversationRunChunkMirrorQueueOptions
  extends ConversationRunChunkMirrorSharedOptions {
  queueController: ConversationRunEventQueueController;
}

export interface ConversationRunChunkMirrorApiOptions
  extends ConversationRunChunkMirrorSharedOptions {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  latestEventId: number;
  latestExternalEventSequence?: number;
  maxEventsPerBatch?: number;
  maxCursorResyncsPerFlush?: number;
}

export type ConversationRunChunkMirrorOptions =
  | ConversationRunChunkMirrorQueueOptions
  | ConversationRunChunkMirrorApiOptions;

function resolveQueueController(
  input: ConversationRunChunkMirrorOptions,
): ConversationRunEventQueueController {
  if ("queueController" in input) {
    return input.queueController;
  }

  const maxEventsPerBatch = input.maxEventsPerBatch ?? DEFAULT_IMMEDIATE_FLUSH_EVENT_COUNT;
  return createConversationRunEventQueueController({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    conversationId: input.conversationId,
    runId: input.runId,
    latestEventId: input.latestEventId,
    latestExternalEventSequence: input.latestExternalEventSequence ?? 0,
    maxEventsPerBatch,
    maxCursorResyncsPerFlush: input.maxCursorResyncsPerFlush ??
      DEFAULT_MAX_CURSOR_RESYNCS_PER_FLUSH,
  });
}

export function createConversationRunChunkMirror(
  input: ConversationRunChunkMirrorOptions,
): ConversationRunChunkMirror {
  const encoder = input.encoder ?? new ConversationRunEventEncoder();
  const immediateFlushEventCount = input.immediateFlushEventCount ??
    DEFAULT_IMMEDIATE_FLUSH_EVENT_COUNT;
  const mirror = createConversationRunMirror({
    queueController: resolveQueueController(input),
    immediateFlushEventCount,
    ...(input.flushDelayMs !== undefined ? { flushDelayMs: input.flushDelayMs } : {}),
    ...(input.getRetryDelayMs ? { getRetryDelayMs: input.getRetryDelayMs } : {}),
    ...(input.onRetryScheduled ? { onRetryScheduled: input.onRetryScheduled } : {}),
    ...(input.onStopped ? { onStopped: input.onStopped } : {}),
  });

  return {
    async handleChunk(chunk) {
      if (mirror.getSnapshot().disabled) {
        return;
      }

      const events = await (input.prepareChunkEvents?.({
        chunk,
        defaultPrepare: () => prepareConversationRunChunkEvents([chunk], encoder),
      }) ?? prepareConversationRunChunkEvents([chunk], encoder));
      await input.onChunkPrepared?.({ chunk, events });
      if (events.length === 0) {
        return;
      }

      mirror.enqueue(events);
    },
    async appendEvents(events) {
      if (mirror.getSnapshot().disabled || events.length === 0) {
        return;
      }

      const normalizedEvents = await (input.prepareExternalEvents?.({
        events,
        defaultPrepare: () => prepareConversationRunExternalEvents(events),
      }) ?? prepareConversationRunExternalEvents(events));
      await input.onExternalEventsPrepared?.({ events: normalizedEvents });
      if (normalizedEvents.length === 0) {
        return;
      }

      mirror.enqueue(normalizedEvents);
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
