import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import { type ConversationRunEvent, ConversationRunEventEncoder } from "./run-events.ts";
import {
  type ConversationRunMirror,
  type ConversationRunMirrorHighBacklogState,
  type ConversationRunMirrorRetryScheduledState,
  type ConversationRunMirrorSnapshot,
  type ConversationRunMirrorStoppedState,
  createConversationRunMirror,
} from "./run-mirror.ts";
import {
  prepareConversationRunChunkEvents,
  prepareConversationRunExternalEvents,
} from "./run-event-preparation.ts";
import {
  type ConversationRunEventQueueController,
  createConversationRunEventQueueController,
} from "./durable.ts";

const DEFAULT_IMMEDIATE_FLUSH_EVENT_COUNT = 24;
const DEFAULT_MAX_CURSOR_RESYNCS_PER_FLUSH = 3;
const DEFAULT_HOSTED_CHUNK_MIRROR_BATCH_SIZE = 24;
const DEFAULT_HOSTED_CHUNK_MIRROR_HIGH_BACKLOG_EVENT_COUNT = 500;

/** Public API contract for conversation run chunk mirror. */
export interface ConversationRunChunkMirror {
  /** Executes chunk. */
  handleChunk(chunk: ChatUiMessageChunk<ChatMessageMetadata>): Promise<void>;
  /** Appends events. */
  appendEvents(events: ConversationRunEvent[]): Promise<void>;
  /** Performs the flush operation. */
  flush(): Promise<ConversationRunMirrorSnapshot>;
  /** Returns snapshot. */
  getSnapshot(): ReturnType<ConversationRunMirror["getSnapshot"]>;
  /** Releases resources used by dispose. */
  dispose(): void;
}

/** Public API contract for conversation run chunk mirror prepared chunk. */
export interface ConversationRunChunkMirrorPreparedChunk {
  /** Chunk value. */
  chunk: ChatUiMessageChunk<ChatMessageMetadata>;
  /** Events value. */
  events: ConversationRunEvent[];
}

/** Public API contract for conversation run chunk mirror prepared events. */
export interface ConversationRunChunkMirrorPreparedEvents {
  /** Events value. */
  events: ConversationRunEvent[];
}

/** Input payload for conversation run chunk mirror prepare chunk events. */
export interface ConversationRunChunkMirrorPrepareChunkEventsInput {
  /** Chunk value. */
  chunk: ChatUiMessageChunk<ChatMessageMetadata>;
  /** Callback that handles default prepare. */
  defaultPrepare: () => ConversationRunEvent[];
}

/** Input payload for conversation run chunk mirror prepare external events. */
export interface ConversationRunChunkMirrorPrepareExternalEventsInput {
  /** Events value. */
  events: ConversationRunEvent[];
  /** Callback that handles default prepare. */
  defaultPrepare: () => ConversationRunEvent[];
}

/** Shared batching and lifecycle options for conversation run chunk mirrors. */
export interface ConversationRunChunkMirrorSharedOptions {
  /** Event count that triggers an immediate flush. */
  immediateFlushEventCount?: number;
  /** Event encoder used to enforce payload limits. */
  encoder?: ConversationRunEventEncoder;
  /** Maximum delay before queued events are flushed. */
  flushDelayMs?: number;
  /** Resolves retry delay from the current consecutive failure count. */
  getRetryDelayMs?: (consecutiveFailures: number) => number;
  /** Queue depth that triggers the high-backlog callback. */
  highBacklogEventCount?: number;
  /** Called when the mirror reaches the configured backlog threshold. */
  onHighBacklog?: (state: ConversationRunMirrorHighBacklogState) => Promise<void> | void;
  /** Called when a failed flush schedules a retry. */
  onRetryScheduled?: (state: ConversationRunMirrorRetryScheduledState) => Promise<void> | void;
  /** Called when the mirror stops accepting events. */
  onStopped?: (state: ConversationRunMirrorStoppedState) => Promise<void> | void;
  /** Prepares durable events for one UI chunk. */
  prepareChunkEvents?: (
    input: ConversationRunChunkMirrorPrepareChunkEventsInput,
  ) => Promise<ConversationRunEvent[]> | ConversationRunEvent[];
  /** Prepares externally supplied durable events. */
  prepareExternalEvents?: (
    input: ConversationRunChunkMirrorPrepareExternalEventsInput,
  ) => Promise<ConversationRunEvent[]> | ConversationRunEvent[];
  /** Called after a UI chunk is converted to durable events. */
  onChunkPrepared?: (input: ConversationRunChunkMirrorPreparedChunk) => Promise<void> | void;
  /** Called after external events are prepared. */
  onExternalEventsPrepared?: (
    input: ConversationRunChunkMirrorPreparedEvents,
  ) => Promise<void> | void;
}

/** Options accepted by conversation run chunk mirror queue. */
export interface ConversationRunChunkMirrorQueueOptions
  extends ConversationRunChunkMirrorSharedOptions {
  /** Queue controller value. */
  queueController: ConversationRunEventQueueController;
}

