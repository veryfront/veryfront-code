import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import {
  type AgentRunEventTimingOptions,
  createAgentRunEventTimingAnchor,
} from "../../runtime/model-call-context.ts";
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
  readonly timing?: AgentRunEventTimingOptions;
  handleChunk(chunk: ChatUiMessageChunk<ChatMessageMetadata>): Promise<void>;
  appendEvents(events: ConversationRunEvent[]): Promise<void>;
  flush(options?: {
    abortSignal?: AbortSignal;
    throwOnTimeoutRetry?: boolean;
  }): Promise<ConversationRunMirrorSnapshot>;
  getSnapshot(): ReturnType<ConversationRunMirror["getSnapshot"]>;
  dispose(): void;
}

/** Public API contract for conversation run chunk mirror prepared chunk. */
export interface ConversationRunChunkMirrorPreparedChunk {
  chunk: ChatUiMessageChunk<ChatMessageMetadata>;
  events: ConversationRunEvent[];
}

/** Public API contract for conversation run chunk mirror prepared events. */
export interface ConversationRunChunkMirrorPreparedEvents {
  events: ConversationRunEvent[];
}

/** Input payload for conversation run chunk mirror prepare chunk events. */
export interface ConversationRunChunkMirrorPrepareChunkEventsInput {
  chunk: ChatUiMessageChunk<ChatMessageMetadata>;
  defaultPrepare: () => ConversationRunEvent[];
}

/** Input payload for conversation run chunk mirror prepare external events. */
export interface ConversationRunChunkMirrorPrepareExternalEventsInput {
  events: ConversationRunEvent[];
  defaultPrepare: () => ConversationRunEvent[];
}

interface ConversationRunChunkMirrorSharedOptions {
  immediateFlushEventCount?: number;
  encoder?: ConversationRunEventEncoder;
  flushDelayMs?: number;
  getRetryDelayMs?: (consecutiveFailures: number) => number;
  highBacklogEventCount?: number;
  onHighBacklog?: (state: ConversationRunMirrorHighBacklogState) => Promise<void> | void;
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

/** Options accepted by conversation run chunk mirror queue. */
export interface ConversationRunChunkMirrorQueueOptions
  extends ConversationRunChunkMirrorSharedOptions {
  queueController: ConversationRunEventQueueController;
}

/** Options accepted by conversation run chunk mirror API. */
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
  /** Explicit host-owned transport for trusted runtime composition and tests. */
  fetch?: typeof globalThis.fetch;
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
  trace?: <T>(operationName: string, operation: () => Promise<T>) => Promise<T>;
  setTraceAttributes?: (attributes: HostedConversationRunChunkMirrorTraceAttributes) => void;
  debug?: (message: string, metadata: Record<string, unknown>) => void;
  warn?: (message: string, metadata: Record<string, unknown>) => void;
  error?: (message: string, metadata: Record<string, unknown>) => void;
}

/** Options accepted by hosted conversation run chunk mirror. */
export interface HostedConversationRunChunkMirrorOptions {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  latestEventId: number;
  latestExternalEventSequence?: number;
  batchSize?: number;
  highBacklogEventCount?: number;
  instrumentation?: HostedConversationRunChunkMirrorInstrumentation;
  /** Explicit host-owned transport for trusted runtime composition and tests. */
  fetch?: typeof globalThis.fetch;
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
    fetch: input.fetch,
  });
}

/** Create conversation run chunk mirror. */
export function createConversationRunChunkMirror(
  input: ConversationRunChunkMirrorOptions,
): ConversationRunChunkMirror {
  // The mirror owns one encoder for the whole run, so a clock installed here
  // makes every durable event carry a run-relative `elapsedMs`. Runs are
  // headless -- a scheduled run has no client attached -- so this is the only
  // point that observes emission time. Callers injecting their own encoder
  // choose their own clock, or none.
  const getEncoderTimingAnchor = input.encoder?.getTimingAnchor;
  const timing = typeof getEncoderTimingAnchor === "function"
    ? getEncoderTimingAnchor.call(input.encoder) ?? createAgentRunEventTimingAnchor()
    : createAgentRunEventTimingAnchor();
  const encoder = input.encoder ?? new ConversationRunEventEncoder(timing);
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
    timing,
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

      const stampedEvents = encoder.stamp(events);
      const preparedEvents = await (input.prepareExternalEvents?.({
        events: stampedEvents,
        defaultPrepare: () => prepareConversationRunExternalEvents(stampedEvents),
      }) ?? prepareConversationRunExternalEvents(stampedEvents));
      const normalizedEvents = prepareConversationRunExternalEvents(encoder.stamp(preparedEvents));
      await input.onExternalEventsPrepared?.({ events: normalizedEvents });
      if (normalizedEvents.length === 0) {
        return;
      }

      mirror.enqueue(normalizedEvents);
    },
    flush(options) {
      return mirror.flush(options);
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

// Retries are self-healing and back off to only a few seconds, so logging
// every attempt at error level turns one degraded append window into a Sentry
// error every few seconds per active run (VERYFRONT-AGENT-3). Escalate
// exactly once per failure streak, at the attempt where the streak first
// reaches this threshold: the counter increments by one per scheduled retry
// and resets to zero on a successful flush, so strict equality fires once
// and re-arms after recovery. Terminal stop/disable paths report at error
// level separately.
const HOSTED_CHUNK_MIRROR_RETRY_ERROR_THRESHOLD = 5;

function recordHostedChunkMirrorRetryScheduled(input: {
  instrumentation: HostedConversationRunChunkMirrorInstrumentation | undefined;
  conversationId: string;
  runId: string;
  flushAttempt: ConversationRunMirrorRetryScheduledState;
}): void {
  const metadata = createHostedChunkMirrorRetryMetadata({
    conversationId: input.conversationId,
    runId: input.runId,
    errorMessage: input.flushAttempt.errorMessage ?? "Conversation run append failed",
    retryDelayMs: input.flushAttempt.retryDelayMs,
    pendingEventCount: input.flushAttempt.pendingEventCount,
    consecutiveFailures: input.flushAttempt.consecutiveFailures,
  });
  const message = "Durable run mirror flush failed; queued for retry";
  if (input.flushAttempt.consecutiveFailures === HOSTED_CHUNK_MIRROR_RETRY_ERROR_THRESHOLD) {
    input.instrumentation?.error?.(message, metadata);
    return;
  }

  input.instrumentation?.warn?.(message, metadata);
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

  // veryfront-issue-inbox#743: the run finished server-side before the mirror
  // drained. Nothing is lost that the runtime can still write, so this is a clean
  // stop, not a failure.
  if (input.flushAttempt.disableReason === "run_terminal") {
    input.instrumentation?.warn?.(
      "Stopping durable run mirroring because the run is already terminal",
      {
        conversationId: input.conversationId,
        runId: input.runId,
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
    fetch: input.fetch,
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