/** Options accepted by conversation run chunk mirror API. */
export interface ConversationRunChunkMirrorApiOptions
  extends ConversationRunChunkMirrorSharedOptions {
  /** Bearer token used for authenticated API requests. */
  authToken: string;
  /** Base URL for Veryfront API requests. */
  apiUrl: string;
  /** Conversation ID value. */
  conversationId: string;
  /** Run ID value. */
  runId: string;
  /** Latest event ID value. */
  latestEventId: number;
  /** Latest external event sequence value. */
  latestExternalEventSequence?: number;
  /** Max events per batch value. */
  maxEventsPerBatch?: number;
  /** Max cursor resyncs per flush value. */
  maxCursorResyncsPerFlush?: number;
}

/** Options accepted by conversation run chunk mirror. */
export type ConversationRunChunkMirrorOptions =
  | ConversationRunChunkMirrorQueueOptions
  | ConversationRunChunkMirrorApiOptions;

/** Public API contract for hosted conversation run chunk mirror trace attributes. */
export type HostedConversationRunChunkMirrorTraceAttributes = Record<
  string,
  string | number | boolean | null | undefined
>;

/** Public API contract for hosted conversation run chunk mirror instrumentation. */
export interface HostedConversationRunChunkMirrorInstrumentation {
  /** Callback that handles trace. */
  trace?: <T>(operationName: string, operation: () => Promise<T>) => Promise<T>;
  /** Callback that handles set trace attributes. */
  setTraceAttributes?: (attributes: HostedConversationRunChunkMirrorTraceAttributes) => void;
  /** Callback that handles debug. */
  debug?: (message: string, metadata: Record<string, unknown>) => void;
  /** Writes a warning log entry. */
  warn?: (message: string, metadata: Record<string, unknown>) => void;
  /** Writes an error log entry. */
  error?: (message: string, metadata: Record<string, unknown>) => void;
}

/** Options accepted by hosted conversation run chunk mirror. */
export interface HostedConversationRunChunkMirrorOptions {
  /** Bearer token used for authenticated API requests. */
  authToken: string;
  /** Base URL for Veryfront API requests. */
  apiUrl: string;
  /** Conversation ID value. */
  conversationId: string;
  /** Run ID value. */
  runId: string;
  /** Latest event ID value. */
  latestEventId: number;
  /** Latest external event sequence value. */
  latestExternalEventSequence?: number;
  /** Batch size value. */
  batchSize?: number;
  /** High backlog event count value. */
  highBacklogEventCount?: number;
  /** Instrumentation value. */
  instrumentation?: HostedConversationRunChunkMirrorInstrumentation;
}

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

/** Create conversation run chunk mirror. */
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
    ...(input.highBacklogEventCount !== undefined
      ? { highBacklogEventCount: input.highBacklogEventCount }
      : {}),
    ...(input.onHighBacklog ? { onHighBacklog: input.onHighBacklog } : {}),
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

function createHostedChunkMirrorRetryMetadata(input: {
  conversationId: string;
  runId: string;
  errorMessage: string;
  retryDelayMs: number;
  pendingEventCount: number;
  consecutiveFailures: number;
}): Record<string, unknown> {
  return {
    conversationId: input.conversationId,
    runId: input.runId,
    error: input.errorMessage,
    retryDelayMs: input.retryDelayMs,
    pendingEventCount: input.pendingEventCount,
    consecutiveFailures: input.consecutiveFailures,
  };
}

async function runHostedChunkMirrorTrace<T>(
  instrumentation: HostedConversationRunChunkMirrorInstrumentation | undefined,
  operationName: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (instrumentation?.trace) {
    return await instrumentation.trace(operationName, operation);
  }

  return await operation();
}

function recordHostedChunkMirrorRetryScheduled(input: {
  instrumentation: HostedConversationRunChunkMirrorInstrumentation | undefined;
  conversationId: string;
  runId: string;
  flushAttempt: ConversationRunMirrorRetryScheduledState;
}): void {
  input.instrumentation?.error?.(
    "Durable run mirror flush failed; queued for retry",
    createHostedChunkMirrorRetryMetadata({
      conversationId: input.conversationId,
      runId: input.runId,
      errorMessage: input.flushAttempt.errorMessage ?? "Conversation run append failed",
      retryDelayMs: input.flushAttempt.retryDelayMs,
      pendingEventCount: input.flushAttempt.pendingEventCount,
      consecutiveFailures: input.flushAttempt.consecutiveFailures,
    }),
  );
}

function recordHostedChunkMirrorHighBacklog(input: {
  instrumentation: HostedConversationRunChunkMirrorInstrumentation | undefined;
  conversationId: string;
  runId: string;
  backlog: ConversationRunMirrorHighBacklogState;
}): void {
  input.instrumentation?.warn?.("Durable run mirror backlog is high", {
    conversationId: input.conversationId,
    runId: input.runId,
    pendingEventCount: input.backlog.pendingEventCount,
    consecutiveFailures: input.backlog.consecutiveFailures,
    threshold: input.backlog.threshold,
  });
}

function recordHostedChunkMirrorStopped(input: {
  instrumentation: HostedConversationRunChunkMirrorInstrumentation | undefined;
  conversationId: string;
  runId: string;
  flushAttempt: ConversationRunMirrorStoppedState;
}): void {
  if (input.flushAttempt.disableReason === "cursor_resyncs_exhausted") {
    input.instrumentation?.error?.(
      "Disabling durable run mirroring after repeated cursor resync failures",
      {
        conversationId: input.conversationId,
        runId: input.runId,
      },
    );
    return;
  }

  if (input.flushAttempt.disableReason === "payload_too_large") {
    input.instrumentation?.error?.(
      "Disabling durable run mirroring after an oversized event was rejected; " +
        "an event exceeded the durable payload limit despite normalization",
      {
        conversationId: input.conversationId,
        runId: input.runId,
        latestEventId: input.flushAttempt.latestEventId,
        latestExternalEventSequence: input.flushAttempt.latestExternalEventSequence,
      },
    );
    return;
  }

  if (input.flushAttempt.disableReason === "auth_rejected") {
    input.instrumentation?.error?.(
      "Disabling durable run mirroring after permanent append authentication rejection",
      {
        conversationId: input.conversationId,
        runId: input.runId,
        latestEventId: input.flushAttempt.latestEventId,
        latestExternalEventSequence: input.flushAttempt.latestExternalEventSequence,
      },
    );
    return;
  }

  if (input.flushAttempt.disableReason === "ignorable_append_rejection") {
    input.instrumentation?.warn?.(
      "Disabling durable run mirroring after external append rejection",
      {
        conversationId: input.conversationId,
        runId: input.runId,
      },
    );
    return;
  }

  if (input.flushAttempt.disableReason === "non_appendable") {
    input.instrumentation?.warn?.(
      "Disabling durable run mirroring after cursor mismatch reached a non-appendable run state",
      {
        conversationId: input.conversationId,
        runId: input.runId,
        latestEventId: input.flushAttempt.latestEventId,
        latestExternalEventSequence: input.flushAttempt.latestExternalEventSequence,
      },
    );
  }
}

/** Create hosted conversation run chunk mirror. */
export function createHostedConversationRunChunkMirror(
  input: HostedConversationRunChunkMirrorOptions,
): ConversationRunChunkMirror {
  const batchSize = input.batchSize ?? DEFAULT_HOSTED_CHUNK_MIRROR_BATCH_SIZE;
  const highBacklogEventCount = input.highBacklogEventCount ??
    DEFAULT_HOSTED_CHUNK_MIRROR_HIGH_BACKLOG_EVENT_COUNT;

  return createConversationRunChunkMirror({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    conversationId: input.conversationId,
    runId: input.runId,
    latestEventId: input.latestEventId,
    latestExternalEventSequence: input.latestExternalEventSequence,
    maxEventsPerBatch: batchSize,
    maxCursorResyncsPerFlush: DEFAULT_MAX_CURSOR_RESYNCS_PER_FLUSH,
    immediateFlushEventCount: batchSize,
    highBacklogEventCount,
    prepareChunkEvents: ({ chunk, defaultPrepare }) =>
      runHostedChunkMirrorTrace(input.instrumentation, "durable.mirrorChunk", async () => {
        const events = defaultPrepare();
        input.instrumentation?.setTraceAttributes?.({
          "conversation.id": input.conversationId,
          "run.id": input.runId,
          "stream.ui_chunk.type": chunk.type,
          "durable.event_count": events.length,
        });
        input.instrumentation?.debug?.("Durable run mirror processed UI chunk", {
          conversationId: input.conversationId,
          runId: input.runId,
          chunkType: chunk.type,
          durableEventTypes: events.map((event) => event.type),
          durableEventCount: events.length,
        });
        return events;
      }),
    prepareExternalEvents: ({ defaultPrepare }) =>
      runHostedChunkMirrorTrace(input.instrumentation, "durable.mirrorAppendEvents", async () => {
        const events = defaultPrepare();
        input.instrumentation?.setTraceAttributes?.({
          "conversation.id": input.conversationId,
          "run.id": input.runId,
          "durable.event_count": events.length,
        });
        input.instrumentation?.debug?.("Durable run mirror queued external events", {
          conversationId: input.conversationId,
          runId: input.runId,
          durableEventTypes: events.map((event) => event.type),
          durableEventCount: events.length,
        });
        return events;
      }),
    onRetryScheduled: (flushAttempt) => {
      recordHostedChunkMirrorRetryScheduled({
        instrumentation: input.instrumentation,
        conversationId: input.conversationId,
        runId: input.runId,
        flushAttempt,
      });
    },
    onHighBacklog: (backlog) => {
      recordHostedChunkMirrorHighBacklog({
        instrumentation: input.instrumentation,
        conversationId: input.conversationId,
        runId: input.runId,
        backlog,
      });
    },
    onStopped: (flushAttempt) => {
      recordHostedChunkMirrorStopped({
        instrumentation: input.instrumentation,
        conversationId: input.conversationId,
        runId: input.runId,
        flushAttempt,
      });
    },
  });
}
